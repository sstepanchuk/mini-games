// The game author's tools, on a scratch copy of the repository (IHROTEKA_ROOT; no keyring, no password needed):
// `cli new` makes a game from tools/template that the build takes and whose own tests pass (its waiting screen,
// <ihroteka-wait>, under its title); `remove-game` asks for --yes and keeps the plaintext sources aside; game.json
// "api" is checked against the library's version; the build warns about a string in a game's code that looks like a
// file next to it (on the site the game is one page), and refuses a script from elsewhere (the site's policy would:
// README, Trust); the library API it puts first in a game's page defines the game's waiting screens (<ihroteka-wait>)
// only inside the library.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-tools-'));
after(() => fs.rmSync(root, { recursive: true, force: true }));
process.env.IHROTEKA_ROOT = root;                      // (before the tools load: repo.js reads it once)
const { readManifest, bundleGame, testGame, apiVersion, assetStrings, withLibraryApi } = await import('../tools/build.js');
const CLI = path.join(import.meta.dirname, '..', 'tools', 'cli.js');
const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^VAULT_PASSWORDS?$/.test(k)));
const cli = (...args) => { const r = spawnSync(process.execPath, [CLI, ...args], { env: { ...ENV, IHROTEKA_ROOT: root }, encoding: 'utf8' }); return { ok: r.status === 0, out: r.stdout + r.stderr }; };
const file = (...p) => path.join(root, ...p);
fs.writeFileSync(file('package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));

test('cli new: a game from the template, valid for the build, its own tests passing, and the way to try it', async () => {
  const r = cli('new', 'demo2', '--title', 'Демо <два>', '--players', '2-4');
  assert.ok(r.ok, r.out);
  assert.match(r.out, /http:\/\/localhost:8000\/demo2\//);
  assert.match(r.out, /--devnet/);
  const g = readManifest('demo2');
  assert.deepEqual([g.title, g.players, g.wire, g.api], ['Демо <два>', '2-4', 1, apiVersion()]);
  const png = fs.readFileSync(file('games/demo2', g.image));
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], 'a 1200×630 cover');
  const page = fs.readFileSync(file('games/demo2/index.html'), 'utf8');
  assert.match(page, /<title>Демо &lt;два&gt;<\/title>/);
  assert.match(page, /<h1>[^<]*<\/h1>\s*(<!--[\s\S]*?-->\s*)?<ihroteka-wait><\/ihroteka-wait>/, 'the library\'s waiting screen, empty, under its title (README "Waiting screens")');
  assert.ok(testGame('demo2') >= 1, 'its tests run, and pass');
  const warned = [], html = await bundleGame('demo2', g, { warn: m => warned.push(m) });
  assert.ok(/^<!doctype html>/i.test(html) && !/src="main\.js"/.test(html) && html.includes('window.ihroteka'), 'one page, the API first');
  assert.deepEqual(warned, [], 'nothing it names is missing on the site');
});

// (owner, decision 6 (c): README "Waiting screens"; the element is defined in the game's own window, before its page
// is parsed, and only forwards to the library page: library/app/screens.js)
test('the game\'s page: the library API first, and with it <ihroteka-wait>, defined only inside the library', () => {
  const html = withLibraryApi('<!doctype html><html><head><meta charset="utf-8"><title>x</title></head><body></body></html>', 'demo9', { title: 'T' });
  const api = html.match(/<meta charset="utf-8">\n<script>([\s\S]*?)<\/script>/)?.[1];
  assert.ok(api, 'the first script, right after the charset meta');
  const guard = api.indexOf('library && library.waitScreen'), define = api.indexOf("customElements.define('ihroteka-wait'");
  assert.ok(guard > 0 && define > guard, 'defined there, behind its guard');
  assert.ok(!api.includes('Contract (version'), 'the leading comment is dropped');
  // the script itself, in a stand-in of a game's window: → what it defined, and what the element's callbacks told
  const run = ({ parent, defined = false, ihroteka } = {}) => {
    const defs = [], told = [];
    class HTMLElement {}
    const win = { customElements: { get: () => defined, define: (n, c) => defs.push([n, c]) } };
    win.parent = parent ? { __ihroteka: { attach: () => ihroteka ?? {}, ...parent(told) } } : win;
    new Function('window', 'HTMLElement', api)(win, HTMLElement);
    for (const [, C] of defs) { const el = new C(); el.connectedCallback(); el.disconnectedCallback(); told.push(el instanceof HTMLElement); }
    return { names: defs.map(([n]) => n), told, ihroteka: win.ihroteka };
  };
  const inLibrary = run({ parent: told => ({ waitScreen: (el, on) => told.push(on) }) });
  assert.deepEqual(inLibrary.names, ['ihroteka-wait']);
  assert.deepEqual(inLibrary.told, [true, false, true], 'connected, gone: told to the library page (an element of the game\'s own window)');
  assert.deepEqual(run().names, [], 'a game page on its own: nothing');
  assert.equal(run().ihroteka, undefined);
  assert.deepEqual(run({ parent: () => ({}) }).names, [], 'a library page from before the screens: nothing');
  assert.deepEqual(run({ parent: told => ({ waitScreen: () => told.push(1) }), defined: true }).names, [], 'defined already: not again');
  assert.deepEqual(run({ parent: told => ({ waitScreen: () => told.push(1) }), ihroteka: false }).names, [], 'not our frame (no API): nothing');
});

test('cli new refuses what the build would refuse, and leaves nothing behind', () => {
  for (const [args, why] of [[['demo2'], /already exists/], [['../evil'], /lowercase letters/], [['lib'], /not lib/], [['Big'], /lowercase/],
    [['x1', '--players', '9'], /--players/], [['x2', '--players', '4-2'], /--players/], [['x3', '--title'], /needs a value/], [['x4', '--bogus'], /Unknown option: --bogus/], [[], /new <id>/]]) {
    const r = cli('new', ...args);
    assert.ok(!r.ok && why.test(r.out), args.join(' ') + ': ' + r.out);
  }
  assert.deepEqual(fs.readdirSync(file('games')), ['demo2']);
  assert.ok(!fs.existsSync(path.join(root, '..', 'evil')));
});

test('remove-game asks for --yes; then vault/<id> goes and games/<id> is kept aside, dated', () => {
  assert.ok(cli('new', 'gone').ok);
  fs.mkdirSync(file('vault/gone'), { recursive: true });
  fs.copyFileSync(file('games/gone/game.json'), file('vault/gone/game.json'));
  let r = cli('remove-game', 'gone');
  assert.ok(!r.ok && /deletes vault\/gone and moves games\/gone to games\/\.removed\/gone-\d{4}-\d\d-\d\dT/.test(r.out) && /--yes/.test(r.out), r.out);
  assert.ok(fs.existsSync(file('games/gone')) && fs.existsSync(file('vault/gone')), 'nothing changed');
  r = cli('remove-game', 'gone', '--yes');
  assert.ok(r.ok, r.out);
  assert.ok(!fs.existsSync(file('games/gone')) && !fs.existsSync(file('vault/gone')));
  const kept = fs.readdirSync(file('games/.removed'));
  assert.equal(kept.length, 1);
  assert.ok(fs.existsSync(file('games/.removed', kept[0], 'rules.js')), 'the sources, whole');
  assert.ok(!cli('remove-game', 'gone', '--yes').ok, 'gone already');
  assert.ok(!cli('remove-game', '../tools', '--yes').ok && fs.existsSync(path.join(import.meta.dirname, '..', 'tools', 'cli.js')), 'never outside games/');
  assert.ok(!cli('remove-game', 'demo2', '--yes', '--force').ok && fs.existsSync(file('games/demo2')), 'an unknown option stops it');
});

test('game.json "api": a whole number, at most the library\'s version', () => {
  // (apiVersion reads shell.js's text: it is the version the Game API is pinned at, and the template says it too)
  const pinned = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'api-surface.json'), 'utf8')).version;
  assert.equal(apiVersion(), pinned, 'tools/build.js apiVersion() ≠ tests/api-surface.json "version"');
  assert.equal(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'tools', 'template', 'game.json'), 'utf8')).api, pinned, 'tools/template/game.json "api"');
  const at = file('games/demo2/game.json'), g = JSON.parse(fs.readFileSync(at, 'utf8'));
  try {
    for (const [api, ok] of [[1, true], [apiVersion(), true], [apiVersion() + 1, false], [0, false], ['4', false], [4.5, false]]) {
      fs.writeFileSync(at, JSON.stringify({ ...g, api }));
      if (ok) readManifest('demo2'); else assert.throws(() => readManifest('demo2'), /"api"/, JSON.stringify(api));
    }
  } finally { fs.writeFileSync(at, JSON.stringify(g)); }
});

test('game.json "camera" and "microphone": true or false; only true reaches the shelf (the frame may use it: README, Trust)', async () => {
  const { shelfEntry } = await import('../tools/build.js');
  const at = file('games/demo2/game.json'), g = JSON.parse(fs.readFileSync(at, 'utf8'));
  try {
    for (const flag of ['camera', 'microphone']) {
      for (const [v, ok] of [[true, true], [false, true], ['yes', false], [1, false], [null, false], ['true', false]]) {
        fs.writeFileSync(at, JSON.stringify({ ...g, [flag]: v }));
        if (ok) assert.equal(shelfEntry('demo2', readManifest('demo2'))[flag], v === true || undefined, flag + ': ' + v);
        else assert.throws(() => readManifest('demo2'), new RegExp('"' + flag + '" must be true or false'), flag + ': ' + JSON.stringify(v));
      }
    }
    // each on its own: asking for one gives that one only
    fs.writeFileSync(at, JSON.stringify({ ...g, microphone: true }));
    assert.deepEqual(Object.keys(shelfEntry('demo2', readManifest('demo2'))).filter(k => /camera|microphone/.test(k)), ['microphone']);
    fs.writeFileSync(at, JSON.stringify({ ...g, camera: true, microphone: false }));
    assert.deepEqual(Object.keys(shelfEntry('demo2', readManifest('demo2'))).filter(k => /camera|microphone/.test(k)), ['camera']);
    const plain = shelfEntry('demo2', g);
    assert.ok(!('camera' in plain) && !('microphone' in plain), 'a game that does not ask: its shelf entry as before');
    assert.deepEqual(Object.keys(plain), ['id', 'title', 'tagline', 'image', 'emoji', 'players', 'wire']);
  } finally { fs.writeFileSync(at, JSON.stringify(g)); }
});

test('the build warns about a string in the code that looks like a file next to the game', async () => {
  const main = file('games/demo2/main.js'), was = fs.readFileSync(main, 'utf8');
  try {
    fs.writeFileSync(main, was + '\nconst pic = "img/hero.png", hit = \'./sfx/hit.mp3\', mime = "image/png", web = "https://x.org/a.png", data = "data:image/png;base64,AA";\nconsole.log(pic, hit, mime, web, data);\n');
    const warned = [];
    await bundleGame('demo2', readManifest('demo2'), { warn: m => warned.push(m) });
    assert.equal(warned.length, 2, warned.join('\n'));
    assert.match(warned[0], /games\/demo2\/main\.js names "img\/hero\.png".*import it/);
    assert.match(warned[1], /"\.\/sfx\/hit\.mp3"/);
  } finally { fs.writeFileSync(main, was); }
  assert.deepEqual(assetStrings('a("x.json"); b(`../y/z.woff2`); c("a b.png", "x.png.txt", ".png")'), ['x.json', '../y/z.woff2']);
});

test('the build refuses a script from elsewhere: the site\'s policy would refuse it (README: Trust)', async () => {
  const at = file('games/demo2/index.html'), was = fs.readFileSync(at, 'utf8');
  try {
    for (const src of ['https://cdn.example.org/lib@1.0.0/x.js', '//cdn.example.org/x.js', 'data:text/javascript,1']) {
      fs.writeFileSync(at, was.replace('</head>', () => '<script src="' + src + '"></script>\n</head>'));
      await assert.rejects(bundleGame('demo2', readManifest('demo2')), e => e.message.includes('<script src="' + src + '"> is from elsewhere'), src);
    }
  } finally { fs.writeFileSync(at, was); }
  await bundleGame('demo2', readManifest('demo2'));      // (as it was: bundled)
});
