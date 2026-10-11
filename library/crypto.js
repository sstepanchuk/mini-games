/* =====================================================================
   Encryption of the games. Runs unchanged in the browser and in Node (Web Crypto).

   - The games (each built game and its sources) are sealed with one library key (AES-256-GCM).
     Everything else is public: the library itself, the list of games, who has access.
   - Each person has an ECDH P-256 key pair. keyring.json holds, per person, a "box" with the library
     key that only their private key opens, and their private key sealed with their password
     (PBKDF2-SHA-256, with a salt of their own: a guess has to be tried against each person separately).
     People can be added or removed without knowing anyone else's password.
   - Every sealed file starts with the id of the library key it was sealed with (keyring.kid), so a
     file left behind by a key rotation is caught without a password (tools: check; site: "updating").
   ===================================================================== */
const { subtle } = globalThis.crypto;
const AES = { name: 'AES-GCM', length: 256 };
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const enc = new TextEncoder(), dec = new TextDecoder();

export const random = n => globalThis.crypto.getRandomValues(new Uint8Array(n));
export const b64 = u8 => btoa(Array.from(new Uint8Array(u8), b => String.fromCharCode(b)).join(''));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
export const text = u8 => dec.decode(u8);
// a game is sealed gzipped (a third of the size: ciphertext cannot be compressed later); older ones are plain
export const gameText = u8 => u8[0] === 0x1f && u8[1] === 0x8b
  ? new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  : text(u8);

// Associated data for every ciphertext: a file swapped in under another name will not decrypt.
export const label = {
  game: id => 'ihroteka:game:' + id,
  source: id => 'ihroteka:source:' + id,
  priv: id => 'ihroteka:priv:' + id,
  box: id => 'ihroteka:box:' + id
};

/* ---------- AES-GCM: [12-byte iv][ciphertext + tag] ---------- */
async function seal(key, data, aad) {
  const iv = random(12);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, typeof data === 'string' ? enc.encode(data) : data);
  const out = new Uint8Array(12 + ct.byteLength);
  out.set(iv);
  out.set(new Uint8Array(ct), 12);
  return out;
}
async function unseal(key, blob, aad) {
  const u = new Uint8Array(blob);
  return new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: u.subarray(0, 12), additionalData: enc.encode(aad) }, key, u.subarray(12)));
}
// the key can be used but never read back
export const importKey = raw => subtle.importKey('raw', raw, AES, false, ['encrypt', 'decrypt']);
export const newLibraryKey = () => random(32);
// public id of a library key: first 8 bytes of its SHA-256 (says which key, reveals nothing about it)
export const keyId = async raw => b64(new Uint8Array(await subtle.digest('SHA-256', raw)).subarray(0, 8));

/* ---------- sealed files: [1][8-byte key id][12-byte iv][ciphertext + tag] ---------- */
const FILE_V = 1, KID = 8;
export async function sealFile(key, kid, data, aad) {
  const body = await seal(key, data, aad), out = new Uint8Array(1 + KID + body.length);
  out[0] = FILE_V;
  out.set(unb64(kid), 1);
  out.set(body, 1 + KID);
  return out;
}
// key id a file was sealed with, or null if it is not a sealed file
export function fileKid(blob) {
  const u = new Uint8Array(blob);
  return u.length > 1 + KID + 28 && u[0] === FILE_V ? b64(u.subarray(1, 1 + KID)) : null;
}
export const openFile = (key, blob, aad) => unseal(key, new Uint8Array(blob).subarray(1 + KID), aad);

/* ---------- keys derived from a password and from a key exchange ---------- */
async function passwordKey(keyring, salt, password) {
  const base = await subtle.importKey('raw', enc.encode(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: unb64(salt), iterations: keyring.kdf.iterations }, base, AES, false, ['encrypt', 'decrypt']);
}
// ECDH + HKDF; both sides salt with the box's ephemeral public key (epk)
async function boxKey(priv, pubRaw, epk, id) {
  const pub = await subtle.importKey('raw', pubRaw, ECDH, false, []);
  const bits = await subtle.deriveBits({ name: 'ECDH', public: pub }, priv, 256);
  const hkdf = await subtle.importKey('raw', bits, 'HKDF', false, ['deriveKey']);
  return subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: epk, info: enc.encode(label.box(id)) }, hkdf, AES, false, ['encrypt', 'decrypt']);
}

/* ---------- keyring ---------- */
export const KEYRING_V = 4;                            // format version (4: a password salt per person)
export const newKeyring = () => ({ v: KEYRING_V, kid: '', kdf: { iterations: 600000 }, people: [] });

// a private key (PKCS#8) sealed with a password, under a new salt → { salt, priv }
export async function sealPrivate(keyring, id, pkcs8, password) {
  const salt = b64(random(16));
  return { salt, priv: b64(await seal(await passwordKey(keyring, salt, password), pkcs8, label.priv(id))) };
}

// a new person: fresh key pair, private key sealed with their password (the caller adds name and box)
export async function newPerson(keyring, id, password) {
  const pair = await subtle.generateKey(ECDH, true, ['deriveBits']);
  return { id, pub: b64(await subtle.exportKey('raw', pair.publicKey)), ...await sealPrivate(keyring, id, await subtle.exportKey('pkcs8', pair.privateKey), password) };
}

// the library key in a box only this person can open (ephemeral-static ECDH)
export async function boxFor(person, libraryRaw) {
  const eph = await subtle.generateKey(ECDH, true, ['deriveBits']);
  const epk = new Uint8Array(await subtle.exportKey('raw', eph.publicKey));
  const key = await boxKey(eph.privateKey, unb64(person.pub), epk, person.id);
  return { epk: b64(epk), ct: b64(await seal(key, libraryRaw, label.box(person.id))) };
}

// Sign in: find the person whose private key this password opens. One slow derivation per person (each has
// their own salt), all at once. → { person, priv } or null
export async function signIn(keyring, password) {
  const tries = keyring.people.map(async person => {
    const pkcs8 = await unseal(await passwordKey(keyring, person.salt, password), unb64(person.priv), label.priv(person.id));
    return { person, priv: await subtle.importKey('pkcs8', pkcs8, ECDH, false, ['deriveBits']) };
  });
  return Promise.any(tries).catch(() => null);         // nobody's (or a damaged entry)
}

// the raw library key from a person's box → Uint8Array, or null if they are no longer in the keyring
export async function libraryKey(keyring, id, priv) {
  const person = keyring.people.find(p => p.id === id);
  if (!person) return null;
  const epk = unb64(person.box.epk);
  return unseal(await boxKey(priv, epk, epk, id), unb64(person.box.ct), label.box(id));
}

// New password = new key pair. Re-sealing the old private key would not help: the old entry stays in
// git history, and the old password would still open it. The old box in history holds the same library
// key, so the tools also rotate the library key after this (see tools/cli.js: passwd).
export async function replaceKeys(keyring, person, newPassword, libraryRaw) {
  const { pub, salt, priv } = await newPerson(keyring, person.id, newPassword);
  Object.assign(person, { pub, salt, priv });
  person.box = await boxFor(person, libraryRaw);
}
