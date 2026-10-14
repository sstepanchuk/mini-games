// The library of an earlier release, to run in a worker tab next to this one (tab.js workerData.library), found in git
// history (no tags needed), as each test needs it:
//   previousRelease(dir)                   the same wire version (config.js PROTO; tests/app/release.test.js): the
//                                          library as it was just before its last change (the first parent of the newest
//                                          commit on the first-parent line that touched library/). Right after a PROTO
//                                          bump that one speaks the older version: none then (a library of another
//                                          version is never linked with this one, so it plays no game with it).
//   previousRelease(dir, { older: true })  the older wire version (tests/net/version.test.js): the library just before
//                                          the commit that set this PROTO, which must speak PROTO - 1. A library with no
//                                          PROTO line is from before versions: none (it never counts as version 1).
// A library edited here and not committed yet is the next commit's: the library it replaces is HEAD's (for either, when
// it speaks the version asked), the same one CI finds once that commit is in.
// IHROTEKA_PREVIOUS=<rev> picks one instead (if it fits). Extracted with git archive into dir → { tag: its commit (short),
// proto, library: its library/ folder }, or null, and noPrevious() then says why: a shallow clone (CI's default
// checkout: no history), no git, the same library as this one, another PROTO, from before versions. With
// IHROTEKA_NEED_PREVIOUS=1 (CI) a shallow clone or no git throws instead: the mixed-version tests must not skip unseen.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../../', import.meta.url));
// the wire version a library's config.js says (null: none, a library from before the number)
const protoOf = src => { const m = src.match(/^export const PROTO = (\d+);/m); return m ? +m[1] : null; };
let why = '';
// why the last previousRelease found none ('' when it found one)
export const noPrevious = () => why;

export function previousRelease(dir, { older = false } = {}) {
  const git = (...a) => execFileSync('git', a, { cwd: REPO, stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 28 });
  const text = (...a) => git(...a).toString().trim();
  const none = reason => { why = reason; return null; };
  const need = reason => {
    if (process.env.IHROTEKA_NEED_PREVIOUS === '1') throw new Error('tests/support/release.js: ' + reason + ', and IHROTEKA_NEED_PREVIOUS=1 needs the previous release');
    return none(reason);
  };
  why = '';
  const ours = protoOf(readFileSync(join(REPO, 'library/net/config.js'), 'utf8'));   // (this checkout's: what the tabs run)
  let shallow;
  try { shallow = text('rev-parse', '--is-shallow-repository'); } catch (e) { return need('no git: ' + (e.code || 'not a repository')); }
  if (shallow === 'true') return need('shallow clone: no history to find it in (fetch-depth: 0)');
  // A library changed here and not yet committed: the next commit is its last change, so the one it replaces is HEAD's
  // (as CI will find it once that commit is in: the same pair, before and after the commit)
  let edited = false;
  try { git('diff', '--quiet', 'HEAD', '--', 'library'); } catch (e) { if (e.status !== 1) throw e; edited = true; }
  let rev = process.env.IHROTEKA_PREVIOUS;
  if (!rev && !older) rev = edited ? 'HEAD' : text('rev-list', '-1', '--first-parent', 'HEAD', '--', 'library') + '^';
  if (!rev) {
    const set = text('log', '--format=%H', '-S', 'export const PROTO = ' + ours + ';', '--', 'library/net/config.js').split('\n').filter(Boolean).pop();
    if (set) rev = set + '^';
    else if (edited) rev = 'HEAD';                     // (this PROTO is set here, not committed yet)
    else return none('from before versions: no commit set PROTO = ' + ours);
  }
  let tag, proto;
  try { tag = text('rev-parse', '--short', rev); proto = protoOf(git('show', rev + ':library/net/config.js').toString()); } catch (e) { return none('no such release here: ' + rev); }
  if (proto === null) return none('from before versions: ' + tag + ' says no PROTO');
  if (process.env.IHROTEKA_PREVIOUS ? (older ? proto >= ours : proto !== ours) : proto !== (older ? ours - 1 : ours)) {
    return none('other PROTO: ' + tag + ' speaks ' + proto + ', this one ' + ours + (older || process.env.IHROTEKA_PREVIOUS ? '' : ' (the last library change changed PROTO)'));
  }
  try { git('diff', '--quiet', rev, '--', 'library'); return none('same library: ' + tag + '\'s library is this one'); } catch (e) { if (e.status !== 1) throw e; }
  const to = join(dir, 'prev-' + tag);
  mkdirSync(to, { recursive: true });
  execFileSync('tar', ['-x', '-C', to], { input: git('archive', rev, 'library') });
  return { tag, proto, library: join(to, 'library') };
}
