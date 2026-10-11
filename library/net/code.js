// A WebRTC offer or answer squeezed into a short code that fits a small QR code (~200 characters).
// Only what a data-channel connection needs travels: ICE credentials, the DTLS fingerprint, the mid and a
// few host candidates; the other side rebuilds a full SDP from them. Nothing secret is in the code: the
// fingerprint makes the link end-to-end encrypted with exactly the device that showed it.
//
// Binary layout, then base32 (A–Z, 2–7: QR alphanumeric mode, the densest one for this):
//   [version|kind] [game tag ×3] [ufrag] [pwd] [fingerprint ×32] [mid] [n] n × ([type] [address] [port ×2])
//   strings are [length][ASCII]; type 4 = IPv4 (4 bytes), 6 = IPv6 (16 bytes), 16 = mDNS name <uuid>.local (16 bytes)
const VERSION = 1, MAX_CANDIDATES = 6;
export const OFFER = 0, ANSWER = 1;

// which game the code belongs to: a code shown by another game is refused instead of failing mysteriously
function gameTag(game) {
  let h = 0x811c9dc5;                                  // FNV-1a
  for (const c of new TextEncoder().encode(game)) h = Math.imul(h ^ c, 0x01000193) >>> 0;
  return [h >>> 16 & 255, h >>> 8 & 255, h & 255];
}

/* ---------- SDP → code ---------- */
export function encode(sdp, kind, game) {
  const line = re => (sdp.match(re) || [])[1];
  const ufrag = line(/^a=ice-ufrag:(\S+)/m), pwd = line(/^a=ice-pwd:(\S+)/m), mid = line(/^a=mid:(\S+)/m) || '0';
  const fp = line(/^a=fingerprint:sha-256 ([0-9A-Fa-f:]+)/m);
  if (!ufrag || !pwd || !fp) throw new Error('unexpected SDP');
  const out = [VERSION << 1 | kind, ...gameTag(game)];
  const str = s => { out.push(s.length, ...[...s].map(c => c.charCodeAt(0) & 127)); };
  str(ufrag); str(pwd);
  out.push(...fp.split(':').map(h => parseInt(h, 16)));
  str(mid);
  const cands = candidates(sdp);
  out.push(cands.length);
  for (const c of cands) out.push(c.type, ...c.bytes, c.port >> 8, c.port & 255);
  return base32(out);
}

// what a description offers to connect to, for reports: "IPv4 192.168.1.5:50000, mDNS"
export const describe = sdp => candidates(sdp).map(c => c.type === 16 ? 'mDNS' : (c.type === 4 ? 'IPv4 ' : 'IPv6 ') + c.text + ':' + c.port).join(', ') || 'none';

// Host candidates over UDP, the most useful first: private IPv4 (home Wi-Fi, an Android hotspot), then IPv6
// (link-local IPv6 is the only way between devices on an iOS 18+ hotspot), then hidden mDNS names.
export function candidates(sdp) {
  const seen = new Set(), list = [];
  for (const [, addr, port] of sdp.matchAll(/^a=candidate:\S+ 1 udp \d+ (\S+) (\d+) typ host/gim)) {
    const c = address(addr.toLowerCase());
    if (!c || seen.has(addr)) continue;
    seen.add(addr);
    list.push({ ...c, port: +port });
  }
  const rank = c => c.type === 4 ? (/^(10|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(c.text) ? 0 : 1) : c.type === 6 ? 2 : 3;
  return list.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_CANDIDATES);
}
function address(text) {
  let m;
  if ((m = text.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/))) return { type: 4, text, bytes: m.slice(1).map(Number) };
  if ((m = text.match(/^([0-9a-f]{8})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{4})-([0-9a-f]{12})\.local$/))) return { type: 16, text, bytes: hex(m.slice(1).join('')) };
  if (text.includes(':') && !text.includes('%')) { const b = ipv6(text); if (b) return { type: 6, text, bytes: b }; }
  return null;
}

/* ---------- code → SDP ---------- */
// → { kind, sdp, candidates: how many addresses }; throws an Error for anything that is not a code of this game
export function decode(code, game) {
  const b = unbase32(code);
  let i = 0;
  const byte = () => { if (i >= b.length) throw new Error('short'); return b[i++]; };
  const take = n => { const s = b.slice(i, i + n); if (s.length < n) throw new Error('short'); i += n; return s; };
  const str = () => String.fromCharCode(...take(byte()));
  const head = byte();
  if (head >> 1 !== VERSION) throw new Error('version');
  if (take(3).join() !== gameTag(game).join()) throw new Error('game');
  const kind = head & 1, ufrag = str(), pwd = str();
  const fp = Array.from(take(32), x => x.toString(16).padStart(2, '0').toUpperCase()).join(':');
  const mid = str(), n = byte(), cands = [];
  for (let k = 0; k < n; k++) {
    const type = byte(), bytes = take(type === 4 ? 4 : 16), port = byte() << 8 | byte();
    const addr = type === 4 ? bytes.join('.') : type === 6 ? ipv6Text(bytes) : uuidText(bytes) + '.local';
    // standard host priority, decreasing in the order the other side ranked them
    cands.push('a=candidate:' + (k + 1) + ' 1 udp ' + (2122260223 - k * 256) + ' ' + addr + ' ' + port + ' typ host generation 0');
  }
  if (!/^[\x21-\x7e]{4,256}$/.test(ufrag + pwd) || !/^[\w-]{1,32}$/.test(mid)) throw new Error('bad');
  const sdp = ['v=0', 'o=- ' + Date.now() + ' 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE ' + mid, 'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...cands, 'a=end-of-candidates',
    'a=ice-ufrag:' + ufrag, 'a=ice-pwd:' + pwd, 'a=ice-options:trickle', 'a=fingerprint:sha-256 ' + fp,
    'a=setup:' + (kind === OFFER ? 'actpass' : 'active'), 'a=mid:' + mid, 'a=sctp-port:5000', 'a=max-message-size:262144', ''].join('\r\n');
  return { kind, sdp, candidates: n };
}

/* ---------- small helpers ---------- */
const hex = s => s.match(/../g).map(h => parseInt(h, 16));
const uuidText = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('').replace(/^(.{8})(.{4})(.{4})(.{4})/, '$1-$2-$3-$4-');
function ipv6(text) {
  const [l, r = ''] = text.split('::');
  const part = s => s ? s.split(':') : [];
  const a = part(l), z = part(r);
  if (!text.includes('::') && a.length !== 8) return null;
  const groups = [...a, ...Array(8 - a.length - z.length).fill('0'), ...z];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.flatMap(g => { const v = parseInt(g, 16); return [v >> 8, v & 255]; });
}
const ipv6Text = b => Array.from({ length: 8 }, (_, k) => ((b[2 * k] << 8) | b[2 * k + 1]).toString(16)).join(':');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function base32(bytes) {
  let out = '', bits = 0, v = 0;
  for (const x of bytes) { v = v << 8 | x; bits += 8; while (bits >= 5) { out += B32[v >>> (bits - 5) & 31]; bits -= 5; } }
  return bits ? out + B32[v << (5 - bits) & 31] : out;
}
function unbase32(s) {
  const out = [];
  let bits = 0, v = 0;
  for (const c of String(s).toUpperCase().replace(/[\s=]/g, '')) {
    const d = B32.indexOf(c);
    if (d < 0) throw new Error('chars');
    v = (v << 5 | d) & 0xfff; bits += 5;
    if (bits >= 8) { out.push(v >>> (bits - 8) & 255); bits -= 8; }
  }
  return out;
}
