// What a device remembers of the sign-in (library/app/device.js), on a fake IndexedDB that answers, never answers
// (Safari now and then) or fails, and a fake localStorage. Each page of the library is a fresh instance of the module
// on the same storage. «Забути пароль на цьому пристрої» must stay forgotten even when IndexedDB does not take the
// delete: a mark in localStorage, written first, makes the next page finish it.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const DEVICE = new URL('../../library/app/device.js', import.meta.url).href, MARK = 'ihroteka-forgotten';
const KEY = { id: 'alice-id', priv: 'a CryptoKey that cannot be read' }, NEW = { id: 'alice-id', priv: 'her key after a new password' };

// a device's IndexedDB: mode 'ok' | 'hang' (open never answers; release() answers them all) | 'error' (open fails)
function idb() {
  const data = new Map(), pending = [];
  const dev = { data, mode: 'ok',
    release() { for (const f of pending.splice(0)) f(); },
    open() {
      const req = {};
      const answer = () => {
        const db = { close() {}, transaction() {
          const tx = {}, done = (r, v) => setImmediate(() => { r.result = v; tx.oncomplete?.(); });
          tx.objectStore = () => ({ get(k) { const r = {}; done(r, data.get(k)); return r; },
            put(v, k) { const r = {}; data.set(k, v); done(r, k); return r; },
            delete(k) { const r = {}; data.delete(k); done(r); return r; } });
          return tx;
        }, createObjectStore() {} };
        req.result = db; req.onsuccess?.();
      };
      setImmediate(() => {
        if (dev.mode === 'hang') return pending.push(answer);
        if (dev.mode === 'error') { req.error = new Error('UnknownError: Connection to Indexed Database server lost'); return req.onerror?.(); }
        answer();
      });
      return req;
    } };
  return dev;
}
// localStorage; broken: every call throws (storage blocked)
function ls({ broken = false } = {}) {
  const m = new Map(), chk = () => { if (broken) throw new Error('SecurityError'); };
  return { m, getItem: k => { chk(); return m.has(k) ? m.get(k) : null; }, setItem: (k, v) => { chk(); m.set(k, String(v)); }, removeItem: k => { chk(); m.delete(k); } };
}
let n = 0;
// a new page of the library on this device
const page = async (dev, store) => { globalThis.indexedDB = dev; globalThis.localStorage = store; return import(DEVICE + '?p=' + ++n); };
const timers = () => process.getActiveResourcesInfo().filter(r => r === 'Timeout').length;

test('healthy storage: remembered across pages; forget → true at once, nothing stored, no mark left', async () => {
  const dev = idb(), store = ls();
  await (await page(dev, store)).remember(KEY.id, KEY.priv);
  const p = await page(dev, store);
  assert.deepEqual(await p.recall(), KEY);
  const t0 = Date.now();
  assert.equal(await p.forget(), true);
  assert.ok(Date.now() - t0 < 500);
  assert.ok(!dev.data.has('me'));
  assert.ok(!store.m.has(MARK));
  assert.equal(await (await page(dev, store)).recall(), null);
});

test('a request leaves no timer behind', async () => {
  const dev = idb(), store = ls(), before = timers(), p = await page(dev, store);
  await p.remember(KEY.id, KEY.priv);
  await (await page(dev, store)).recall();
  await p.forget();
  dev.mode = 'error';
  await (await page(dev, store)).recall();
  assert.equal(timers(), before);
});

test('forget while IndexedDB fails: true; the next page does not recall the key, and erases it', async () => {
  const dev = idb(), store = ls();
  await (await page(dev, store)).remember(KEY.id, KEY.priv);
  const p = await page(dev, store);
  assert.deepEqual(await p.recall(), KEY);
  dev.mode = 'error';
  assert.equal(await p.forget(), true);
  assert.ok(dev.data.has('me'), '(the delete did not get through)');
  assert.equal(await p.recall(), null, 'this page forgot it');
  dev.mode = 'ok';
  assert.equal(await (await page(dev, store)).recall(), null, 'the next page does not recall it');
  assert.ok(!dev.data.has('me'), 'it erased it');
  assert.ok(!store.m.has(MARK), 'and the mark with it');
});

test('forget while IndexedDB never answers: true after the timeout; the delete is not made late, the next page makes it', async () => {
  const dev = idb(), store = ls();
  await (await page(dev, store)).remember(KEY.id, KEY.priv);
  const p = await page(dev, store);
  assert.deepEqual(await p.recall(), KEY);
  dev.mode = 'hang';
  const t0 = Date.now();
  assert.equal(await p.forget(), true);
  assert.ok(Date.now() - t0 >= 2900, 'it waited for IndexedDB');
  dev.mode = 'ok';
  dev.release();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  assert.ok(dev.data.has('me'), 'the open that answered late did not delete it then');
  const next = await page(dev, store);
  assert.equal(await next.recall(), null);
  assert.ok(!dev.data.has('me'));
  assert.ok(!store.m.has(MARK));
});

test('IndexedDB and localStorage both fail: forget → false (the key may still be there)', async () => {
  const dev = idb();
  await (await page(dev, ls())).remember(KEY.id, KEY.priv);
  const p = await page(dev, ls({ broken: true }));
  assert.deepEqual(await p.recall(), KEY);
  dev.mode = 'error';
  assert.equal(await p.forget(), false);
});

test('a page that never saw or stored a key: forget → true, storage blocked or not', async () => {
  const dev = idb();
  dev.mode = 'error';
  const p = await page(dev, ls({ broken: true }));
  assert.equal(await p.recall(), null, 'storage trouble = nothing remembered');
  assert.equal(await p.forget(), true);
});

test('signing in again after a forget the storage did not take: the next page recalls the new key', async () => {
  const dev = idb(), store = ls();
  await (await page(dev, store)).remember(KEY.id, KEY.priv);
  const p = await page(dev, store);
  await p.recall();
  dev.mode = 'error';
  await p.forget();
  dev.mode = 'ok';
  await p.remember(NEW.id, NEW.priv);
  assert.ok(!store.m.has(MARK), 'a key stored again clears the mark');
  assert.deepEqual(await (await page(dev, store)).recall(), NEW);
});

test('recall() under way, then forget(): recall is null afterwards', async () => {
  const dev = idb(), store = ls();
  await (await page(dev, store)).remember(KEY.id, KEY.priv);
  const p = await page(dev, store);
  const reading = p.recall();                          // nothing in memory yet: it reads IndexedDB
  await p.forget();
  await reading;
  assert.equal(await p.recall(), null);
  assert.ok(!dev.data.has('me'));
});

test('without IndexedDB: remembered on this page only; forget → true', async () => {
  const p = await page(undefined, ls());
  assert.equal(await p.recall(), null);
  await p.remember(KEY.id, KEY.priv);
  assert.deepEqual(await p.recall(), KEY);
  assert.equal(await p.forget(), true);
  assert.equal(await p.recall(), null);
});
