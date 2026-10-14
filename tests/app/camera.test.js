// The camera of nearby pairing (library/app/qr.js Camera; owner, decision 34: off while the page is hidden, on again when
// it is back), in Node with a camera whose answers the test holds: whatever order the browser answers in, and however
// often the page is hidden and shown while it asks, at most one camera stream is live, none once the camera stops.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera } from '../../library/app/qr.js';

// a camera that answers when told: ask() → the asks not answered yet; answer(i) → that one's stream (a live track)
function camera() {
  const asks = [], tracks = [];
  const stream = () => {
    const t = { live: true, stop() { this.live = false; }, addEventListener() {} };
    tracks.push(t);
    return { getTracks: () => [t], getVideoTracks: () => [t] };
  };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(r => asks.push(r)) } } });
  const settle = () => new Promise(r => setImmediate(r));
  return { asks, live: () => tracks.filter(t => t.live).length, answer: async i => { asks[i](stream()); await settle(); await settle(); } };
}
const video = () => ({ srcObject: null, muted: false, playsInline: false, play: async () => {} });

test('hidden, shown, hidden and shown again while the camera is still being asked for: one stream live, none once stopped', async () => {
  const cam = camera(), c = new Camera(video());
  const on = c.start();
  await cam.answer(0);
  assert.equal(await on, true);
  assert.equal(cam.live(), 1);
  c.pause();                                               // hidden
  assert.equal(cam.live(), 0);
  const r1 = c.resume();                                   // shown: asked again…
  c.pause();                                               // …hidden before the answer…
  const r2 = c.resume();                                   // …and shown again: asked once more
  assert.equal(cam.asks.length, 3);
  await cam.answer(1);
  await cam.answer(2);
  await Promise.all([r1, r2]);
  assert.equal(cam.live(), 1, 'one camera stream, not two (the other would stay on, the camera\'s light too)');
  assert.ok(c.running);
  c.stop();
  assert.equal(cam.live(), 0, 'stopped: none live');
});

test('…and the answers in the other order, or the page hidden again before either: never a stream while hidden', async () => {
  const cam = camera(), c = new Camera(video());
  const on = c.start();
  await cam.answer(0);
  await on;
  c.pause();
  const r1 = c.resume();
  c.pause();
  const r2 = c.resume();
  await cam.answer(2);                                     // the later ask answers first
  await cam.answer(1);
  await Promise.all([r1, r2]);
  assert.equal(cam.live(), 1);
  c.pause();                                               // hidden: off
  assert.equal(cam.live(), 0);
  const r3 = c.resume();
  c.pause();                                               // hidden again while asked
  await cam.answer(3);
  await r3;
  assert.equal(cam.live(), 0, 'hidden: no stream');
  c.stop();
  assert.equal(cam.live(), 0);
});
