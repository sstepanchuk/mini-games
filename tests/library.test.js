// End-to-end tests of the library tools and crypto: npm test. A small library is made once (alice and bob with
// generated passwords, one game, built), and each test works on its own copy of it (IHROTEKA_ROOT), so a test runs
// alone (--test-name-pattern) or in any order, and nothing outside the copies changes. The tools never see a
// VAULT_PASSWORD from the environment: only the made-up passwords of these copies.
import { test, before, beforeEach, after } from 'node:test';
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
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VAULT_PASSWORDS?$/.test(k)));
let root;                                              // this test's copy
let made, built;                                       // made once: the library with its game; the same, built
const pw = {}, madePw = {};                            // this test's passwords; those of the library as made
const dirs = [];

const run = (args, password, input) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...ENV, IHROTEKA_ROOT: root, ...(password !== undefined && { VAULT_PASSWORD: password }) }, encoding: 'utf8', input });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
};
const must = (args, password, input) => { const r = run(args, password, input); assert.ok(r.ok, r.out); return r.out; };
const file = (...p) => path.join(root, ...p);
const write = (p, data) => { fs.mkdirSync(path.dirname(file(p)), { recursive: true }); fs.writeFileSync(file(p), data); };
const kr = () => JSON.parse(fs.readFileSync(file('vault/keyring.json'), 'utf8'));
const kidOf = p => vault.fileKid(fs.readFileSync(file(p)));
const libKey = async password => { const k = kr(), who = await vault.signIn(k, password); return vault.importKey(await vault.libraryKey(k, who.person.id, who.priv)); };
// what vault/demo/source.bin holds: { file: base64 }
const sealedSource = async () => JSON.parse(zlib.gunzipSync(Buffer.from(await vault.openFile(await libKey(pw.bob), fs.readFileSync(file('vault/demo/source.bin')), vault.label.source('demo'))))).files;
const game = (id, extra = {}) => {
  write(`games/${id}/game.json`, JSON.stringify({ title: 'Test ' + id, tagline: 't', description: 'd', image: 'preview.png', ...extra }));
  write(`games/${id}/index.html`, '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body><img src="dot.png"><script type="module" src="main.js"></script></body></html>');
  write(`games/${id}/style.css`, 'body{background:url(dot.png)}');
  write(`games/${id}/main.js`, 'import { hi } from "./lib/hi.js"; document.title = hi;');
  write(`games/${id}/lib/hi.js`, 'export const hi = "hello";');
  write(`games/${id}/dot.png`, PNG);
  write(`games/${id}/preview.png`, PNG);
};

// a new scratch folder (a copy of `from`, if given), removed after the tests
const scratch = from => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-'));
  dirs.push(dir);
  if (from) fs.cpSync(from, dir, { recursive: true });
  return dir;
};
// this test works on a fresh copy of `from`, with its passwords
const use = from => { root = scratch(from); Object.assign(pw, madePw); };

before(() => {
  root = made = scratch();
  fs.writeFileSync(file('package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
  const out = must(['init', 'alice', 'bob']);
  for (const m of out.matchAll(/^\s+(\w+)\s+(\S+)$/gm)) madePw[m[1]] = m[2];
  assert.ok(madePw.alice && madePw.bob, out);
  game('demo');
  root = built = scratch(made);
  must(['build'], madePw.alice);
});
beforeEach(() => use(built));
after(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });

test('init, build and check', () => {
  use(made);                                                                   // not built yet
  assert.ok(pw.alice && pw.bob);
  const k = kr();                                                              // a salt per person: no guess tests everyone at once
  assert.equal(new Set(k.people.map(p => p.salt)).size, 2);
  assert.equal(k.kdf.salt, undefined);
  assert.match(must(['build'], pw.alice), /demo/);
  assert.match(must(['check']), /valid: 1 game/);
  assert.match(must(['build'], pw.alice), /unchanged/);                       // nothing changed → nothing rewritten
  for (const p of ['vault/demo/game.bin', 'vault/demo/source.bin']) assert.equal(kidOf(p), kr().kid);
});

test('the site is assembled from library/ and vault/, and works offline: every file is in the service worker', () => {
  const sw = fs.readFileSync(file('site/sw.js'), 'utf8');
  for (const f of ['""', '"demo/"', '"demo/game.bin"', '"keyring.json"', '"library.json"', '"lib/ihroteka.js"', '"lib/qr-scan.js"', '"lib/inflate.js"', '"manifest.webmanifest"', '"icons/icon-512.png"']) assert.ok(sw.includes(f), f);
  assert.match(fs.readFileSync(file('site/lib/inflate.js'), 'utf8'), /^\/\*! fflate © Arjun Barrett, MIT \*\//, 'the gunzip of older iPhones, with its licence');
  assert.ok(!sw.includes('"sw.js"') && !sw.includes('index.html'));
  assert.match(sw, /fonts\.googleapis\.com/);
  assert.equal(JSON.parse(fs.readFileSync(file('site/manifest.webmanifest'), 'utf8')).display, 'standalone');
  assert.match(fs.readFileSync(file('site/demo/index.html'), 'utf8'), /boot\(\{"game":"demo"\}\)/);
  assert.deepEqual(JSON.parse(fs.readFileSync(file('site/library.json'), 'utf8')).map(g => [g.id, g.players]), [['demo', { min: 2, max: 2 }]]);   // 2 when not given
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

// (vault-keys-01: Safari before 16.4, iOS 15–16.3, has no DecompressionStream, and every sealed game is gzipped: lock.js
// then loads lib/inflate.js, fflate's gunzip, and hands it to gameText)
test('a game opens where the browser has no DecompressionStream (older iPhones)', async () => {
  const plain = await vault.openFile(await libKey(pw.bob), fs.readFileSync(file('vault/demo/game.bin')), vault.label.game('demo'));
  assert.deepEqual([...plain.subarray(0, 2)], [0x1f, 0x8b], 'sealed gzipped');
  const { gunzip } = await import('../library/app/inflate.js');
  const saved = globalThis.DecompressionStream;
  delete globalThis.DecompressionStream;
  try {
    assert.equal(typeof globalThis.DecompressionStream, 'undefined');
    assert.throws(() => vault.gameText(plain), ReferenceError, 'without the gunzip it cannot');
    const html = await vault.gameText(plain, gunzip);
    assert.match(html, /window\.ihroteka/);
    assert.match(html, /hello/);
    assert.equal(html, await (async () => { globalThis.DecompressionStream = saved; try { return await vault.gameText(plain); } finally { delete globalThis.DecompressionStream; } })(), 'the same page as the browser\'s own gunzip gives');
    assert.equal(await vault.gameText(new TextEncoder().encode('<p>plain</p>'), gunzip), '<p>plain</p>', 'a page sealed without gzip, as before');
  } finally { globalThis.DecompressionStream = saved; }
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

test('the public cover is not sealed in source.bin; unlock restores it from vault/', async () => {
  const files = await sealedSource(), cover = fs.readFileSync(file('vault/demo/preview.png'));
  assert.ok(!('preview.png' in files) && 'dot.png' in files, 'only the cover is left out: ' + Object.keys(files).join(' '));
  fs.rmSync(file('games'), { recursive: true });
  assert.doesNotMatch(must(['unlock'], pw.bob), /local changes/);
  assert.ok(fs.readFileSync(file('games/demo/preview.png')).equals(cover));
  assert.doesNotMatch(must(['unlock'], pw.bob), /local changes/, 'the cover put back is no local change');
  write('games/demo/preview.png', Buffer.concat([cover, Buffer.from('edited')]));
  assert.match(must(['unlock'], pw.bob), /local changes in preview\.png/);    // a cover of this copy's own is kept…
  must(['unlock', '--force'], pw.bob);                                         // …until --force takes the vault's
  assert.ok(fs.readFileSync(file('games/demo/preview.png')).equals(cover));
  // an archive from before (the cover inside) still unlocks; the next build seals it again without the cover, once
  const old = zlib.gzipSync(JSON.stringify({ v: 1, files: { ...files, 'preview.png': cover.toString('base64') } }));
  fs.writeFileSync(file('vault/demo/source.bin'), await vault.sealFile(await libKey(pw.bob), kr().kid, old, vault.label.source('demo')));
  fs.rmSync(file('games'), { recursive: true });
  assert.doesNotMatch(must(['unlock'], pw.bob), /local changes/);
  assert.ok(fs.readFileSync(file('games/demo/preview.png')).equals(cover));
  assert.doesNotMatch(must(['build', '--no-tests'], pw.bob), /demo: .*\(unchanged\)/);
  assert.ok(!('preview.png' in await sealedSource()));
  assert.match(must(['build', '--no-tests'], pw.bob), /demo: .*\(unchanged\)/);
});

test('build never seals a games/ that is behind vault/ over it (someone else built since), and unlock brings it up to date', async () => {
  const sealedMain = async () => Buffer.from((await sealedSource())['main.js'], 'base64').toString();
  const mine = scratch(file('games'));                                         // this copy, as built: in step with vault/
  write('games/demo/main.js', '// theirs');                                    // someone else builds a newer demo…
  must(['build', '--no-tests'], pw.alice);
  const theirs = fs.readFileSync(file('vault/demo/source.bin'));
  fs.rmSync(file('games'), { recursive: true }); fs.cpSync(mine, file('games'), { recursive: true });   // …and this copy pulls it
  let r = run(['build', '--no-tests'], pw.bob);
  assert.ok(!r.ok, r.out);
  assert.match(r.out, /vault\/demo changed since your last npm run unlock or build \(main\.js\)/);
  assert.match(r.out, /npm run unlock .*npm run build -- --force/);
  assert.ok(fs.readFileSync(file('vault/demo/source.bin')).equals(theirs), 'vault/ untouched');
  assert.match(must(['unlock'], pw.bob), /✓ games\/demo \(updated: main\.js\)/);    // no --force: nothing of this copy's own is lost
  assert.equal(fs.readFileSync(file('games/demo/main.js'), 'utf8'), '// theirs');
  assert.match(must(['build', '--no-tests'], pw.bob), /demo: .*\(unchanged\)/);
  // both changed: unlock keeps the local edit and names both; the build refuses; --force seals this copy's
  const base = fs.readFileSync(file('games/demo/.vault-base'));
  write('games/demo/main.js', '// mine');
  write('games/demo/style.css', 'body{}');
  must(['build', '--no-tests'], pw.alice);                                     // (someone else's build)
  fs.writeFileSync(file('games/demo/.vault-base'), base);                      // this copy, from before that build…
  write('games/demo/main.js', '// mine, again');                               // …with an edit of its own
  // (style.css is the same on both sides: no edit of this copy's own)
  assert.match(must(['unlock'], pw.bob), /local changes in main\.js, and vault\/demo changed too \(main\.js, style\.css\).*npm run unlock -- --force.*npm run build -- --force/);
  assert.equal(fs.readFileSync(file('games/demo/main.js'), 'utf8'), '// mine, again');
  r = run(['build', '--no-tests'], pw.bob);
  assert.ok(!r.ok && /changed since your last npm run unlock or build \(main\.js, style\.css\); yours: main\.js$/m.test(r.out), r.out);
  must(['build', '--no-tests', '--force'], pw.bob);
  assert.equal(await sealedMain(), '// mine, again');
  // the same edit on both sides (or an unlock cut short before it wrote the base): no conflict, only the base to write
  const before = fs.readFileSync(file('games/demo/.vault-base'));
  write('games/demo/main.js', '// both');
  must(['build', '--no-tests'], pw.alice);
  fs.writeFileSync(file('games/demo/.vault-base'), before);
  const both = must(['unlock'], pw.bob);
  assert.doesNotMatch(both, /local changes/);
  assert.match(both, /^✓ games\/demo$/m);
  assert.match(must(['build', '--no-tests'], pw.bob), /demo: .*\(unchanged\)/);
  // the cover is public, beside source.bin: a newer one in vault/ is someone else's change too
  const cover = Buffer.concat([fs.readFileSync(file('vault/demo/preview.png')), Buffer.from('theirs')]);
  fs.writeFileSync(file('vault/demo/preview.png'), cover);
  assert.match(run(['build', '--no-tests'], pw.bob).out, /vault\/demo changed since your last npm run unlock or build \(preview\.png\)/);
  assert.match(must(['unlock'], pw.bob), /✓ games\/demo \(updated: preview\.png\)/);
  assert.ok(fs.readFileSync(file('games/demo/preview.png')).equals(cover));
  // a folder from before .vault-base: in step → recorded by the next build; not in step → refused until --force
  fs.rmSync(file('games/demo/.vault-base'));
  must(['build', '--no-tests'], pw.bob);
  assert.ok(fs.existsSync(file('games/demo/.vault-base')));
  fs.rmSync(file('games/demo/.vault-base'));
  write('games/demo/main.js', '// older');
  r = run(['build', '--no-tests'], pw.bob);
  assert.ok(!r.ok && /games\/demo differs from vault\/demo, and nothing here records which version it was unlocked from/.test(r.out), r.out);
  must(['build', '--no-tests', '--force'], pw.bob);
  assert.equal(await sealedMain(), '// older');
  assert.ok(!('.vault-base' in await sealedSource()), 'never sealed: not a file of the game');
});

test('removing a person rotates the key; their password stops working', () => {
  const pwCarol = must(['user', 'add', 'carol'], pw.alice).match(/shown once\): (\S+)/)[1];
  // the site's keyring too, so that the assembled site (npm run dev -- site) already lets carol in
  assert.ok(JSON.parse(fs.readFileSync(file('site/keyring.json'), 'utf8')).people.some(p => p.name === 'carol'), 'site/keyring.json lists carol');
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

test('a person added before there is any game: the password is shown, and nothing fails after it', () => {
  root = scratch();
  fs.writeFileSync(file('package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
  const alice = must(['init', 'alice']).match(/^\s+alice\s+(\S+)$/m)[1];
  const r = run(['user', 'add', 'carol'], alice);
  assert.ok(r.ok, r.out);
  assert.match(r.out, /carol has access\. Password \(shown once\): \S+/);
  assert.ok(kr().people.some(p => p.name === 'carol'));
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
    [{ image: '../x.png' }, /image/], [{ colour: 'red' }, /unknown field/], [{ emoji: '<' }, /emoji/], [{ title: '' }, /title/],
    [{ players: '9' }, /players/], [{ players: '4-2' }, /players/], [{ players: 2 }, /players/]
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
  assert.ok(!run(['remove-game', 'extra']).ok && fs.existsSync(file('vault/extra')), 'not without --yes');
  must(['remove-game', 'extra', '--yes'], pw.alice);
  assert.ok(!fs.existsSync(file('vault/extra')) && !fs.existsSync(file('games/extra')));
  assert.ok(fs.readdirSync(file('games/.removed')).some(d => d.startsWith('extra-')), 'its sources kept aside (tests/tools.test.js)');
  assert.match(must(['check']), /1 game/);
});

// `node tools/cli.js dev …` in this test's copy; `first` resolves with what it said first (its address, or why not),
// said(re) with all it said once that matches re (or once it stopped)
function devServer(...args) {
  const server = spawn(process.execPath, [CLI, 'dev', ...args], { env: { ...ENV, IHROTEKA_ROOT: root } });
  let out = '', ended = false;
  const waits = [];                                      // [re, resolve]
  const heard = () => { for (const w of waits.splice(0)) if (ended || w[0].test(out)) w[1](out); else waits.push(w); };
  server.stdout.on('data', d => { out += d; heard(); }); server.stderr.on('data', d => { out += d; heard(); });
  server.on('close', () => { ended = true; heard(); });
  const said = (re = /./) => new Promise(resolve => { waits.push([re, resolve]); heard(); });
  const stop = () => new Promise(resolve => {
    if (server.exitCode !== null || server.signalCode !== null) return resolve();
    server.once('exit', resolve); server.kill();
  });
  return { first: said(), said, stop };
}
const get = (port, p) => new Promise((resolve, reject) => http.get({ host: '127.0.0.1', port, path: p }, res => {
  let body = '';
  res.setEncoding('utf8').on('data', d => { body += d; }).on('end', () => resolve({ status: res.statusCode, body }));
}).on('error', reject));
const somePort = () => String(18000 + Math.floor(Math.random() * 1000));

test('dev server stays inside its folder and survives bad requests', async () => {
  const port = somePort(), dev = devServer(port);
  try {
    assert.match(await dev.first, new RegExp(':' + port + '/'));
    // every link it prints has one origin (a page's storage, its sign-in included, is per origin)
    const said = await dev.said(/devnet/);
    assert.deepEqual([...new Set(said.match(/https?:\/\/[^/\s]+/g))], ['http://localhost:' + port], said);
    assert.match(said, new RegExp('^  demo: http://localhost:' + port + '/demo/$', 'm'));
    const status = async p => (await get(port, p)).status;
    fs.mkdirSync(file('games-backup'), { recursive: true }); fs.writeFileSync(file('games-backup/x'), 'x');
    assert.equal(await status('/..%2fgames-backup/x'), 403);
    assert.equal(await status('/%E0%A4%A'), 400);
    assert.equal(await status('/'), 200);                                     // the library, around the games
    assert.equal(await status('/demo/'), 200);
    assert.equal(await status('/demo/?frame'), 200);                           // the game itself, inside the library's frame
    assert.equal(await status('/lib/ihroteka.js'), 200);
    assert.equal(await status('/icons/..%2f..%2fpackage.json'), 403);
    // a service worker left on this origin by the site is replaced by one that removes itself
    const sw = await get(port, '/sw.js');
    assert.equal(sw.status, 200);
    assert.match(sw.body, /registration\.unregister\(\)/);
  } finally { await dev.stop(); }
});

test('dev server serves the built site, on 8001 unless given a port', async () => {
  const port = somePort(), dev = devServer('site', port);
  try {
    assert.match(await dev.first, new RegExp(':' + port + '/'));
    assert.equal((await get(port, '/')).status, 200);
    assert.equal((await get(port, '/demo/')).status, 200);
    const sw = await get(port, '/sw.js');                                      // the site's own worker, as published
    assert.equal(sw.status, 200);
    assert.ok(sw.body.includes('"demo/game.bin"') && !sw.body.includes('unregister'));
  } finally { await dev.stop(); }
  // no port: 8001 (if something else has it, the server says so and stops: either way it is 8001)
  const auto = devServer('site');
  try { assert.match(await auto.first, /:8001\/|Port 8001 is busy/); } finally { await auto.stop(); }
  // a port typed is that port, 8000 too
  const typed = devServer('site', '8000');
  try { assert.match(await typed.first, /:8000\/|Port 8000 is busy/); } finally { await typed.stop(); }
});

test('dev server: a game.json that does not read takes only its own game off the shelf', async () => {
  game('typo');
  write('games/typo/game.json', fs.readFileSync(file('games/typo/game.json'), 'utf8').replace('"title"', '"titel"'));
  const port = somePort(), dev = devServer(port);
  try {
    assert.match(await dev.first, new RegExp(':' + port + '/'));
    const shelf = await get(port, '/');
    assert.equal(shelf.status, 200, shelf.body);
    assert.match(shelf.body, /"id":"demo"/);
    assert.doesNotMatch(shelf.body, /"id":"typo"/);
    assert.equal((await get(port, '/demo/')).status, 200);
    assert.equal((await get(port, '/demo/?frame')).status, 200);
    const typo = await get(port, '/typo/');                                     // its own page says why
    assert.equal(typo.status, 500);
    assert.match(typo.body, /games\/typo\/game\.json: unknown field "titel"/);
    assert.match(await dev.said(/left off the shelf/), /✗ games\/typo\/game\.json: unknown field "titel" \(left off the shelf\)/);
  } finally { await dev.stop(); }
});
