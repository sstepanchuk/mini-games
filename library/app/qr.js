// QR codes: drawing one, and reading one with the camera.
import { encode } from 'uqr';
import { root } from './dom.js';

// draw text as a QR code filling a square canvas of `px` CSS pixels (with a white quiet zone)
export function drawQr(canvas, text, px = 260) {
  const { data, size } = encode(text, { ecc: 'M', border: 2 });
  const dpr = Math.min(3, window.devicePixelRatio || 1), cell = Math.floor(px * dpr / size);
  canvas.dataset.code = text;                            // also readable without a camera (tests, copy)
  canvas.width = canvas.height = cell * size;
  canvas.style.width = canvas.style.height = cell * size / dpr + 'px';
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) g.fillRect(x * cell, y * cell, cell, cell);
}

// The camera, kept on for the whole pairing: while it runs, browsers also reveal this device's real local
// addresses to WebRTC instead of hidden mDNS names, which makes a link between two phones more likely.
export class Camera {
  constructor(video) { this.video = video; this.stream = null; this.detect = null; this.stopped = false; this.started = null; }
  // facing: 'user' (front) or 'environment' (back); → true if the camera runs (one request, however many callers)
  start(facing = 'environment') {
    this.facing = facing;
    return this.started || (this.started = this.open(facing));
  }
  async open(facing) {
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 1280 } }, audio: false });
    } catch (e) { return false; }                      // no camera, or not allowed: the code can still be pasted
    if (this.stopped) { for (const t of stream.getTracks()) t.stop(); return false; }   // closed while the camera was starting
    this.stream = stream;
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    this.video.classList.toggle('mirror', facing === 'user');   // the front camera is shown as a mirror, as people expect
    try { await this.video.play(); } catch (e) {}
    return true;
  }
  // resolves with the first QR text that test(text) accepts; stop() ends it with null
  async read(test) {
    const detect = await this.detector();
    const c = document.createElement('canvas'), g = c.getContext('2d', { willReadFrequently: true });
    this.reading = true;
    while (this.reading && this.stream) {
      await new Promise(r => setTimeout(r, 160));
      const v = this.video, w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) continue;
      const k = Math.min(1, 640 / Math.max(w, h)), cw = Math.round(w * k), chh = Math.round(h * k);
      if (c.width !== cw || c.height !== chh) { c.width = cw; c.height = chh; }
      g.drawImage(v, 0, 0, c.width, c.height);
      let text = null;
      try { text = await detect(c, g); } catch (e) {}
      if (text && test(text)) { this.reading = false; return text; }
    }
    return null;
  }
  async detector() {
    if (this.detect) return this.detect;
    if ('BarcodeDetector' in window) {
      try {
        if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
          const d = new BarcodeDetector({ formats: ['qr_code'] });
          return this.detect = async c => (await d.detect(c))[0]?.rawValue || null;
        }
      } catch (e) {}
    }
    const { scan } = await import(new URL('lib/qr-scan.js', root).href);
    return this.detect = (c, g) => scan(g.getImageData(0, 0, c.width, c.height));
  }
  stop() {
    this.reading = false; this.stopped = true;
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.video.srcObject = null;
  }
}
