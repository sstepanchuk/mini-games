// Local server. For games/ it runs the real library around the plaintext games: the shelf at /, each game in
// the library's frame, the SDK bundled on the fly (an import map points @ihroteka/<name> at it), no sign-in.
// It serves plaintext sources, so by default it only listens on this computer.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import * as esbuild from 'esbuild';
import { P, MIME, rel, exists, problem, gameIds } from './repo.js';
import { readManifest, withLibraryApi, sdkModules, page } from './build.js';

const text = type => type + (/^(text|application\/json)/.test(type) ? '; charset=utf-8' : '');
const SDK = '/@ihroteka/';
const bundle = async (entry, format = 'esm') => (await esbuild.build({ entryPoints: [entry], bundle: true, write: false, format,
  sourcemap: 'inline', charset: 'utf8', logLevel: 'silent', alias: sdkModules(), loader: { '.png': 'dataurl', '.woff2': 'dataurl' } })).outputFiles[0].text;
// the library's own files, as the build makes them (lib/… from sdk/shelf)
const LIB = { '/lib/ihroteka.js': 'index.js', '/lib/ihroteka.css': 'style.css', '/lib/qr-scan.js': 'scan.js' };

// the game's page: library API first, then an import map for the SDK
function gameHtml(id) {
  const imports = Object.fromEntries(Object.keys(sdkModules()).map(m => [m, SDK + m.split('/')[1] + '/index.js']));
  return withLibraryApi(fs.readFileSync(path.join(P.games, id, 'index.html'), 'utf8'), id, readManifest(id))
    .replace(/<script\b/i, m => '<script type="importmap">' + JSON.stringify({ imports }) + '</script>\n' + m);
}
function shelfHtml(game) {
  const games = gameIds().map(id => { const g = readManifest(id); return { id, title: g.title, tagline: g.tagline, image: g.image, emoji: g.emoji }; });
  return page({ title: 'Ігротека (dev)', description: '', shareTitle: '', shareDescription: '', imageUrl: '', imageAlt: '', emoji: '🛠', theme: '#e4e2f0',
    base: '/', cover: '', icon: '🛠', heading: 'Ігротека', lead: '', bootArgs: JSON.stringify({ game, dev: { games } }) });
}

export function serve(what = 'games', port = '8000', host = '127.0.0.1') {
  const games = what !== 'docs', dir = games ? P.games : P.site;
  if (!exists(dir)) problem('No ' + rel(dir) + (games ? ' (run npm run unlock first)' : ''));

  const respond = async (req, res) => {
    const send = (code, type, body) => res.writeHead(code, { 'Content-Type': text(type), 'Cache-Control': 'no-store' }).end(body);
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { return send(400, 'text/plain', 'Bad URL'); }
    if (games) {
      const embed = new URL(req.url, 'http://x').searchParams.has('frame');   // the library's frame asks for the game itself
      const game = url.match(/^\/([a-z0-9-]+)\/(index\.html)?$/)?.[1];
      if (url === '/' || (game && gameIds().includes(game) && !embed)) return send(200, 'text/html', shelfHtml(url === '/' ? undefined : game));
      if (game && gameIds().includes(game)) return send(200, 'text/html', gameHtml(game));
      if (LIB[url]) return send(200, url.endsWith('.css') ? 'text/css' : 'text/javascript', await bundle(path.join(P.sdk, 'shelf', LIB[url])));
      if (url.startsWith(SDK)) {                         // an SDK module, bundled with its dependencies
        const name = url.slice(SDK.length).split('/')[0], entry = sdkModules()['@ihroteka/' + name];
        return entry ? send(200, 'text/javascript', await bundle(entry)) : send(404, 'text/plain', 'Not found');
      }
      if (url.startsWith('/icons/')) return file(path.join(P.sdk, 'shelf'), url);
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
  }).listen(+port, host, () => {
    console.log('http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '/' + (host === '127.0.0.1' ? '' : '   (reachable from your network)'));
    if (games) for (const id of gameIds()) console.log('  ' + id + ': http://localhost:' + port + '/' + id + '/');
  });
}
