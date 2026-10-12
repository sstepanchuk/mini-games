// The library of an earlier release, to run in a worker tab next to this one (tab.js workerData.library): the newest
// tag reachable from HEAD whose library/ differs from this checkout's (IHROTEKA_PREVIOUS=<tag> picks one), extracted
// with git archive into dir → { tag, library: its library/ folder }, or null where there is none (no git, or no
// tags: CI's shallow clone).
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));

export function previousRelease(dir) {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  try {
    const tags = process.env.IHROTEKA_PREVIOUS ? [process.env.IHROTEKA_PREVIOUS] : git('tag', '--merged', 'HEAD', '--sort=-creatordate').toString().split('\n').filter(Boolean);
    for (const tag of tags) {
      try { git('diff', '--quiet', tag, '--', 'library'); continue; } catch (e) { if (e.status !== 1) throw e; }   // (the same library)
      const to = join(dir, 'prev');
      mkdirSync(to);
      execFileSync('tar', ['-x', '-C', to], { input: git('archive', tag, 'library') });
      return { tag, library: join(to, 'library') };
    }
  } catch (e) { /* no git, or no tags here */ }
  return null;
}
