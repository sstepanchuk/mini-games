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
// addresses to WebRTC instead of hidden mDNS names, which makes a link between two phones more likely. While the page
// is hidden it may be paused (owner, decision 34: invite.js says when): the tracks stop, the video stays, and resume()
// asks for the camera again; a read() under way waits meanwhile. A camera that ends by itself (unplugged, the
// permission taken back, another app took it) is asked for once more; a second time, onlost() (the code can still be
// pasted).
const safeScan = (scan, image) => { try { return scan(image); } catch (e) { return null; } };

export class Camera {
  constructor(video) {
    Object.assign(this, { video, stream: null, detect: null, stopped: false, paused: false, asking: false, again: false, lost: 0, run: null, onlost: null });
  }
  // on, or off only for a while (paused, or being asked for again)
  get running() { return !this.stopped && !!(this.stream || this.paused || this.again); }
  async start() {
    if (this.stream) return true;
    let stream;
    this.asking = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 } }, audio: false });
    } catch (e) { return false; }                      // no camera, or not allowed: the code can still be pasted
    finally { this.asking = false; }
    if (this.stopped || this.paused) { for (const t of stream.getTracks()) t.stop(); return false; }   // closed (or hidden) while it was starting
    // (asked again meanwhile, hidden and shown while the browser answered: one stream runs, a second one would stay on)
    if (this.stream) { for (const t of stream.getTracks()) t.stop(); return true; }
    this.stream = stream;
    for (const t of stream.getVideoTracks()) {
      t.addEventListener('ended', () => this.ended(stream));
      t.addEventListener('unmute', () => this.play());  // (WebKit may leave the preview paused when the camera comes back)
    }
    this.video.srcObject = this.stream;
    this.video.muted = true; this.video.playsInline = true;
    await this.play();
    return true;
  }
  async play() { try { await this.video.play(); } catch (e) {} }
  // the page hidden: the camera off, the video kept (a camera that does not run is not asked for again)
  pause() {
    if (this.stopped || this.paused || !(this.stream || this.asking)) return;
    this.paused = true;
    this.release();
  }
  // the page shown again → whether the camera runs
  async resume() {
    if (this.stopped || !this.paused) return !!this.stream;
    this.paused = false;
    return this.start();
  }
  // a track ended without us (stop and pause end none: they stop the tracks, which says nothing)
  async ended(stream) {
    if (this.stopped || this.paused || this.stream !== stream) return;
    this.release();
    this.again = this.lost++ < 1;
    const back = this.again && await this.start();
    this.again = false;
    if (!back && !this.stopped && !this.paused && this.onlost) this.onlost();
  }
  // resolves with the first QR text that test(text) accepts; a newer read() or stop() ends it with null (and so does
  // a camera that is gone for good)
  async read(test) {
    const run = this.run = {}, { detect, native } = await this.detector();
    const c = native ? null : document.createElement('canvas'), g = c && c.getContext('2d', { willReadFrequently: true });
    while (this.run === run && this.running) {
      await new Promise(r => setTimeout(r, 160));
      const v = this.video, w = v.videoWidth, h = v.videoHeight;
      if (!this.stream || !w || !h || this.run !== run) continue;
      let text = null;
      if (native) text = await detect(v).catch(() => null);   // the browser reads the video itself
      else {
        const k = Math.min(1, 640 / Math.max(w, h)), cw = Math.round(w * k), ch = Math.round(h * k);
        if (c.width !== cw || c.height !== ch) { c.width = cw; c.height = ch; }
        g.drawImage(v, 0, 0, cw, ch);
        text = safeScan(detect, g.getImageData(0, 0, cw, ch));
      }
      if (text && this.run === run && test(text)) { this.run = null; return text; }
    }
    return null;
  }
  // → { detect, native }: the browser's own QR reader where there is one, else jsQR (from the offline copy too)
  async detector() {
    if (this.detect) return this.detect;
    if ('BarcodeDetector' in window) {
      try {
        if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
          const d = new BarcodeDetector({ formats: ['qr_code'] });
          return this.detect = { native: true, detect: async v => (await d.detect(v))[0]?.rawValue || null };
        }
      } catch (e) {}
    }
    const { scan } = await import(new URL('lib/qr-scan.js', root).href);
    return this.detect = { native: false, detect: scan };
  }
  release() {
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.stream = null; this.video.srcObject = null;
  }
  stop() {
    this.run = null; this.stopped = true; this.paused = false;
    this.release();
  }
}
