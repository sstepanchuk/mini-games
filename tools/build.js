// Games into the vault (manifest, library API, one-page bundle), the vault into the site, and checks — no password needed
// for anything here but bundling a game.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import * as esbuild from 'esbuild';
import * as vault from '../library/crypto.js';
import { P, MIME, rel, esc, exists, problem, homepage, vaultIds, vaultPath, walk, writeAtomic } from './repo.js';

const RESERVED = new Set(['lib']);                     // top-level names the site itself uses

/* ---------- manifest: game.json (in games/<id>/, and as kept in vault/<id>/) ---------- */
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
export function readManifest(id, dir = path.join(P.games, id)) {
  const file = rel(path.join(dir, 'game.json'));
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id) || RESERVED.has(id)) problem(rel(dir) + ': the folder name becomes the URL, so use lowercase letters, digits and dashes (and not ' + [...RESERVED].join(', ') + ')');
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
  for (const f of dir.startsWith(P.games) ? ['index.html', g.image] : [g.image]) if (!exists(path.join(dir, f))) problem(rel(path.join(dir, f)) + ' not found');
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

/* ---------- the site: library/app + vault/ → site/ (CI does this on every push) ---------- */
const ICONS = ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
async function libraryFiles() {
  const dir = P.app, js = (entry, banner) => esbuildText(path.join(dir, entry), { ...JS, ...(banner && { banner: { js: banner } }) }, 'library/app');
  const files = {
    'index.html': page({ ...LIBRARY, shareTitle: LIBRARY.title, shareDescription: LIBRARY.description, imageUrl: '', imageAlt: '', emoji: '🎲',
      base: './', bootArgs: '{}' }),
    'lib/ihroteka.js': await js('index.js'),
    'lib/ihroteka.css': await esbuildText(path.join(dir, 'style.css'), {}, 'library/app'),
    'lib/qr-scan.js': await js('scan.js', '/*! jsQR © Cosmo Wolfe, Apache-2.0 */'),
    'manifest.webmanifest': JSON.stringify({
      name: LIBRARY.title, short_name: LIBRARY.title, description: LIBRARY.description, lang: 'uk', id: './', start_url: './', scope: './',
      display: 'standalone', background_color: LIBRARY.theme, theme_color: LIBRARY.theme,
      icons: [{ src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }]
    })
  };
  for (const f of ICONS) files['icons/' + f] = fs.readFileSync(path.join(dir, 'icons', f));
  return files;
}

// → number of games; the folder is written from scratch
export async function buildSite(out = P.site) {
  const problems = checkVault();
  if (problems.length) problem(problems.join('\n'));
  const files = await libraryFiles(), games = vaultIds().map(id => [id, readManifest(id, vaultPath(id))]);
  files['keyring.json'] = fs.readFileSync(P.keyring);
  files['library.json'] = JSON.stringify(games.map(([id, g]) => ({ id, title: g.title, tagline: g.tagline, image: g.image, emoji: g.emoji })));
  for (const [id, g] of games) {
    files[id + '/index.html'] = gamePage(id, g);
    files[id + '/game.bin'] = fs.readFileSync(vaultPath(id, 'game.bin'));
    files[id + '/' + g.image] = fs.readFileSync(vaultPath(id, g.image));
  }
  files['sw.js'] = serviceWorker(files);
  fs.rmSync(out, { recursive: true, force: true });
  for (const [f, data] of Object.entries(files)) writeAtomic(path.join(out, f), data);
  return games.length;
}

// the offline copy: sw.js lists every file of the site; its version is a hash of them all
function serviceWorker(files) {
  const names = Object.keys(files).sort(), hash = crypto.createHash('sha256'), tpl = fs.readFileSync(path.join(P.app, 'sw.js'), 'utf8');
  hash.update(tpl);                                    // a new worker gets a new version too
  for (const f of names) hash.update(f + '\0').update(files[f]);
  const fonts = [...fs.readFileSync(path.join(P.app, 'page.html'), 'utf8').matchAll(/href="(https:\/\/fonts\.googleapis\.com\/[^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&'));
  const pages = names.map(f => f.replace(/(^|\/)index\.html$/, '$1'));   // a page is stored under its address
  return tpl
    .replace('/* FILES */', pages.map(f => JSON.stringify(f)).join(','))
    .replace('/* FONTS */', [...new Set(fonts)].map(f => JSON.stringify(f)).join(','))
    .replace('/* VERSION */', hash.digest('hex').slice(0, 16));
}

/* ---------- password-free check of vault/ (also run by CI) → [problem, …] ---------- */
export function checkVault() {
  const problems = [], bad = msg => problems.push(msg);
  let kr = null;
  try { kr = JSON.parse(fs.readFileSync(P.keyring, 'utf8')); } catch (e) { bad(rel(P.keyring) + ': ' + e.message); }
  if (kr) {
    if (kr.v !== vault.KEYRING_V || !/^[A-Za-z0-9+/]{11}=$/.test(kr.kid) || !(kr.kdf?.iterations >= 100000)) bad('keyring.json: invalid header');
    if (!Array.isArray(kr.people) || !kr.people.length) bad('keyring.json: no people');
    const ids = new Set();
    for (const p of Array.isArray(kr.people) ? kr.people : []) {
      if (!(p.id && p.salt && p.pub && p.priv && typeof p.name === 'string' && p.box?.epk && p.box?.ct)) bad('keyring.json: incomplete entry ' + (p.id || '?'));
      if (ids.has(p.id)) bad('keyring.json: duplicate id ' + p.id);
      ids.add(p.id);
    }
  }
  const ids = vaultIds();
  if (!ids.length) bad('no games in vault/');
  for (const id of ids) {
    let g = null;
    try { g = readManifest(id, vaultPath(id)); } catch (e) { bad(e.message); }
    // both sealed files, with the current library key (a stale one means: rebuild after git pull)
    for (const f of ['game.bin', 'source.bin']) {
      const file = vaultPath(id, f);
      if (!exists(file)) { bad('missing ' + rel(file)); continue; }
      const kid = vault.fileKid(fs.readFileSync(file));
      if (!kid) bad(rel(file) + ': not a sealed file');
      else if (kr && kid !== kr.kid) bad(rel(file) + ': sealed with an old library key (rebuild after git pull)');
    }
    // nothing else: anything more could be plaintext
    for (const f of walk(vaultPath(id), undefined, true)) if (!['game.json', 'game.bin', 'source.bin', g && g.image].includes(f)) bad(rel(vaultPath(id, f)) + ': unexpected file (a game keeps only game.json, its cover, game.bin and source.bin)');
  }
  for (const f of walk(P.vault, undefined, true)) if (f !== 'keyring.json' && !ids.includes(f.split('/')[0])) bad('vault/' + f + ': unexpected file');
  return problems;
}
