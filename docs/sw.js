/* The library offline. Built into docs/sw.js with the list of every published file and a version (a hash of
   them all). Each version is one complete, consistent copy: the keyring always matches the sealed files next to
   it. A new version is downloaded whole in the background and replaces the old one only when complete.
   Everything stored is what the site publishes anyway: encrypted files and public pages. */
const FILES = ["dragons/game.bin","dragons/","dragons/preview.png","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/maskable-512.png","","keyring.json","lib/ihroteka.css","lib/ihroteka.js","lib/qr-scan.js","library.bin","manifest.webmanifest"];                            // relative to the site root; '' and '<id>/' are the pages
const FONTS = ["https://fonts.googleapis.com/css2?family=Onest:wght@400;500;700&family=Unbounded:wght@500;800&display=swap"];                            // font stylesheets the pages use (stored with their font files)
const VERSION = '444eea9c60638ee5';
const CACHE = 'ihroteka-' + VERSION, FONT_CACHE = 'ihroteka-fonts';
const BASE = new URL('./', self.location).href;

self.addEventListener('install', e => e.waitUntil((async () => {
  const cache = await caches.open(CACHE);
  // straight from the server, past the HTTP cache: a stale keyring next to fresh files would not open them
  await cache.addAll(FILES.map(f => new Request(BASE + f, { cache: 'reload' })));
  await Promise.all(FONTS.map(url => storeFont(url).catch(() => {})));   // fonts are a nicety: never fail on them
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith('ihroteka-') && k !== CACHE && k !== FONT_CACHE) await caches.delete(k);
  await self.clients.claim();
})()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.href.startsWith(BASE)) e.respondWith(local(req, url));
  else if (/^fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) e.respondWith(font(req));
});

// The site's own files come from this version's copy. A page address (with ?room=… or not) is its page;
// anything not in the copy goes to the network.
async function local(req, url) {
  let path = url.href.slice(BASE.length).split(/[?#]/)[0].replace(/(^|\/)index\.html$/, '$1');
  const hit = await (await caches.open(CACHE)).match(BASE + path);
  return hit || fetch(req);
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
