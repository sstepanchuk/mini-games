// The library of an earlier release, to run in a worker tab next to this one (tab.js workerData.library): the newest
// tag reachable from HEAD whose library/ differs from this checkout's and that speaks this one's wire version
// (config.js PROTO: one that does not is never linked with it, so it plays no game with it; tests/app/release.test.js),
// or with { older: true } the newest one that speaks an older version (tests/net/version.test.js). IHROTEKA_PREVIOUS=<tag>
// picks one (if it fits). Extracted with git archive into dir → { tag, proto, library: its library/ folder }, or null
// where there is none (no git, no tags: CI's shallow clone; or none that fits, as right after a PROTO bump).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
// the wire version a library's config.js says (none: 1, the version of a library from before the number)
const protoOf = src => +((src.match(/^export const PROTO = (\d+);/m) || [])[1] || 1);

export function previousRelease(dir, { older = false } = {}) {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  const ours = protoOf(readFileSync(join(REPO, 'library/net/config.js'), 'utf8'));
  try {
    const tags = process.env.IHROTEKA_PREVIOUS ? [process.env.IHROTEKA_PREVIOUS] : git('tag', '--merged', 'HEAD', '--sort=-creatordate').toString().split('\n').filter(Boolean);
    for (const tag of tags) {
      try { git('diff', '--quiet', tag, '--', 'library'); continue; } catch (e) { if (e.status !== 1) throw e; }   // (the same library)
      const proto = protoOf(git('show', tag + ':library/net/config.js').toString());
      if (older ? proto >= ours : proto !== ours) continue;
      const to = join(dir, 'prev-' + tag.replace(/[^\w.-]/g, '_'));
      mkdirSync(to);
      execFileSync('tar', ['-x', '-C', to], { input: git('archive', tag, 'library') });
      return { tag, proto, library: join(to, 'library') };
    }
  } catch (e) { /* no git, or no tags here */ }
  return null;
}
