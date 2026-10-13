// A game's own tests gate its sealing: `npm run build` runs games/<id>/test/*.test.js (node:test) before it asks for
// the password, refuses to build when one fails, and `--no-tests` skips them. Works on a scratch copy (IHROTEKA_ROOT)
// with no keyring: a build that gets past the tests stops at the missing keyring, so nothing is ever sealed here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'cli.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VAULT_PASSWORDS?$/.test(k)));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-gate-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));

const write = (p, data) => { const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
const game = id => {
  write(`games/${id}/game.json`, JSON.stringify({ title: 'Test ' + id, tagline: 't', description: 'd', image: 'preview.png' }));
  write(`games/${id}/index.html`, '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>');
  write(`games/${id}/preview.png`, PNG);
};
const passing = 'import { test } from "node:test"; test("fine", () => {});';
// (a made-up password: the build must not hand it to a game's tests)
const build = (...args) => {
  const r = spawnSync(process.execPath, [CLI, 'build', ...args], { env: { ...ENV, IHROTEKA_ROOT: root, VAULT_PASSWORD: 'made-up' }, encoding: 'utf8' });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};
const pastTests = out => /No vault\/keyring\.json/.test(out);   // the build went on to the password and the keyring

test('a game without tests builds as before; with passing tests too, and they see no password', () => {
  game('plain');
  let r = build();
  assert.ok(!r.ok && pastTests(r.out) && !/tests/.test(r.out), r.out);
  game('tested');
  write('games/tested/test/a.test.js', passing);
  write('games/tested/test/env.test.js', 'import { test } from "node:test"; import assert from "node:assert"; test("no password", () => assert.equal(process.env.VAULT_PASSWORD, undefined));');
  write('games/tested/test/e2e/slow.e2e.cjs', 'process.exit(1);');      // browser scenarios are not run by the build
  write('games/tested/test/helper.js', 'throw new Error("not a test file");');
  r = build();
  assert.ok(pastTests(r.out), r.out);
  assert.match(r.out, /✓ tested: its tests pass \(2 files\)/);
});

test('a game whose tests fail is not built; --no-tests builds anyway', () => {
  game('broken');
  write('games/broken/test/a.test.js', passing);
  write('games/broken/test/b.test.js', 'import { test } from "node:test"; import assert from "node:assert"; test("a rule that broke", () => assert.equal(1 + 1, 3));');
  let r = build();
  assert.ok(!r.ok && !pastTests(r.out), r.out);
  assert.match(r.out, /games\/broken: its tests fail, so it is not sealed/);
  assert.match(r.out, /a rule that broke/);                          // with their report
  r = build('--no-tests');
  assert.ok(pastTests(r.out) && !/tests fail/.test(r.out), r.out);
  assert.match(r.out, /tests skipped \(--no-tests\)/);
  r = build('--no-test');
  assert.match(r.out, /Unknown option: --no-test/);
  fs.rmSync(path.join(root, 'games/broken'), { recursive: true });
});
