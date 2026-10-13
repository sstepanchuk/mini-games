// Sealed broker traffic (phase 5, J2; owner, decision 10). The public brokers carry a room's messages; with the room's
// code anyone could read them (names, the addresses in a direct link's offer) or forge one (a 'moved' that sends a
// player away). So every packet is sealed with a key that only the code gives, and the topic it goes on says nothing
// that leads back to the code without paying for that key.
//
// The key. PBKDF2-SHA-256 of the code (salt: 'ihroteka room ' + the game, the same for every room of the library, so a
// table over every code would open every room: the code space is what counts, see ITER) gives 256 bits; HKDF-SHA-256
// makes of them the room's topic (128 bits, hex) and its AES-256-GCM key. Never a plain hash of the code: one GPU
// reverses that for every code of 8 characters in minutes (the topic of a library before PROTO 2: `legacy` below).
// Keep this derivation across PROTO bumps: pages of two versions meet on the same topic, and say 'version' (room.js).
//
// A packet is JSON {"s": base64(iv ‖ ciphertext ‖ tag), "f": sender, "q": its number}, f and q last and readable: the
// brokers' duplicate filter and the replay window (brokers.js) read them before any crypto. The seal binds them, and the
// topic it was published on (additional data: topic \n f \n q), so a packet cannot be renumbered, credited to another
// sender or moved to another topic (a mailbox, say). Inside: the message as JSON, without f and q. Every iv is fresh
// (random 96 bits).
//
// Sealing at once (sealNow). Web Crypto answers later, and a page that goes away (pagehide: a reload, a closed tab)
// never hears that answer. For its last words (brokers.js lastWords) a room keeps one packet's worth ready (spare): a fresh
// iv, the counter-mode stream for it and E(J0), made with the same key as AES-CTR; the seal is then an XOR and GHASH,
// here and synchronous, and opens like any other packet (NIST SP 800-38D).
//
// The replay window (fresh, mark): a sender numbers its packets (q: one counter for all its topics, from the clock when
// its room began, brokers.js). A receiver takes each number once, and none more than WINDOW below the highest it has
// opened from that sender. Numbers are marked only once a packet opened: a forged packet with a stolen f and the next q
// never shadows the genuine one.
const TE = new TextEncoder(), TD = new TextDecoder();

// PBKDF2 iterations, so that a cheap phone pays about 0.1 s for a room's key, once per room it joins. Measured in Node 22
// (Web Crypto, one core of a 2.8 GHz Xeon, October 2026): 1.9 million iterations a second, so 40 000 take 21 ms; a cheap
// phone is taken as about 5 times slower (an estimate, to be checked on the real phones of the phase 1b checks: room.diag()
// says what the key took). What it buys: one high-end GPU does about 9·10^9 iterations a second (hashcat's PBKDF2-HMAC-
// SHA256 benchmark), so 2·10^5 codes a second: every code of 8 characters (31^8, 8.5·10^11) in about 45 days, of 6 (an
// old room's link) in about an hour. Raising it costs every player that much more time on joining.
export const ITER = 40000;
export const WINDOW = 2048;                            // a sender's numbers taken this far below its highest (see the top)
export const SPARE = 65536;                            // the longest message sealed at once (sealNow), bytes of its JSON

const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const aad = (topic, f, q) => TE.encode(topic + '\n' + f + '\n' + q);
// one call of AES-CTR: n bytes of the key stream from this counter block (the last 32 bits count, as in GCM)
const stream = async (key, counter, n) => new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-CTR', counter, length: 32 }, key, new Uint8Array(n)));

/**
 * The room's keys (needs Web Crypto: config.js secure) → { topic, legacy, gcm, ctr, h }
 *   topic   where the room's packets go: 'ihroteka/s/' + 32 hex characters (mailboxes under it, brokers.js)
 *   legacy  the topic a library before PROTO 2 uses for this code: a hash of the code, never published on by us unless a
 *           page of that library speaks there first (internet.js, the door)
 *   gcm, ctr  the AES key (not extractable), for AES-GCM and for the spare's key stream; h: GHASH's key, E(0^128)
 */
export async function roomKeys(game, code) {
  const s = crypto.subtle;
  const pw = await s.importKey('raw', TE.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: TE.encode('ihroteka room ' + game), iterations: ITER }, pw, 256);
  const master = await s.importKey('raw', bits, 'HKDF', false, ['deriveBits']);
  const hkdf = async (info, n) => new Uint8Array(await s.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: TE.encode(info) }, master, n));
  const topic = 'ihroteka/s/' + hex(await hkdf('ihroteka topic', 128));
  const raw = await hkdf('ihroteka seal', 256);
  const gcm = await s.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const ctr = await s.importKey('raw', raw, 'AES-CTR', false, ['encrypt']);
  raw.fill(0);
  const h = words(await stream(ctr, new Uint8Array(16), 16));
  const legacy = 'ihroteka/' + hex(new Uint8Array(await s.digest('SHA-256', TE.encode(game + ':' + code))).subarray(0, 16));
  return { topic, legacy, gcm, ctr, h };
}

// the packet as it travels (see the top)
const envelope = (bytes, f, q) => '{"s":"' + b64(bytes) + '","f":"' + f + '","q":' + q + '}';

// plain (a message as JSON, without f and q) → the packet that sender f publishes as number q on topic
export async function seal(K, topic, f, q, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const c = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(topic, f, q) }, K.gcm, TE.encode(plain)));
  const out = new Uint8Array(12 + c.length);
  out.set(iv); out.set(c, 12);
  return envelope(out, f, q);
}

// a packet's s, as it came on topic from f with number q → its message as JSON, or null (not sealed with this room's key
// for this topic, sender and number: forged, garbled, moved or renumbered)
export async function open(K, topic, f, q, s) {
  let b;
  try { b = unb64(s); } catch (e) { return null; }
  if (b.length < 12 + 16) return null;
  try { return TD.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.subarray(0, 12), additionalData: aad(topic, f, q) }, K.gcm, b.subarray(12))); } catch (e) { return null; }
}

// One packet's worth, made ahead (see the top): a fresh iv, E(J0) and the key stream for SPARE bytes. Use it once.
export async function spare(K) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const block = n => { const c = new Uint8Array(16); c.set(iv); c[15] = n; return c; };   // J0 = iv ‖ 0…01; the text from iv ‖ 0…02
  const [ej0, ks] = await Promise.all([stream(K.ctr, block(1), 16), stream(K.ctr, block(2), SPARE)]);
  return { iv, ej0, ks };
}
// seal, at once, with a spare M (which it uses up) → the packet, or null (no spare, or plain longer than SPARE bytes:
// M is still unused then)
export function sealNow(K, M, topic, f, q, plain) {
  const p = TE.encode(plain);
  if (!M || M.used || p.length > M.ks.length) return null;
  M.used = true;                                       // (never twice with one iv)
  const out = new Uint8Array(12 + p.length + 16), c = out.subarray(12, 12 + p.length);
  out.set(M.iv);
  for (let i = 0; i < p.length; i++) c[i] = p[i] ^ M.ks[i];
  const tag = ghash(K.h, aad(topic, f, q), c);
  for (let i = 0; i < 16; i++) out[12 + p.length + i] = tag[i] ^ M.ej0[i];
  return envelope(out, f, q);
}

// GHASH (SP 800-38D 6.4): the additional data and the ciphertext, each zero-padded to 16 bytes, then their lengths in bits
function ghash(h, a, c) {
  const x = [0, 0, 0, 0];
  const absorb = b => {
    for (let i = 0; i < b.length; i += 16) {
      for (let k = 0; k < 4; k++) x[k] ^= word(b, i + 4 * k);
      mul(x, h);
    }
  };
  absorb(a); absorb(c);
  x[1] ^= a.length * 8; x[3] ^= c.length * 8;          // (64-bit lengths: their high halves are 0 here)
  mul(x, h);
  const out = new Uint8Array(16);
  for (let k = 0; k < 16; k++) out[k] = x[k >> 2] >>> (24 - 8 * (k & 3)) & 255;
  return out;
}
// x ← x · h in GF(2^128), GCM's bit order (SP 800-38D, algorithm 1); four 32-bit words, the first byte highest
function mul(x, h) {
  let z0 = 0, z1 = 0, z2 = 0, z3 = 0, v0 = x[0], v1 = x[1], v2 = x[2], v3 = x[3];
  for (let i = 0; i < 128; i++) {
    if (h[i >> 5] >>> (31 - (i & 31)) & 1) { z0 ^= v0; z1 ^= v1; z2 ^= v2; z3 ^= v3; }
    const r = v3 & 1;
    v3 = v3 >>> 1 | v2 << 31; v2 = v2 >>> 1 | v1 << 31; v1 = v1 >>> 1 | v0 << 31; v0 >>>= 1;
    if (r) v0 ^= 0xe1000000;
  }
  x[0] = z0; x[1] = z1; x[2] = z2; x[3] = z3;
}
// four bytes from i on, big-endian (past the end: zeros)
const word = (b, i) => ((b[i] ?? 0) << 24 | (b[i + 1] ?? 0) << 16 | (b[i + 2] ?? 0) << 8 | (b[i + 3] ?? 0)) >>> 0;
const words = b => [0, 4, 8, 12].map(i => word(b, i));

function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const t = atob(s), out = new Uint8Array(t.length);
  for (let i = 0; i < t.length; i++) out[i] = t.charCodeAt(i);
  return out;
}

/* ---------- the replay window (see the top) ---------- */
export const newWindow = () => ({ hi: -1, seen: new Uint8Array(WINDOW) });
// whether number q from this sender is still to be taken (not seen, not too old)
export const fresh = (w, q) => q > w.hi || (q > w.hi - WINDOW && !w.seen[q % WINDOW]);
// q opened: taken (the numbers it moves past, not seen yet, are free again in their slots)
export function mark(w, q) {
  if (q > w.hi) {
    if (q - w.hi >= WINDOW) w.seen.fill(0);
    else for (let x = w.hi + 1; x < q; x++) w.seen[x % WINDOW] = 0;
    w.hi = q;
  }
  w.seen[q % WINDOW] = 1;
}
