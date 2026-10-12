// Local server. For games/ it runs the real library around the plaintext games: the shelf at /, each game in the
// library's frame, the library bundled on the fly, no sign-in. It serves plaintext sources, so by default it only
// listens on this computer. `site` serves the assembled site/ instead, on port 8001 unless given one: its service
// worker and storage then never share an origin with the games mode on 8000.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import * as esbuild from 'esbuild';
import { P, MIME, rel, exists, problem, gameIds } from './repo.js';
import { readManifest, shelfEntry, withLibraryApi, page } from './build.js';

const text = type => type + (/^(text|application\/json)/.test(type) ? '; charset=utf-8' : '');
// as the build bundles them (build.js: JS), unminified and with a source map: what works here works on the site
const bundle = async entry => (await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm',
  ...(entry.endsWith('.js') && { target: 'es2020' }), sourcemap: 'inline', charset: 'utf8', logLevel: 'silent' })).outputFiles[0].text;
// the library's own files, as the build makes them (lib/… from library/app)
const LIB = { '/lib/ihroteka.js': 'index.js', '/lib/ihroteka.css': 'style.css', '/lib/qr-scan.js': 'scan.js' };
// The games mode registers no service worker. One left on this origin by the site (`dev -- site` on this port, or
// an old dev server) would keep answering from its offline copy and hide every edit: when the browser checks it
// for an update, it gets this one, which removes itself and the copies and reloads the pages it held.
const UNREGISTER = `self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  await self.registration.unregister();
  for (const k of await caches.keys()) if (k.startsWith('ihroteka-')) await caches.delete(k);
  for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url).catch(() => {});
})()));
`;
// the game's page, with the library API in front of its code
const gameHtml = id => withLibraryApi(fs.readFileSync(path.join(P.games, id, 'index.html'), 'utf8'), id, readManifest(id));
function shelfHtml(game) {
  const games = gameIds().map(id => shelfEntry(id, readManifest(id)));
  return page({ title: 'Ігротека (dev)', description: '', shareTitle: '', shareDescription: '', imageUrl: '', imageAlt: '', emoji: '🛠', theme: '#e4e2f0',
    base: '/', bootArgs: JSON.stringify({ game, dev: { games } }) });
}

// port: given on the command line, or by mode (cli.js passes its own '8000' when none was typed)
export function serve(what = 'games', port, host = '127.0.0.1') {
  const games = what !== 'site', dir = games ? P.games : P.site;
  const typed = process.argv.slice(2).some(a => /^\d+$/.test(a));
  if (!port || (!games && port === '8000' && !typed)) port = games ? '8000' : '8001';
  if (!exists(dir)) problem('No ' + rel(dir) + (games ? ' (run npm run unlock first)' : ' (run npm run site first)'));

  const respond = async (req, res) => {
    const send = (code, type, body) => res.writeHead(code, { 'Content-Type': text(type), 'Cache-Control': 'no-store' }).end(body);
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(400, 'text/plain', 'Bad URL'); }
    if (games) {
      const embed = new URL(req.url, 'http://x').searchParams.has('frame');   // the library's frame asks for the game itself
      const game = url.match(/^\/([a-z0-9-]+)\/(index\.html)?$/)?.[1];
      if (url === '/' || (game && gameIds().includes(game) && !embed)) return send(200, 'text/html', shelfHtml(url === '/' ? undefined : game));
      if (game && gameIds().includes(game)) return send(200, 'text/html', gameHtml(game));
      if (LIB[url]) return send(200, url.endsWith('.css') ? 'text/css' : 'text/javascript', await bundle(path.join(P.app, LIB[url])));
      if (url.startsWith('/icons/')) return file(P.app, url);
      if (url === '/sw.js') return send(200, 'text/javascript', UNREGISTER);
    }
    return file(dir, url);

    function file(base, url) {
      let f = path.join(base, url);
      if (f !== base && !f.startsWith(base + path.sep)) return send(403, 'text/plain', 'Forbidden');
      if (exists(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
      if (!exists(f)) return send(404, 'text/plain', 'Not found');
      send(200, MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', fs.readFileSync(f));
    }
  };

  http.createServer((req, res) => {
    respond(req, res).catch(e => {                      // a typo in game.json must not stop the server
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.message);
      console.error('✗ ' + e.message);
    });
  }).on('error', e => {
    console.error('✗ ' + (e.code === 'EADDRINUSE' ? 'Port ' + port + ' is busy: npm run dev -- <another port>' : e.message));
    process.exit(1);
  }).listen(+port, host, () => {
    console.log('http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '/' + (host === '127.0.0.1' ? '' : '   (reachable from your network)'));
    if (games) for (const id of gameIds()) console.log('  ' + id + ': http://localhost:' + port + '/' + id + '/');
  });
}
