#!/usr/bin/env node
// Keyring format migration: `npm run migrate [-- --dry-run]`. Brings vault/keyring.json up to the format these tools
// read (library/crypto.js: KEYRING_V), one step at a time. A keyring already there is left alone, so running it again
// changes nothing. A step checks everything it made before anything is written, and the keyring is written in one
// rename (an interrupted run leaves the old file). --dry-run does all of it but the writing.
//
//   v3 → v4  a password salt per person (v3 had one salt for everyone: one guess was tried against all at once).
//            Each person's private key is opened with their password and sealed again under a new salt of their
//            own. Key pairs, boxes and the library key stay as they are: signed-in devices keep working, and nothing
//            else in vault/ changes. Needs everyone's password: VAULT_PASSWORD and VAULT_PASSWORDS (several, one per
//            line) are tried first; anyone they do not open is asked for by name.
//
// Older formats are refused. Their steps were one-offs, run once on the only keyring there was, in the layout
// before vault/ (docs/keyring.json, docs/library.bin, vault/<id>.bin), and they rewrote sealed files of that layout,
// so they cannot be repeated on today's files:
//   v1 + key ids  keyring.kid, and the key id in front of every sealed file (commit c53c38a)
//   v1 → v2       labels 'drakony:…' → 'ihroteka:…': every ciphertext sealed again, everyone's password (7ccf849)
//   v2 → v3       names in plain text; the sealed shelf list (docs/library.bin) dropped (d432127)
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import * as vault from '../library/crypto.js';
import * as repo from './repo.js';

const { subtle } = globalThis.crypto, enc = new TextEncoder();
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const { problem } = repo;

// v3: every private key sealed with a key from the password and the keyring's one salt
async function sharedSaltKey(kr, password) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(kr.kdf.salt), iterations: kr.kdf.iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
}
const openPriv = async (person, key) => {
  const u = unb64(person.priv);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: enc.encode(vault.label.priv(person.id)) }, key, u.subarray(12)));
};

/**
 * keyring v3 → v4 (a new object; kr is not changed)
 * known     passwords to try on everyone first
 * ask       async person → their password ('' or null: not given)
 * → { kr, names }: the v4 keyring, and whose private keys were sealed again
 */
export async function v3to4(kr, known, ask) {
  if (kr.v !== 3 || !kr.kdf || typeof kr.kdf.salt !== 'string' || !(kr.kdf.iterations > 0) || !Array.isArray(kr.people)) problem('Not a v3 keyring.');
  const keys = new Map();                                // password → its key (one slow derivation per password)
  const keyOf = pw => { if (!keys.has(pw)) keys.set(pw, sharedSaltKey(kr, pw)); return keys.get(pw); };
  const tryOpen = async (p, pw) => { try { return await openPriv(p, await keyOf(pw)); } catch (e) { return null; } };
  const tries = [...new Set(known.filter(Boolean))];
  const next = { ...kr, v: 4, kdf: { iterations: kr.kdf.iterations }, people: [] }, opened = [];
  for (const p of kr.people) {
    let pw = null, pkcs8 = null;
    for (const t of tries) if ((pkcs8 = await tryOpen(p, t))) { pw = t; break; }
    if (!pkcs8) {
      pw = await ask(p);
      if (!pw) problem('No password for ' + p.name + ': everyone’s password is needed (their private key is sealed again).');
      if (!(pkcs8 = await tryOpen(p, pw))) problem('Wrong password for ' + p.name + '.');
      tries.push(pw);
    }
    const { id, name, pub, box } = p, { salt, priv } = await vault.sealPrivate(next, id, pkcs8, pw);
    next.people.push({ id, name, salt, pub, priv, box });
    opened.push([id, pw]);
  }
  // the check: with their own salt now, each password opens that person's private key, and it opens their box
  // (the same library key: kr.kid)
  for (const [id, pw] of opened) {
    const person = next.people.find(p => p.id === id), who = await vault.signIn({ ...next, people: [person] }, pw);
    const raw = who && await vault.libraryKey(next, id, who.priv).catch(() => null);
    if (!raw || await vault.keyId(raw) !== kr.kid) problem('Check failed for ' + person.name + ': nothing was written.');
  }
  return { kr: next, names: next.people.map(p => p.name) };
}

const STEPS = { 3: v3to4 };

// Passwords are taken exactly as typed (no trimming), the same way the browser takes them.
let piped = null;
async function ask(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(question);
    piped ??= readline.createInterface({ input: process.stdin })[Symbol.asyncIterator]();
    const { value, done } = await piped.next();
    return done ? null : value.replace(/\r$/, '');
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  rl._writeToOutput = s => { if (s.startsWith(question)) process.stdout.write(question); };
  return new Promise(resolve => rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer); }));
}

async function main(args) {
  const dry = args.includes('--dry-run');
  if (args.some(a => a !== '--dry-run')) problem('Usage: node tools/migrate.js [--dry-run]');
  if (!repo.exists(repo.P.keyring)) problem('No ' + repo.rel(repo.P.keyring) + '.');
  let kr = JSON.parse(fs.readFileSync(repo.P.keyring, 'utf8'));
  if (kr.v === vault.KEYRING_V) return console.log('✓ ' + repo.rel(repo.P.keyring) + ' is already v' + kr.v + ': nothing to do.');
  if (kr.v > vault.KEYRING_V) problem(repo.rel(repo.P.keyring) + ' is v' + kr.v + ', newer than these tools (v' + vault.KEYRING_V + '): update them.');
  if (!STEPS[kr.v]) problem(repo.rel(repo.P.keyring) + ' is v' + kr.v + ': only v3 and later can be migrated (see tools/migrate.js).');
  if (!dry) repo.requireClean(repo.P.vault);
  const known = [process.env.VAULT_PASSWORD, ...(process.env.VAULT_PASSWORDS || '').split('\n')];
  while (kr.v < vault.KEYRING_V) {
    const from = kr.v, step = STEPS[from];
    if (!step) problem('No step from v' + from + '.');
    const r = await step(kr, known, p => ask('Password of ' + p.name + ': '));
    kr = r.kr;
    console.log((dry ? '· would migrate' : '✓ migrated') + ' v' + from + ' → v' + kr.v + ': ' + r.names.join(', '));
  }
  if (dry) return console.log('Dry run: nothing written.');
  repo.writeKeyring(kr);
  console.log('✓ ' + repo.rel(repo.P.keyring) + ' written. Commit vault/.');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(() => process.exit(0), e => {
    console.error('✗ ' + (e instanceof repo.Problem ? e.message : e.stack || e));
    process.exit(1);
  });
}
