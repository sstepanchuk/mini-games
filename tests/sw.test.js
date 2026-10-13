// The offline copy (library/app/sw.js), run in a fake service worker: the Cache Storage is a map of caches holding a
// number of files, with room for a fixed number in all (addAll stores every file or none, and says QuotaExceededError
// when they do not fit, as a browser does). A phone short of space keeps the copy it works from (owner, decision 22):
// an update that does not fit deletes only copies of other versions, tries once more, and if it still does not fit,
// is not installed (the old version stays active, nothing of it deleted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../library/app/sw.js', import.meta.url)), 'utf8');
const BASE = 'https://example.github.io/lib/', FILES = ['', 'lib/ihroteka.js', 'keyring.json', 'dragons/', 'dragons/game.bin'];

// a device: its caches ({ name: [url, …] }), room for this many files in all, whether a version is active, and an
// error other than the quota that storing meets (fails)
function device({ caches = {}, room = 100, active = true, fails = null } = {}) {
  const store = new Map(Object.entries(caches).map(([k, urls]) => [k, new Map(urls.map(u => [u, 'old ' + u]))]));
  const used = () => [...store.values()].reduce((n, c) => n + c.size, 0);
  const quota = () => Object.assign(new Error('no room'), { name: 'QuotaExceededError' });
  const cache = name => ({
    async addAll(reqs) { if (fails) throw fails; if (used() + reqs.length > room) throw quota(); for (const r of reqs) store.get(name).set(r.url, 'new ' + r.url); },
    async match(url) { const v = store.get(name).get(typeof url === 'string' ? url : url.url); return v === undefined ? undefined : { text: async () => v }; },
    async put(url, res) { if (used() + 1 > room) throw quota(); store.get(name).set(url, await res.text()); }
  });
  const handlers = {};
  const self = {
    location: BASE + 'sw.js',
    registration: { active: active ? {} : null },
    addEventListener: (t, fn) => { handlers[t] = fn; },
    skipWaiting: async () => {}, clients: { claim: async () => {} }
  };
  const ctx = vm.createContext({
    self, URL, console,
    caches: {
      async open(name) { if (!store.has(name)) store.set(name, new Map()); return cache(name); },
      async keys() { return [...store.keys()]; },
      async delete(name) { return store.delete(name); }
    },
    Request: class { constructor(url) { this.url = url; } },
    Response: class { constructor(body) { this.body = body; } async text() { return this.body; } },
    fetch: async () => { throw new Error('offline'); }
  });
  const code = SRC.replace('/* FILES */', FILES.map(f => JSON.stringify(f)).join(',')).replace('/* FONTS */', '').replace('/* VERSION */', 'v2');
  vm.runInContext(code, ctx);
  const fire = async t => { let p; handlers[t]({ waitUntil: x => { p = x; } }); return p; };
  return { store, fire, names: () => [...store.keys()].sort() };
}
const full = () => FILES.map(f => BASE + f);

test('an update installs as a whole copy; on activation only it (with the fonts and the note of the copy in use) stays', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-fonts': [] } });
  await d.fire('install');
  assert.equal(d.store.get('ihroteka-v2').size, FILES.length);
  assert.ok(d.store.has('ihroteka-v1'), 'the old copy works on until the new one is active');
  await d.fire('activate');
  assert.deepEqual(d.names(), ['ihroteka-fonts', 'ihroteka-meta', 'ihroteka-v2']);
  assert.equal(d.store.get('ihroteka-meta').get(BASE + '__in-use'), 'ihroteka-v2', 'it notes which copy is in use');
});

test('no room for two copies: copies of other versions go, never the one in use; then the update fits', async () => {
  // v1 in use (noted), and v0 left over from an update that never finished
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-v0': full(), 'ihroteka-meta': [] }, room: 2 * FILES.length + 1 });
  d.store.get('ihroteka-meta').set(BASE + '__in-use', 'ihroteka-v1');
  await d.fire('install');
  assert.deepEqual(d.names(), ['ihroteka-meta', 'ihroteka-v1', 'ihroteka-v2']);
  assert.equal(d.store.get('ihroteka-v1').size, FILES.length, 'the copy in use is whole');
  assert.equal(d.store.get('ihroteka-v2').size, FILES.length);
});

test('no room even then: the update is not installed, and the copy in use stays whole', async () => {
  const d = device({ caches: { 'ihroteka-v1': full(), 'ihroteka-meta': [] }, room: FILES.length + 2 });
  d.store.get('ihroteka-meta').set(BASE + '__in-use', 'ihroteka-v1');
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
