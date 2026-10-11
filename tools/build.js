// Turning games/<id>/ into a published game: manifest, library API, one-page bundle, public page; and site checks.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as esbuild from 'esbuild';
import * as vault from '../library/crypto.js';
import { P, MIME, rel, esc, exists, problem, homepage, sourceIds, siteGames, sitePath, sourcePath, walk } from './repo.js';

const RESERVED = new Set(['lib']);                     // top-level names the site itself uses

/* ---------- manifest: games/<id>/game.json ---------- */
const FIELDS = {
  title: 'name on the shelf and in the link preview',
  tagline: 'one line under the title on the shelf',
  description: 'page description',
  image: '1200×630 PNG next to game.json, e.g. preview.png',
  shareTitle: '?link preview title',
  shareDescription: '?link preview text',
  imageAlt: '?image description',
  emoji: '?tab icon (one emoji)',
  theme: '?browser theme color, e.g. #e4e2f0'
};
const FORMAT = {
  image: v => /^[\w-]+\.png$/.test(v),
  emoji: v => [...v].length <= 4 && !/[\x00-\x7f]/.test(v),
  theme: v => /^#[0-9a-f]{3,8}$/i.test(v)
};
export function readManifest(id) {
  const dir = path.join(P.games, id), file = rel(path.join(dir, 'game.json'));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || RESERVED.has(id)) problem('games/' + id + ': the folder name becomes the URL, so use lowercase letters, digits and dashes (and not ' + [...RESERVED].join(', ') + ')');
  let g;
  try { g = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { problem(file + ': ' + e.message); }
  for (const k of Object.keys(g)) if (!(k in FIELDS)) problem(file + ': unknown field "' + k + '"');
  for (const [k, about] of Object.entries(FIELDS)) {
    const optional = about.startsWith('?');
    if (g[k] === undefined && optional) continue;
    if (typeof g[k] !== 'string' || !g[k].trim()) problem(file + ': "' + k + '" must be a non-empty string (' + about.replace('?', '') + ')');
    if (FORMAT[k] && !FORMAT[k](g[k])) problem(file + ': "' + k + '" has an unexpected value (' + about.replace('?', '') + ')');
  }
  for (const f of ['index.html', g.image]) if (!exists(path.join(dir, f))) problem('games/' + id + '/' + f + ' not found');
  return g;
}

/* ---------- the library API (library/game-api.js), first thing in <head> ---------- */
export function withLibraryApi(html, id, g) {
  const api = fs.readFileSync(P.gameApi, 'utf8')
    .replace(/^\/\*[\s\S]*?\*\/\s*/, '')
    .replace('/* GAME */ null', () => JSON.stringify({ id, title: g.title }).replace(/</g, '\\u003c'));
  const at = /<meta charset[^>]*>/i.test(html) ? /<meta charset[^>]*>/i : /<head>/i;   // charset must stay near the top
  if (!at.test(html)) problem('games/' + id + '/index.html has no <head>');
  return html.replace(at, m => m + '\n<script>' + api.trim() + '</script>');
}

/* ---------- one self-contained page ---------- */
// Styles and module scripts are bundled inline; images, fonts and sounds they use become data: URLs.
// Anything else the page points to by a relative URL would not exist on the site, so the build stops.
const ASSETS = Object.fromEntries(Object.entries(MIME).filter(([, t]) => /^(image|font|audio)\/|json/.test(t)));   // inlined as data: URLs
const loader = Object.fromEntries(Object.keys(ASSETS).filter(e => e !== '.json').map(e => [e, 'dataurl']));   // scripts import JSON as data
const attr = (tag, name) => tag.match(new RegExp('\\s' + name + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i'))?.slice(1).find(v => v !== undefined);
const local = url => url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
const dataUrl = file => 'data:' + ASSETS[path.extname(file).toLowerCase()] + ';base64,' + fs.readFileSync(file).toString('base64');

// one entry point → one minified file (also used for the site's own script and stylesheet)
async function esbuildText(entry, extra, where) {
  const r = await esbuild.build({ entryPoints: [entry], bundle: true, minify: true, write: false, charset: 'utf8',
    legalComments: 'none', logLevel: 'silent', loader, ...extra }).catch(e => problem(where + ': ' + (e.errors?.[0]?.text || e.message)));
  return r.outputFiles[0].text.trim();
}
const JS = { format: 'esm', target: 'es2020' };

export async function bundleGame(id, g) {
  const dir = path.join(P.games, id), where = 'games/' + id + '/index.html';
  let html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/^\uFEFF/, '');
  if (!/^\s*<!doctype html>/i.test(html)) problem(where + ' must start with <!doctype html> (without it the page renders in quirks mode)');
  html = withLibraryApi(html, id, g);
  const build = (entry, extra) => esbuildText(path.join(dir, entry), extra, where);

  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/\brel\s*=\s*["']?stylesheet/i.test(tag) || !local(attr(tag, 'href'))) continue;
    const css = await build(attr(tag, 'href'), {});
    html = html.replace(tag, () => '<style>' + css + '</style>');
  }
  for (const tag of html.match(/<script\b[^>]*>\s*<\/script>/gi) || []) {
    const src = attr(tag, 'src');
    if (!local(src)) continue;
    if (!/\btype\s*=\s*["']?module/i.test(tag)) problem(where + ': <script src="' + src + '"> must be type="module" to be bundled');
    const js = await build(src, JS);
    if (/<\/script/i.test(js)) problem(where + ': the bundle contains "</script" and cannot be inlined');
    html = html.replace(tag, () => '<script type="module">' + js + '</script>');   // still a module: runs after the page is parsed, as before
  }
  // remaining relative src/href: inline known assets, refuse everything else
  html = html.replace(/(\s(?:src|href)\s*=\s*)(["'])([^"']*)\2/gi, (m, pre, q, url) => {
    if (!local(url)) return m;
    const file = path.join(dir, url.split(/[?#]/)[0]);
    if (!file.startsWith(dir + path.sep) || !exists(file) || !ASSETS[path.extname(file).toLowerCase()]) problem(where + ': "' + url + '" would not exist on the site (only styles, module scripts and media files are bundled)');
    return pre + q + dataUrl(file) + q;
  });
  return html;
}

/* ---------- the site's pages: one template (library/app/page.html) for the shelf and every game ---------- */
// {{key}} is replaced (HTML-escaped; bootArgs as is); a line starting with {{?key}} stays only when key is set
export function page(vals) {
  return fs.readFileSync(path.join(P.app, 'page.html'), 'utf8')
    .replace(/^\{\{\?(\w+)\}\}(.*\n)/gm, (_, k, line) => vals[k] ? line : '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => k in vals ? (k === 'bootArgs' ? vals[k] : esc(vals[k])) : problem('page.html: unknown field ' + k));
}
const LIBRARY = { title: 'Ігротека', description: 'Наша маленька бібліотека ігор. Ігри відкриваються за паролем.', theme: '#e4e2f0' };

export function gamePage(id, g) {
  const base = homepage();
  if (!/^https:\/\/[^/]+\/(.*\/)?$/.test(base.replace(/\/?$/, '/'))) problem('package.json "homepage" must be the absolute https URL of the site (link previews need it)');
  return page({
    title: g.title, description: g.description, shareTitle: g.shareTitle || g.title, shareDescription: g.shareDescription || g.description,
    imageUrl: base.replace(/\/?$/, '/') + id + '/' + g.image, imageAlt: g.imageAlt || g.title, emoji: g.emoji || '🎮', theme: g.theme || LIBRARY.theme,
    base: '../', bootArgs: JSON.stringify({ game: id })
  });
}

/* ---------- the library itself, built from library/app: path in docs/ → contents ---------- */
const ICONS = ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
export async function siteFiles() {
  const dir = P.app, js = (entry, banner) => esbuildText(path.join(dir, entry), { ...JS, ...(banner && { banner: { js: banner } }) }, 'library/app');
  const files = {
    'index.html': page({ ...LIBRARY, shareTitle: LIBRARY.title, shareDescription: LIBRARY.description, imageUrl: '', imageAlt: '', emoji: '🎲',
      base: './', bootArgs: '{}' }),
    'lib/ihroteka.js': await js('index.js') + '\n',
    'lib/ihroteka.css': await esbuildText(path.join(dir, 'style.css'), {}, 'library/app') + '\n',
    'lib/qr-scan.js': await js('scan.js', '/*! jsQR © Cosmo Wolfe, Apache-2.0 */') + '\n',
    'manifest.webmanifest': JSON.stringify({
      name: LIBRARY.title, short_name: LIBRARY.title, description: LIBRARY.description, lang: 'uk', id: './', start_url: './', scope: './',
      display: 'standalone', background_color: LIBRARY.theme, theme_color: LIBRARY.theme,
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    }, null, 2) + '\n'
  };
  for (const f of ICONS) files['icons/' + f] = fs.readFileSync(path.join(dir, 'icons', f));
  return files;
}

/* ---------- the offline copy: sw.js lists every published file; its version is a hash of them all ---------- */
export function serviceWorker() {
  const files = walk(P.site).filter(f => f !== 'sw.js'), hash = crypto.createHash('sha256');
  for (const f of files) hash.update(f + '\0').update(fs.readFileSync(sitePath(f)));
  const fonts = [...fs.readFileSync(path.join(P.app, 'page.html'), 'utf8').matchAll(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const pages = files.map(f => f.replace(/(^|\/)index\.html$/, '$1'));   // a page is stored under its address
  return fs.readFileSync(path.join(P.app, 'sw.js'), 'utf8')
    .replace('/* FILES */', pages.map(f => JSON.stringify(f)).join(','))
    .replace('/* FONTS */', [...new Set(fonts)].map(f => JSON.stringify(f)).join(','))
    .replace('/* VERSION */', hash.digest('hex').slice(0, 16));
}

/* ---------- password-free site validation (also run by CI) → { problems, games, people } ---------- */
export async function checkSite() {
  const shelf = await siteFiles();
  const SITE_FILES = new Set(['keyring.json', 'library.json', 'sw.js', ...Object.keys(shelf)]);
  const problems = [], bad = msg => problems.push(msg);
  let kr = null;
  try { kr = JSON.parse(fs.readFileSync(P.keyring, 'utf8')); } catch (e) { bad(rel(P.keyring) + ': ' + e.message); }
  if (kr) {
    if (kr.v !== vault.KEYRING_V || !kr.kid || !kr.kdf?.salt || !(kr.kdf.iterations >= 100000)) bad('keyring.json: invalid header');
    if (!kr.people?.length) bad('keyring.json: no people');
    for (const p of kr.people || []) if (!(p.id && p.pub && p.priv && typeof p.name === 'string' && p.box?.epk && p.box?.ct)) bad('keyring.json: incomplete entry ' + (p.id || '?'));
  }
  // every sealed file must be sealed with the current library key
  const sealedWithCurrentKey = (file, label) => {
    if (!exists(file)) return bad('missing ' + rel(file));
    const kid = vault.fileKid(fs.readFileSync(file));
    if (!kid) bad(rel(file) + ': not a sealed file');
    else if (kr && kid !== kr.kid) bad(rel(file) + ': sealed with an old library key (' + label + ' — rebuild after git pull)');
  };
  for (const [f, data] of Object.entries(shelf)) {
    if (!exists(sitePath(f))) bad('missing docs/' + f);
    else if (!fs.readFileSync(sitePath(f)).equals(Buffer.from(data))) bad('docs/' + f + ' is out of date with library/app (npm run build)');
  }
  if (!exists(sitePath('sw.js'))) bad('missing docs/sw.js');
  else if (fs.readFileSync(sitePath('sw.js'), 'utf8') !== serviceWorker()) bad('docs/sw.js does not list the published files (npm run build)');
  let list = [];
  try { list = JSON.parse(fs.readFileSync(sitePath('library.json'), 'utf8')); } catch (e) { bad('docs/library.json: ' + e.message); }
  const games = siteGames();
  if (!games.length) bad('no games in docs/');
  if (list.map(g => g.id).sort().join() !== games.join()) bad('docs/library.json does not list exactly the games in docs/ (npm run build)');
  for (const id of games) {
    sealedWithCurrentKey(sitePath(id, 'game.bin'), id);
    sealedWithCurrentKey(sourcePath(id), id + ' sources');
    const page = sitePath(id, 'index.html');
    if (!exists(page)) { bad('missing docs/' + id + '/index.html'); continue; }
    const html = fs.readFileSync(page, 'utf8'), img = list.find(g => g.id === id)?.image;
    if (!html.includes('boot({"game":' + JSON.stringify(id))) bad('docs/' + id + '/index.html is not a library game page');
    if (/\{\{\w+\}\}/.test(html)) bad('docs/' + id + '/index.html: unfilled template');
    if (!img || !exists(sitePath(id, img))) bad('docs/' + id + ': missing image ' + (img || ''));
  }
  for (const id of sourceIds()) if (!games.includes(id)) bad('vault/' + id + '.bin exists but docs/ has no such game');
  // only known files may be published: anything else could be a plaintext leak
  const allowed = f => SITE_FILES.has(f) || (/^([\w-]+)\/(index\.html|game\.bin|[\w-]+\.png)$/.test(f) && games.includes(f.split('/')[0]));
  for (const f of walk(P.site)) if (!allowed(f)) bad('docs/' + f + ': unexpected file (only game pages, sealed files and cover images are published)');
  return { problems, games: games.length, people: kr?.people?.length || 0 };
}
