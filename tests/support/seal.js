// The room's seal (library/net/seal.js) made again with node:crypto, for the test's side of worker tabs (world.js: a
// spy who knows a room's code reads and writes its packets as a tab would; tests/net/seal.test.js: both ways must agree).
// Synchronous, so a spy's publish goes out inside the call, as before sealing.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, pbkdf2Sync, randomBytes } from 'node:crypto';
import { ITER } from '../../library/net/seal.js';

const cache = new Map();
// → { topic, legacy, key (the AES-256-GCM key, raw) } of room `code` of `game`
export function keysOf(game, code) {
  const id = game + '\n' + code;
  if (!cache.has(id)) {
    const master = pbkdf2Sync(code, 'ihroteka room ' + game, ITER, 32, 'sha256');
    const hk = (info, n) => Buffer.from(hkdfSync('sha256', master, Buffer.alloc(0), info, n));
    cache.set(id, { topic: 'ihroteka/s/' + hk('ihroteka topic', 16).toString('hex'), key: hk('ihroteka seal', 32),
      legacy: 'ihroteka/' + createHash('sha256').update(game + ':' + code).digest().subarray(0, 16).toString('hex') });
  }
  return cache.get(id);
}
const aad = (topic, f, q) => Buffer.from(topic + '\n' + f + '\n' + q);
// message m from f, number q, on topic → the packet as it travels ({"s", "f", "q"})
export function sealWith(key, topic, f, q, m) {
  const iv = randomBytes(12), c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(aad(topic, f, q));
  const body = Buffer.concat([c.update(JSON.stringify(m)), c.final()]);
  return JSON.stringify({ s: Buffer.concat([iv, body, c.getAuthTag()]).toString('base64'), f, q });
}
// a packet (its JSON) as it came on topic → its message, with f and q, or null (not sealed with this key for this topic)
export function openWith(key, topic, packet) {
  try {
    const e = JSON.parse(packet), b = Buffer.from(e.s, 'base64');
    const d = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
    d.setAAD(aad(topic, e.f, e.q));
    d.setAuthTag(b.subarray(b.length - 16));
    const m = JSON.parse(Buffer.concat([d.update(b.subarray(12, b.length - 16)), d.final()]).toString());
    return { ...m, f: e.f, q: e.q };
  } catch (e) { return null; }
}
