// Repository model: where things live, the keyring, sealed games and their source archives.
// Library code throws Problem for anything the user can fix; only cli.js prints and exits.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as vault from '../library/crypto.js';

export class Problem extends Error {}
export const problem = msg => { throw new Problem(msg); };

// IHROTEKA_ROOT lets tests run the tools against a scratch copy of the repository
const ROOT = path.resolve(process.env.IHROTEKA_ROOT || path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const TOOLS = path.dirname(fileURLToPath(import.meta.url));
export const P = {
  games: path.join(ROOT, 'games'),       // plaintext game sources (local only)
  vault: path.join(ROOT, 'vault'),       // what the repository keeps: the keyring and the games (encrypted where it matters)
  site: path.join(ROOT, 'site'),         // the site, assembled from library/ and vault/ (not kept in git)
  keyring: path.join(ROOT, 'vault', 'keyring.json'),
  app: path.join(TOOLS, '..', 'library', 'app'),       // the library page
  gameApi: path.join(TOOLS, '..', 'library', 'game-api.js')
};
export const rel = p => path.relative(ROOT, p) || '.';
export const exists = fs.existsSync;
export const same = (a, b) => Buffer.from(a).equals(Buffer.from(b));
// content types of everything a game or the site may contain
export const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };
export const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const homepage = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).homepage || '';

// games/<id>/ (plaintext, local) and vault/<id>/ (game.json, cover, game.bin, source.bin)
const dirs = (dir, has) => exists(dir) ? fs.readdirSync(dir).filter(d => exists(path.join(dir, d, has))).sort() : [];
export const gameIds = () => dirs(P.games, 'game.json');
export const vaultIds = () => dirs(P.vault, 'game.json');
export const vaultPath = (id, ...f) => path.join(P.vault, id, ...f);

// write next to the target, then rename: a crash never leaves a half-written file
export function writeAtomic(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.tmp', data);
  fs.renameSync(file + '.tmp', file);
}

// → true if written
export function writeIfChanged(file, data) {
  if (exists(file) && fs.readFileSync(file).equals(Buffer.from(data))) return false;
  writeAtomic(file, data);
  return true;
}

// refuse to touch encrypted files with uncommitted changes (the only backup is git)
export function requireClean(...dirs) {
  let out;
  try { out = execFileSync('git', ['status', '--porcelain', '--', ...dirs.map(rel)], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { return; }                                  // not a git checkout: nothing to compare with
  if (out.trim()) problem('Uncommitted changes in ' + dirs.map(rel).join(', ') + '. Commit or discard them first (git is the only backup of encrypted files).');
}

/* ---------- keyring & people ---------- */
export function readKeyring() {
  if (!exists(P.keyring)) problem('No ' + rel(P.keyring) + '. Start with `node tools/cli.js init <name> …`.');
  const kr = JSON.parse(fs.readFileSync(P.keyring, 'utf8'));
  if (kr.v !== vault.KEYRING_V) problem(rel(P.keyring) + ' is format v' + kr.v + ', these tools read v' + vault.KEYRING_V + '.');
  return kr;
}
export const writeKeyring = kr => writeAtomic(P.keyring, JSON.stringify(kr, null, 2) + '\n');

// → { kr, me, raw, key, kid }: the keyring, who signed in, and the library key
export async function open(password) {
  const kr = readKeyring();
  const who = await vault.signIn(kr, password);
  if (!who) problem('Wrong password.');
  const raw = await vault.libraryKey(kr, who.person.id, who.priv);
  const kid = await vault.keyId(raw);
  if (kr.kid !== kid) problem('keyring.json is inconsistent: its key id does not match the library key.');
  return { kr, me: who.person, raw, key: await vault.importKey(raw), kid };
}
export async function addPerson(kr, raw, name, password) {
  const id = Buffer.from(vault.random(6)).toString('hex');
  const person = await vault.newPerson(kr, id, password);
  person.name = name;
  person.box = await vault.boxFor(person, raw);
  kr.people.push(person);
}

// 12 characters without look-alikes (0/o, 1/l): ~60 bits of entropy
export function makePassword() {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  while (s.length < 12) { const b = vault.random(1)[0]; if (b < abc.length * 8) s += abc[b % abc.length]; }
  return s.match(/.{4}/g).join('-');
}
export function checkNewPassword(pw) {
  if (pw !== pw.trim()) problem('A password must not start or end with a space.');
  if (pw.length < 12) problem('Too short: at least 12 characters. The keyring is public, so short passwords can be brute-forced.');
}

/* ---------- sealed files ---------- */
// every sealed file with its label
function sealedFiles() {
  return vaultIds().flatMap(id => [[vaultPath(id, 'game.bin'), vault.label.game(id)], [vaultPath(id, 'source.bin'), vault.label.source(id)]]);
}
export function readSealed(file, aad, { key, kid }) {
  const blob = fs.readFileSync(file);
  if (vault.fileKid(blob) !== kid) problem(rel(file) + ' is sealed with another library key (stale checkout? run git pull).');
  return vault.openFile(key, blob, aad);
}
// writes only when the content changed (equal(old, new) decides), so unchanged builds leave git clean → true if written
export async function writeSealed(file, plain, aad, lib, equal = same) {
  if (exists(file)) {
    const blob = fs.readFileSync(file);
    if (vault.fileKid(blob) === lib.kid) {
      const old = await vault.openFile(lib.key, blob, aad).catch(() => null);
      if (old && equal(old, plain)) return false;
    }
  }
  writeAtomic(file, await vault.sealFile(lib.key, lib.kid, plain, aad));
  return true;
}

// New library key for everyone left in kr.people. Everything is decrypted, re-sealed and written to *.tmp
// first, the keyring too; only then is anything renamed into place. A failure before that leaves vault/ as it was.
export async function rotate(kr, lib) {
  const files = [];
  for (const [file, aad] of sealedFiles()) files.push([file, aad, await readSealed(file, aad, lib)]);
  const raw = vault.newLibraryKey(), next = { raw, key: await vault.importKey(raw), kid: await vault.keyId(raw) };
  const written = [];
  try {
    for (const [file, aad, plain] of files) { fs.writeFileSync(file + '.tmp', await vault.sealFile(next.key, next.kid, plain, aad)); written.push(file); }
    for (const p of kr.people) p.box = await vault.boxFor(p, raw);
    kr.kid = next.kid;
    fs.writeFileSync(P.keyring + '.tmp', JSON.stringify(kr, null, 2) + '\n'); written.push(P.keyring);
  } catch (e) {
    for (const f of written) fs.rmSync(f + '.tmp', { force: true });
    throw e;
  }
  for (const f of written) fs.renameSync(f + '.tmp', f);
  return next;
}

/* ---------- game sources: folder ⇄ one gzipped JSON archive (dotfiles are not included) ---------- */
// all: also dotfiles and node_modules (checks of vault/ must see everything)
export function walk(dir, base = dir, all = false) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter(e => all || (!e.name.startsWith('.') && e.name !== 'node_modules'))
    .flatMap(e => e.isDirectory() ? walk(path.join(dir, e.name), base, all) : [path.relative(base, path.join(dir, e.name)).split(path.sep).join('/')])
    .sort();
}
const readFolder = dir => Object.fromEntries(walk(dir).map(f => [f, fs.readFileSync(path.join(dir, f)).toString('base64')]));
const packSource = dir => zlib.gzipSync(JSON.stringify({ v: 1, files: readFolder(dir) }), { level: 9 });
export const unpackSource = buf => JSON.parse(zlib.gunzipSync(buf)).files;
// archives are compared by their files, not by gzip bytes (those differ between zlib versions)
const sameFiles = (a, b) => { const x = unpackSource(a), y = unpackSource(b); return JSON.stringify(x) === JSON.stringify(y); };
// a game's page, gzipped before sealing; compared by its text, and an old ungzipped file is replaced
const gz = b => b[0] === 0x1f && b[1] === 0x8b;
export const writeGame = (id, html, lib) => writeSealed(vaultPath(id, 'game.bin'), zlib.gzipSync(html, { level: 9 }), vault.label.game(id), lib,
  (old, now) => gz(old) && same(zlib.gunzipSync(old), zlib.gunzipSync(now)));
export const writeSource = (id, lib) => writeSealed(vaultPath(id, 'source.bin'), packSource(path.join(P.games, id)), vault.label.source(id), lib, sameFiles);
