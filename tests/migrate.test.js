// The keyring migration (tools/migrate.js) on a v3 keyring made here, in a scratch copy: npm test
// (made-up passwords and few PBKDF2 iterations: the step keeps whatever count the keyring has)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as vault from '../library/crypto.js';
import { v3to4 } from '../tools/migrate.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOOL = path.join(REPO, 'tools', 'migrate.js'), CLI = path.join(REPO, 'tools', 'cli.js');
const PW = { alice: 'alice made up 1', bob: 'bob made up 2' }, ITER = 1000;
const { subtle } = globalThis.crypto, enc = new TextEncoder();
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const roots = [];
let v3 = '', raw = null, sealed = null;

// a keyring as v3 had it: one salt for everyone, people { id, pub, priv, name, box }
async function v3Keyring() {
  const salt = vault.random(16);
  raw = vault.newLibraryKey();
  const kr = { v: 3, kid: await vault.keyId(raw), kdf: { salt: vault.b64(salt), iterations: ITER }, people: [] };
  for (const [name, pw] of Object.entries(PW)) {
    const id = Buffer.from(vault.random(6)).toString('hex');
    const pair = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const base = await subtle.importKey('raw', enc.encode(pw.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
    const iv = vault.random(12), ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(vault.label.priv(id)) }, key, await subtle.exportKey('pkcs8', pair.privateKey)));
    const person = { id, pub: vault.b64(await subtle.exportKey('raw', pair.publicKey)), priv: vault.b64(new Uint8Array([...iv, ...ct])), name };
    person.box = await vault.boxFor(person, raw);
    kr.people.push(person);
  }
  return kr;
}

// a scratch repository with that keyring → its root
function scratch(text = v3) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-migrate-'));
  roots.push(root);
  fs.mkdirSync(path.join(root, 'vault'));
  fs.writeFileSync(path.join(root, 'vault', 'keyring.json'), text);
  return root;
}
const keyring = root => fs.readFileSync(path.join(root, 'vault', 'keyring.json'), 'utf8');
// the tool, with only the passwords given here (none from the environment of whoever runs the tests)
function run(root, args = [], env = {}, input = '') {
  const base = { ...process.env, IHROTEKA_ROOT: root };
  delete base.VAULT_PASSWORD; delete base.VAULT_PASSWORDS;
  const r = spawnSync(process.execPath, [TOOL, ...args], { env: { ...base, ...env }, encoding: 'utf8', input });
  return { ok: r.status === 0, out: r.stdout + r.stderr };
}

before(async () => {
  v3 = JSON.stringify(await v3Keyring(), null, 2) + '\n';
  sealed = await vault.sealFile(await vault.importKey(raw), JSON.parse(v3).kid, enc.encode('a game'), vault.label.game('demo'));
});
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

test('v3 → v4: a salt per person, the same key pairs and library key', async () => {
  const root = scratch(), old = JSON.parse(v3);
  const r = run(root, [], { VAULT_PASSWORD: PW.alice }, PW.bob + '\n');            // bob's password is asked for
  assert.ok(r.ok, r.out);
  assert.match(r.out, /Password of bob/);
  assert.doesNotMatch(r.out, /Password of alice/);
  assert.match(r.out, /v3 → v4: alice, bob/);
  const kr = JSON.parse(keyring(root));
  assert.equal(kr.v, vault.KEYRING_V);
  assert.deepEqual(kr.kdf, { iterations: ITER });                                   // no shared salt any more
  assert.equal(kr.kid, old.kid);
  assert.deepEqual(kr.people.map(p => Object.keys(p)), kr.people.map(() => ['id', 'name', 'salt', 'pub', 'priv', 'box']));
  assert.equal(new Set(kr.people.map(p => p.salt)).size, 2);
  for (const p of kr.people) assert.equal(unb64(p.salt).length, 16);
  for (const [i, p] of kr.people.entries()) {
    const o = old.people[i];
    assert.deepEqual([p.id, p.name, p.pub, p.box], [o.id, o.name, o.pub, o.box]);    // devices signed in keep working
    assert.notEqual(p.priv, o.priv);
  }
  for (const [name, pw] of Object.entries(PW)) {                                    // today's tools sign in, and open the games
    const who = await vault.signIn(kr, pw);
    assert.equal(who && who.person.name, name);
    const key = await vault.libraryKey(kr, who.person.id, who.priv);
    assert.equal(await vault.keyId(key), kr.kid);
    assert.equal(new TextDecoder().decode(await vault.openFile(await vault.importKey(key), sealed, vault.label.game('demo'))), 'a game');
  }
  const list = spawnSync(process.execPath, [CLI, 'user', 'list'], { env: { ...process.env, IHROTEKA_ROOT: root }, encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.match(list.stdout, /alice[\s\S]*bob/);

  const before = keyring(root), again = run(root);                                  // again: nothing to do, nothing asked
  assert.ok(again.ok, again.out);
  assert.match(again.out, /already v4/);
  assert.equal(keyring(root), before);
});

test('--dry-run checks everything and writes nothing', () => {
  const root = scratch(), r = run(root, ['--dry-run'], { VAULT_PASSWORDS: PW.bob + '\n' + PW.alice });
  assert.ok(r.ok, r.out);
  assert.match(r.out, /would migrate v3 → v4: alice, bob/);
  assert.match(r.out, /nothing written/);
  assert.doesNotMatch(r.out, /Password of/);
  assert.equal(keyring(root), v3);
});

test('a missing or wrong password: nothing is written', () => {
  const root = scratch();
  let r = run(root, [], { VAULT_PASSWORD: PW.alice });
  assert.ok(!r.ok);
  assert.match(r.out, /No password for bob/);
  r = run(root, [], { VAULT_PASSWORD: PW.alice }, 'not bob’s\n');
  assert.ok(!r.ok);
  assert.match(r.out, /Wrong password for bob/);
  r = run(root, [], { VAULT_PASSWORDS: PW.bob }, PW.bob + '\n');                    // bob's password is not alice's
  assert.ok(!r.ok);
  assert.match(r.out, /Wrong password for alice/);
  assert.equal(keyring(root), v3);
});

test('older and newer keyrings are refused; bad arguments too', () => {
  for (const [v, why] of [[2, /only v3 and later/], [vault.KEYRING_V + 1, /newer than these tools/]]) {
    const text = JSON.stringify({ ...JSON.parse(v3), v }), root = scratch(text), r = run(root, [], { VAULT_PASSWORDS: PW.alice + '\n' + PW.bob });
    assert.ok(!r.ok);
    assert.match(r.out, why);
    assert.equal(keyring(root), text);
  }
  const r = run(scratch(), ['--force']);
  assert.ok(!r.ok);
  assert.match(r.out, /Usage/);
});

test('the step itself: a new keyring, the old one untouched', async () => {
  const kr = JSON.parse(v3), copy = structuredClone(kr);
  const r = await v3to4(kr, [PW.alice, PW.bob], () => assert.fail('nobody is asked: both passwords are known'));
  assert.deepEqual(kr, copy);
  assert.equal(r.kr.v, 4);
  assert.deepEqual(r.names, ['alice', 'bob']);
  await assert.rejects(v3to4(r.kr, [], () => null), /Not a v3 keyring/);
});
