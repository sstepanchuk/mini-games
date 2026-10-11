// End-to-end tests of the library tools and crypto, run against a scratch copy: npm test
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import * as vault from '../library/crypto.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPO, 'tools', 'cli.js');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
let root;
const pw = {};

const run = (args, password, input) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...process.env, IHROTEKA_ROOT: root, VAULT_PASSWORD: password }, encoding: 'utf8', input });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};
const must = (args, password, input) => { const r = run(args, password, input); assert.ok(r.ok, r.out); return r.out; };
const file = (...p) => path.join(root, ...p);
const write = (p, data) => { fs.mkdirSync(path.dirname(file(p)), { recursive: true }); fs.writeFileSync(file(p), data); };
const kr = () => JSON.parse(fs.readFileSync(file('vault/keyring.json'), 'utf8'));
const kidOf = p => vault.fileKid(fs.readFileSync(file(p)));
const libKey = async password => { const k = kr(), who = await vault.signIn(k, password); return vault.importKey(await vault.libraryKey(k, who.person.id, who.priv)); };
const game = (id, extra = {}) => {
  write(`games/${id}/game.json`, JSON.stringify({ title: 'Test ' + id, tagline: 't', description: 'd', image: 'preview.png', ...extra }));
  write(`games/${id}/index.html`, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><img src="dot.png"><script type="module" src="main.js"></script></body></html>');
  write(`games/${id}/style.css`, 'body{background:url(dot.png)}');
  write(`games/${id}/main.js`, 'import { hi } from "./lib/hi.js"; document.title = hi;');
  write(`games/${id}/lib/hi.js`, 'export const hi = "hello";');
  write(`games/${id}/dot.png`, PNG);
  write(`games/${id}/preview.png`, PNG);
};

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-'));
  fs.writeFileSync(file('package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
  const out = must(['init', 'alice', 'bob']);
  for (const m of out.matchAll(/^\s+(\w+)\s+(\S+)$/gm)) pw[m[1]] = m[2];
  game('demo');
});

after(() => fs.rmSync(root, { recursive: true, force: true }));

test('init, build and check', () => {
  assert.ok(pw.alice && pw.bob);
  assert.match(must(['build'], pw.alice), /demo/);
  assert.match(must(['check']), /valid: 1 game/);
  assert.match(must(['build'], pw.alice), /unchanged/);                       // nothing changed → nothing rewritten
  for (const p of ['vault/demo/game.bin', 'vault/demo/source.bin']) assert.equal(kidOf(p), kr().kid);
});

test('the site is assembled from library/ and vault/, and works offline: every file is in the service worker', () => {
  const sw = fs.readFileSync(file('site/sw.js'), 'utf8');
  for (const f of ['""', '"demo/"', '"demo/game.bin"', '"keyring.json"', '"library.json"', '"lib/ihroteka.js"', '"lib/qr-scan.js"', '"manifest.webmanifest"', '"icons/icon-512.png"']) assert.ok(sw.includes(f), f);
  assert.ok(!sw.includes('"sw.js"') && !sw.includes('index.html'));
  assert.match(sw, /fonts\.googleapis\.com/);
  assert.equal(JSON.parse(fs.readFileSync(file('site/manifest.webmanifest'), 'utf8')).display, 'standalone');
  assert.match(fs.readFileSync(file('site/demo/index.html'), 'utf8'), /boot\(\{"game":"demo"\}\)/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('site/library.json'), 'utf8')).map(g => g.id), ['demo']);
  // no password needed, and the same vault gives the same site
  const before = fs.readFileSync(file('site/sw.js'));
  must(['site']);
  assert.ok(fs.readFileSync(file('site/sw.js')).equals(before));
});

test('the game page is one self-contained module page with the library API', async () => {
  const plain = await vault.openFile(await libKey(pw.bob), fs.readFileSync(file('vault/demo/game.bin')), vault.label.game('demo'));
  assert.deepEqual([...plain.subarray(0, 2)], [0x1f, 0x8b]);                  // sealed gzipped
  const html = await vault.gameText(plain);
  assert.match(html, /window\.ihroteka/);
  assert.match(html, /<script type="module">/);
  assert.doesNotMatch(html, /src="(?!data:)|href="(?!data:)/);              // every relative reference was inlined
  assert.match(html, /hello/);
});

test('wrong password is refused', () => {
  const r = run(['unlock'], 'not-a-password');
  assert.ok(!r.ok);
  assert.match(r.out, /Wrong password/);
});

test('unlock restores sources exactly and protects local changes', () => {
  const before = fs.readFileSync(file('games/demo/main.js'), 'utf8');
  fs.rmSync(file('games'), { recursive: true });
  must(['unlock'], pw.bob);
  assert.equal(fs.readFileSync(file('games/demo/main.js'), 'utf8'), before);
  write('games/demo/main.js', '// local edit');
  write('games/demo/extra.txt', 'x');
  assert.match(must(['unlock'], pw.bob), /local changes in extra\.txt, main\.js/);
  assert.equal(fs.readFileSync(file('games/demo/main.js'), 'utf8'), '// local edit');
  must(['unlock', '--force'], pw.bob);
  assert.equal(fs.readFileSync(file('games/demo/main.js'), 'utf8'), before);
  assert.ok(!fs.existsSync(file('games/demo/extra.txt')));
});

test('unlock refuses an archive with paths outside the game folder', async () => {
  const good = fs.readFileSync(file('vault/demo/source.bin')), key = await libKey(pw.bob);
  const evil = zlib.gzipSync(JSON.stringify({ v: 1, files: { '../../escaped.txt': Buffer.from('x').toString('base64') } }));
  fs.writeFileSync(file('vault/demo/source.bin'), await vault.sealFile(key, kr().kid, evil, vault.label.source('demo')));
  const r = run(['unlock', '--force'], pw.bob);
  fs.writeFileSync(file('vault/demo/source.bin'), good);
  assert.ok(!r.ok);
  assert.match(r.out, /unsafe path/);
  assert.ok(!fs.existsSync(path.join(root, '..', 'escaped.txt')) && !fs.existsSync(file('escaped.txt')));
});

test('removing a person rotates the key; their password stops working', () => {
  const pwCarol = must(['user', 'add', 'carol'], pw.alice).match(/shown once\): (\S+)/)[1];
  const oldKid = kr().kid;
  must(['user', 'remove', 'carol'], pw.alice);
  assert.notEqual(kr().kid, oldKid);
  for (const p of ['vault/demo/game.bin', 'vault/demo/source.bin']) assert.equal(kidOf(p), kr().kid);
  assert.ok(!run(['unlock'], pwCarol).ok);
  assert.match(must(['user', 'list']), /alice/);                             // names are public: no password needed
  assert.doesNotMatch(must(['user', 'list']), /carol/);
  assert.match(must(['build'], pw.bob), /unchanged/);
  assert.match(must(['check']), /valid/);
  assert.ok(!run(['user', 'remove', 'alice'], pw.alice).ok);                // not yourself
});

test('a failed rotation writes nothing', () => {
  const k = kr(), stale = fs.readFileSync(file('vault/demo/source.bin'));
  const bad = Buffer.from(stale); bad[1] ^= 0xff;                              // pretend a file was sealed with another key
  fs.writeFileSync(file('vault/demo/source.bin'), bad);
  const game = fs.readFileSync(file('vault/demo/game.bin'));
  const r = run(['user', 'remove', 'bob'], pw.alice);
  assert.ok(!r.ok);
  assert.match(r.out, /another library key/);
  assert.deepEqual(kr(), k);
  assert.ok(fs.readFileSync(file('vault/demo/game.bin')).equals(game));
  fs.writeFileSync(file('vault/demo/source.bin'), stale);
});

test('a new password replaces the keys, so the old one opens nothing', async () => {
  const before = kr();
  const out = must(['user', 'passwd'], pw.bob, '\n');                         // empty answer → generated password
  const fresh = out.match(/New password: (\S+)/)[1];
  const after = kr();
  assert.ok(!run(['unlock'], pw.bob).ok);
  assert.ok(run(['unlock'], fresh).ok);
  // someone with the old keyring (git history) and the old password: their private key no longer opens the box,
  // and the old box holds a library key that no longer opens anything
  const old = await vault.signIn(before, pw.bob);
  await assert.rejects(vault.libraryKey(after, old.person.id, old.priv));
  assert.notEqual(await vault.keyId(await vault.libraryKey(before, old.person.id, old.priv)), after.kid);
  for (const p of ['vault/demo/game.bin', 'vault/demo/source.bin']) assert.equal(kidOf(p), after.kid);
  pw.bob = fresh;
});

test('a password can be typed through a pipe (asked, then repeated)', () => {
  const next = 'pipe-typed-password-1';
  must(['user', 'passwd'], pw.bob, next + '\n' + next + '\n');
  assert.ok(run(['unlock'], next).ok);
  pw.bob = next;
  assert.ok(!run(['user', 'passwd'], pw.bob, next + '\n').ok);                 // no repeat: refused, nothing changed
  assert.ok(run(['unlock'], next).ok);
});

test('check catches stale keys and unexpected files', () => {
  write('vault/demo/main.js', 'secret');
  assert.match(run(['check']).out, /main\.js: unexpected file/);
  write('vault/demo/.notes', 'secret');                                        // hidden files too
  assert.match(run(['check']).out, /\.notes: unexpected file/);
  fs.rmSync(file('vault/demo/.notes'));
  assert.ok(!run(['site']).ok);                                              // nothing is published from a vault that fails the check
  fs.rmSync(file('vault/demo/main.js'));
  const good = fs.readFileSync(file('vault/demo/game.bin')), bad = Buffer.from(good); bad[2] ^= 1;
  fs.writeFileSync(file('vault/demo/game.bin'), bad);
  assert.match(run(['check']).out, /old library key/);
  fs.writeFileSync(file('vault/demo/game.bin'), good);
  assert.ok(run(['check']).ok);
});

test('manifests and pages are validated', () => {
  const cases = [
    [{ image: '../x.png' }, /image/], [{ colour: 'red' }, /unknown field/], [{ emoji: '<' }, /emoji/], [{ title: '' }, /title/]
  ];
  for (const [extra, msg] of cases) { game('bad', extra); assert.match(run(['build'], pw.alice).out, msg); }
  game('bad');
  write('games/bad/index.html', '<html><head></head><body></body></html>');
  assert.match(run(['build'], pw.alice).out, /doctype/);
  write('games/bad/index.html', '<!doctype html><html><head></head><body><a href="other.html">x</a></body></html>');
  assert.match(run(['build'], pw.alice).out, /would not exist on the site/);
  fs.rmSync(file('games/bad'), { recursive: true });
  game('lib');
  assert.match(run(['build'], pw.alice).out, /folder name/);
  fs.rmSync(file('games/lib'), { recursive: true });
});

test('remove-game takes a game off the shelf', () => {
  game('extra');
  must(['build'], pw.alice);
  assert.match(must(['check']), /2 game/);
  must(['remove-game', 'extra'], pw.alice);
  assert.ok(!fs.existsSync(file('vault/extra')) && !fs.existsSync(file('games/extra')));
  assert.match(must(['check']), /1 game/);
});

test('dev server stays inside its folder and survives bad requests', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const server = spawn(process.execPath, [CLI, 'dev', String(port)], { env: { ...process.env, IHROTEKA_ROOT: root } });
  await new Promise(r => server.stdout.once('data', r));
  const get = p => new Promise(r => http.get({ host: '127.0.0.1', port, path: p }, res => { res.resume(); r(res.statusCode); }));
  try {
    fs.mkdirSync(file('games-backup'), { recursive: true }); fs.writeFileSync(file('games-backup/x'), 'x');
    assert.equal(await get('/..%2fgames-backup/x'), 403);
    assert.equal(await get('/%E0%A4%A'), 400);
    assert.equal(await get('/'), 200);                                        // the library, around the games
    assert.equal(await get('/demo/'), 200);
    assert.equal(await get('/demo/?frame'), 200);                              // the game itself, inside the library's frame
    assert.equal(await get('/lib/ihroteka.js'), 200);
    assert.equal(await get('/icons/..%2f..%2fpackage.json'), 403);
  } finally { server.kill(); }
});
