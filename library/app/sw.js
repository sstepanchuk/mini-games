/* The library offline. Built into site/sw.js with the list of every published file and a version (a hash of
   them all). Each version is one complete, consistent copy: the keyring always matches the sealed files next to
   it (install refuses a copy that mixes two versions, as a cache on the way can hand out right after a deploy). A new
   version is downloaded whole in the background and replaces the old one only when complete; the copy in use is
   never deleted for it. Everything stored is what the site publishes anyway: encrypted files and public pages. */
const FILES = [/* FILES */];                            // relative to the site root; '' and '<id>/' are the pages
const FONTS = [/* FONTS */];                            // font stylesheets the pages use (stored with their font files)
const VERSION = '/* VERSION */';
const CACHE = 'ihroteka-' + VERSION, FONT_CACHE = 'ihroteka-fonts';
const META = 'ihroteka-meta';                          // a note of which copy is the one in use (see working)
const BASE = new URL('./', self.location).href, IN_USE = BASE + '__in-use';
const FAILED = BASE + '__failed';                      // a note of why this version could not be stored (update.js reads it)

self.addEventListener('install', e => e.waitUntil((async () => {
  // straight from the server, past the HTTP cache: a stale keyring next to fresh files would not open them
  const all = () => caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(BASE + f, { cache: 'reload' }))));
  try { await all(); }
  catch (err) {
    if (err.name !== 'QuotaExceededError') throw err;
    // No room for two copies. The copy in use stays (owner, decision 22: playing nearby without internet must never
    // lose it): only copies of other versions go (left over from an update that never finished), then one more try,
    // if that freed anything. If that fails too, this version is not installed: the device keeps the copy it has,
    // notes why, tells the pages, and tries again on the next update check.
    const keep = new Set([CACHE, FONT_CACHE, META, ...await working()]);
    let freed = 0;
    for (const k of await caches.keys()) if (k.startsWith('ihroteka-') && !keep.has(k) && await caches.delete(k)) freed++;
    try {
      if (!freed) throw err;                             // nothing freed: a second download would not fit either
      await all();
    } catch (e) {
      await caches.delete(CACHE);
      if (e.name === 'QuotaExceededError') await noRoom();
      throw e;
    }
  }
  // One version or none: a cache on the way may still hand out a file of before a key rotation next to the new ones
  // (cache: 'reload' does not always reach past it). Such a copy would say «Бібліотеку щойно оновили…» for every
  // game until the next deploy, offline too; it is not installed (the copy in use stays), and the next update check
  // downloads it again.
  try { await consistent(); }
  catch (err) { await caches.delete(CACHE); throw err; }
  await Promise.all(FONTS.map(url => storeFont(url).catch(() => {})));   // fonts are a nicety: never fail on them
  await self.skipWaiting();
})()));

// every sealed file of this copy carries the key id of its keyring.json (library/crypto.js: [1][8-byte key id]…);
// only those 8 bytes are read (a game.bin can be megabytes)
async function consistent() {
  const sealed = FILES.filter(f => f.endsWith('.bin'));
  if (!sealed.length) return;
  const copy = await caches.open(CACHE), { kid } = JSON.parse(await (await copy.match(BASE + 'keyring.json')).text());
  for (const f of sealed) {
    const head = new Uint8Array(await (await (await copy.match(BASE + f)).blob()).slice(1, 9).arrayBuffer());
    if (btoa(String.fromCharCode(...head)) !== kid) throw new Error(f + ': another key id than keyring.json (two versions mixed)');
  }
}

// this version did not fit: a note for the page that asked for the update (update.js), and every page hears it now
async function noRoom() {
  try { await (await caches.open(META)).put(FAILED, new Response(JSON.stringify({ version: VERSION, why: 'storage', at: Date.now() }))); } catch (e) {}
  try { for (const c of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) c.postMessage({ ihroteka: 'no-room', version: VERSION }); } catch (e) {}
}

self.addEventListener('activate', e => e.waitUntil((async () => {
  // the note first: an activation that stops part way (a worker stopped or crashed mid-way counts as activated, and
  // its handler is not run again) leaves it naming this copy, never one it was about to delete
  await note();
  await caches.open(META).then(c => c.delete(FAILED)).catch(() => {});
  for (const k of await caches.keys()) if (k.startsWith('ihroteka-') && k !== CACHE && k !== FONT_CACHE && k !== META) await caches.delete(k);
  await self.clients.claim();
})()));

// The note of the copy in use. Written at activation, and checked by the worker the first time it answers a page
// after it starts (only the active worker answers them): that mends a note an activation stopped before writing.
// A note only: never fail on it, and working() checks it before trusting it.
const note = () => caches.open(META).then(c => c.put(IN_USE, new Response(CACHE))).catch(() => {});
const check = () => caches.open(META).then(c => c.match(IN_USE)).then(m => m && m.text()).then(t => t === CACHE || note(), () => {});
let checked = false;

// The copies the pages work from now (cache names): none before any version is active; the noted one, if it is there
// and complete; else (a worker from before the note, or a note naming a copy that is gone) every complete copy (a copy
// is complete when it holds the shelf: addAll stores all of it or nothing).
async function working() {
  if (!self.registration.active) return [];
  const names = await caches.keys();
  const complete = async k => names.includes(k) && !!await (await caches.open(k)).match(BASE);   // (open would make a missing one)
  const noted = await (await caches.open(META)).match(IN_USE), name = noted && await noted.text();
  if (name && await complete(name)) return [name];
  const out = [];
  for (const k of names) if (k.startsWith('ihroteka-') && k !== META && k !== FONT_CACHE && await complete(k)) out.push(k);
  return out;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(BASE)) {
    e.respondWith(local(req, url));
    if (!checked) { checked = true; e.waitUntil(check()); }
  }
  else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(font(req));
});

// The site's own files come from this version's copy. A page address (with ?room=… or not) is its page;
// anything not in the copy goes to the network, and a page that is not there either (unknown, or no network)
// opens the library (but the library itself: that would send it to itself, round and round).
async function local(req, url) {
  const path = url.href.slice(BASE.length).split(/[?#]/)[0].replace(/(^|\/)index\.html$/, '$1');
  const cache = await caches.open(CACHE), hit = await cache.match(BASE + path);
  if (hit) return hit;
  const shelf = () => req.mode === 'navigate' && path ? Response.redirect(BASE, 302) : null;
  try { const res = await fetch(req); return (res.status === 404 && shelf()) || res; }
  catch (e) { const page = shelf(); if (page) return page; throw e; }
}

async function font(req) {
  const cache = await caches.open(FONT_CACHE);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}
// a stylesheet and every font file it points to
async function storeFont(url) {
  const cache = await caches.open(FONT_CACHE);
  if (await cache.match(url, { ignoreVary: true })) return;
  const css = await fetch(url, { mode: 'cors' });
  if (!css.ok) return;
  const text = await css.clone().text();
  await Promise.all([...text.matchAll(/url\((https:[^)]+)\)/g)].map(async ([, f]) => {
    if (!(await cache.match(f))) { const r = await fetch(f, { mode: 'cors' }); if (r.ok) await cache.put(f, r); }
  }));
  await cache.put(url, css);
}
