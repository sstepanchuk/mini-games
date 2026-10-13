// The network of one worker tab (tab.js): fake MQTT brokers over a BroadcastChannel that the tabs of one world
// share (world.js), as tests/e2e/support/fakenet.cjs does for browser pages. Direct links are fakertc.js (when
// the world has them; without, rooms go through the brokers only, the path every room falls back to).
//
// The bus carries { t: topic, s: payload, url: broker } from each tab to every other; a tab hands it to its own
// connection to that broker if it listens to the topic (exactly, or by MQTT's wildcards: + one level, # the rest),
// brokerMs later. Like a real broker, a tab's own messages
// come back to it on topics it listens to (the room's topic; nobody listens to their own outgoing mailbox).
// By default nothing is impaired, and a publish goes out at once, inside the call (so a goodbye sent just before
// a tab is killed does get out).
//
// set(opts) switches, any subset, at any time:
//   up        the whole network. Off: the brokers drop and cannot reconnect, direct links go silent, navigator.onLine
//             is false, 'offline' fires. On: 'online' fires (the room checks its brokers), and they connect again.
//   direct    false: the direct links (fakertc.js) go silent both ways, as on a network switch before they fail
//   brokers   which brokers we reach: true, false, or one boolean per broker (in config.js BROKERS order)
//   send      false: whatever we publish is lost, though the connections stay up (an outage one way)
//   hear      false: whatever the brokers bring us is lost
//   lat, jit  ms: each publish waits lat + random(0..jit), in order per connection
//   loss      0..1: each publish is lost with this chance (and each message on a direct link's 'fast' channel)
//   maxBytes  a publish longer than this (UTF-8) is refused by the broker: lost
// Counters: sent (publishes that went out), lost (dropped by a switch above), big (refused by maxBytes).

const TE = new TextEncoder();
// whether a subscription to `sub` gets topic t (MQTT: '+' is one level, '#' at the end any number of them)
function matches(sub, t) {
  if (sub === t) return true;
  if (!sub.includes('+') && !sub.includes('#')) return false;
  const a = sub.split('/'), b = t.split('/');
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '#') return true;
    if (i >= b.length || (a[i] !== '+' && a[i] !== b[i])) return false;
  }
  return a.length === b.length;
}
const listens = (c, t) => { for (const sub of c.subs) if (matches(sub, t)) return true; return false; };

/**
 * Install window.mqtt (and a WebSocket for hasInternet) on this worker's global.
 *   bus        the world's BroadcastChannel name
 *   urls       the brokers' URLs, in config.js order
 *   brokerMs   how long a broker takes to pass a message on
 *   emit(type) fires a window event ('online' / 'offline')
 * → { set(opts), state(), urls, up, direct (whether direct links work now), loss }
 */
export function install({ bus, urls, brokerMs = 25, emit, ...opts }) {
  const sw = { up: true, brokers: true, direct: true, send: true, hear: true, lat: 0, jit: 0, loss: 0, maxBytes: Infinity };
  const count = { sent: 0, lost: 0, big: 0 };
  const clients = new Set(), now = () => performance.now();
  const reach = url => sw.up && (Array.isArray(sw.brokers) ? !!sw.brokers[urls.indexOf(url)] : !!sw.brokers);
  const ch = new BroadcastChannel(bus);

  // to our own connections to that broker that listen to the topic
  const arrive = (url, t, s) => {
    for (const c of clients) if (c.url === url && listens(c, t)) setTimeout(() => c.hear(t, s), brokerMs);
  };
  ch.onmessage = e => { const { t, s, url } = e.data || {}; if (typeof s === 'string') arrive(url, t, s); };

  function connect(url) {
    const H = {};
    let alive = true, last = 0;
    const emitC = (ev, ...a) => { for (const f of H[ev] || []) f(...a); };
    const out = (t, s) => {
      if (!alive || !reach(url)) return;
      count.sent++;
      ch.postMessage({ t, s, url });
      arrive(url, t, s);
    };
    const c = {
      url, subs: new Set(),
      on(ev, f) { (H[ev] = H[ev] || []).push(f); return c; },
      subscribe(t, o, cb) { c.subs.add(t); setTimeout(() => cb && cb(null), 5); },
      unsubscribe(t) { c.subs.delete(t); },
      publish(t, s) {
        if (!alive || !reach(url)) return;
        if (!sw.send || Math.random() < sw.loss) { count.lost++; return; }
        if (TE.encode(s).length > sw.maxBytes) { count.big++; return; }
        const ms = Math.max(sw.lat + Math.random() * sw.jit, last - now());   // in order
        if (ms <= 0) return out(t, s);
        last = now() + ms;
        setTimeout(() => out(t, s), ms);
      },
      end() { alive = false; clients.delete(c); },
      hear(t, s) { if (alive && sw.hear && reach(url) && listens(c, t)) emitC('message', t, TE.encode(s)); },
      drop() { if (!alive) return; c.end(); setTimeout(() => emitC('close'), 300); }
    };
    clients.add(c);
    setTimeout(() => { if (alive && reach(url)) emitC('connect'); else { c.end(); emitC('close'); } }, 40);
    return c;
  }

  globalThis.mqtt = { connect };
  // hasInternet (brokers.js) opens a WebSocket to each broker: it opens while that broker is reachable
  globalThis.WebSocket = function (url) {
    const s = { close() {} };
    setTimeout(() => (reach(url) ? s.onopen && s.onopen() : s.onerror && s.onerror()), 20);
    return s;
  };

  function set(o) {
    const wasUp = sw.up;
    for (const k of Object.keys(o)) if (!(k in sw)) throw new Error('fakenet: no switch ' + k);
    Object.assign(sw, o);
    for (const c of [...clients]) if (!reach(c.url)) c.drop();
    if (sw.up !== wasUp) emit(sw.up ? 'online' : 'offline');
  }
  set(opts);
  return { set, state: () => ({ ...sw, ...count, connected: [...clients].length }), urls, get up() { return sw.up; },
    get direct() { return sw.up && sw.direct; }, get loss() { return sw.loss; } };
}
