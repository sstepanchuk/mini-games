// The password and the key (library/app/lock.js, with device.js), in memory: no build and no site. Each version of
// the library is a keyring.json and a sealed demo/game.bin made here with library/crypto.js (1 000 PBKDF2 iterations:
// fast); fetch answers per path and cache mode; IndexedDB and localStorage are fakes per device; the dialog is read
// through tests/support/dom-stub.js, which a loader hook puts in place of library/app/dom.js. Each page of the library
// is its own instance of lock.js and device.js (?inst=N, carried to their own imports). Passwords are made here and
// never printed (nor put in an assert's message or values).
import { register } from 'node:module';
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';

const STUB = new URL('../support/dom-stub.js', import.meta.url).href;
// library/app/dom.js → the stand-in; ?inst=N on a module of library/app goes on to its own ./ imports
register('data:text/javascript,' + encodeURIComponent(`
  const STUB = ${JSON.stringify(STUB)};
  export async function resolve(spec, ctx, next) {
    const from = ctx.parentURL || '', app = from.includes('/library/app/'), inst = app && new URL(from).searchParams.get('inst');
    const q = inst ? '?inst=' + inst : '';
    if (app && spec === './dom.js') return { url: STUB + q, shortCircuit: true };
    const r = await next(spec, ctx);
    return q && spec.startsWith('./') && r.url.includes('/library/app/') ? { ...r, url: r.url + q } : r;
  }`));
const vault = await import('../../library/crypto.js');
const LOCK = new URL('../../library/app/lock.js', import.meta.url).href, DEVICE = new URL('../../library/app/device.js', import.meta.url).href;

const BASE = 'https://example.github.io/lib/', GAME = { id: 'demo', title: 'Демо' };
const MSG = { offline: 'Не вдалося завантажити. Перевір інтернет і спробуй ще.', broken: 'Не вдалося відкрити бібліотеку. Онови сторінку трохи згодом.',
  wrong: 'Не той пароль.', updating: 'Бібліотеку щойно оновили. Спробуй за кілька хвилин.',
  insecure: 'Ця сторінка працює лише через https. Відкрий її за звичайним посиланням.',
  intro: 'Ігри в Ігротеці відкриваються за паролем. Цей пристрій його запам’ятає.',
  removed: 'Доступ до ігор із цим паролем закрили. Якщо тобі дали новий пароль — введи його.',
  changed: 'Твій пароль змінили. Введи новий.',
  unlocking: 'Відмикаю…', slow: 'Відмикаю… Це може тривати кілька секунд.' };
const password = () => Buffer.from(vault.random(12)).toString('base64');

// a version of the library for these people (name → password): keyring.json and demo/game.bin; people kept from
// `keep` keep their keys (a key rotation; with keep's library key too, none: a person added or taken off without one),
// the others get new ones
async function version(people, keep, same = false) {
  const raw = same ? keep.raw : vault.newLibraryKey(), kr = { ...vault.newKeyring(), kid: await vault.keyId(raw), kdf: { iterations: 1000 } };
  for (const [name, pw] of Object.entries(people)) {
    const old = keep?.kr.people.find(p => p.name === name);
    const p = old ? { ...old } : { ...(await vault.newPerson(kr, name + '-id', pw)), name };
    p.box = await vault.boxFor(p, raw);
    kr.people.push(p);
  }
  const bin = await vault.sealFile(await vault.importKey(raw), kr.kid, zlib.gzipSync('<!doctype html>GAME ' + kr.kid), vault.label.game('demo'));
  return { kr, raw, html: '<!doctype html>GAME ' + kr.kid, files: { 'keyring.json': Buffer.from(JSON.stringify(kr)), 'demo/game.bin': Buffer.from(bin) } };
}

// the network: serve(path, cache mode) → the body, 'offline' (fetch fails) or nothing (404); hold(path) keeps that
// path's requests waiting until released; log: every request (path and cache mode)
const net = { serve: () => null, holds: new Map(), log: [] };
globalThis.fetch = async (url, o = {}) => {
  const path = String(url).slice(BASE.length);
  net.log.push(path + ' ' + o.cache);
  if (net.holds.has(path)) await net.holds.get(path).promise;
  const r = net.serve(path, o.cache);
  if (r === 'offline') throw new TypeError('Failed to fetch');
  return r ? new Response(r) : new Response('', { status: 404 });
};
beforeEach(() => { net.holds.clear(); net.log = []; });   // (a hold a failed test left is not the next test's)
const hold = path => { let release; const promise = new Promise(r => { release = r; }); net.holds.set(path, { promise }); return () => { net.holds.delete(path); release(); }; };
const serving = v => { net.serve = p => v.files[p]; };

// a device: IndexedDB (data: what it stores; hang: no answer, as Safari now and then: answer() makes the opens it held
// answer late and new ones at once, recover() drops them and answers new ones; opens: how many were asked for) and
// localStorage
function device() {
  const data = new Map(), store = new Map(), held = [];
  const dev = { data, hang: false, opens: 0,
    answer() { dev.hang = false; for (const f of held.splice(0)) f(); },
    recover() { dev.hang = false; held.length = 0; },
    idb: { open() {
      const req = {};
      dev.opens++;
      const answer = () => {
        const db = { close() {}, createObjectStore() {}, transaction() {
          const tx = {}, ok = (r, v) => queueMicrotask(() => { r.result = v; tx.oncomplete?.(); });
          tx.objectStore = () => ({ get: k => { const r = {}; ok(r, data.get(k)); return r; },
            put: (v, k) => { const r = {}; data.set(k, v); ok(r, k); return r; },
            delete: k => { const r = {}; data.delete(k); ok(r); return r; } });
          return tx;
        } };
        req.result = db; req.onupgradeneeded?.(); req.onsuccess?.();
      };
      queueMicrotask(() => { if (dev.hang) held.push(answer); else answer(); });
      return req;
    } },
    ls: { getItem: k => store.has(k) ? store.get(k) : null, setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } } };
  return dev;
}
const put = (k, v) => Object.defineProperty(globalThis, k, { value: v, configurable: true, writable: true });
let n = 0;
// a new page of the library on this device → { lock, device, ui } (ui.dialogs: the dialogs it showed)
async function page(dev) {
  put('indexedDB', dev.idb); put('localStorage', dev.ls);
  const q = '?inst=' + ++n;
  return { lock: await import(LOCK + q), device: await import(DEVICE + q), ui: await import(STUB + q) };
}
const settle = () => new Promise(r => setImmediate(r));
// (by the clock, not by turns: Web Crypto and gunzip run on Node's thread pool, which the worker tabs of the tests that
// run alongside keep busy — 2000 turns were not always enough for a retry past the caches)
async function until(fn, ms = 10000) { const end = Date.now() + ms; for (;;) { const v = fn(); if (v || Date.now() > end) return v; await settle(); } }

// the open dialog; its parts
const dialog = pg => pg.ui.dialogs.find(d => d.open);
function* nodes(list) { for (const x of list) if (x && typeof x === 'object') { yield x; yield* nodes(x.children || []); } }
const part = (d, ok) => [...nodes(d.nodes)].find(ok);
const field = d => part(d, x => x.tag === 'input' && x.type === 'password');
const go = d => part(d, x => x.tag === 'button' && x.type === 'submit');
const said = d => part(d, x => x.tag === 'p' && x.className === 'err');
// the line above the field (what the dialog says first), and the one under the button while the password is checked
const intro = d => part(d, x => x.tag === 'p' && x.className === '').textContent;
const waits = d => part(d, x => x.tag === 'p' && x.className === 'busy');
// type a password and press «Відкрити» → what the dialog says under it then (the submit runs to its end)
async function type(d, pw) {
  field(d).value = pw;
  await part(d, x => x.tag === 'form').listeners.submit[0]({ preventDefault() {} });
  return said(d).textContent;
}
// the game opened → its page; or what the player is told ('cancelled' when they closed the dialog)
const opening = (pg, game = GAME) => pg.lock.openGame(game).then(html => ({ html }), e => ({ say: e.cancelled ? 'cancelled' : e.say }));
// opening the game on a page that should not ask for the password → as opening, or { asked: true } (it did)
async function attempt(pg, game = GAME) {
  let over = null;
  opening(pg, game).then(x => { over = x; });
  await until(() => over || dialog(pg));
  return over || { asked: true };
}
// a device signed in to version v with this password (typed once)
async function signedIn(v, pw) {
  const dev = device(), pg = await page(dev);
  serving(v);
  const r = opening(pg), d = await until(() => dialog(pg));
  assert.equal(await type(d, pw), '');
  assert.deepEqual(await r, { html: v.html });
  assert.ok(dev.data.has('me'));
  return dev;
}

const pw = { alice: password(), carol: password() };
const A = await version(pw), B = await version({ alice: pw.alice }, A);         // B: the key rotated, carol removed

test('a remembered key opens a game with no dialog', async () => {
  const dev = await signedIn(A, pw.alice), pg = await page(dev);
  assert.deepEqual(await attempt(pg), { html: A.html });
});

test('a wrong password: «Не той пароль.», told to a screen reader, the field marked; then the right one opens the game', async () => {
  serving(A);
  const dev = device(), pg = await page(dev), r = opening(pg), d = await until(() => dialog(pg));
  assert.equal(await type(d, password()), MSG.wrong);
  const err = said(d);
  assert.equal(err.getAttribute('role'), 'alert');
  assert.ok(err.id && field(d).getAttribute('aria-describedby') === err.id, 'the field is described by it');
  assert.equal(field(d).getAttribute('aria-invalid'), 'true');
  assert.equal(go(d).textContent, 'Відкрити');
  assert.equal(await type(d, pw.alice), '');
  assert.notEqual(field(d).getAttribute('aria-invalid'), 'true');
  assert.deepEqual(await r, { html: A.html });
  assert.ok(dev.data.has('me'));
});

test('a stale file next to a rotated keyring (either way round): one retry past every cache, and the game opens', async () => {
  const dev = await signedIn(A, pw.alice);
  for (const stale of ['demo/game.bin', 'keyring.json']) {
    net.serve = (p, cache) => (p === stale && cache !== 'reload' ? A : B).files[p];
    net.log = [];
    const pg = await page(dev);
    assert.deepEqual(await attempt(pg), { html: B.html }, stale + ' stale');
    assert.deepEqual(net.log.filter(l => l.endsWith(' reload')).sort(), ['demo/game.bin reload', 'keyring.json reload']);
  }
});

test('both stale even past the caches: «Бібліотеку щойно оновили…»', async () => {
  const dev = await signedIn(A, pw.alice);
  net.serve = p => (p === 'demo/game.bin' ? A : B).files[p];
  assert.deepEqual(await attempt(await page(dev)), { say: MSG.updating });
  assert.ok(dev.data.has('me'));
});

test('keyring.json cannot be downloaded: «Перевір інтернет», and the key is still remembered', async () => {
  const dev = await signedIn(A, pw.alice);
  net.serve = p => p === 'keyring.json' ? 'offline' : A.files[p];
  const pg = await page(dev);
  assert.deepEqual(await attempt(pg), { say: MSG.offline });
  assert.ok(dev.data.has('me'));
  serving(A);
  assert.deepEqual(await attempt(pg), { html: A.html }, 'the same page, online again');
});

test('a keyring.json that is JSON but not a keyring (a portal\'s JSON, null, a newer format) keeps the remembered key, and the same page opens the game once keyring.json is right', async () => {
  const dev = await signedIn(A, pw.alice);
  const bodies = {
    'a portal\'s JSON': '{"error":"login required"}',
    'null': 'null',
    'a newer format': JSON.stringify({ ...A.kr, v: vault.KEYRING_V + 1, members: A.kr.people, people: undefined })
  };
  for (const [what, body] of Object.entries(bodies)) {
    net.serve = p => p === 'keyring.json' ? Buffer.from(body) : A.files[p];
    const pg = await page(dev);
    assert.deepEqual(await attempt(pg), { say: MSG.broken }, what + ': no password asked');
    assert.ok(dev.data.has('me'), what + ': the key is kept');
    serving(A);
    assert.deepEqual(await attempt(pg), { html: A.html }, what + ': then the same page opens the game');
  }
});

test('a person removed from the library: the device forgets the key, and the dialog says access was closed (after «Скасувати» and on a new page too)', async () => {
  const dev = await signedIn(A, pw.carol), pg = await page(dev);
  serving(B);
  const r = opening(pg), d = await until(() => dialog(pg));
  assert.deepEqual(dev.data.get('me'), { why: 'removed' }, 'forgotten, once a real keyring.json said so: only why is kept');
  assert.equal(intro(d), MSG.removed);
  assert.equal(await type(d, pw.carol), MSG.wrong);
  d.close();
  assert.deepEqual(await r, { say: 'cancelled' });
  const again = opening(pg), d2 = await until(() => dialog(pg));
  assert.equal(intro(d2), MSG.removed, 'the same page, after «Скасувати»');
  d2.close();
  await again;
  const next = await page(dev), r3 = opening(next), d3 = await until(() => dialog(next));
  assert.equal(intro(d3), MSG.removed, 'a new page');
  assert.equal(await next.device.recall(), null, 'nobody signed in (no «Забути пароль»)');
  d3.close();
  await r3;
  // and alice, kept through the rotation, opens B with no password
  const alice = await signedIn(A, pw.alice);
  serving(B);
  assert.deepEqual(await attempt(await page(alice)), { html: B.html });
});

test('missing only from a stale keyring.json (a cache from before the person was added): the one past every cache keeps the key', async () => {
  const dave = password(), D = await version({ alice: pw.alice, dave }), stale = await version({ alice: pw.alice }, D, true);
  const dev = await signedIn(D, dave);
  net.serve = (p, cache) => (p === 'keyring.json' && cache !== 'reload' ? stale : D).files[p];
  net.log = [];
  assert.deepEqual(await attempt(await page(dev)), { html: D.html }, 'no password asked');
  assert.ok(net.log.includes('keyring.json reload'), 'keyring.json fetched again past every cache');
  assert.ok(dev.data.get('me')?.priv, 'the key kept');
});

test('a password changed with the tool: this one forgets its key, says so, and the new password opens the game and clears it', async () => {
  const dev = await signedIn(A, pw.alice), fresh = password(), C = await version({ alice: fresh });
  serving(C);
  const pg = await page(dev), r = opening(pg), d = await until(() => dialog(pg));
  assert.deepEqual(dev.data.get('me'), { why: 'changed' });
  assert.equal(intro(d), MSG.changed);
  assert.equal(await type(d, fresh), '');
  assert.deepEqual(await r, { html: C.html });
  assert.ok(dev.data.get('me')?.priv, 'the new key stored in place of the note');
  assert.equal(await pg.lock.signOut(), true);
  const next = await page(dev), r2 = opening(next), d2 = await until(() => dialog(next));
  assert.equal(intro(d2), MSG.intro, 'after «Забути пароль»: the usual words');
  d2.close();
  await r2;
});

test('«Забути пароль» clears the note of why the key went', async () => {
  const dev = await signedIn(A, pw.carol);
  serving(B);
  const pg = await page(dev), r = opening(pg), d = await until(() => dialog(pg));
  assert.equal(intro(d), MSG.removed);
  d.close();
  await r;
  assert.equal(await pg.lock.signOut(), true);
  assert.ok(!dev.data.has('me'));
  const again = opening(pg), d2 = await until(() => dialog(pg));
  assert.equal(intro(d2), MSG.intro, 'this page');
  d2.close();
  await again;
  const next = await page(dev), r3 = opening(next), d3 = await until(() => dialog(next));
  assert.equal(intro(d3), MSG.intro, 'the next page');
  d3.close();
  await r3;
});

test('cancel while «Відмикаю…»: the device remembers nothing, the password is asked again on this page and the next', async () => {
  serving(A);
  const dev = device(), pg = await page(dev), r = opening(pg), d = await until(() => dialog(pg));
  field(d).value = pw.alice;
  const submitted = part(d, x => x.tag === 'form').listeners.submit[0]({ preventDefault() {} });
  assert.equal(waits(d).textContent, MSG.unlocking);
  d.close();                                            // what «Скасувати», Escape and a tap outside all do
  assert.deepEqual(await r, { say: 'cancelled' });
  await submitted;                                      // the password checked after all
  for (let i = 0; i < 20; i++) await settle();
  assert.ok(!dev.data.has('me'), 'nothing stored');
  const again = opening(pg), d2 = await until(() => dialog(pg));
  assert.ok(d2, 'asked again on this page');
  d2.close();
  await again;
  assert.deepEqual(await attempt(await page(dev)), { asked: true }, 'asked again on the next page');
});

test('«Забути пароль» while the remembered key is still being checked: the button stays hidden, nothing stored', async () => {
  const dev = await signedIn(A, pw.alice), pg = await page(dev);
  let shown = 0;
  pg.lock.whenSignedIn(() => { shown++; });            // (what shows «Забути пароль на цьому пристрої»)
  await until(() => shown);
  const release = hold('keyring.json');
  net.log = [];
  const r = opening(pg);
  await until(() => net.log.includes('keyring.json no-cache'));
  const out = await pg.lock.signOut();
  release();
  await r;
  for (let i = 0; i < 20; i++) await settle();
  assert.equal(shown, 1, 'the button is not shown again');
  assert.ok(!dev.data.has('me'));
  assert.equal(await pg.device.recall(), null);
  assert.equal(out, true, 'signOut says it is forgotten');
});

test('a check that fails after sign-out does not drop a newer key', async () => {
  const dev = await signedIn(A, pw.alice), pg = await page(dev);
  let shown = 0;
  pg.lock.whenSignedIn(() => { shown++; });
  await until(() => shown);
  const release = hold('keyring.json');
  net.log = [];
  const old = opening(pg);
  await until(() => net.log.includes('keyring.json no-cache'));
  await pg.lock.signOut();
  const now = opening(pg), d = await until(() => dialog(pg));
  net.serve = () => 'offline';
  release();                                            // the old check fails: offline
  assert.deepEqual(await old, { say: MSG.offline });
  serving(A);
  assert.equal(await type(d, pw.alice), '');
  assert.deepEqual(await now, { html: A.html });
  const signedInAgain = shown;
  assert.deepEqual(await attempt(pg), { html: A.html }, 'the next game opens');
  for (let i = 0; i < 20; i++) await settle();
  assert.equal(shown, signedInAgain, 'with the key the page has: not asked for again');
});

test('IndexedDB that never answers: the password is asked after 3 s', async () => {
  const dev = await signedIn(A, pw.alice);
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    dev.hang = true;
    const pg = await page(dev), r = opening(pg);
    for (let i = 0; i < 20 && !dialog(pg); i++) { mock.timers.tick(200); for (let j = 0; j < 20; j++) await settle(); }
    assert.ok(dialog(pg), 'asked, although the key is stored');
    dialog(pg).close();
    assert.deepEqual(await r, { say: 'cancelled' });
  } finally { mock.timers.reset(); }
});

// (mock timers: the storage's 3 s and the tries after it; what runs on Node's own (Web Crypto) is waited for by the clock)
const steps = async ms => { for (let t = 0; t < ms; t += 100) { mock.timers.tick(100); for (let j = 0; j < 20; j++) await settle(); } };
const timeouts = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;
// a page of a signed-in device whose IndexedDB does not answer: the dialog after 3 s, though the key is stored
async function hung(v, pass) {
  const dev = await signedIn(v, pass);
  dev.hang = true;
  const pg = await page(dev);
  let over = null;
  opening(pg).then(x => { over = x; });
  for (let t = 0; t < 3500 && !dialog(pg); t += 100) await steps(100);
  return { dev, pg, d: dialog(pg), over: () => over };
}

test('the storage does not answer, then answers while the dialog is open (its late answer): the dialog closes by itself and the game opens with no password', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dev, pg, d, over } = await hung(A, pw.alice);
    assert.ok(d, 'asked after 3 s, although the key is stored');
    assert.equal(over(), null);
    dev.answer();                                       // (the open that timed out answers now)
    await steps(100);
    assert.ok(await until(() => !d.open && over()), 'closed by itself');
    assert.deepEqual(over(), { html: A.html });
    assert.equal(pg.lock.askingPassword(), false);
  } finally { mock.timers.reset(); }
});

test('the storage does not answer, then answers new requests while the dialog is open: tried again every second, the dialog closes by itself within about 1 s', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dev, d, over } = await hung(A, pw.alice);
    assert.ok(d);
    const before = dev.opens;
    await steps(2000);
    assert.ok(dev.opens - before >= 1, 'the storage is asked again while the dialog is open');
    assert.ok(d.open, '(still no answer)');
    dev.recover();                                      // (the opens it held are lost; new ones answer)
    await steps(1100);
    assert.ok(await until(() => !d.open && over(), 3000), 'closed by itself');
    assert.deepEqual(over(), { html: A.html });
  } finally { mock.timers.reset(); }
});

test('the storage answers «nothing stored» late: the dialog stays; closed, nothing asks the storage any more', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    serving(A);
    const dev = device();
    dev.hang = true;
    const pg = await page(dev);
    let over = null;
    opening(pg).then(x => { over = x; });
    for (let t = 0; t < 3500 && !dialog(pg); t += 100) await steps(100);
    const d = dialog(pg);
    assert.ok(d, 'asked after 3 s');
    dev.answer();
    await steps(3000);
    assert.ok(d.open, 'the dialog stays');
    const opens = dev.opens;
    await steps(3000);
    assert.equal(dev.opens, opens, 'no more asking once the storage said it has nothing');
    d.close();
    await until(() => over);
    assert.deepEqual(over, { say: 'cancelled' });
    assert.equal(timeouts(), 0, 'no timer left');
  } finally { mock.timers.reset(); }
});

test('the storage never answers: asked again while the dialog is open; closed, never again', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const { dev, pg, d, over } = await hung(A, pw.alice);
    await steps(2000);
    d.close();
    await until(() => over());
    assert.deepEqual(over(), { say: 'cancelled' });
    const opens = dev.opens;
    await steps(5000);
    assert.equal(dev.opens, opens, 'nothing asks the storage once the dialog is closed');
    assert.equal(pg.lock.askingPassword(), false);
  } finally { mock.timers.reset(); }
});

test('a late answer for a person no longer in the library: forgotten, the dialog stays and says access was closed', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const dev = await signedIn(A, pw.carol);
    serving(B);
    dev.hang = true;
    const pg = await page(dev);
    let over = null;
    opening(pg).then(x => { over = x; });
    for (let t = 0; t < 3500 && !dialog(pg); t += 100) await steps(100);
    const d = dialog(pg);
    assert.equal(intro(d), MSG.intro, '(the storage said nothing yet)');
    dev.answer();
    assert.ok(await until(() => dev.data.get('me')?.why === 'removed', 5000), 'forgotten, with why');
    await steps(200);
    assert.ok(d.open, 'the dialog stays');
    assert.equal(intro(d), MSG.removed);
    assert.equal(over, null);
    d.close();
  } finally { mock.timers.reset(); }
});

test('the storage does not answer as the page starts: «Забути пароль» shows once it answers', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const dev = await signedIn(A, pw.alice);
    dev.hang = true;
    const pg = await page(dev);
    let shown = 0;
    pg.lock.whenSignedIn(() => { shown++; });
    await steps(4000);
    assert.equal(shown, 0, '(nothing known yet)');
    dev.recover();
    await steps(1100);
    assert.ok(await until(() => shown, 2000), 'shown once the storage answered');
    await steps(3000);
    assert.equal(shown, 1);
    assert.equal(timeouts(), 0, 'no timer left');
  } finally { mock.timers.reset(); }
});

test('a game opened with the remembered key, or a dialog that closed by itself: no timer left', async () => {
  const dev = await signedIn(A, pw.alice), before = timeouts();
  assert.deepEqual(await attempt(await page(dev)), { html: A.html });
  assert.equal(timeouts(), before);
});

test('while the password is checked: «Відмикаю…» under the button at once, told to a screen reader; after 1 s it says it may take a few seconds; then it goes', async () => {
  serving(A);
  const dev = device(), pg = await page(dev), r = opening(pg), d = await until(() => dialog(pg));
  const line = waits(d);
  assert.equal(line.getAttribute('role'), 'status');
  assert.ok(!line.hidden && !line.textContent, 'empty until the password is sent (in the page: a live region must be there before it speaks)');
  const release = hold('keyring.json');                 // (the check waits for keyring.json meanwhile)
  mock.timers.enable({ apis: ['setTimeout'] });
  let submitted;
  try {
    field(d).value = pw.alice;
    submitted = part(d, x => x.tag === 'form').listeners.submit[0]({ preventDefault() {} });
    assert.equal(line.textContent, MSG.unlocking);
    assert.equal(go(d).disabled, true);
    mock.timers.tick(999);
    assert.equal(line.textContent, MSG.unlocking);
    mock.timers.tick(1);
    assert.equal(line.textContent, MSG.slow);
  } finally { mock.timers.reset(); }
  release();
  await submitted;
  assert.deepEqual(await r, { html: A.html });
  assert.ok(!line.hidden && line.textContent === '', 'empty again');
});

test('a wrong password: the line under the button goes when it is said', async () => {
  serving(A);
  const dev = device(), pg = await page(dev), r = opening(pg), d = await until(() => dialog(pg));
  assert.equal(await type(d, password()), MSG.wrong);
  assert.equal(waits(d).textContent, '');
  assert.equal(go(d).disabled, false);
  d.close();
  await r;
});

test('askingPassword: true while a password dialog is open (a password being checked too), false once it closed', async () => {
  serving(A);
  const dev = device(), pg = await page(dev);
  assert.equal(pg.lock.askingPassword(), false);
  const r = opening(pg), d = await until(() => dialog(pg));
  assert.equal(pg.lock.askingPassword(), true);
  const release = hold('keyring.json');
  field(d).value = pw.alice;
  const submitted = part(d, x => x.tag === 'form').listeners.submit[0]({ preventDefault() {} });
  assert.equal(pg.lock.askingPassword(), true, 'a password being checked');
  release();
  await submitted;
  await r;
  assert.equal(pg.lock.askingPassword(), false, 'opened');
  await pg.lock.signOut();
  const again = opening(pg), d2 = await until(() => dialog(pg));
  assert.equal(pg.lock.askingPassword(), true);
  d2.close();
  await again;
  assert.equal(pg.lock.askingPassword(), false, 'cancelled');
});

test('no Web Crypto (not https): said, and final (trying again here cannot help)', async () => {
  serving(A);
  const pg = await page(device()), was = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', { value: {}, configurable: true });
  let e = null;
  try { await pg.lock.openGame(GAME).catch(x => { e = x; }); } finally { Object.defineProperty(globalThis, 'crypto', was); }
  assert.equal(e?.say, MSG.insecure);
  assert.equal(e?.final, true);
});

test('the shelf (library.json): what is not a shelf, or no network, is said; MSG.broken is the library\'s', async () => {
  const pg = await page(device());
  assert.equal(pg.lock.MSG.broken, MSG.broken);
  const shelf = [{ id: 'demo', title: 'Демо' }];
  for (const [what, body, say] of [['HTML from a portal', Buffer.from('<!doctype html><p>Увійдіть'), MSG.broken], ['no network', 'offline', MSG.offline],
    ['nothing there (404)', null, MSG.broken], ['the shelf', Buffer.from(JSON.stringify(shelf)), null]]) {
    net.serve = p => p === 'library.json' ? body : null;
    const out = await pg.lock.openShelf().then(v => ({ v }), e => ({ say: e.say }));
    if (say) assert.deepEqual(out, { say }, what);
    else assert.deepEqual(out, { v: shelf }, what);
  }
});
