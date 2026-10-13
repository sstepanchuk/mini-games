// PNG images from pixels, with nothing but zlib: the cover a new game starts with (cli.js new), and test fixtures.
import zlib from 'node:zlib';

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length), td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  out.writeUInt32BE(data.length, 0);
  td.copy(out, 4);
  out.writeUInt32BE(crc32(td), 8 + data.length);
  return out;
}

// w×h, 8-bit RGB; pixel(x, y) → [r, g, b] (0..255)
export function png(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0, o = 0; y < h; y++) {
    raw[o++] = 0;                                        // (no filter)
    for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                              // 8 bits per channel, RGB (compression, filter, interlace: 0)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// '#e4e2f0' (or '#abc') → [r, g, b]
export const rgb = hex => { const h = hex.replace('#', ''), f = h.length < 6 ? [...h.slice(0, 3)].map(c => c + c).join('') : h.slice(0, 6); return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)); };

// A placeholder cover, 1200×630 unless told (the size of a link preview): the theme colour, a little darker towards
// the bottom, with a row of four rounded tiles. Replace it with a picture of the game before it goes on the shelf.
export function cover(theme = '#e4e2f0', w = 1200, h = 630) {
  const [r, g, b] = rgb(theme), dark = (v, k) => Math.round(v * k);
  const T = Math.round(w / 8), GAP = Math.round(w / 30), X0 = Math.round((w - 4 * T - 3 * GAP) / 2), Y0 = Math.round((h - T) / 2), R = Math.round(T * 0.19);
  const inTile = (x, y) => {
    if (y < Y0 || y >= Y0 + T) return false;
    const i = Math.floor((x - X0) / (T + GAP)), tx = x - X0 - i * (T + GAP), ty = y - Y0;
    if (i < 0 || i > 3 || tx >= T) return false;
    const cx = Math.min(Math.max(tx, R), T - R), cy = Math.min(Math.max(ty, R), T - R);
    return (tx - cx) ** 2 + (ty - cy) ** 2 <= R * R;   // (the corners rounded)
  };
  return png(w, h, (x, y) => {
    if (inTile(x, y)) return [255, 255, 255];
    const k = 1 - 0.12 * y / h;
    return [dark(r, k), dark(g, k), dark(b, k)];
  });
}
