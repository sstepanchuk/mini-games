// MQTT transport: one connection per public broker, all at once. Liveness checks, backoff, sealing and opening every
// packet (seal.js), and dropping copies of a message that arrived through several brokers, or again. What messages mean
// is up to internet.js, which receives them through its mode hooks (room.js): N.onConnected(client), N.onMessage(msg,
// client), N.onDown() (a working broker dropped) and N.onLegacy(msg) (the door, below).
//
// Sealed (phase 5, J2). A message becomes JSON at the call (what the caller changes later does not travel), gets its
// number q at once (so the numbers keep the order of the calls), and is sealed in one chain per room (N.out), in that
// order; only then does it go, to whichever brokers work by then. What comes in is opened in one chain per connection
// (c._in), so one broker's packets keep their order. Before any crypto, by f and q (readable outside the seal): our own
// echo, a copy already opened through another broker, a number seen before or too old (the replay window, seal.js) are
// dropped; numbers are marked only once a packet opened. Opened, a packet still has to be a message (an object with a
// string t), and one with `to` is for that session only. Leaving the room, the connections end once that chain is out.
// The page going away (pagehide) cannot wait for Web Crypto: what the links would send through the brokers then waits
// (N.stash), and goes in the room's last words, one packet on the topic sealed at once (lastWords, seal.js sealNow), after
// what they sent before and is still being sealed (N.wait: a tab closed in sight is hidden first, and the open game's
// snapshot goes then, app/together.js; it would never go, and the link would hold what follows it, waiting for it).
//
// The door. A library before PROTO 2 meets on the plain topic of SHA-256(game:code) (seal.js legacy). Each connection
// also listens to every topic of that kind ('ihroteka/+', one wildcard for all rooms: what a broker sees of it says nothing
// about our code) and hands what comes on our room's one to N.onLegacy, plain; internet.js answers there only to such a
// page (pubLegacy), so that it says 'version' and updates itself. Nothing else of ours ever goes there.
//
// The connections are managed here rather than by the MQTT library, so behaviour is predictable:
// - each broker connects on its own; a failed one is retried later and later (up to two minutes);
// - a connection that is still being set up is never restarted (browsers report minor network changes
//   often, and restarting on each of them used to break joining a room);
// - while no broker works at all, retries are frequent: the problem is probably our own network.
import { BROKERS, MQTT_LIB, me, SENDER } from './config.js';
import { fresh, mark, newWindow, open, seal, sealNow, spare, SPARE } from './seal.js';

const SENDERS = 64;                                    // how many senders the replay windows remember (the last heard)
const LEGACY_ALL = 'ihroteka/+';                       // every room's topic of a library before PROTO 2 (the door)
const TE = new TextEncoder(), TD = new TextDecoder();
const rnd = n => Array.from({ length: n }, () => (Math.random() * 36 | 0).toString(36)).join('');
let mqttLib = null;
// This page's highest number on the brokers, across its rooms: a room's numbers start from the clock (room.js seq), and
// the same session in the same room again must not start below where it was, or whoever still remembers it would drop
// all of it as too old (the replay window, seal.js): a clock set back meanwhile (a phone's, by the network) did that.
let seqHi = 0;
const next = N => { const q = ++N.seq; if (q > seqHi) seqHi = q; return q; };
// The replay windows (N.last) live as long as the page, one set per room (topic; the last ROOMS of them): the same page
// in the same room again (the old tab of a player that takes its place back, «Повернути сюди») takes nothing again that
// it heard before, or a stranger could send it a recorded 'moved' from its host once more, and move it out again.
const ROOMS = 8, windows = new Map();
// The page is going away (pagehide; back from the back-forward cache: pageshow): the links' data for the brokers waits
// for the room's last words (lastWords). Listened to from the start, so it is set before anyone else's pagehide (the
// library's own sends the open game's last snapshot).
let going = false;
globalThis.addEventListener?.('pagehide', () => { going = true; });   // (no window in Node: tests that read the module)
globalThis.addEventListener?.('pageshow', () => { going = false; });

// The MQTT client library, loaded once from a CDN (with a fallback), checked against its pinned hash.
export function loadTransport() {
  if (window.mqtt) return Promise.resolve();
  if (mqttLib) return mqttLib;
  mqttLib = new Promise((res, rej) => {
    const tryUrl = i => {
      if (window.mqtt) return res();
      if (i >= MQTT_LIB.urls.length) { mqttLib = null; return rej(new Error('mqtt')); }
      const s = document.createElement('script');
      s.integrity = MQTT_LIB.integrity; s.crossOrigin = 'anonymous';
      s.src = MQTT_LIB.urls[i];
      s.onload = () => (window.mqtt ? res() : tryUrl(i + 1));
      s.onerror = () => tryUrl(i + 1);
      document.head.appendChild(s);
    };
    tryUrl(0);
  });
  return mqttLib;
}

// Is there internet, not just a network? navigator.onLine only knows about the network: on a hotspot without
// mobile data, or a Wi-Fi without internet, it still says online. So: can a broker be reached? → true | false,
// within ms (the first broker that answers decides; all of them failing decides at once).
export function hasInternet(ms = 3000) {
  if (navigator.onLine === false) return Promise.resolve(false);
  return new Promise(done => {
    let left = BROKERS.length;
    const end = ok => {
      clearTimeout(timer);
      for (const s of sockets) if (s) { s.onopen = s.onerror = null; try { s.close(); } catch (e) {} }
      done(ok);
    };
    const timer = setTimeout(() => end(false), ms);
    const sockets = BROKERS.map(b => {
      try {
        const s = new WebSocket(b.url, 'mqtt');
        s.onopen = () => end(true);
        s.onerror = () => { if (--left === 0) end(false); };
        return s;
      } catch (e) { if (--left === 0) setTimeout(() => end(false)); return null; }
    });
  });
}

// (N.keys, N.topic and N.legacy are set: seal.js roomKeys)
export function openBrokers(N) {
  N.br = BROKERS.map(() => ({ state: 'connecting', since: 0, fails: 0, timer: null }));
  N.clients = [];
  N.out = Promise.resolve(); N.wait = new Set();
  if (N.seq < seqHi) N.seq = seqHi;
  N.last = windows.get(N.topic) || N.last;
  windows.delete(N.topic); windows.set(N.topic, N.last);
  if (windows.size > ROOMS) windows.delete(windows.keys().next().value);
  N.door = { id: 'door' + rnd(8) + '.' + rnd(6), q: Date.now() };   // (a session of its own: see pubLegacy)
  refill(N);
  BROKERS.forEach((b, i) => openBroker(N, i));
}

// the connections end once what was sealed before (the goodbyes) has gone out
export function closeBrokers(N) {
  for (const st of N.br) { clearTimeout(st.timer); st.timer = null; }
  const cl = N.clients.slice();
  N.out.then(() => { for (const c of cl) { try { if (c) c.end(true); } catch (e) {} } });
}

function openBroker(N, i) {
  const B = BROKERS[i], st = N.br[i];
  clearTimeout(st.timer); st.timer = null;
  st.state = 'connecting'; st.since = performance.now();
  const o = { clientId: 'ih-' + me + '-' + i + '-' + Date.now().toString(36), clean: true, keepalive: 15, reconnectPeriod: 0, connectTimeout: 8000 };
  if (B.user) { o.username = B.user; o.password = B.pass; }
  let c;
  try { c = window.mqtt.connect(B.url, o); } catch (e) { N.clients[i] = null; retryBroker(N, i); return; }
  c._ok = false; c._echo = false; c._lat = null; c._rx = performance.now();
  N.clients[i] = c;
  c.on('connect', () => {
    if (N.closed || N.clients[i] !== c) return;
    c.subscribe(N.topic, { qos: 0 }, err => {
      if (N.closed || N.clients[i] !== c) return;
      if (err) { retryBroker(N, i); return; }
      c._ok = true; c._rx = performance.now();
      st.state = 'ok'; st.fails = 0;
      c.subscribe(LEGACY_ALL, { qos: 0 }, () => {});   // the door (see the top): a broker that refuses it is fine
      N.onConnected(c);
      pubOn(N, { t: 'k' });                            // measure at once how fast this broker is
    });
  });
  c.on('message', (t, p) => { if (!N.closed && N.clients[i] === c) { c._rx = performance.now(); onRaw(N, t, p, c); } });
  c.on('close', () => { const was = c._ok; c._ok = false; if (!N.closed && N.clients[i] === c) retryBroker(N, i); if (was) N.onDown(); });
  c.on('error', () => {});
}

// the broker did not answer or the connection dropped: close it and try again after a growing pause
function retryBroker(N, i) {
  const st = N.br[i];
  if (st.timer) return;
  const old = N.clients[i];
  N.clients[i] = null;
  try { if (old) old.end(true); } catch (e) {}
  st.state = 'wait'; st.fails++;
  const anyOk = N.clients.some(c => c && c._ok);
  const base = Math.min(anyOk ? 120000 : 2500, 1000 * Math.pow(2, Math.min(st.fails - 1, 7)));
  st.timer = setTimeout(() => { st.timer = null; if (!N.closed) openBroker(N, i); }, base * (.75 + Math.random() * .5));
}

// the same, but right now (after a network change there is nothing to wait for)
function rebuildBroker(N, i) {
  const st = N.br[i], old = N.clients[i];
  clearTimeout(st.timer); st.timer = null;
  N.clients[i] = null;
  try { if (old) old.end(true); } catch (e) {}
  openBroker(N, i);
}

// check every broker now, without waiting for timeouts → false if it was checked a moment ago
export function kickBrokers(N) {
  const t0 = performance.now();
  if (t0 - N.kickAt < 3000) return false;
  N.kickAt = t0;
  N.br.forEach((st, i) => {
    if (st.state === 'wait') { st.fails = Math.min(st.fails, 1); rebuildBroker(N, i); }   // waiting for a retry: retry now
    else if (st.state === 'connecting' && t0 - st.since > 5000) rebuildBroker(N, i);      // stuck while connecting
  });
  pubOn(N, { t: 'k' });                                // a live broker echoes this back at once
  setTimeout(() => {
    if (N.closed) return;
    N.clients.forEach((c, i) => { if (c && c._ok && c._echo && c._rx < t0) rebuildBroker(N, i); });
  }, 2500);
  return true;
}

// periodic upkeep (from the watchdog): echo test, forget old broker scores, restart stuck connections
export function tendBrokers(N, now) {
  if (now - N.winAt > 2000) { N.winAt = now; for (const P of N.peers.values()) for (let i = 0; i < P.win.length; i++) P.win[i] = (P.win[i] || 0) * .5; }
  if (now - N.kAt > 5000) {
    N.kAt = now;
    for (const [q, at] of N.kq) if (now - at > 10000) N.kq.delete(q);
    pubOn(N, { t: 'k' });
    N.clients.forEach((c, i) => { if (c && c._ok && c._echo && now - c._rx > 12000) rebuildBroker(N, i); });
    N.br.forEach((st, i) => { if (st.state === 'connecting' && now - st.since > 10000) retryBroker(N, i); });
  }
}

export const brokerDiag = N => {
  const now = performance.now();
  return N.br.map((st, i) => BROKERS[i].name + ': ' + (st.state === 'ok' ? 'ok ' + (N.clients[i]._lat == null ? '?' : Math.round(N.clients[i]._lat) + ' ms')
    : st.state === 'wait' ? 'down' : now - st.since > 3500 ? 'not answering' : 'connecting')).join(', ');
};

// to every broker at once (the receiver drops the copies by number)
export function pubOn(N, obj) { post(N, N.topic, obj, live); }
const live = N => { const l = []; N.clients.forEach((c, i) => { if (c && c._ok) l.push(i); }); return l; };

// Seal obj in the room's chain and publish it on topic, then, to the brokers to(N) picks (see the top). A 'k' remembers
// when it went (N.kq): its echo says how fast each broker is. Until then it waits in N.wait (link: a link's data,
// [session, its k, [messages]]), where the last words may take it along: then it does not go again (gone). (A Set: the
// chain may hold thousands, and each leaves it as it goes.)
function post(N, topic, obj, to, link = null) {
  const K = N.keys, q = next(N), plain = JSON.stringify(obj), k = obj.t === 'k';
  if (!K) return;
  const e = { link, gone: false };
  N.wait.add(e);
  N.out = N.out.then(() => seal(K, topic, me, q, plain)).then(s => {
    N.wait.delete(e);
    if (e.gone) return;
    const at = performance.now();
    for (const i of to(N)) { try { N.clients[i].publish(topic, s, { qos: 0 }); } catch (x) {} }
    if (k) N.kq.set(q, at);
  }, x => { N.wait.delete(e); throw x; }).catch(x => console.error(x));
}

// The page goes (pagehide), and the mode says its goodbye: one packet on the topic, sealed at once (a spare, seal.js),
// with what the links sent through the brokers that is still being sealed (N.wait), then what they meant to send
// meanwhile (N.stash): w, [session, the link's k, [messages]] each (internet.js delivers them before the bye). As much
// of it as a spare holds, from the start (a link's messages keep their order; what is still being sealed and did not fit
// goes after, if the page lives on long enough). No spare yet (the room just began): the usual way, after the rest.
export function lastWords(N) {
  const K = N.keys, M = N.spare, q = next(N), wait = [...N.wait].filter(e => e.link);
  const w = wait.map(e => e.link).concat(N.stash ? [...N.stash].map(([id, [k, d]]) => [id, k, d]) : []);
  N.stash = null; N.spare = null;
  if (!K) return;
  const parts = [];
  let size = 18;                                       // {"t":"bye","w":[]}
  for (const x of w) {
    const j = JSON.stringify(x), b = TE.encode(j).length + (parts.length ? 1 : 0);
    if (size + b > SPARE) break;
    parts.push(j); size += b;
  }
  const s = sealNow(K, M, N.topic, me, q, parts.length ? '{"t":"bye","w":[' + parts.join(',') + ']}' : '{"t":"bye"}');
  if (s) {
    for (const e of wait.slice(0, parts.length)) e.gone = true;   // (in the last words: not again after them)
    for (const c of N.clients) if (c && c._ok) { try { c.publish(N.topic, s, { qos: 0 }); } catch (e) {} }
  } else pubOn(N, { t: 'bye' });
  refill(N);                                           // (a page back from the back-forward cache has one again)
}
function refill(N) {
  const K = N.keys;
  if (K && !N.spare) spare(K).then(M => { if (!N.closed && N.keys === K && !N.spare) N.spare = M; }, e => console.error(e));
}

// The "mailbox" for data from one player to another: only the receiver listens to it, and the broker does not
// echo it back to the sender, which halves the traffic.
export const mailbox = (N, from, to) => N.topic + '/d/' + from + '/' + to;

// Game data for player P goes to two brokers, not all four. Which two P tells us: they see which broker
// delivers our packets first. Until they do, we take the two that answer us fastest. Every 24th message
// goes through all of them, so the other side can keep comparing. (Chosen when the packet goes, once sealed.)
// While the page goes away: kept for its last words (see lastWords).
export function pubData(N, P, obj) {
  if (going) {
    const st = N.stash || (N.stash = new Map()), e = st.get(P.id);
    if (e) e[1].push(...obj.d); else st.set(P.id, [obj.k, obj.d.slice()]);
    return;
  }
  const all = ++N.pubN % 24 === 0;
  post(N, mailbox(N, me, P.id), obj, () => dataBrokers(N, P, all), [P.id, obj.k, obj.d]);
}
function dataBrokers(N, P, all) {
  const cl = N.clients, live = [];
  for (let i = 0; i < cl.length; i++) if (cl[i] && cl[i]._ok) live.push(i);
  if (all) return live;
  const to = [];
  if (performance.now() - P.peerBestAt < 6000) for (const i of P.peerBest) if (live.includes(i)) to.push(i);
  live.sort((a, b) => (cl[a]._lat == null ? 1e9 : cl[a]._lat) - (cl[b]._lat == null ? 1e9 : cl[b]._lat));
  for (const i of live) { if (to.length >= 2) break; if (!to.includes(i)) to.push(i); }
  return to;
}

// The door (see the top): obj, plain, on the topic of a library before PROTO 2, under a session of its own (N.door: our
// sealed traffic is not tied to it), to every broker.
export function pubLegacy(N, obj) {
  const s = JSON.stringify({ ...obj, f: N.door.id, q: ++N.door.q });
  for (const c of N.clients) if (c && c._ok) { try { c.publish(N.legacy, s, { qos: 0 }); } catch (e) {} }
}

// the two brokers that deliver P's data to us first
export function bestBrokers(P) {
  const idx = [];
  for (let i = 0; i < P.win.length; i++) if (P.win[i] > .5) idx.push(i);
  return idx.sort((a, b) => P.win[b] - P.win[a]).slice(0, 2);
}

function onRaw(N, topic, p, c) {
  if (topic !== N.topic && !topic.startsWith(N.topic + '/')) { if (topic === N.legacy) legacy(N, p); return; }   // (another room's, at the door)
  const str = typeof p === 'string' ? p : TD.decode(p);
  // Before any crypto: every packet ends with …"f":"sender","q":number}
  const qi = str.lastIndexOf('"q":'), fi = str.lastIndexOf('"f":"', qi);
  if (qi < 0 || fi < 0) return;
  const f = str.slice(fi + 5, str.indexOf('"', fi + 5)), q = parseInt(str.slice(qi + 4), 10);
  if (f === me) {                                      // our own echo: the broker is alive; a 'k' says how fast it is
    c._echo = true;
    const at = N.kq.get(q);
    if (at !== undefined) { const d = performance.now() - at; c._lat = c._lat == null ? d : c._lat * .7 + d * .3; }
    return;
  }
  const w = N.last.get(f);
  if (w && !fresh(w, q)) return;                       // a copy through another broker, or seen before, or too old
  let e;
  try { e = JSON.parse(str); } catch (x) { return; }
  // anyone can publish to a public topic: drop whatever does not look like one of our packets
  if (!e || typeof e.s !== 'string' || e.f !== f || e.q !== q || !SENDER.test(f) || !Number.isSafeInteger(q) || q <= 0) return;
  const K = N.keys;
  c._in = (c._in || Promise.resolve()).then(() => open(K, topic, f, q, e.s)).then(plain => { if (plain !== null && !N.closed) opened(N, plain, f, q, c); })
    .catch(x => console.error(x));
}

// A packet opened: its number is taken now (unless its copy through another broker opened first), and its message,
// if it is one, goes to the mode.
function opened(N, plain, f, q, c) {
  let w = N.last.get(f);
  if (w && !fresh(w, q)) return;
  if (w) N.last.delete(f);                             // a recent sender moves to the end of the queue
  else {
    w = newWindow();
    if (N.last.size >= SENDERS) N.last.delete(N.last.keys().next().value);   // the one heard longest ago is forgotten
  }
  N.last.set(f, w);
  mark(w, q);
  let m;
  try { m = JSON.parse(plain); } catch (x) { return; }
  if (!m || typeof m !== 'object' || Array.isArray(m) || typeof m.t !== 'string') return;
  m.f = f; m.q = q;
  if (m.to && m.to !== me) return;
  try { N.onMessage(m, c); } catch (x) { console.error(x); }   // one odd message must not break the connection
}

// At the door: a plain message on our room's topic of a library before PROTO 2 (to everyone, or to the door's session)
function legacy(N, p) {
  let m;
  try { m = JSON.parse(typeof p === 'string' ? p : TD.decode(p)); } catch (e) { return; }
  if (!m || typeof m !== 'object' || typeof m.f !== 'string' || !SENDER.test(m.f) || typeof m.t !== 'string' || m.f === N.door.id) return;
  if (m.to !== undefined && m.to !== N.door.id) return;
  try { N.onLegacy(m); } catch (e) { console.error(e); }
}
