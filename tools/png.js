// PNG images from pixels, with nothing but zlib: the cover a new game starts with (cli.js new), test fixtures, and
// what the build needs to know of a cover (its size, and whether it is still that placeholder).
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

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// the rows of a w×h 8-bit RGB image as a PNG keeps them (what its IDAT inflates to); pixel(x, y) → [r, g, b] (0..255)
function rows(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0, o = 0; y < h; y++) {
    raw[o++] = 0;                                        // (no filter)
    for (let x = 0; x < w; x++) { const [r, g, b] = pixel(x, y); raw[o++] = r; raw[o++] = g; raw[o++] = b; }
  }
  return raw;
}

// w×h, 8-bit RGB; pixel(x, y) → [r, g, b] (0..255)
export function png(w, h, pixel) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2;                              // 8 bits per channel, RGB (compression, filter, interlace: 0)
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows(w, h, pixel), { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// → { w, h, data } (data: its IDAT chunks, together and inflated), or null when buf is not a PNG
export function pngInfo(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) return null;
  let w = 0, h = 0;
  const idat = [];
  for (let o = 8; o + 12 <= buf.length;) {
    const n = buf.readUInt32BE(o), type = buf.toString('latin1', o + 4, o + 8), data = buf.subarray(o + 8, o + 8 + n);
    if (data.length < n) return null;                    // (cut short)
    if (type === 'IHDR' && n >= 8) { w = data.readUInt32BE(0); h = data.readUInt32BE(4); }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    o += 12 + n;
  }
  if (!w || !h || !idat.length) return null;
  try { return { w, h, data: zlib.inflateSync(Buffer.concat(idat)) }; } catch (e) { return null; }
}

// '#e4e2f0' (or '#abc') → [r, g, b]
export const rgb = hex => { const h = hex.replace('#', ''), f = h.length < 6 ? [...h.slice(0, 3)].map(c => c + c).join('') : h.slice(0, 6); return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16)); };

// A placeholder cover, 1200×630 unless told (the size of a link preview): an unfinished poster of the library's series
// («Великі цифри»): the paper panel at the left with its thick black bar (the number and the title are not there yet), the
// theme colour at the right, a little darker towards the bottom, with the three shapes in white (a square, a circle, a
// triangle). Replace it with a picture of the game before it goes on the shelf.
const THEME = '#eee7d7';                                 // (game.json without "theme")
export const cover = (theme = THEME, w = 1200, h = 630) => png(w, h, coverPixel(theme, w, h));

// buf is still that placeholder: made for no theme, or for this one (a theme put into game.json later). Its pixels are
// compared, not its bytes: zlib may pack the same pixels differently on another machine. A placeholder an older `cli new`
// made (four rounded tiles, the old default theme) still counts: a game added before this look is noticed too.
const OLD_THEME = '#e4e2f0';
export function isPlaceholder(buf, theme) {
  const info = pngInfo(buf), [w, h] = [1200, 630];
  if (!info || info.w !== w || info.h !== h) return false;
  const themes = [...new Set([THEME, OLD_THEME, theme || THEME])];
  return [coverPixel, oldCoverPixel].some(px => themes.some(t => info.data.equals(rows(w, h, px(t, w, h)))));
}

// the placeholder's pixel(x, y) → [r, g, b]
function coverPixel(theme, w, h) {
  const [r, g, b] = rgb(theme), dark = (v, k) => Math.round(v * k), INK = [27, 26, 23], WHITE = [255, 255, 255], PAPER = rgb(THEME);
  const PANEL = Math.round(w * .49), M = Math.round(w * .043), BAR = [Math.round(h * .73), Math.round(h * .768)];
  const T = Math.round(w / 12), GAP = Math.round(w / 40), X0 = PANEL + Math.round((w - PANEL - 3 * T - 2 * GAP) / 2), Y0 = Math.round((h - T) / 2);
  const inShape = (x, y) => {
    if (y < Y0 || y >= Y0 + T) return false;
    const i = Math.floor((x - X0) / (T + GAP)), tx = x - X0 - i * (T + GAP), ty = y - Y0;
    if (i < 0 || i > 2 || tx >= T) return false;
    if (i === 0) return true;                                                   // the square
    if (i === 1) return (tx - T / 2 + .5) ** 2 + (ty - T / 2 + .5) ** 2 <= T * T / 4;   // the circle
    return Math.abs(tx - T / 2 + .5) <= (ty + .5) / 2;                           // the triangle
  };
  return (x, y) => {
    if (x < PANEL) return x >= M && x < PANEL - M && y >= BAR[0] && y < BAR[1] ? INK : PAPER;
    if (inShape(x, y)) return WHITE;
    const k = 1 - 0.12 * y / h;
    return [dark(r, k), dark(g, k), dark(b, k)];
  };
}

// the placeholder of the look before (a row of four rounded white tiles on the theme colour): only to recognise it
function oldCoverPixel(theme, w, h) {
  const [r, g, b] = rgb(theme), dark = (v, k) => Math.round(v * k);
  const T = Math.round(w / 8), GAP = Math.round(w / 30), X0 = Math.round((w - 4 * T - 3 * GAP) / 2), Y0 = Math.round((h - T) / 2), R = Math.round(T * 0.19);
  const inTile = (x, y) => {
    if (y < Y0 || y >= Y0 + T) return false;
    const i = Math.floor((x - X0) / (T + GAP)), tx = x - X0 - i * (T + GAP), ty = y - Y0;
    if (i < 0 || i > 3 || tx >= T) return false;
    const cx = Math.min(Math.max(tx, R), T - R), cy = Math.min(Math.max(ty, R), T - R);
    return (tx - cx) ** 2 + (ty - cy) ** 2 <= R * R;
  };
  return (x, y) => {
    if (inTile(x, y)) return [255, 255, 255];
    const k = 1 - 0.12 * y / h;
    return [dark(r, k), dark(g, k), dark(b, k)];
  };
}
