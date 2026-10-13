/* The library offline. Built into site/sw.js with the list of every published file and a version (a hash of
   them all). Each version is one complete, consistent copy: the keyring always matches the sealed files next to
   it. A new version is downloaded whole in the background and replaces the old one only when complete.
   Everything stored is what the site publishes anyway: encrypted files and public pages. */
const FILES = [/* FILES */];                            // relative to the site root; '' and '<id>/' are the pages
const FONTS = [/* FONTS */];                            // font stylesheets the pages use (stored with their font files)
const VERSION = '/* VERSION */';
const CACHE = 'ihroteka-' + VERSION, FONT_CACHE = 'ihroteka-fonts';
const META = 'ihroteka-meta';                          // a note of which copy is the one in use (see working)
const BASE = new URL('./', self.location).href, IN_USE = BASE + '__in-use';

self.addEventListener('install', e => e.waitUntil((async () => {
  // straight from the server, past the HTTP cache: a stale keyring next to fresh files would not open them
  const all = () => caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(BASE + f, { cache: 'reload' }))));
  try { await all(); }
  catch (err) {
    if (err.name !== 'QuotaExceededError') throw err;
    // No room for two copies. The copy in use stays (owner, decision 22: playing nearby without internet must never
    // lose it): only copies of other versions go (left over from an update that never finished), then one more try.
    // If that fails too, this version is not installed: the device keeps the copy it has, and tries again on the
    // next update check.
    const keep = new Set([CACHE, FONT_CACHE, META, ...await working()]);
    for (const k of await caches.keys()) if (k.startsWith('ihroteka-') && !keep.has(k)) await caches.delete(k);
    try { await all(); } catch (e) { await caches.delete(CACHE); throw e; }
  }
  await Promise.all(FONTS.map(url => storeFont(url).catch(() => {})));   // fonts are a nicety: never fail on them
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('ihroteka-') && k !== CACHE && k !== FONT_CACHE && k !== META) await caches.delete(k);
  try { await (await caches.open(META)).put(IN_USE, new Response(CACHE)); } catch (e) {}   // (a note only: never fail on it)
  await self.clients.claim();
})()));

// The copies the pages work from now (cache names): none before any version is active; the one the active worker
// noted; or, from a worker before the note, every complete copy (a copy is complete when it holds the shelf: addAll
// stores all of it or nothing).
async function working() {
  if (!self.registration.active) return [];
  const noted = await (await caches.open(META)).match(IN_USE);
  if (noted) return [await noted.text()];
  const out = [];
  for (const k of await caches.keys()) if (k.startsWith('ihroteka-') && k !== META && await (await caches.open(k)).match(BASE)) out.push(k);
  return out;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(BASE)) e.respondWith(local(req, url));
  else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(font(req));
});

// The site's own files come from this version's copy. A page address (with ?room=… or not) is its page;
// anything not in the copy goes to the network, and a page that is not there either (unknown, or no network)
// opens the library.
async function local(req, url) {
  const path = url.href.slice(BASE.length).split(/[?#]/)[0].replace(/(^|\/)index\.html$/, '$1');
  const cache = await caches.open(CACHE), hit = await cache.match(BASE + path);
  if (hit) return hit;
  const shelf = () => req.mode === 'navigate' ? Response.redirect(BASE, 302) : null;
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
