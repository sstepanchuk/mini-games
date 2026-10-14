// What the tests of mixed library versions need from the checkout (tests/support/release.js: the previous release, from
// git history): in CI the history must be there (not a shallow clone), or those tests would only skip, unseen. Locally it
// runs with CI=1. And which release it finds, in a small history of its own: the one this library replaces.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { noPrevious, previousRelease } from './support/release.js';

const REPO = fileURLToPath(new URL('../', import.meta.url));

test('CI has the history: a full clone, with a library of the older wire version to play against', { skip: !process.env.CI && 'only in CI (CI=1)' }, () => {
  assert.equal(execFileSync('git', ['rev-parse', '--is-shallow-repository'], { cwd: REPO }).toString().trim(), 'false', 'a shallow clone (fetch-depth: 0 in the workflow)');
  const dir = mkdtempSync(join(tmpdir(), 'ihroteka-history-'));
  try {
    assert.ok(previousRelease(dir, { older: true }), 'the release before this wire version: ' + noPrevious());
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// A: PROTO 1; B: PROTO 2; C: a library change; D: no library change. The previous release of a clean checkout is the
// library before its last change (B), and the older version's the one before B (A); a library edited and not committed
// yet is the next commit's, so it replaces HEAD's (D), as CI finds once that commit is in; an uncommitted PROTO 3 plays
// the older version against HEAD's.
test('the previous release is the library this one replaces, before and after its commit', async t => {
  const repo = mkdtempSync(join(tmpdir(), 'ihroteka-history-')), out = join(repo, '.out');
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (...a) => execFileSync('git', a, { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  const put = (f, s) => { mkdirSync(join(repo, f, '..'), { recursive: true }); writeFileSync(join(repo, f), s); };
  const commit = m => { git('add', '-A'); git('commit', '-q', '--no-gpg-sign', '-m', m); return git('rev-parse', '--short', 'HEAD'); };
  git('init', '-q');
  put('.gitignore', '.out/\n');
  mkdirSync(join(repo, 'tests/support'), { recursive: true });
  copyFileSync(fileURLToPath(new URL('./support/release.js', import.meta.url)), join(repo, 'tests/support/release.js'));
  put('library/net/config.js', 'export const PROTO = 1;\n'); put('library/a.js', '1\n');
  const A = commit('A');
  put('library/net/config.js', 'export const PROTO = 2;\n');
  const B = commit('B');
  put('library/a.js', '2\n');
  commit('C');
  put('README', 'docs\n');
  const D = commit('D');
  const { previousRelease, noPrevious } = await import(pathToFileURL(join(repo, 'tests/support/release.js')).href);
  const kept = [process.env.IHROTEKA_PREVIOUS, process.env.IHROTEKA_NEED_PREVIOUS];
  delete process.env.IHROTEKA_PREVIOUS; delete process.env.IHROTEKA_NEED_PREVIOUS;
  t.after(() => { for (const [k, v] of [['IHROTEKA_PREVIOUS', kept[0]], ['IHROTEKA_NEED_PREVIOUS', kept[1]]]) if (v !== undefined) process.env[k] = v; });
  const pick = o => { const r = previousRelease(out, o); return r ? [r.tag, r.proto, readFileSync(join(r.library, 'a.js'), 'utf8').trim()] : noPrevious(); };
  assert.deepEqual([pick(), pick({ older: true })], [[B, 2, '1'], [A, 1, '1']], 'a clean checkout');
  put('library/a.js', '3\n');
  assert.deepEqual([pick(), pick({ older: true })], [[D, 2, '2'], [A, 1, '1']], 'a library edited here: HEAD\'s is the one it replaces');
  put('library/net/config.js', 'export const PROTO = 3;\n');
  const same = pick();
  assert.match(String(same), /^other PROTO: \w+ speaks 2, this one 3/, 'a new PROTO here: none of this one');
  assert.deepEqual(pick({ older: true }), [D, 2, '2'], 'a new PROTO here: HEAD\'s is the older version');
});
