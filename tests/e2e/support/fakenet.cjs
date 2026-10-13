// A fake network for one library page, installed before any of its code runs: page.addInitScript(fakeNet(pid, opt)).
// - The brokers are fake: a BroadcastChannel between the pages of one browser (pages in another browser, i.e. another
//   device, never hear them; a subscription takes MQTT's wildcards, + and #). The internet probe (a WebSocket to a
//   broker) answers as the brokers would.
// - The direct links are real WebRTC data channels, wrapped so that they can be impaired, silenced or cut.
// By default nothing is impaired and every send goes out at once, inside the call (so a goodbye sent while a page
// closes does get out), and the brokers deliver after brokerMs (25).
//
// On the page's window, at any time:
//   __net(on)       the whole network. Off: the brokers drop and cannot reconnect, direct links go silent both ways,
//                   navigator.onLine is false, 'offline' fires. On: all back, 'online' fires.
//   __brokers(on)   only the brokers (and the probe); navigator.onLine stays true (a hotspot without mobile data)
//   __switch(ms)    a network switch (Wi-Fi to mobile): the brokers drop and come back at once on the new network; the
//                   direct links go silent and, ms (5000) later, fail for good (the old address is gone)
//   __killDc()      the phone's OS dropped the direct links
//   __hide(on)      the phone locked / the browser in the background: the page and its frames hidden
//   __imp = { lat, jit, loss, hiccup }   everything going out of this page is impaired:
//                   lat, jit  ms: each message waits lat + random(0..jit)
//                   loss      0..1: 'fast' channel messages are dropped, broker messages half as often; the ordered
//                             channel retransmits instead (the message and everything behind it waits about one more
//                             round trip + 200 ms)
//                   hiccup    { every: ms, ms: ms }: now and then everything going out is held a while (Wi-Fi stalls)
//   __tx            what went out, per path and message type: { 'dc-ctl lib-g:mv': { n, b }, … } ('d' batches count
//                   each message inside, plus one '(batch)' line per packet on the wire; a sealed broker packet by what
//                   it carries, read as Web Crypto sealed it; one sealed at once, a page's last words: '(sealed)')
//   __wire          what went out on the wire, per path: { 'dc-ctl': characters, … } (each packet once)
//   __open(s)       a packet this page sent to the brokers (its JSON) → its message with f and q, as sealed (or as it is)
//
// opt: { imp, relayOnly: no WebRTC at all, brokers: false = no internet from the start (nearby still works), brokerMs }
'use strict';

// runs in the page (serialized: it may use nothing from this module)
function install({ pid, imp = {}, relayOnly = false, brokers = true, brokerMs = 25 }) {
  window.__pid = pid; window.__imp = imp;
  let up = true, brokersUp = brokers, dcUp = true, holdUntil = 0;
  const clients = new Set(), pcs = new Set(), now = () => performance.now(), I = () => window.__imp || {};
  const reach = () => up && brokersUp;
  setInterval(() => { const h = I().hiccup; if (h && Math.random() < 100 / h.every) holdUntil = now() + h.ms * (0.5 + Math.random()); }, 100);
  const delayOf = () => { const i = I(); let d = (i.lat || 0) + Math.random() * (i.jit || 0); if (holdUntil > now()) d = Math.max(d, holdUntil - now() + (i.lat || 0)); return d; };

  // The brokers' packets are sealed ({"s", "f", "q"}: library/net/seal.js). What one of this page's carries is read where
  // Web Crypto seals it (AES-GCM; its additional data is topic \n f \n q), so that it is counted by what it carries.
  const sealed = new Map(), TD = new TextDecoder();
  const subtle = window.SubtleCrypto && SubtleCrypto.prototype, encrypt = subtle && subtle.encrypt;
  if (encrypt) subtle.encrypt = function (alg, key, data) {
    try {
      if (alg && alg.name === 'AES-GCM' && alg.additionalData) {
        const [, f, q] = TD.decode(alg.additionalData).split('\n');
        sealed.set(f + ' ' + q, TD.decode(data));
        if (sealed.size > 4096) sealed.delete(sealed.keys().next().value);
      }
    } catch (e) {}
    return encrypt.call(this, alg, key, data);
  };
  // a packet that went out (its JSON) → its message, with f and q (sealed by this page: opened), or the packet itself
  const open = window.__open = s => {
    let m = null;
    try { m = JSON.parse(s); } catch (e) { return null; }
    const p = m && typeof m.s === 'string' && sealed.get(m.f + ' ' + m.q);
    if (p) { try { return { ...JSON.parse(p), f: m.f, q: m.q }; } catch (e) {} }
    return m;
  };
  const tx = window.__tx = {}, wire = window.__wire = {};
  const count = (k, b) => { const e = tx[k] || (tx[k] = { n: 0, b: 0 }); e.n++; e.b += b; };
  const kind = x => !x || typeof x !== 'object' ? '?' : typeof x.t !== 'string' && typeof x.s === 'string' ? '(sealed)' :
    x.t + (x._x ? '*' : '') + (x.t === 'lib-g' && x.m ? ':' + x.m.t : '');
  const tally = (path, s) => {
    wire[path] = (wire[path] || 0) + s.length;
    const m = open(s);
    if (m && m.t === 'd' && Array.isArray(m.d)) { for (const x of m.d) count(path + ' ' + kind(x), JSON.stringify(x).length); count(path + ' (batch)', s.length); }
    else count(path + ' ' + kind(m), s.length);
  };

  if (relayOnly) window.RTCPeerConnection = undefined;
  else {
    const PC = window.RTCPeerConnection;
    window.RTCPeerConnection = function (...a) { const pc = new PC(...a); pcs.add(pc); return pc; };
    window.RTCPeerConnection.prototype = PC.prototype;
  }
  const closeLinks = () => { for (const pc of pcs) try { pc.close(); } catch (e) {} pcs.clear(); };
  const dropBrokers = () => { for (const c of [...clients]) c._drop(); };
  window.__switch = (ms = 5000) => { dropBrokers(); dcUp = false; setTimeout(() => { closeLinks(); dcUp = true; }, ms); };
  window.__killDc = closeLinks;
  window.__hide = v => {
    for (const w of [window, ...Array.from(document.querySelectorAll('iframe'), f => f.contentWindow)]) {
      try {
        Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => v ? 'hidden' : 'visible' });
        Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => v });
        w.document.dispatchEvent(new Event('visibilitychange'));
      } catch (e) {}
    }
  };
  window.__net = on => {
    up = on;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => up });
    if (!on) dropBrokers();
    dispatchEvent(new Event(on ? 'online' : 'offline'));
  };
  window.__brokers = on => { brokersUp = on; if (!on) dropBrokers(); };

  if (window.RTCDataChannel) {
    const send = RTCDataChannel.prototype.send;
    RTCDataChannel.prototype.send = function (d) {
      if (!(up && dcUp)) return;
      tally('dc-' + this.label, d);
      const i = I();
      let ms = delayOf();
      if (this.ordered) {                                // reliable, in order: a loss costs a retransmit for everything behind it
        if (Math.random() < (i.loss || 0)) ms += 2 * (i.lat || 0) + 200;
        ms = Math.max(ms, (this.__last || 0) - now());
        this.__last = now() + ms;
      } else if (Math.random() < (i.loss || 0)) return;
      if (ms <= 0) return send.call(this, d);
      setTimeout(() => { if (up && dcUp && this.readyState === 'open') try { send.call(this, d); } catch (e) {} }, ms);
    };
    const desc = Object.getOwnPropertyDescriptor(RTCDataChannel.prototype, 'onmessage');
    Object.defineProperty(RTCDataChannel.prototype, 'onmessage', { configurable: true, get() { return desc.get.call(this); },
      set(fn) { desc.set.call(this, fn && (e => { if (up && dcUp) fn.call(this, e); })); } });
  }

  window.WebSocket = function () {
    const s = { close() {} };
    setTimeout(() => reach() ? s.onopen && s.onopen() : s.onerror && s.onerror(), 50);
    return s;
  };
  // whether a subscription to sub gets topic t (MQTT: '+' is one level, '#' at the end any number of them)
  const matches = (sub, t) => {
    if (!sub.includes('+') && !sub.includes('#')) return false;
    const a = sub.split('/'), b = t.split('/');
    for (let i = 0; i < a.length; i++) {
      if (a[i] === '#') return true;
      if (i >= b.length || (a[i] !== '+' && a[i] !== b[i])) return false;
    }
    return a.length === b.length;
  };
  window.mqtt = { connect(url) {
    const H = {}, subs = new Set(), bc = new BroadcastChannel('fake-mqtt');
    const hears = t => subs.has(t) || [...subs].some(x => matches(x, t));   // (exactly, or by MQTT's wildcards)
    let alive = true, last = 0;
    const emit = (ev, ...a) => (H[ev] || []).forEach(f => f(...a));
    const deliver = (t, s) => setTimeout(() => { if (alive) emit('message', t, s); }, brokerMs);
    const out = (t, s) => { if (!alive || !reach()) return; bc.postMessage({ t, s, url }); if (hears(t)) deliver(t, s); };
    const c = {
      on(ev, f) { (H[ev] = H[ev] || []).push(f); return c; },
      subscribe(t, o, cb) { subs.add(t); setTimeout(() => cb && cb(null), 5); },
      unsubscribe(t) { subs.delete(t); },
      publish(t, s) {
        if (!alive || !reach()) return;
        tally(t.includes('/d/') ? 'mqtt-mail' : 'mqtt-room', s);
        if (Math.random() < (I().loss || 0) / 2) return; // (TCP to the broker: losses are rarer, but brokers do drop)
        const ms = Math.max(delayOf(), last - now());   // in order
        if (ms <= 0) return out(t, s);
        last = now() + ms;
        setTimeout(() => out(t, s), ms);
      },
      end() { alive = false; clients.delete(c); try { bc.close(); } catch (e) {} },
      _drop() { if (!alive) return; c.end(); setTimeout(() => emit('close'), 300); }
    };
    bc.onmessage = e => { if (alive && reach() && e.data.url === url && hears(e.data.t)) deliver(e.data.t, e.data.s); };
    clients.add(c);
    setTimeout(() => { if (alive && reach()) emit('connect'); else { c.end(); emit('close'); } }, 40);
    return c;
  } };
}

// the init script for one page; pid: the first part of its session id (window.__pid, see library/net/config.js)
function fakeNet(pid, opt = {}) {
  if (!/^[a-z0-9]{4,32}$/.test(pid)) throw new Error('fakeNet: pid must be 4 to 32 of [a-z0-9]: ' + pid);
  return '(' + install + ')(' + JSON.stringify({ ...opt, pid }) + ');';
}

module.exports = { fakeNet };
