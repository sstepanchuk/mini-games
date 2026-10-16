// Local server. For games/ it runs the real library around the plaintext games: the shelf at /, each game in the
// library's frame, the library bundled on the fly, no sign-in. It serves plaintext sources, so by default it only
// listens on this computer. `site` serves the assembled site/ instead, on port 8001 unless given one: its service
// worker and storage then never share an origin with the games mode on 8000.
// Options (games mode): devnet — a fake network between the tabs of one browser (devnet.js: every library page gets
// it; without the option, a page asked with ?devnet does); probe — the browser scenarios' open game,
// tests/e2e/fixtures/probe, on the shelf as 'probe' (CI has no plaintext games: they are sealed).
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';
import { P, MIME, rel, exists, problem, gameIds, Problem } from './repo.js';
import { readManifest, shelfEntry, withLibraryApi, page } from './build.js';
import { devnetFor, devnetScript } from './devnet.js';

const text = type => type + (/^(text|application\/json)/.test(type) ? '; charset=utf-8' : '');
// as the build bundles them (build.js: JS), unminified and with a source map: what works here works on the site
const bundle = async entry => (await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format: 'esm',
  ...(entry.endsWith('.js') && { target: 'es2020' }), sourcemap: 'inline', charset: 'utf8', logLevel: 'silent' })).outputFiles[0].text;
// the library's own files, as the build makes them (lib/… from library/app)
const LIB = { '/lib/ihroteka.js': 'index.js', '/lib/ihroteka.css': 'style.css', '/lib/qr-scan.js': 'scan.js', '/lib/inflate.js': 'inflate.js' };
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
export const PROBE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'e2e', 'fixtures', 'probe');
// the games served: id → its folder (games/<id>, and the probe when asked)
const gameDirs = probe => ({ ...Object.fromEntries(gameIds().map(id => [id, path.join(P.games, id)])), ...(probe && { probe: PROBE }) });
// the game's page, with the library API in front of its code
const gameHtml = (id, dir) => withLibraryApi(fs.readFileSync(path.join(dir, 'index.html'), 'utf8'), id, readManifest(id, dir));
// The page's Content-Security-Policy (library/app/page.html's <meta>; README: Trust), for a game's page: here the frame
// loads it by its address, so it does not inherit the policy as the site's srcdoc frame does. It gets it as a header
// instead, so that what the site would refuse (a script from elsewhere, eval) fails here too.
export const csp = () => fs.readFileSync(path.join(P.app, 'page.html'), 'utf8').match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1];
function shelfHtml(game, dirs, devnet) {
  if (game) readManifest(game, dirs[game]);             // a game's own page says why its game.json does not read (500)
  // on the shelf, a game.json that does not read takes only its own game off it
  const games = Object.entries(dirs).flatMap(([id, dir]) => {
    try { return [shelfEntry(id, readManifest(id, dir))]; } catch (e) {
      if (!(e instanceof Problem)) throw e;
      console.error('✗ ' + e.message + ' (left off the shelf)');
      return [];
    }
  });
  const html = page({ title: 'Ігротека (dev)', description: '', shareTitle: '', shareDescription: '', imageUrl: '', imageAlt: '', emoji: '🛠', theme: '#eee7d7',
    base: '/', bootArgs: JSON.stringify({ game, dev: { games } }) });
  return devnet ? html.replace('</head>', () => devnetScript() + '\n</head>') : html;   // (before the library's code runs)
}

// The server, not listening yet. what: 'games' | 'site'; opt (games mode): { devnet, probe }, as at the top.
export function devServer(what = 'games', { devnet = false, probe = false } = {}) {
  const games = what !== 'site', dir = games ? P.games : P.site;
  if (!exists(dir) && !(games && probe)) problem('No ' + rel(dir) + (games ? ' (run npm run unlock first)' : ' (run npm run site first)'));

  const respond = async (req, res) => {
    const headers = {}, send = (code, type, body) => res.writeHead(code, { 'Content-Type': text(type), 'Cache-Control': 'no-store', ...headers }).end(body);
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(400, 'text/plain', 'Bad URL'); }
    if (games) {
      const embed = new URL(req.url, 'http://x').searchParams.has('frame');   // the library's frame asks for the game itself
      const dirs = gameDirs(probe), game = url.match(/^\/([a-z0-9-]+)\/(index\.html)?$/)?.[1];
      if (url === '/' || (game && dirs[game] && !embed)) {
        const net = devnetFor(req, devnet);
        if (net.cookie) headers['Set-Cookie'] = net.cookie;
        return send(200, 'text/html', shelfHtml(url === '/' ? undefined : game, dirs, net.on));
      }
      if (game && dirs[game]) { headers['Content-Security-Policy'] = csp(); return send(200, 'text/html', gameHtml(game, dirs[game])); }
      if (LIB[url]) return send(200, url.endsWith('.css') ? 'text/css' : 'text/javascript', await bundle(path.join(P.app, LIB[url])));
      if (url.startsWith('/icons/')) return file(P.app, url);
      if (url === '/sw.js') return send(200, 'text/javascript', UNREGISTER);
      const own = url.match(/^\/([a-z0-9-]+)(\/.*)$/);  // a game's own files (its modules, styles, pictures)
      if (own && dirs[own[1]]) return file(dirs[own[1]], own[2]);
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

  return http.createServer((req, res) => {
    respond(req, res).catch(e => {                      // a typo in game.json must not stop the server
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(e.message);
      console.error('✗ ' + e.message);
    });
  });
}

// port: as typed on the command line (cli.js passes none when none was typed), or by mode
export function serve(what = 'games', port, host = '127.0.0.1', opt = {}) {
  const games = what !== 'site';
  port ||= games ? '8000' : '8001';
  devServer(what, opt).on('error', e => {
    console.error('✗ ' + (e.code === 'EADDRINUSE' ? 'Port ' + port + ' is busy: npm run dev -- <another port>' : e.message));
    process.exit(1);
  }).listen(+port, host, () => {
    // one origin for every link: a page's storage (its sign-in, its offline copy) is per origin
    const at = 'http://localhost:' + port + '/';
    console.log(at + (host === '127.0.0.1' ? '' : '   (reachable from your network)'));
    if (games) for (const id of Object.keys(gameDirs(opt.probe))) console.log('  ' + id + ': ' + at + id + '/');
    if (games) console.log(opt.devnet ? '  devnet: a fake network between the tabs of one browser (tools/devnet.js)' : '  two tabs playing together without internet: add ?devnet to the address (or npm run dev -- --devnet)');
  });
}
