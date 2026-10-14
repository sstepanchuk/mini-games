// devnet (tools/devnet.js): the dev server's fake network, so that tabs play together without internet. Only the dev
// server puts it into a page, and only when asked (--devnet, or ?devnet, which a session cookie remembers; ?devnet=0
// forgets it); never into a game's own page; and the assembled site never has it, whatever the build does. The dev
// server's probe (--probe: the browser scenarios' open game) is served only when asked too. The tools work on a scratch
// copy (IHROTEKA_ROOT: the committed vault/ and a package.json, no games/ until a test makes one), so a developer's own
// games/ changes nothing here, and every branch runs here as it does in CI.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { DEVNET_TAG, devnetFor, devnetScript } from '../tools/devnet.js';

const REPO = path.join(import.meta.dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-devnet-'));
fs.cpSync(path.join(REPO, 'vault'), path.join(root, 'vault'), { recursive: true });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
process.env.IHROTEKA_ROOT = root;                      // (before the tools load: repo.js reads it once)
const { devServer } = await import('../tools/dev.js');
const { buildSite } = await import('../tools/build.js');
const { walk } = await import('../tools/repo.js');

const MARKS = [DEVNET_TAG, '__devnet'];                 // what only devnet's script says
const servers = [];
const start = async opt => {
  const s = devServer('games', opt);
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  servers.push(s);
  return 'http://127.0.0.1:' + s.address().port;
};
after(() => {
  for (const s of servers) s.close();
  fs.rmSync(root, { recursive: true, force: true });
  delete process.env.IHROTEKA_ROOT;
});
const get = async (url, cookie) => {
  const r = await fetch(url, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
  return { status: r.status, text: await r.text(), cookie: r.headers.get('set-cookie') };
};
const has = t => MARKS.some(m => t.includes(m));

test('the assembled site never has devnet (the library, its pages, the offline copy)', async () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-site-'));
  try {
    await buildSite(out);
    const files = walk(out);
    assert.ok(files.includes('index.html') && files.includes('lib/ihroteka.js') && files.includes('sw.js'), files.join(' '));
    for (const f of files) assert.ok(!has(fs.readFileSync(path.join(out, f), 'latin1')), f + ' mentions devnet');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

test('nothing the library runs knows devnet: only tools/dev.js brings it', () => {
  const lib = path.join(import.meta.dirname, '..', 'library');
  for (const f of walk(lib).filter(f => f.endsWith('.js') || f.endsWith('.html'))) assert.ok(!/devnet/i.test(fs.readFileSync(path.join(lib, f), 'utf8')), 'library/' + f);
});

let plain, always;
before(async () => { plain = await start({ probe: true }); always = await start({ devnet: true, probe: true }); });

test('a page without ?devnet has none; with ?devnet it has it, and the browser is told to remember', async () => {
  const off = await get(plain + '/');
  assert.equal(off.status, 200);
  assert.ok(!has(off.text) && !off.cookie);
  const on = await get(plain + '/?devnet');
  assert.ok(has(on.text) && on.text.indexOf(DEVNET_TAG) < on.text.indexOf('import { boot }'), 'before the library\'s code runs');
  assert.match(on.cookie, new RegExp('^' + DEVNET_TAG + '=1; Path=/;'));
  const cookie = DEVNET_TAG + '=1';
  assert.ok(has((await get(plain + '/probe/?room=abcdefgh', cookie)).text), 'the cookie: a room link opened in another tab has it too');
  assert.ok(!has((await get(plain + '/probe/?frame', cookie)).text), 'never in a game\'s own page');
  const bye = await get(plain + '/?devnet=0', cookie);
  assert.ok(!has(bye.text) && /Max-Age=0/.test(bye.cookie), '?devnet=0 forgets it');
});

test('--devnet: every library page has it, never a game\'s own page', async () => {
  assert.ok(has((await get(always + '/')).text));
  assert.ok(has((await get(always + '/probe/')).text));
  assert.ok(!has((await get(always + '/probe/?frame')).text));
  assert.ok(has((await get(always + '/?devnet=0')).text), '(the server says always)');
});

test('the probe is served only when asked, with the library API in front of its code', async () => {
  const shelf = (await get(plain + '/')).text;
  assert.match(shelf, /"id":"probe"/);
  const page = (await get(plain + '/probe/?frame')).text;
  assert.ok(page.indexOf('window.ihroteka') > 0 && page.indexOf('window.ihroteka') < page.indexOf('__probe'), 'the API first');
  assert.equal((await get(plain + '/probe/preview.png')).status, 200);
  // nothing outside its folder (fetch takes ../ and %2e%2e out of the address before it is sent; %2f reaches the server,
  // which decodes it: only its guard stops this one)
  assert.equal((await get(plain + '/probe/..%2f..%2f..%2f..%2fpackage.json')).status, 403);
  // without --probe: with no games/ (as in CI), no server; with a game, the probe neither on the shelf nor served
  assert.throws(() => devServer('games', {}), { message: /^No games/ });
  const made = spawnSync(process.execPath, [path.join(REPO, 'tools', 'cli.js'), 'new', 'demo'], { env: { ...process.env, IHROTEKA_ROOT: root }, encoding: 'utf8' });
  assert.equal(made.status, 0, made.stdout + made.stderr);
  const none = await start({}), only = (await get(none + '/')).text;
  assert.match(only, /"id":"demo"/);
  assert.doesNotMatch(only, /"id":"probe"/);
  assert.equal((await get(none + '/probe/preview.png')).status, 404);
});

test('devnetFor: the address and the cookie decide', () => {
  const req = (url, cookie) => ({ url, headers: cookie ? { cookie } : {} });
  assert.deepEqual(devnetFor(req('/'), false), { on: false, cookie: null });
  assert.deepEqual(devnetFor(req('/?devnet'), false).on, true);
  assert.deepEqual(devnetFor(req('/?devnet', 'a=1; ' + DEVNET_TAG + '=1'), false), { on: true, cookie: null });
  assert.deepEqual(devnetFor(req('/', DEVNET_TAG + '=1'), false), { on: true, cookie: null });
  assert.equal(devnetFor(req('/?devnet=0', DEVNET_TAG + '=1'), false).on, false);
  assert.equal(devnetFor(req('/?devnet=0'), false).cookie, null, '(nothing to forget)');
});

// devnet's script in a page of its own (a vm context: what the script uses of a browser), with extra already on window
function page(extra = {}) {
  const win = { BroadcastChannel, setTimeout, console: { info() {} }, navigator: {}, WebSocket: function Real() {},
    document: { body: { append() {} }, createElement: () => ({ style: {} }), addEventListener() {} }, ...extra };
  win.window = win;
  vm.runInContext(devnetScript().replace(/^<script>|<\/script>$/g, ''), vm.createContext(win));
  return win;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('devnet\'s brokers: the pages of one browser hear each other on each broker apart, as the brokers would', async () => {
  const A = page(), B = page();
  assert.ok(A.__devnet && B.__devnet && A.navigator.onLine === true);
  const ws = new A.WebSocket('wss://one.example/mqtt', 'mqtt');   // the internet probe (net/brokers.js hasInternet) opens
  assert.ok(await Promise.race([new Promise(r => { ws.onopen = () => r(true); }), sleep(500)]), 'the probe opens');
  const got = { a: [], b: [], b2: [] }, conn = [];
  const client = (W, url, k) => W.mqtt.connect(url).on('connect', () => conn.push(k)).on('message', (t, s) => got[k].push(t + ' ' + s));
  const a = client(A, 'wss://one', 'a'), b = client(B, 'wss://one', 'b'), b2 = client(B, 'wss://two', 'b2');
  try {
    await sleep(60);
    assert.deepEqual(conn.sort(), ['a', 'b', 'b2']);
    for (const c of [a, b, b2]) c.subscribe('room', { qos: 0 });
    b.subscribe('room/d/A/B', { qos: 0 });                 // B's mailbox from A (net/brokers.js mailbox): only B listens
    await sleep(20);
    a.publish('room', 'hi');
    a.publish('room/d/A/B', 'to B');
    await sleep(60);
    assert.deepEqual(got.a, ['room hi'], 'A hears its own on the room\'s topic (a broker echoes it), not B\'s mailbox');
    assert.deepEqual(got.b, ['room hi', 'room/d/A/B to B'], 'B hears both, in order');
    assert.deepEqual(got.b2, [], 'nothing through another broker');
    b.unsubscribe('room/d/A/B');
    b2.end();
    a.publish('room/d/A/B', 'gone');
    a.publish('room', 'again');
    await sleep(60);
    assert.deepEqual(got.b, ['room hi', 'room/d/A/B to B', 'room again'], 'unsubscribed: no more of that topic');
    assert.deepEqual(got.b2, [], 'ended: nothing more');
  } finally { for (const c of [a, b, b2]) c.end(); }
});

test('a page that already has a fake network (a browser scenario\'s, against a dev server with --devnet) keeps it', () => {
  const mqtt = { connect() {} }, WebSocket = function Scenario() {};
  const C = page({ mqtt, WebSocket });
  assert.equal(C.mqtt, mqtt);
  assert.equal(C.WebSocket, WebSocket);
  assert.equal(C.__devnet, undefined);
  assert.equal(C.navigator.onLine, undefined);
});
