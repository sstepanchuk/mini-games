// devnet: a fake network for the dev server, so that playing together works without internet (and without the public
// brokers) between the tabs of one browser. Only dev.js puts it into a page, and only when asked: `npm run dev --
// --devnet` (every library page), or `?devnet` in the address (that browser from then on, by a session cookie;
// `?devnet=0` turns it off). Never in a build: tests/devnet.test.js checks the assembled site.
// What it replaces, before the library's code runs (as tests/e2e/support/fakenet.cjs does for the browser scenarios):
// - the MQTT client (library/net/brokers.js takes window.mqtt when there is one): every "broker" is a BroadcastChannel
//   between the pages of this browser, so internet rooms (links, codes) work across its tabs;
// - the internet probe (brokers.js hasInternet: a WebSocket to a broker, wss://) opens at once, and navigator.onLine
//   says true: the "Грати разом" dialog offers a link even with the cable out;
// direct links stay real WebRTC (between tabs of one computer they usually connect; when not, the room keeps to its
// brokers, as it would). Nearby (QR codes) needs nothing of this. A small «devnet» tag in the corner says it is on.
/* global window, document */                          // (what runs in the page)
export const DEVNET_TAG = 'ihroteka-devnet';             // the channel, the cookie, and what tests look for

// runs in the page (serialized: it may use nothing from this module)
function install(TAG) {
  // (a page that has an MQTT client before its own code runs has a fake network already: a browser scenario's,
  // tests/e2e/support/fakenet.cjs, against a dev server started with --devnet. It keeps that one: it drives it.)
  if (window.__devnet || window.mqtt) return;
  window.__devnet = true;
  const WS = window.WebSocket;
  window.WebSocket = function (url, protocols) {
    if (!/^wss:\/\//.test(String(url))) return new WS(url, protocols);
    const s = { readyState: 0, url: String(url), close() { s.readyState = 3; }, send() {} };
    setTimeout(() => { if (s.readyState === 0) { s.readyState = 1; if (s.onopen) s.onopen({}); } }, 20);
    return s;
  };
  Object.assign(window.WebSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3, prototype: WS.prototype });
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
  window.mqtt = { connect(url) {
    const H = {}, subs = new Set(), bc = new BroadcastChannel(TAG);
    let alive = true;
    const emit = (ev, ...a) => (H[ev] || []).forEach(f => f(...a));
    const deliver = (t, s) => setTimeout(() => { if (alive && subs.has(t)) emit('message', t, s); }, 10);
    const c = {
      on(ev, f) { (H[ev] = H[ev] || []).push(f); return c; },
      subscribe(t, o, cb) { subs.add(t); setTimeout(() => cb && cb(null), 5); },
      unsubscribe(t) { subs.delete(t); },
      publish(t, s) { if (!alive) return; bc.postMessage({ t, s, url }); deliver(t, s); },   // (a broker echoes our own too)
      end() { if (!alive) return; alive = false; try { bc.close(); } catch (e) {} }
    };
    bc.onmessage = e => { if (alive && e.data && e.data.url === url) deliver(e.data.t, e.data.s); };
    setTimeout(() => { if (alive) emit('connect'); }, 30);
    return c;
  } };
  const tag = () => {
    const b = document.createElement('div');
    b.id = TAG; b.textContent = 'devnet'; b.title = 'A fake network between the tabs of this browser (tools/devnet.js)';
    b.style.cssText = 'position:fixed;left:4px;bottom:4px;z-index:2147483647;font:11px/1.4 monospace;padding:0 5px;border-radius:4px;background:#5b4bd6;color:#fff;opacity:.8;pointer-events:none';
    document.body.append(b);
  };
  if (document.body) tag(); else document.addEventListener('DOMContentLoaded', tag);
  console.info('devnet: no real brokers here; rooms link the tabs of this browser (tools/devnet.js)');
}

// the <script> for a page's <head>
export const devnetScript = () => '<script>(' + install + ')(' + JSON.stringify(DEVNET_TAG) + ');</script>';

// From a request to the dev server: whether its page gets devnet, and the cookie to set ({ on, cookie }).
// always: the server was started with --devnet.
export function devnetFor(req, always) {
  const q = new URL(req.url, 'http://x').searchParams, asked = q.get('devnet');
  const had = (req.headers.cookie || '').split(/;\s*/).includes(DEVNET_TAG + '=1');
  if (asked === '0') return { on: always, cookie: had ? DEVNET_TAG + '=; Path=/; Max-Age=0; SameSite=Strict' : null };
  if (asked !== null) return { on: true, cookie: had ? null : DEVNET_TAG + '=1; Path=/; SameSite=Strict' };
  return { on: always || had, cookie: null };
}
