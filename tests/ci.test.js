// What CI runs and how it says what failed. npm test and npm run test:games end with the failing tests named: the spec
// reporter, given before the glob (npm test -- --x lands after the glob and becomes an argument, not a flag; and with
// no reporter, in CI node --test prints TAP, where a failure is somewhere in thousands of lines). Every action a
// workflow uses is pinned to a commit, its version beside it (a tag can be moved, a commit cannot: README, Trust).
// Deploy's check job has the whole history, which the mixed-version tests take the previous release from, and fails
// rather than skips them without it (IHROTEKA_NEED_PREVIOUS: tests/support/release.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const REPO = path.join(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
const WORKFLOWS = path.join(REPO, '.github', 'workflows');
const workflows = fs.readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f));

test('package.json: npm test and npm run test:games name the failing tests at the end (the spec reporter, before the glob)', () => {
  for (const name of ['test', 'test:games']) {
    const s = pkg.scripts[name], glob = s.indexOf('"');
    assert.match(s, /^node --test /, name);
    assert.ok(glob > 0, name + ': its files are a quoted glob: ' + s);
    assert.match(s.slice(0, glob), /\s--test-reporter=spec\s/, name + ': --test-reporter=spec before the glob: ' + s);
    assert.doesNotMatch(s.slice(s.indexOf('"', glob + 1) + 1), /--/, name + ': no flag after the glob: ' + s);
  }
  assert.match(pkg.scripts['test:games'], /\s--test-timeout=\d+\s/, 'a game\'s test that never ends fails in time');
  assert.match(pkg.engines?.node || '', /^>=\s*2[2-9]/, 'Node 22 or newer, as README and CI');
});

test('workflows: every action is pinned to a commit, with its version beside it', () => {
  assert.ok(workflows.length >= 2, workflows.join());
  for (const f of workflows) {
    const uses = fs.readFileSync(path.join(WORKFLOWS, f), 'utf8').split('\n').filter(l => /^\s*(-\s+)?uses:/.test(l));
    assert.ok(uses.length, f + ': uses actions');
    for (const l of uses) assert.match(l, /uses:\s*[\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+#\s*v\d+(\.\d+)*\s*$/, f + ': ' + l.trim());
  }
});

test('pages.yml: the check job has the whole history, and the tests need the previous release', () => {
  const y = fs.readFileSync(path.join(WORKFLOWS, 'pages.yml'), 'utf8');
  const check = y.slice(y.indexOf('\n  check:'), y.indexOf('\n  deploy:'));
  assert.match(check, /uses: actions\/checkout@[0-9a-f]{40}[^\n]*\n\s+with:\n(\s+[\w-]+: [^\n]+\n)*?\s+fetch-depth: 0\n/, 'checkout with fetch-depth: 0');
  assert.match(check, /persist-credentials: false/, 'no git credentials kept');
  assert.match(check, /- run: npm test\n\s+env:\n\s+IHROTEKA_NEED_PREVIOUS: '1'\n/, 'npm test with IHROTEKA_NEED_PREVIOUS');
});
