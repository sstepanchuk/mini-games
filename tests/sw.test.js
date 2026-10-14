// The offline copy (library/app/sw.js), run in a fake service worker: the Cache Storage is a map of caches holding a
// number of files, with room for a fixed number in all (addAll stores every file or none, and says QuotaExceededError
// when they do not fit, as a browser does). A phone short of space keeps the copy it works from (owner, decision 22):
// an update that does not fit deletes only copies of other versions, tries once more if that freed anything, and if it
// still does not fit, is not installed (the old version stays active, nothing of it deleted; a note says why and the
// pages are told). A copy is one version or none: sealed files that carry another key id than its keyring.json are not
// installed. The note of the copy in use is written before anything is deleted, and mended by the worker that answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../library/app/sw.js', import.meta.url)), 'utf8');
const BASE = 'https://example.github.io/lib/', FILES = ['', 'lib/ihroteka.js', 'keyring.json', 'dragons/', 'dragons/game.bin'];
const IN_USE = BASE + '__in-use', FAILED = BASE + '__failed';

// what a version of the site holds: keyring.json names its library key's id, and every sealed file starts with
// [1][that id: 8 bytes] (library/crypto.js sealFile); keys: which key each one carries (kid of keyring.json, sealed)
const KID = { A: [1, 2, 3, 4, 5, 6, 7, 8], B: [8, 7, 6, 5, 4, 3, 2, 1] };
const b64 = bytes => btoa(String.fromCharCode(...bytes));
const site = ({ keyring = 'B', sealed = 'B' } = {}) => path => path === 'keyring.json' ? JSON.stringify({ v: 4, kid: b64(KID[keyring]), people: [] })
  : path.endsWith('.bin') ? new Uint8Array([1, ...KID[sealed], ...new Array(40).fill(9)])
  : 'new ' + BASE + path;

// a device: its caches ({ name: [url, …] }), room for this many files in all (d.room: it can change), whether a
// version is active, an error other than the quota that storing meets (fails), how many caches it deletes before the
// worker stops (stopAfter: then caches.delete throws, as a worker stopped part way), and the site it downloads from.
// d.downloads: how many times the worker downloaded its copy; d.told: what the pages heard from it.
function device({ caches = {}, room = 100, active = true, fails = null, stopAfter = Infinity, from = site() } = {}) {
  let deletes = 0;
  const d = { room, downloads: 0, told: [] };
  const store = new Map(Object.entries(caches).map(([k, urls]) => [k, new Map(urls.map(u => [u, 'old ' + u]))]));
  const used = () => [...store.values()].reduce((n, c) => n + c.size, 0);
  const quota = () => Object.assign(new Error('no room'), { name: 'QuotaExceededError' });
  const key = url => typeof url === 'string' ? url : url.url;
  const cache = name => ({
    async addAll(reqs) {
      d.downloads++;
      if (fails) throw fails;
      if (used() + reqs.length > d.room) throw quota();
      for (const r of reqs) store.get(name).set(r.url, from(r.url.slice(BASE.length)));
    },
    async match(url) { const v = store.get(name)?.get(key(url)); return v === undefined ? undefined : new Response(v); },
    async put(url, res) { if (used() + 1 > d.room) throw quota(); store.get(name).set(key(url), await res.text()); },
    async delete(url) { return !!store.get(name)?.delete(key(url)); }
  });
  const handlers = {};
  const page = { postMessage: m => d.told.push(structuredClone(m)) };   // (a copy, as a message is)
  const self = {
    location: BASE + 'sw.js',
    registration: { active: active ? {} : null },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async o => o && o.type === 'window' && o.includeUncontrolled ? [page] : [] }
  };
  const ctx = vm.createContext({
    self, URL, console, btoa, Response,
    caches: {
      async open(name) { if (!store.has(name)) store.set(name, new Map()); return cache(name); },
      async keys() { return [...store.keys()]; },
      async delete(name) {
        if (deletes++ >= stopAfter) throw Object.assign(new Error('the worker stopped'), { name: 'AbortError' });
        return store.delete(name);
      }
    },
    Request: class { constructor(url) { this.url = url; } },
    fetch: async () => { throw new TypeError('offline'); }
  });
  const code = SRC.replace('/* FILES */', FILES.map(f => JSON.stringify(f)).join(',')).replace('/* FONTS */', '').replace('/* VERSION */', 'v2');
  vm.runInContext(code, ctx);
  const fire = async t => { let p; handlers[t]({ waitUntil: x => { p = x; } }); return p; };
  // a page's request to the worker: what it answers (text; a redirect: 'redirect <where>'), once all it waits for is done
  const ask = async (url, mode = 'navigate') => {
    const waits = [];
    let answer;
    handlers.fetch({ request: { url, method: 'GET', mode }, respondWith: x => { answer = x; }, waitUntil: x => { waits.push(x); } });
    await Promise.all(waits);
    const r = await answer;
    return r.status === 302 ? 'redirect ' + r.headers.get('location') : r.text();
  };
  return Object.assign(d, { store, fire, ask, names: () => [...store.keys()].sort(), note: () => store.get('ihroteka-meta')?.get(IN_USE) });
}
const full = () => FILES.map(f => BASE + f);
// the device notes the copy in use
const noted = (d, name) => { if (!d.store.has('ihroteka-meta')) d.store.set('ihroteka-meta', new Map()); d.store.get('ihroteka-meta').set(IN_USE, name); };

test('an update installs as a whole copy; on activation only it (with the fonts and the note of the copy in use) stays', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-fonts': [] } });
  await d.fire('install');
  assert.equal(d.store.get('ihroteka-v2').size, FILES.length);
  assert.ok(d.store.has('ihroteka-v1'), 'the old copy works on until the new one is active');
  await d.fire('activate');
  assert.deepEqual(d.names(), ['ihroteka-fonts', 'ihroteka-meta', 'ihroteka-v2']);
  assert.equal(d.note(), 'ihroteka-v2', 'it notes which copy is in use');
});

test('no room for two copies: copies of other versions go, never the one in use; then the update fits', async () => {
  // v1 in use (noted), and v0 left over from an update that never finished
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-v0': full(), 'ihroteka-meta': [] }, room: 2 * FILES.length + 1 });
  noted(d, 'ihroteka-v1');
  await d.fire('install');
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1', 'ihroteka-v2']);
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length, 'the copy in use is whole');
  assert.equal(d.store.get('ihroteka-v2').size, FILES.length);
});

test('no room even then: the update is not installed, and the copy in use stays whole', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, room: FILES.length + 2 });
  noted(d, 'ihroteka-v1');
  await assert.rejects(d.fire('install'), { name: 'QuotaExceededError' });
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1'], 'nothing of the new version left taking room');
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length);
});

test('a worker from before the note: every complete copy counts as in use; an unfinished one goes', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-v0': [BASE + 'keyring.json'] }, room: 2 * FILES.length });
  await d.fire('install');
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1', 'ihroteka-v2']);
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length);
});

test('the first install (nothing in use): whatever is there may go to make room', async () => {
  const d = device({ caches: { 'ihroteka-v1': full() }, room: FILES.length + 1, active: false });
  await d.fire('install');
  assert.deepEqual(d.names(), ['ihroteka-v2']);
});

test('any other failure fails the install as before (the old copy untouched)', async () => {
  const d = device({ caches: { 'ihroteka-v1': full() }, fails: Object.assign(new Error('network'), { name: 'TypeError' }) });
  await assert.rejects(d.fire('install'), { name: 'TypeError' });
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length);
});

/* ---------- the note of the copy in use ---------- */

test('a note naming a copy that is gone: the complete copy is kept and the failed install deletes only its own', async () => {
  // v1 in use; its activation stopped after deleting v0 and before the note (a worker stopped or crashed: Chromium
  // counts it activated and does not run it again), or the note's put failed: the note still names v0
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, room: FILES.length });
  noted(d, 'ihroteka-v0');
  await assert.rejects(d.fire('install'), { name: 'QuotaExceededError' });
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1']);
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length, 'the copy in use is whole');
});

test('an activation stopped part way: its note already names its copy', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-v0': full(), 'ihroteka-meta': [] }, stopAfter: 1 });
  noted(d, 'ihroteka-v1');
  await d.fire('install');
  await assert.rejects(d.fire('activate'), { name: 'AbortError' });
  assert.equal(d.note(), 'ihroteka-v2');
});

test('the worker answering the pages mends a note that names another copy', async () => {
  // v2 is active (it answers the pages); an activation stopped before its note left the note naming v1, still there
  const d = device({ caches: { 'ihroteka-v2': full(), 'ihroteka-v1': full(), 'ihroteka-meta': [] } });
  noted(d, 'ihroteka-v1');
  assert.equal(await d.ask(BASE + '?room=abc'), 'old ' + BASE, 'the page comes from the copy');
  assert.equal(d.note(), 'ihroteka-v2');
});

test('no copy and no network: the library itself is not sent to itself; another page is sent to the library', async () => {
  const d = device();
  await assert.rejects(d.ask(BASE), { name: 'TypeError' }, 'no redirect loop: the browser says it is offline');
  assert.equal(await d.ask(BASE + 'nope/'), 'redirect ' + BASE);
});

/* ---------- one version or none ---------- */

test('a copy whose game.bin carries another key id than its keyring.json is not installed: nothing of it stays, the copy in use is untouched', async () => {
  // a cache on the way still hands out the game.bin of before the key rotation, next to the new keyring.json
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, from: site({ keyring: 'B', sealed: 'A' }) });
  noted(d, 'ihroteka-v1');
  await assert.rejects(d.fire('install'), /dragons\/game\.bin/);
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1']);
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length);
  assert.equal(d.store.get('ihroteka-v1').get(BASE + 'keyring.json'), 'old ' + BASE + 'keyring.json');
});

test('the same with a stale keyring.json next to new sealed files', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, from: site({ keyring: 'A', sealed: 'B' }) });
  noted(d, 'ihroteka-v1');
  await assert.rejects(d.fire('install'), /dragons\/game\.bin/);
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1']);
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length);
});

test('a consistent copy installs as before', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, from: site({ keyring: 'A', sealed: 'A' }) });
  noted(d, 'ihroteka-v1');
  await d.fire('install');
  await d.fire('activate');
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v2']);
  assert.equal(d.store.get('ihroteka-v2').size, FILES.length);
  assert.equal(d.note(), 'ihroteka-v2');
});

/* ---------- no room ---------- */

test('no room and nothing else to delete: one download, not two', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, room: FILES.length + 2 });
  noted(d, 'ihroteka-v1');
  await assert.rejects(d.fire('install'), { name: 'QuotaExceededError' });
  assert.equal(d.downloads, 1);
});

test('no room even then: the note says why, the pages are told, activation clears it', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, room: FILES.length + 2 });
  noted(d, 'ihroteka-v1');
  const t0 = Date.now();
  await assert.rejects(d.fire('install'), { name: 'QuotaExceededError' });
  const failed = JSON.parse(d.store.get('ihroteka-meta').get(FAILED));
  assert.deepEqual({ ...failed, at: undefined }, { version: 'v2', why: 'storage', at: undefined });
  assert.ok(failed.at >= t0 && failed.at <= Date.now(), 'when');
  assert.deepEqual(d.told, [{ ihroteka: 'no-room', version: 'v2' }]);
  // the player made room; the next update check installs it
  d.room = 100;
  await d.fire('install');
  await d.fire('activate');
  assert.equal(d.store.get('ihroteka-meta').get(FAILED), undefined);
  assert.equal(d.note(), 'ihroteka-v2');
});
