// Games into the vault (manifest, library API, one-page bundle), the vault into the site, and checks — no password needed
// for anything here but bundling a game.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import * as esbuild from 'esbuild';
import * as vault from '../library/crypto.js';
import { P, MIME, rel, esc, exists, problem, homepage, vaultIds, vaultPath, walk, writeAtomic } from './repo.js';
import { pngInfo, isPlaceholder } from './png.js';

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
  players: '?how many play together: "2", or a range such as "2-4" (1 to 8; 2 when not given)',
  theme: '?browser theme color, e.g. #e4e2f0'
};
// the fields that are numbers, not strings (whole, from 1)
const NUMBERS = {
  wire: '?the version of the game\'s messages and snapshots: a whole number from 1 (1 when not given), raised by hand ' +
    'only when they change; copies of the game with different numbers are not seated together (ihroteka.game.wire)',
  api: '?the version of the Game API the game is written for (ihroteka.version; README "Game API"): at most the ' +
    'library\'s own'
};
// the fields that are true or false
const FLAGS = {
  camera: '?true: the game\'s frame may use the camera (README: Trust); without it, it may not',
  microphone: '?true: the game\'s frame may use the microphone (README: Trust); without it, it may not'
};
// the Game API version this library gives (library/app/shell.js: api(), version)
export const apiVersion = () => +fs.readFileSync(path.join(P.app, 'shell.js'), 'utf8').match(/^\s*version: (\d+),/m)[1];
const FORMAT = {
  image: v => /^[\w-]+\.png$/.test(v),
  emoji: v => [...v].length <= 4 && !/[\x00-\x7f]/.test(v),
  theme: v => /^#[0-9a-f]{3,8}$/i.test(v),
  players: v => { const r = playersOf(v); return !!r && r.min <= r.max; }
};
// "2" → { min: 2, max: 2 }, "2-4" → { min: 2, max: 4 }
export const playersOf = (v = '2') => { const m = /^([1-8])(?:-([1-8]))?$/.exec(v); return m && { min: +m[1], max: +(m[2] || m[1]) }; };
export const wireOf = g => g.wire ?? 1;
// what the shelf knows about a game (library.json, and the dev server's list); of the flags, only a true one (the frame
// may use it: library/app/shell.js allowOf), so a game that asks for nothing has the entry it always had
export const shelfEntry = (id, g) => ({ id, title: g.title, tagline: g.tagline, image: g.image, emoji: g.emoji, players: playersOf(g.players), wire: wireOf(g),
  ...Object.fromEntries(Object.keys(FLAGS).filter(k => g[k] === true).map(k => [k, true])) });
// a game's id (its folder): it becomes the URL, /<id>/
export const validId = id => typeof id === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(id) && !RESERVED.has(id);
export function readManifest(id, dir = path.join(P.games, id)) {
  const file = rel(path.join(dir, 'game.json'));
  if (!validId(id)) problem(rel(dir) + ': the folder name becomes the URL, so use lowercase letters, digits and dashes (and not ' + [...RESERVED].join(', ') + ')');
  let g;
  try { g = JSON.parse(fs.readFileSync(path.join(dir, 'game.json'), 'utf8').replace(/^\uFEFF/, '')); }
  catch (e) { problem(file + ': ' + e.message); }
  for (const k of Object.keys(g)) if (!(k in FIELDS) && !(k in NUMBERS) && !(k in FLAGS)) problem(file + ': unknown field "' + k + '"');
  for (const k of Object.keys(FLAGS)) if (g[k] !== undefined && typeof g[k] !== 'boolean') problem(file + ': "' + k + '" must be true or false (' + FLAGS[k].slice(1) + ')');
  for (const k of Object.keys(NUMBERS)) if (g[k] !== undefined && !(Number.isSafeInteger(g[k]) && g[k] >= 1)) problem(file + ': "' + k + '" must be a whole number from 1 (' + NUMBERS[k].slice(1) + ')');
  if (g.api > apiVersion()) problem(file + ': "api" is ' + g.api + ', this library gives version ' + apiVersion() + ' (update the library, or write the game for it)');
  for (const [k, about] of Object.entries(FIELDS)) {
    const optional = about.startsWith('?');
    if (g[k] === undefined && optional) continue;
    if (typeof g[k] !== 'string' || !g[k].trim()) problem(file + ': "' + k + '" must be a non-empty string (' + about.replace('?', '') + ')');
    if (FORMAT[k] && !FORMAT[k](g[k])) problem(file + ': "' + k + '" has an unexpected value (' + about.replace('?', '') + ')');
  }
  for (const f of dir.startsWith(P.games) ? ['index.html', g.image] : [g.image]) if (!exists(path.join(dir, f))) problem(rel(path.join(dir, f)) + ' not found');
  return g;
}

// what the shelf and link previews will make of a game's cover (games/<id>/<image>) → [warning, …]; it is sealed anyway
export function coverWarnings(id, g) {
  const name = 'games/' + id + '/' + g.image, buf = fs.readFileSync(path.join(P.games, id, g.image)), info = pngInfo(buf);
  if (!info) return [name + ' is not a PNG'];
  if (info.w !== 1200 || info.h !== 630) return [name + ' is ' + info.w + '×' + info.h + ': the shelf and link previews expect 1200×630'];
  if (isPlaceholder(buf, g.theme)) return [name + ' is still the placeholder from cli new: replace it with a picture of the game (README, Adding a game, 8)'];
  return [];
}

/* ---------- a game's own tests: games/<id>/test/*.test.js (node:test), run before the game is sealed ---------- */
const TEST_TIMEOUT = 120000;                           // ms for each test file, and each test, of a game
// → how many test files ran (0: the game has none). Throws a Problem with their report when one fails, or does not
// finish in time. They run in Node without the password (sealed games keep their tests in source.bin; CI never sees
// them, so this is the gate). timeout: ms instead of TEST_TIMEOUT.
export function testGame(id, { timeout = TEST_TIMEOUT } = {}) {
  const dir = path.join(P.games, id, 'test');
  const files = exists(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort().map(f => path.join(dir, f)) : [];
  if (!files.length) return 0;
  // (without the password, and as a run of its own even when the build itself runs under node --test)
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VAULT_PASSWORDS?|NODE_TEST_CONTEXT)$/.test(k)));
  // Each file runs in a process of its own, which --test-timeout bounds and --test-force-exit ends once its tests are
  // done (a timer or server left open does not keep it). spawnSync's own timeout is only a last resort: it stops the
  // runner, not that process.
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', '--test-force-exit', '--test-timeout=' + timeout, ...files],
    { cwd: path.join(P.games, id), env, encoding: 'utf8', maxBuffer: 64 << 20, timeout: timeout * (files.length + 1) + 60000 });
  const report = ((r.stdout || '') + (r.stderr || '')).trim();
  if (r.error?.code === 'ETIMEDOUT' || /test timed out after \d+ms/.test(report)) {
    problem('games/' + id + ': its tests did not finish in ' + (timeout >= 60000 ? timeout / 60000 + ' min' : timeout / 1000 + ' s') + ' (an open timer or server, ' +
      'a promise that never settles?), so it is not sealed (npm run test:games; to build anyway: npm run build -- --no-tests)\n' + report);
  }
  if (r.error) problem('games/' + id + ': its tests did not run: ' + r.error.message);
  if (r.status !== 0) problem('games/' + id + ': its tests fail, so it is not sealed (npm run test:games; to build anyway: npm run build -- --no-tests)\n' + report);
  return files.length;
}

/* ---------- the library API (library/game-api.js), first thing in <head> ---------- */
export const withLibraryApi = (html, id, g) => atApiPlace(html, id, libraryApi(id, g));
const libraryApi = (id, g) => '<script>' + fs.readFileSync(P.gameApi, 'utf8')
  .replace(/^\/\*[\s\S]*?\*\/\s*/, '')
  .replace('/* GAME */ null', () => JSON.stringify({ id, title: g.title, players: playersOf(g.players), wire: wireOf(g) }).replace(/</g, '\\u003c')).trim() + '</script>';
// the page with what put right after its charset meta, or after <head>
function atApiPlace(html, id, what) {
  const at = /<meta charset[^>]*>/i.test(html) ? /<meta charset[^>]*>/i : /<head>/i;   // charset must stay near the top
  if (!at.test(html)) problem('games/' + id + '/index.html has no <head>');
  return html.replace(at, m => m + '\n' + what);
}

/* ---------- one self-contained page ---------- */
// The page's own markup is read once, piece by piece: styles and module scripts are bundled inline, and the images,
// fonts and sounds they or the markup use become data: URLs. Anything else the markup points to by a relative URL would
// not exist on the site (it serves only the page, game.bin and the cover under /<id>/), so the build stops. What is
// inside a script or a style is code, not markup: it is not read for links, and neither is anything the build put in.
const ASSETS = Object.fromEntries(Object.entries(MIME).filter(([, t]) => /^(image|font|audio)\/|json/.test(t)));   // inlined as data: URLs
const loader = Object.fromEntries(Object.keys(ASSETS).filter(e => e !== '.json').map(e => [e, 'dataurl']));   // scripts import JSON as data
const local = url => url && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);
const dataUrl = file => 'data:' + ASSETS[path.extname(file).toLowerCase()] + ';base64,' + fs.readFileSync(file).toString('base64');
// A string in a game's code that looks like a file next to it ('img/hero.png', './hit.mp3'): on the site the game is
// one page, so a file it names that way is not there. A module imports it instead (the bundle inlines what it imports).
const ASSET_STRING = new RegExp('([\'"`])((?:\\.{1,2}/)?(?:[\\w-]+/)*[\\w-][\\w.-]*\\.(?:' + Object.keys(ASSETS).map(e => e.slice(1)).join('|') + '))\\1', 'gi');
export const assetStrings = js => [...new Set(Array.from(js.matchAll(ASSET_STRING), m => m[2]))];

// the page's markup, piece by piece: a comment; a script or a style, with its body; any other start tag (a quoted value
// may hold ">"); a script or a style never closed
const MARKUP = /<!--[\s\S]*?(?:-->|$)|<(script|style)(?=[\s/>])((?:=\s*"[^"]*"|=\s*'[^']*'|[^>])*)>([\s\S]*?)<\/\1\s*>|<(?!(?:script|style)[\s/>])([a-z][\w:-]*)((?:=\s*"[^"]*"|=\s*'[^']*'|[^>])*)>|<(script|style)(?=[\s/>])/gi;
const ATTR = /\s([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g;   // an attribute with a value, quoted or not
const unescape = v => v.replace(/&quot;/g, '"').replace(/&#39;/g, '\'').replace(/&amp;/g, '&');
const attrsOf = s => { const a = {}; for (const m of s.matchAll(ATTR)) a[m[1].toLowerCase()] ??= unescape(m[2] ?? m[3] ?? m[4]); return a; };
const URL_ATTRS = new Set(['src', 'href', 'xlink:href', 'poster', 'background', 'data']);   // each holds one URL
// the URLs of a srcset: each candidate starts with one (a data: URL may hold commas), then its size
const srcsetUrls = v => Array.from(v.matchAll(/(?:^|,)[\s,]*([^\s,]\S*?)(?=,*(?:\s|$))/g), m => m[1]);
const CSS_URL = /url\(\s*(?:(["']|&quot;|&#39;)(.*?)\1|([^\s"')]*))\s*\)/gi;   // in a style="" as written (&quot; for ")

// one entry point (a file, or { stdin }) → one minified file (also used for the site's own script and stylesheet)
async function esbuildText(entry, extra, where) {
  const r = await esbuild.build({ ...(entry.stdin ? entry : { entryPoints: [entry] }), bundle: true, minify: true, write: false, charset: 'utf8',
    legalComments: 'none', logLevel: 'silent', loader, ...extra }).catch(e => problem(where + ': ' + (e.errors?.[0]?.text || e.message)));
  return r.outputFiles[0].text.trim();
}
const JS = { format: 'esm', target: 'es2020' };

// warn(message): what the page names that may not exist on the site (assetStrings); the page is bundled anyway
export async function bundleGame(id, g, { warn = () => {} } = {}) {
  const dir = path.join(P.games, id), where = 'games/' + id + '/index.html';
  const source = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/^\uFEFF/, '');
  if (!/^\s*<!doctype html>/i.test(source)) problem(where + ' must start with <!doctype html> (without it the page renders in quirks mode)');
  // the library API goes in last, where withLibraryApi puts it: a comment keeps its place while the page is read
  const mark = '<!--' + crypto.randomUUID() + '-->', html = atApiPlace(source, id, mark);
  const inline = { resolveDir: dir, sourcefile: 'index.html' };
  const named = (what, js) => {
    for (const s of assetStrings(js)) warn(what + ' names "' + s + '", which looks like a file next to the game: on the site the game is one page, so it is not there (import it from a module: the build inlines what a module imports)');
  };
  const moduleScript = async (entry, what) => {
    const js = await esbuildText(entry, JS, where);
    if (/<\/script/i.test(js)) problem(where + ': the bundle contains "</script" and cannot be inlined');
    named(what, js);
    return '<script type="module">' + js + '</script>';   // still a module: runs after the page is parsed, as before
  };
  // a relative URL of the markup → the file it names as a data: URL, when it is a media file next to the page
  const asset = (url, attr) => {
    const file = path.join(dir, url.split(/[?#]/)[0]);
    if (!file.startsWith(dir + path.sep) || !exists(file) || !ASSETS[path.extname(file).toLowerCase()]) problem(where + ': ' + attr + ': "' + url + '" would not exist on the site (only styles, module scripts and media files are bundled)');
    return dataUrl(file);
  };
  const tag = (name, attrs) => '<' + name + attrs.replace(ATTR, (m, attr, dq, sq, bare) => {
    const raw = dq ?? sq ?? bare, v = unescape(raw), n = attr.toLowerCase(), q = sq === undefined ? '"' : '\'';
    if (URL_ATTRS.has(n)) return local(v) ? m[0] + attr + '="' + asset(v, n) + '"' : m;
    const set = /^(image)?srcset$/.test(n) && srcsetUrls(v).find(local);
    if (set) problem(where + ': ' + n + ': "' + set + '" would not exist on the site; use src, the build inlines it');
    if (n !== 'style') return m;
    const css = raw.replace(CSS_URL, (u, _, quoted, url) => local(unescape(quoted ?? url)) ? 'url(' + asset(unescape(quoted ?? url), n) + ')' : u);
    return css === raw ? m : m[0] + attr + '=' + q + css + q;
  }) + '>';

  let out = '', last = 0;
  for (const m of html.matchAll(MARKUP)) {
    const [all, el, elAttrs, body, name, attrs, open] = m;
    out += html.slice(last, m.index);
    last = m.index + all.length;
    if (all.startsWith('<!--')) out += all;              // a comment: as it is
    else if (open) problem(where + ': <' + open + '> has no </' + open + '>');
    else if (el && el.toLowerCase() === 'style') out += '<' + el + elAttrs + '>' + await esbuildText({ stdin: { ...inline, contents: body, loader: 'css' } }, {}, where) + '</' + el + '>';
    else if (el) {
      const a = attrsOf(elAttrs), src = a.src, isModule = (a.type || '').trim().toLowerCase() === 'module';
      // (the site's policy lets scripts come only from the site, or inline: README, Trust)
      if (src && !local(src)) problem(where + ': <script src="' + src + '"> is from elsewhere, which the site refuses (README: Trust): keep the file next to the game, and import it from a module');
      if (src && !isModule) problem(where + ': <script src="' + src + '"> must be type="module" to be bundled');
      if (src && body.trim()) problem(where + ': <script src="' + src + '"> must be empty (a browser runs only the file)');
      if (src) out += await moduleScript(path.join(dir, src), 'games/' + id + '/' + src);
      else if (isModule) out += await moduleScript({ stdin: { ...inline, contents: body, loader: 'js' } }, 'an inline module of ' + where);
      else { named('an inline script of ' + where, body); out += all; }
    } else {
      const a = attrsOf(attrs), rel = (a.rel || '').toLowerCase().split(/\s+/);
      if (name.toLowerCase() === 'link' && rel.includes('stylesheet') && !rel.includes('alternate') && local(a.href)) out += '<style>' + await esbuildText(path.join(dir, a.href), {}, where) + '</style>';
      else out += tag(name, attrs);
    }
  }
  return (out + html.slice(last)).replace(mark, () => libraryApi(id, g));
}

/* ---------- the site's pages: one template (library/app/page.html) for the shelf and every game ---------- */
// {{key}} is replaced (HTML-escaped; bootArgs as is); a line starting with {{?key}} stays only when key is set.
// version: the site's version (siteVersion), 'dev' when not given (the dev server).
export function page(vals) {
  vals = { ...vals, version: vals.version || 'dev' };
  return fs.readFileSync(path.join(P.app, 'page.html'), 'utf8')
    .replace(/^\{\{\?(\w+)\}\}(.*\n)/gm, (_, k, line) => vals[k] ? line : '')
    .replace(/\{\{(\w+)\}\}/g, (_, k) => k in vals ? (k === 'bootArgs' ? vals[k] : esc(vals[k])) : problem('page.html: unknown field ' + k));
}
const LIBRARY = { title: 'Ігротека', description: 'Наша маленька бібліотека ігор. Ігри відкриваються за паролем.', theme: '#e4e2f0' };

// The site's version: the commit the library is built from and the day (UTC), e.g. "1a2b3c4 2026-10-12". Every page
// carries it (<meta name="ihroteka-version">) and the library's diagnostics start with it (together.js).
export function siteVersion() {
  let commit = null;
  try { commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: P.app, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); }
  catch (e) { commit = process.env.GITHUB_SHA?.slice(0, 7); }   // no git: CI still says which commit
  return (commit || 'unknown') + ' ' + new Date().toISOString().slice(0, 10);
}
const VERSION_TAG = /<meta name="ihroteka-version"[^>]*>/;

export function gamePage(id, g, version) {
  const base = homepage();
  if (!/^https:\/\/[^/]+\/(.*\/)?$/.test(base.replace(/\/?$/, '/'))) problem('package.json "homepage" must be the absolute https URL of the site (link previews need it)');
  return page({
    title: g.title, description: g.description, shareTitle: g.shareTitle || g.title, shareDescription: g.shareDescription || g.description,
    imageUrl: base.replace(/\/?$/, '/') + id + '/' + g.image, imageAlt: g.imageAlt || g.title, emoji: g.emoji || '🎮', theme: g.theme || LIBRARY.theme,
    base: '../', bootArgs: JSON.stringify({ game: id }), version
  });
}

/* ---------- the site: library/app + vault/ → site/ (CI does this on every push) ---------- */
const ICONS = ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png'];
async function libraryFiles(version) {
  const dir = P.app, js = (entry, banner) => esbuildText(path.join(dir, entry), { ...JS, ...(banner && { banner: { js: banner } }) }, 'library/app');
  const files = {
    'index.html': page({ ...LIBRARY, shareTitle: LIBRARY.title, shareDescription: LIBRARY.description, imageUrl: '', imageAlt: '', emoji: '🎲',
      base: './', bootArgs: '{}', version }),
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
  const version = siteVersion(), files = await libraryFiles(version), games = vaultIds().map(id => [id, readManifest(id, vaultPath(id))]);
  files['keyring.json'] = fs.readFileSync(P.keyring);
  files['library.json'] = JSON.stringify(games.map(([id, g]) => shelfEntry(id, g)));
  for (const [id, g] of games) {
    files[id + '/index.html'] = gamePage(id, g, version);
    files[id + '/game.bin'] = fs.readFileSync(vaultPath(id, 'game.bin'));
    files[id + '/' + g.image] = fs.readFileSync(vaultPath(id, g.image));
  }
  files['sw.js'] = serviceWorker(files);
  fs.rmSync(out, { recursive: true, force: true });
  for (const [f, data] of Object.entries(files)) writeAtomic(path.join(out, f), data);
  return games.length;
}

// the offline copy: sw.js lists every file of the site; its version is a hash of them all (but the site's version
// in the pages: a rebuild of the same site is no update for the devices)
function serviceWorker(files) {
  const names = Object.keys(files).sort(), hash = crypto.createHash('sha256'), tpl = fs.readFileSync(path.join(P.app, 'sw.js'), 'utf8');
  hash.update(tpl);                                    // a new worker gets a new version too
  for (const f of names) hash.update(f + '\0').update(f.endsWith('.html') ? files[f].replace(VERSION_TAG, '') : files[f]);
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
