// The harness of the worker-tab tests (tests/support, used by tests/net and tests/app): what those tests rely on. An
// error inside a tab fails its test, also when that tab went before the test's end; the fake network keeps real time
// and can impair each broker on its own; and the commands later tests use do what they say (support/tab.js, the top).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { room, settled, shows, sleep, until, world } from './support/world.js';

const T = { timeout: 40000 };
const SUPPORT = new URL('./support/', import.meta.url).href;
const LIBRARY = fileURLToPath(new URL('../library', import.meta.url));

// a world whose end the test runs itself (→ its teardown: rejects with what went wrong inside the tabs)
const own = () => { let end = null; const W = world({ after: fn => { end = fn; } }); return { W, end: () => end() }; };

describe('an error inside a tab fails its test', () => {
  for (const go of ['stays', 'close', 'reload', 'kill']) {
    test('a tab\'s pagehide listener throws, and then the tab ' + go + ': its test fails', T, async () => {
      const { W, end } = own();
      const A = await W.tab('aaaa1111');
      await A.onHide([{ m: { t: 'x' } }]);                   // (no room: room().send throws as the page goes)
      if (go === 'stays' || go === 'kill') await A.call('pagehide');
      if (go !== 'stays') await A[go]();
      await assert.rejects(end(), e => /errors inside the tabs:\naaaa1111( \(before it went\))?: TypeError/.test(e.message), 'the error is reported');
    });
  }

  test('an error the test took before the tab went does not fail it', T, async () => {
    const { W, end } = own();
    const A = await W.tab('aaaa1111');
    await A.onHide([{ m: { t: 'x' } }]);
    await A.call('pagehide');
    assert.equal((await A.takeErrors()).length, 1);
    await A.kill();
    await end();
  });
});

// Code in a worker thread of its own, with the fake network's modules (fakenet.js as net, fakertc.js as rtc) and
// sleep (on the real timers, taken before the code can replace them) → what it returns
function inWorker(body) {
  const w = new Worker(`const { parentPort } = require('node:worker_threads');
    const realTimeout = setTimeout, sleep = ms => new Promise(r => realTimeout(r, ms));
    (async () => {
      const net = await import(${JSON.stringify(SUPPORT + 'fakenet.js')}), rtc = await import(${JSON.stringify(SUPPORT + 'fakertc.js')});
      ${body}
    })().then(v => parentPort.postMessage({ v }), e => parentPort.postMessage({ e: String((e && e.stack) || e) }));`, { eval: true });
  return new Promise((res, rej) => {
    w.once('message', m => { w.terminate(); if (m.e) rej(new Error(m.e)); else res(m.v); });
    w.once('error', e => { w.terminate(); rej(e); });
  });
}

describe('the fake network (fakenet.js, fakertc.js)', { concurrency: true }, () => {
  // two tabs' networks on one bus, X and Y, each with its own mqtt.connect; Y listens to 't' through both brokers
  const pair = `
    const U = ['wss://a.test/mqtt', 'wss://b.test/mqtt'], heard = [], bus = 'fn-' + Math.random();
    const X = net.install({ bus, urls: U, brokerMs: 10, emit() {} }), cx = globalThis.mqtt.connect;
    const Y = net.install({ bus, urls: U, brokerMs: 10, emit() {} }), cy = globalThis.mqtt.connect;
    const up = c => new Promise(r => c.on('connect', () => c.subscribe('t', {}, () => r(c))));
    const listen = async (url, tag) => { const c = await up(cy(url)); c.on('message', (t, p) => heard.push(tag + ':' + new TextDecoder().decode(p))); return c; };
    const xs = await Promise.all(U.map(u => up(cx(u))));
    const say = async (s, ms = 300) => { for (const c of xs) c.publish('t', s); await sleep(ms); };`;

  test('lat and hear: one value per broker', async () => {
    const out = await inWorker(pair + `
      await listen(U[0], 'a'); await listen(U[1], 'b');
      X.set({ lat: [0, 150] });
      const t0 = performance.now(), at = {};
      for (const c of xs) c.publish('t', 'one');
      while (heard.length < 2 && performance.now() - t0 < 2000) { await sleep(5); for (const h of heard) at[h] = at[h] ?? Math.round(performance.now() - t0); }
      X.set({ lat: 0 });
      Y.set({ hear: [false, true] });
      await say('two');
      return { at, heard, state: Y.state().hear };`);
    assert.ok(out.at['a:one'] < 80 && out.at['b:one'] >= 150, 'through b 150 ms later: ' + JSON.stringify(out.at));
    assert.deepEqual(out.heard.filter(h => h.endsWith('two')), ['b:two'], 'Y hears nothing through a');
    assert.deepEqual(out.state, [false, true]);
  });

  test('opened per broker; mute: that connection hears nothing (a zombie), a new one does', async () => {
    const out = await inWorker(pair + `
      await listen(U[0], 'a'); await listen(U[1], 'b');
      Y.set({ mute: [1] });
      await say('one');
      await listen(U[1], 'b2');                              // (the room rebuilds that connection)
      await say('two');
      return { heard, opened: Y.state().opened, mute: Y.state().mute };`);
    assert.deepEqual(out.heard.sort(), ['a:one', 'a:two', 'b2:two'].sort());
    assert.deepEqual(out.opened, [1, 2], 'connections opened, by broker');
    assert.deepEqual(out.mute, [1]);
  });

  test('end(true): \'close\' a moment later, as mqtt.js says it', async () => {
    const out = await inWorker(pair + `
      const said = [], c = await up(cy(U[0]));
      c.on('close', () => said.push('close'));
      c.end(true);
      said.push('ended');
      c.end(true);
      await sleep(50);
      return said;`);
    assert.deepEqual(out, ['ended', 'close'], 'after end() returned, once');
  });

  test('a connection says \'close\' once, also when it ends or drops before it connected', async () => {
    const out = await inWorker(pair + `
      const n = {};
      for (const how of ['end', 'drop', 'end, then drop']) {
        Y.set({ up: true });
        const c = cy(U[0]);
        n[how] = 0; c.on('close', () => n[how]++);
        if (how.startsWith('end')) c.end(true);
        if (how.includes('drop')) Y.set({ up: false });
        await sleep(450);
      }
      return n;`);
    assert.deepEqual(out, { end: 1, drop: 1, 'end, then drop': 1 });
  });

  // two tabs' fakertc on one bus; linkUp(): a link from the first to the second → [its connection, its channel 'ctl'],
  // and what the second hears on it (heard)
  const link = `
    const rbus = 'rtc-' + Math.random(), live = () => true, heard = [];
    rtc.install({ bus: rbus, pid: 'aaaa', live }); const PA = globalThis.RTCPeerConnection;
    rtc.install({ bus: rbus, pid: 'bbbb', live }); const PB = globalThis.RTCPeerConnection;
    const linkUp = async () => {
      const a = new PA(), dc = a.createDataChannel('ctl'), b = new PB();
      b.ondatachannel = ({ channel }) => { channel.onmessage = e => heard.push(e.data); channel.onclose = () => heard.push('close'); };
      await a.setLocalDescription(await a.createOffer());
      await b.setRemoteDescription(a.localDescription);
      await b.setLocalDescription(await b.createAnswer());
      await a.setRemoteDescription(b.localDescription);
      await sleep(50);
      return [a, dc];
    };`;

  test('a direct link: what was sent before it closed arrives before the close', async () => {
    const out = await inWorker(link + `
      const [a, dc] = await linkUp();
      dc.send('one'); dc.send('two'); a.close();
      await sleep(100);
      return heard;`);
    assert.deepEqual(out, ['one', 'two', 'close']);
  });

  test('the fake network keeps real time while the page\'s timers are held back (tab.js throttle)', async () => {
    const out = await inWorker(pair + link.replace('heard = []', 'said = []').replace(/heard\.push/g, 'said.push') + `
      await listen(U[0], 'a'); await listen(U[1], 'b');
      const timers = ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'];
      const real = timers.map(k => globalThis[k]);
      for (const k of timers) globalThis[k] = () => { throw new Error('a page timer: ' + k); };
      try {
        X.set({ lat: [0, 20] });
        await say('one');
        const c = cy(U[0]); await new Promise(r => c.on('connect', r));
        const [a, dc] = await linkUp();
        dc.send('three'); a.close();
        await sleep(100);
        return [heard, said];
      } finally { timers.forEach((k, i) => { globalThis[k] = real[i]; }); }`);
    assert.deepEqual([out[0].sort(), out[1]], [['a:one', 'b:one'], ['three', 'close']]);
  });
});

// this library with PROTO + 1, in dir (as tests/net/version.test.js makes it)
function nextVersion(dir) {
  const to = join(dir, 'next');
  cpSync(LIBRARY, to, { recursive: true });
  const f = join(to, 'net', 'config.js');
  writeFileSync(f, readFileSync(f, 'utf8').replace(/^export const PROTO = (\d+);/m, (_, n) => 'export const PROTO = ' + (+n + 1) + ';'));
  return to;
}
const names = ['Array.prototype.at', 'structuredClone', 'Object.hasOwn'];

describe('the tab\'s commands and options', { concurrency: 4 }, () => {
  test('timing: with a time scale, a test sets any of the room\'s times outright; without one, it is not read; out of order, the page does not start', T, async t => {
    const scaled = await (await world(t, { scale: 0.2, timing: { HOLD: 8000, WEAK: 'x', GRACE: -1 } }).tab('aaaa1111')).info();
    const base = (await (await world(t).tab('bbbb1111')).info()).timing;
    assert.deepEqual(scaled.timing, Object.fromEntries(Object.entries(base).map(([k, v]) => [k, k === 'HOLD' ? 8000 : v * 0.2])), 'HOLD as set, the rest scaled');
    assert.equal(scaled.scale, 0.2, 'net/index.js says the scale (SCALE)');
    const plain = await (await world(t, { timing: { HOLD: 8000 } }).tab('cccc1111')).info();
    assert.deepEqual([plain.timing, plain.scale], [base, 1], 'no scale: a browser\'s page, __timing is not read');
    await assert.rejects(world(t, { scale: 0.2, timing: { HOLD: 1500 } }).tab('dddd1111'), /TIMING must keep/, 'HOLD below AUTH_WAIT');
  });

  test('strip: a browser without these (an older Safari), the page after a reload too; a name it does not have is refused', T, async t => {
    const W = world(t);
    const A = await W.tab('aaaa1111', {}, { strip: names }), B = await W.tab('bbbb1111');
    assert.deepEqual(await A.call('typeOf', { names }), ['undefined', 'undefined', 'undefined']);
    assert.deepEqual(await B.call('typeOf', { names }), ['function', 'function', 'function'], 'only that tab');
    const A2 = await A.reload();
    assert.deepEqual(await A2.call('typeOf', { names }), ['undefined', 'undefined', 'undefined']);
    await assert.rejects(W.tab('cccc1111', {}, { strip: ['Array.prototype.nothing'] }), /cannot strip Array\.prototype\.nothing/);
  });

  test('initial: a page opened at a game\'s address shows that game before its room is there, and goes into the room with it', T, async t => {
    const W = world(t);
    const A = await W.tab('aaaa1111', {}, { initial: 'g' });
    await A.lib('supini01', 'Аня');
    assert.ok(await until(async () => (await A.game())?.view === 'g', 3000), 'in the game');
    assert.equal(await A.call('view'), 'g');
    assert.equal((await A.state()).lib.myHere, 'g', 'its room knows it');
  });

  test('open(id, { wire }): the game\'s copy here speaks this wire (attachGame); one opened by following says none', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'supwir01', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g', { wire: 2 });
    assert.ok(await until(async () => (await A.game()) && (await B.game()), 5000), 'both in g');
    assert.deepEqual([(await A.game()).wire, (await B.game()).wire], [2, null]);
  });

  test('a follow into a game this shelf does not have goes to the shelf, as shell.js go does', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.lib('supshl01', 'Аня', {}, { g: 1, h: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('supshl01', 'Богдан', {}, { g: 1 });
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    await A.open('h');
    await sleep(800);
    assert.deepEqual([await B.call('view'), await B.game()], [null, null], 'Богдан has no h: on the shelf');
    await A.open('g');
    assert.ok(await until(async () => (await B.game())?.view === 'g', 5000), 'g he has');
    assert.deepEqual((await B.game()).follows, ['g']);
  });

  test('gstream: the open game streams (room.streaming)', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'supstr01', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'both in the game');
    assert.equal(await B.call('gstream', { on: true }), true);
    assert.equal(await B.call('gstream', { on: false }), false);
  });

  test('lib:version: the events say when the library tells the shell that the versions changed', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.lib('supver01', 'Аня', {}, { g: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('supver01', 'Богдан', {}, { g: 2 });
    const said = async X => (await X.events()).some(e => e[1] === 'lib:version');
    assert.ok(await until(async () => await said(A) && await said(B), 5000), 'both: ' + JSON.stringify((await A.state()).lib.version));
  });

  test('the shell\'s reload answers once the offline copy is in place (reloadDone), or at once as scripted (reloadAnswer)', T, async t => {
    const W = world(t);
    const A = await W.tab('aaaa1111'), B = await W.tab('bbbb1111', {}, { reloadAnswer: 'storage' });
    await A.lib('suprel01', 'Аня'); await B.lib('suprel02', 'Богдан');
    await A.call('updateNow'); await B.call('updateNow');    // «Оновити»
    assert.deepEqual(await A.call('reloads'), [null], 'asked; no answer yet');
    assert.deepEqual(await B.call('reloads'), ['storage'], 'at once: the newer copy could not be stored');
    assert.equal(await A.reloadDone(), 'reload');
    assert.deepEqual(await A.call('reloads'), ['reload']);
    assert.equal(await B.reloadDone(), 'storage', 'nothing to wait for');
  });

  test('near({ leaveOn }): a nearby page leaves its room the moment it hears that status (as the library\'s dialog does)', T, async t => {
    const dir = mkdtempSync(join(tmpdir(), 'ihroteka-support-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const W = world(t, { rtc: true });
    const H = await W.tab('p1tab'), G = await W.tab('p2tab', {}, { library: nextVersion(dir) });
    await H.near('Аня', { leaveOn: 'version' }); await G.near('Богдан');
    await G.pair('answer', await H.pair('offer')).then(code => H.pair('finish', code));
    const ev = await until(async () => { const e = (await H.events()).map(x => x.slice(1).join(' ')); return e.includes('leaveOn version') && e; }, 5000);
    assert.ok(ev, 'it left: ' + (await H.events()).map(x => x.slice(1).join(' ')));
    assert.equal(ev[ev.indexOf('leaveOn version') - 1], 'status version', 'in the same call');
  });

  test('join(…, { ask }), near(…, { ask }) and take(): a typed name is asked about while its place\'s device is on the line (taken), take() takes it', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'supask01', ['Аня', 'Богдан']);
    const B2 = await W.tab('p3tab');
    await B2.join('supask01', 'Богдан', { ask: true });
    assert.ok(await until(async () => (await B2.state()).status === 'taken', 5000), 'asked: ' + await shows([B2]));
    await B2.take();
    assert.ok(await until(settled([A, B2]), 5000), 'it takes the place: ' + await shows([A, B2]));
    assert.equal((await B.state()).role, 'out');
    // nearby: the same option reaches joinNearby
    const H = await W.tab('p4tab'), G = await W.tab('p5tab'), G2 = await W.tab('p6tab');
    await H.near('Ганна'); await G.near('Гліб');
    await G.pair('answer', await H.pair('offer')).then(code => H.pair('finish', code));
    assert.ok(await until(settled([H, G]), 5000), await shows([H, G]));
    await G2.near('Гліб', { ask: true });
    await G2.pair('answer', await H.pair('offer')).then(code => H.pair('finish', code));
    assert.ok(await until(async () => (await G2.state()).status === 'taken', 5000), 'asked: ' + JSON.stringify(await G2.state()));
  });

  test('lib(…, { ask }): the option reaches startInternet (true: asked, as a name typed in the dialog); by default not asked, as before', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'supask02', ['Аня', 'Богдан'], { lib: {} });
    const B2 = await W.tab('p3tab');
    await B2.lib('supask02', 'Богдан', {}, undefined, { ask: true });
    assert.ok(await until(async () => (await B2.state()).status === 'taken', 5000), 'asked: ' + await shows([B2]));
    assert.deepEqual([(await B.state()).linked, (await A.state()).players], [true, ['Аня', 'Богдан']], 'nobody moved');
    const B3 = await W.tab('p4tab');
    await B3.lib('supask02', 'Богдан');
    assert.ok(await until(settled([A, B3]), 5000), 'not asked: ' + await shows([A, B3]));
  });

  test('local: tabs given the same local object are one browser (one localStorage, a change in one is in the others), a reload keeps it; any other tab is a browser of its own', T, async t => {
    const W = world(t);
    const L = { 'ihroteka-name': 'Віра' };                  // (its own entries: what that browser holds at first)
    const A = await W.tab('aaaa1111', {}, { local: L });
    const has = (X, k, v) => until(async () => (await X.local()).some(([a, b]) => a === k && b === v), 3000);
    assert.deepEqual(await A.local(), [['ihroteka-name', 'Віра']]);
    await A.lib('suploc01', 'Аня');                          // (together.js remembers the room and the name)
    assert.ok(await has(A, 'ihroteka-name', 'Аня') && await has(A, 'ihroteka-room', 'suploc01'), JSON.stringify(await A.local()));
    const B = await W.tab('bbbb1111', {}, { local: L }), C = await W.tab('cccc1111');
    assert.ok(await has(B, 'ihroteka-room', 'suploc01'), 'a new tab of that browser starts with it: ' + JSON.stringify(await B.local()));
    assert.deepEqual(await C.local(), [], 'another browser has none of it');
    await B.lib('suploc02', 'Богдан');
    assert.ok(await has(A, 'ihroteka-name', 'Богдан'), 'a change in one tab is in the other: ' + JSON.stringify(await A.local()));
    assert.ok(!(await C.local()).length, 'not in another browser');
    await B.close();
    const A2 = await A.reload();
    assert.ok(await has(A2, 'ihroteka-room', 'suploc02'), 'the next page in the tab has it too: ' + JSON.stringify(await A2.local()));
    await C.lib('suploc03', 'Сава');
    const C2 = await C.reload();
    assert.ok(await has(C2, 'ihroteka-name', 'Сава'), 'each browser keeps its own: ' + JSON.stringify(await C2.local()));
    assert.ok(await has(A2, 'ihroteka-name', 'Богдан'), JSON.stringify(await A2.local()));
  });

  test('shellBusy({ on }): the stand-in shell\'s busy() says the password dialog is open (together.js reloads nothing under it), off again: it does', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'supbsy01', ['Аня', 'Богдан'], { lib: {} });
    await A.call('shellBusy', { on: true });
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });   // (Богдан's g is newer)
    assert.ok(await until(async () => (await A.state()).lib.version.gap?.older, 3000), 'Аня knows she is the older');
    await sleep(1500);                                       // (together.js checks every second)
    assert.deepEqual([(await A.state()).lib.version.reloading, await A.call('reloads')], [null, []], 'busy: no reload asked');
    await A.call('shellBusy', { on: false });
    assert.equal(await until(async () => (await A.state()).lib.version.reloading, 2500), 'wire:g:2', 'not busy: asked');
  });

  test('shellNewer({ value }): the stand-in shell\'s newer() says whether the site has a newer version than the page (default: no)', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.call('shellNewer', { value: true });             // (before the library starts: what it asks later)
    await A.lib('supnew01', 'Аня', {}, { g: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('supnew01', 'Богдан', {}, { g: 1, n: 1 });
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    await B.open('n');                                       // (a game Аня's shelf does not have: the site says who is older)
    const older = X => until(async () => { const g = (await X.state()).lib.version.gap; return g && typeof g.older === 'boolean' && [g.why, g.older]; }, 5000);
    assert.deepEqual(await older(A), ['game', true], 'Аня: the site has newer');
    assert.deepEqual(await older(B), ['game', false], 'Богдан: nothing newer (the default)');
  });

  test('ownView({ id }): the room shows this game because this page opened it (together.js ownView); a follower\'s is not; no room: ours', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'supown01', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await B.game())?.view === 'g', 5000), 'Богдан follows');
    assert.deepEqual([await A.call('ownView', { id: 'g' }), await B.call('ownView', { id: 'g' }), await A.call('ownView', { id: 'h' })], [true, false, false]);
    await B.leave();
    assert.equal(await B.call('ownView', { id: 'g' }), true, 'no room: nobody else\'s');
  });

  test('reload({ boot: true }): the next page starts the library at the address the page had; after «Оновити» it is back in its room by itself (REJOIN)', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'supboot1', ['Аня', 'Богдан'], { lib: {} });
    assert.equal((await B.call('address')).search, '?room=supboot1', 'the address names the room (together.js setQuery)');
    await B.call('updateNow');
    assert.equal(await B.reloadDone(), 'reload');
    const B2 = await B.reload({ boot: true });
    assert.ok(await until(settled([A, B2]), 8000), 'back in the room, nobody asked: ' + await shows([A, B2]));
    assert.ok((await B2.events()).some(e => e[1] === 'linked'), 'its room is watched as any other');
    const C = await (await W.tab('p3tab')).reload({ boot: true });
    assert.equal(await C.state(), null, 'no room in the address, none to go back into');
  });

  test('pagehide({ persisted, lost }) and pageshow({ after }): into the back-forward cache, its goodbye lost or not, and back', T, async t => {
    const W = world(t), S = W.spy();
    const [, B] = await room(W, 'supbfc01', ['Аня', 'Богдан']);
    const byes = () => S.seen.filter(x => x.m.f === B.session && x.m.t === 'bye').length;
    await B.pagehide({ persisted: true });
    assert.equal((await B.call('netState')).up, false, 'its network goes with it');
    assert.ok(await until(() => byes() > 0, 2000), 'its bye got out');
    const t0 = Date.now();
    await B.pageshow({ after: 500 });
    assert.ok(Date.now() - t0 >= 500, 'frozen meanwhile');
    assert.equal((await B.call('netState')).up, true, 'the network back with it');
    assert.ok(await until(async () => (await B.state()).online, 8000), 'its brokers back');
    assert.deepEqual((await B.call('netState')).said, { online: 1, offline: 1 }, 'the page heard the network go and come back');
    // quiet, as a browser does it: neither 'offline' nor 'online', only pagehide and pageshow
    await B.pagehide({ persisted: true, quiet: true });
    assert.equal((await B.call('netState')).up, false, 'its network goes with it, quietly');
    await B.pageshow({ after: 100, quiet: true });
    const s = await B.call('netState');
    assert.ok(s.up && s.said.online === 1 && s.said.offline === 1, 'no online or offline: ' + JSON.stringify(s.said));
    assert.ok(await until(async () => (await B.state()).online, 8000), 'its brokers back');
    const n = byes();
    await B.pagehide({ persisted: true, lost: true });         // the network went first: its bye is lost
    await sleep(300);
    assert.equal(byes(), n, 'nothing got out');
  });

  test('throttle({ every }): page timers chained 5 deep wake every `every` ms, the others every second; off: as they were', T, async t => {
    const W = world(t);
    const A = await W.tab('aaaa1111');
    const old = await A.call('ptick', { ms: 50 });           // a page interval of 50 ms, past its 5th run when held back
    const dense = await A.call('ptick', { ms: 1 });          // one due every ms: due again the moment it ran at a wake-up
    await sleep(400);
    await A.call('throttle', { every: 2000 });
    const fresh = await A.call('ptick', { ms: 50 });         // one that starts while the page is held back
    const [from, fromDense] = (await A.call('pticks')).map(r => r.length);
    await sleep(4600);
    const ticks = await A.call('pticks'), o = ticks[old], f = ticks[fresh];
    const gaps = r => r.slice(1).map((x, i) => x - r[i]);
    const near = (x, to) => Math.abs(x - to) <= 60;
    const held = o.slice(from);
    assert.ok(held.length >= 2 && held.length <= 3 && gaps(held).every(g => near(g, 2000)) && held.every(x => near(x % 2000, 0) || near(x % 2000, 2000)),
      'the old one every 2 s: ' + held.join(', '));
    const d = ticks[dense].slice(fromDense);
    assert.ok(d.length >= 2 && d.length <= 3 && gaps(d).every(g => near(g, 2000)), 'once per wake-up, also one due every ms: ' + d.join(', '));
    assert.ok(f.length >= 4 && gaps(f.slice(0, 4)).every(g => near(g, 1000)), 'the fresh one every second for 4 runs: ' + f.join(', '));
    await A.call('throttle', { every: 0 });
    const n = (await A.call('pticks'))[old].length;
    await sleep(1000);
    assert.ok((await A.call('pticks'))[old].length - n >= 10, 'as before');
  });
});
