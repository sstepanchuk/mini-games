// One browser tab in a worker thread, for node:test (tests/net, tests/app): a few browser shims, the fake brokers
// (fakenet.js) and, if asked, fake direct links (fakertc.js; else no WebRTC: everything goes through the brokers),
// then the real library/net, and for a library tab library/app/together.js with a stand-in for the shell and one
// open game (its ihroteka.room and, from a library of phase 4 on, its ihroteka.round). The test drives it with
// messages (world.js: { id, cmd, args } → { id, ok, value | error }); the commands are below (cmds).
//
// workerData: { pid: the session's first part (window.__pid), bus: the world's BroadcastChannel, scale:
// window.__timeScale (config.js TIMING), brokerMs, rtc: fake direct links, net: fakenet switches to start with,
// library: another library/ folder to run (say, a checkout of an older version; default: this repository's), dev: the
// page says it is the dev server's (its version meta: 'dev', so together.js warns in the console), insecure: the page
// has no Web Crypto (crypto.subtle), as one served over plain http; kept: what the tab's sessionStorage holds when
// the page starts, [[key, value], …] (world.js reload: what the page before it in this tab kept) }.
// Like a browser, an exception thrown by a timer or a listener does not stop the tab: it goes to `errors`
// (console.error and console.warn too), which the test reads.
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { install } from './fakenet.js';
import { install as installRtc } from './fakertc.js';

const { pid, bus, scale = 1, brokerMs = 25, rtc: withRtc = false, net: start = {}, library, dev = false, insecure = false, kept = [] } = workerData;
const root = library ? pathToFileURL(library.replace(/\/?$/, '/')) : new URL('../../library/', import.meta.url);
const lib = p => new URL(p, root).href;
const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);
const realNow = Date.now;
let skew = 0;                                            // the page's clock set back or on (cmds.clock)
Date.now = () => realNow() + skew;

/* ---------- the browser, as much as the library uses of it ---------- */
const errors = [];
const say = (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' '));
console.error = say; console.warn = say;
process.on('uncaughtException', say);
process.on('unhandledRejection', say);

const win = new EventTarget(), doc = new EventTarget();
let hidden = false, siteData = true;                     // siteData: false, as a browser set to block it (cmds.siteData)
// the listeners the page has on window and document now ('window:pagehide' → the set of them), cmds.listeners
const live = new Map();
const tracked = (on, target) => [(type, fn, o) => { const k = on + ':' + type; if (!live.has(k)) live.set(k, new Set()); live.get(k).add(fn); target.addEventListener(type, fn, o); },
  (type, fn, o) => { const s = live.get(on + ':' + type); if (s) s.delete(fn); target.removeEventListener(type, fn, o); }];
const [winOn, winOff] = tracked('window', win), [docOn, docOff] = tracked('document', doc);
// the intervals that run now, timer → its period (cmds.timers): which the page keeps ticking (clearTimeout stops one too)
const ticking = new Map(), [setI, clearI, clearT] = [setInterval, clearInterval, clearTimeout];
Object.assign(globalThis, {
  setInterval: (fn, ms, ...a) => { const id = setI(fn, ms, ...a); ticking.set(id, ms); return id; },
  clearInterval: id => { ticking.delete(id); clearI(id); },
  clearTimeout: id => { ticking.delete(id); clearT(id); }
});
const storage = m => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } });
const tabSession = new Map(kept), local = storage(new Map()), session = storage(tabSession);   // (sessionStorage: the tab's, through reloads)
const blocked = s => () => { if (!siteData) throw new DOMException('The site data is blocked', 'SecurityError'); return s; };
Object.assign(globalThis, {
  window: globalThis, self: globalThis, __pid: pid, __timeScale: scale,
  addEventListener: winOn, removeEventListener: winOff, dispatchEvent: win.dispatchEvent.bind(win),
  document: {
    get hidden() { return hidden; }, get visibilityState() { return hidden ? 'hidden' : 'visible'; },
    addEventListener: docOn, removeEventListener: docOff,
    querySelector: sel => dev && sel === 'meta[name="ihroteka-version"]' ? { content: 'dev' } : null,
    createElement() { throw new Error('tab.js: no DOM in a worker tab'); }
  },
  location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', pathname: '/', search: '' },
  history: { state: null, replaceState() {}, pushState() {} },
  RTCPeerConnection: undefined
});
if (insecure) { const real = globalThis.crypto; Object.defineProperty(globalThis, 'crypto', { configurable: true, value: { getRandomValues: a => real.getRandomValues(a) } }); }
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: blocked(local) });
Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, get: blocked(session) });
let fake = null;
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { get onLine() { return !fake || fake.up; }, userAgent: 'node (tests/support/tab.js)' } });

/* ---------- the library ---------- */
const config = await import(lib('net/config.js'));        // (after the shims: it reads __pid and __timeScale)
fake = install({ bus, urls: config.BROKERS.map(b => b.url), brokerMs, emit: type => win.dispatchEvent(new Event(type)), ...start });
const rtc = withRtc ? installRtc({ bus, pid, live: () => fake.direct, loss: () => fake.loss }) : null;
const net = await import(lib('net/index.js'));
let T = null;                                              // library/app/together.js, for a library tab

let netRoom = null;
const events = [], got = [];
const ROOM_EVENTS = ['status', 'linked', 'join', 'leave', 'players', 'away', 'relinked', 'replaced', 'peer-gone', 'weak', 'budget'];
const watched = new WeakSet();                           // (a room watched once: startNearby may give back the same)
function watchRoom(r) {
  watched.add(r);
  for (const ev of ROOM_EVENTS) r.on(ev, (...a) => events.push([ms(), ev, ...a]));
  r.on('message', (m, from) => got.push([from, m]));
}
const room = () => (T ? T.currentRoom() : netRoom);
const need = () => { const r = room(); if (!r) throw new Error('tab.js: no room yet'); return r; };

/* ---------- a library tab: the shell, as together.js sees it, and the open game ---------- */
let view = null, game = null, round = null;             // round: the open game's ihroteka.round (none from a library before phase 4)
const follows = [];
const gEvents = [], gGot = [], heard = [];               // heard: the names of what it heard, messages ('message:' t) too, in order
const GAME_EVENTS = ['linked', 'join', 'leave', 'players', 'weak', 'peer-gone', 'relinked', 'role', 'resume', 'shared'];
const ROUND_EVENTS = ['start', 'run', 'watch', 'end', 'rejoin'];   // (heard as 'round:<event>', with its one argument)
const roundOff = new Map();                              // round event → the listener listen() added (cmds.roff)
let seatsOf = {}, shell = false, later = false;          // later: the game's code starts listening only when told (glisten)
let slow = false;                                        // slow: the game's page opens only when told (gameSlow off)
let framing = null, pulses = 0;                          // the game's frames (gframes), the pulses it heard (gpulse)
let broke = 0;                                           // how often together.js told the shell the open game broke (gameError)
const reloads = [];                                      // what together.js asked of the shell's reload: its still, or null
// Go to a view (null: the shelf; else a game, which opens a moment later, as its frame would). byPeer: following.
function go(id, byPeer = false) {
  if (id === view) return;
  if (view) T.detachGame();
  game = null; round = null;
  view = id;
  if (byPeer) follows.push(id);
  T.viewChanged(id, byPeer);
  if (id) setTimeout(() => { if (view === id && !game && !slow) openGame(id); }, 5);
}
// the game's page runs: it gets ihroteka.room and listens to everything a game may hear (at once, or when told)
function openGame(id) {
  game = T.attachGame(id);
  round = T.openRound ? T.openRound() : null;
  if (!later) listen();
}
function listen() {
  for (const ev of GAME_EVENTS) game.on(ev, (...a) => { gEvents.push([ms(), ev, ...a]); heard.push(ev); });
  if (round) for (const ev of ROUND_EVENTS) { const fn = a => { gEvents.push([ms(), 'round:' + ev, a]); heard.push('round:' + ev); }; roundOff.set(ev, fn); round.on(ev, fn); }
  game.on('message', (m, from) => { gGot.push([from, m]); heard.push('message:' + m.t); });
}

// a room's topics, as this tab's library makes them (seal.js; a library before it: config.js roomTopic, a hash of the code)
async function topics(g, code) {
  const seal = await import(lib('net/seal.js')).catch(() => null);
  if (!seal) return { topic: await config.roomTopic(g, code) };
  const K = await seal.roomKeys(g, code);
  return { topic: K.topic, legacy: K.legacy };
}

// together.js and the shell around it, once (seats: game id → seats, default 2; wires: game id → its wire number on
// this tab's shelf, the first call only; none: the shell does not say, every game 1)
async function shellUp(seats, wires) {
  T = T || await import(lib('app/together.js'));
  seatsOf = seats;
  if (shell) return;
  shell = true;
  T.initTogether({ current: () => view, follow: id => go(id, true), invite() {}, address: () => globalThis.location.href, seats: id => seatsOf[id] || 2, askName() {},
    reload: still => { reloads.push(still || null); }, gameError: () => { broke++; }, ...(wires && { wires: () => wires }) });
}

/* ---------- the commands ---------- */
const cmds = {
  // a room of library/net (a net-level tab) → this tab's session
  join({ code, name, max, game: g = 'test' }) {
    if (netRoom) netRoom.leave();
    netRoom = net.joinRoom({ game: g, code, name, max });
    watchRoom(netRoom);
    return config.me;
  },
  // a nearby room of library/net (needs the world's fake direct links, rtc) → this tab's session; then its pairing:
  // pair 'offer' → the host's code, 'answer' (code) → the guest's code, 'finish' (code) at the host
  near({ name, max, game: g = 'test' }) {
    if (netRoom) netRoom.leave();
    netRoom = net.joinNearby({ game: g, name, max });
    watchRoom(netRoom);
    return config.me;
  },
  pair: ({ step, code }) => step === 'offer' ? need().pair.offer() : step === 'answer' ? need().pair.answer(code) : need().pair.finish(code),
  // the library's room (together.js: startInternet, as if from a room link) and a shell around it; seats: game id →
  // seats (default 2); wires: game id → its wire number on this tab's shelf (the first call only; none: the shell does
  // not say, every game 1). Again in the same tab: that room is left, as the library does.
  async lib({ code, name, seats = {}, wires }) {
    await shellUp(seats, wires);
    watchRoom(T.startInternet(code, name));
    return config.me;
  },
  // the library's nearby room (together.js startNearby, as the dialog's pairing does: a guest whose link broke gets a
  // new one, a host keeps its own; the world's rtc), then pair(…) as for near → this tab's session
  async libNear({ name, seats = {}, wires }) {
    await shellUp(seats, wires);
    const r = T.startNearby(name);
    if (!watched.has(r)) watchRoom(r);
    return config.me;
  },
  open: ({ id }) => { go(id); },                          // open a game (or the shelf: null) ourselves
  // this tab's session, the brokers, the room's topic (for a spy; and legacy: that of a library before PROTO 2), the room's
  // timing (TIMING, scaled) and the library's wire version (PROTO; undefined before it had one)
  info: async ({ code, game: g = 'test' } = {}) => ({ session: config.me, urls: fake.urls, ...(code ? await topics(g, code) : { topic: null }), timing: config.TIMING,
    proto: config.PROTO }),
  state() {
    const r = room();
    if (!r) return null;
    return { session: config.me, me: r.me, kind: r.kind, status: r.status, role: r.role, host: r.host, players: r.players, away: r.players.filter(p => r.away(p)),
      linked: r.linked, weak: r.weak, online: r.online, direct: r.direct, version: r.versionMismatch ?? null, pairing: r.pair ? r.pair.pending : null,
      reason: r.pair ? r.pair.reason : null,
      lib: T ? T.state() : null };
  },
  // the room object's own properties: name → 'get' (a getter), 'fn' or 'value' (what was written onto it)
  roomProps: () => Object.fromEntries(Object.entries(Object.getOwnPropertyDescriptors(need())).map(([k, d]) => [k, d.get ? 'get' : typeof d.value === 'function' ? 'fn' : 'value'])),
  // the intervals that run now, by period: { '200': 1, '1000': 1, … }
  timers: () => { const by = {}; for (const ms of ticking.values()) by[ms] = (by[ms] || 0) + 1; return by; },
  // what happened since: events [ms, name, ...args] and messages [from, m] (from: an index to read only the new ones)
  log: ({ from = 0, gfrom = 0 } = {}) => ({ events: events.slice(from), got: got.slice(gfrom) }),
  // room.send for each of list (or m), → the first error thrown ('TypeError: ' and its message), or null. then: what
  // each message becomes right after it went, in place, nested objects too (a caller that changes what it sent); as:
  // what each one says it is as JSON (its toJSON)
  send({ m, list = [m], opts, then, as }) {
    const r = need();
    const change = (x, o) => { for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && x[k] && typeof x[k] === 'object') change(x[k], v); else x[k] = v; };
    for (const x of list) {
      if (as) Object.defineProperty(x, 'toJSON', { value: () => as });
      try { r.send(x, opts); } catch (e) { return (e.name === 'TypeError' ? 'TypeError: ' : '') + (e.message || String(e)); }
      if (then) change(x, then);
    }
    return null;
  },
  release: ({ n }) => { need().release(n); },
  lag: ({ n }) => need().lag(n),                          // room.lag: to one player (n), or the slowest
  leave: ({ final = true } = {}) => { if (T) T.leave(); else need().leave(final); },   // (the library always leaves for good)
  kick: () => { need().kick(); },
  // the page closes: it says goodbye (pagehide), and is gone: nothing more goes out or comes in. hidden: a page still in
  // sight is hidden first, in the same go (a closed tab: visibilitychange, then pagehide; nothing else runs between them)
  pagehide: ({ hidden: first = false } = {}) => {
    if (first && !hidden) { hidden = true; doc.dispatchEvent(new Event('visibilitychange')); }
    win.dispatchEvent(new Event('pagehide')); fake.set({ up: false });
  },
  // the page's own pagehide listener, added now (before a room's, as the library's is): it sends each of list
  // ({ m, opts }) on the room, as the page goes; at 'hidden': as it is hidden (visibilitychange), as app/together.js does
  onHide({ list, at = 'pagehide' }) {
    const go = () => { for (const { m, opts } of list) { try { room().send(m, opts); } catch (e) { say(e); } } };
    if (at === 'hidden') docOn('visibilitychange', () => { if (hidden) go(); }); else winOn('pagehide', go);
  },
  hide: ({ on }) => { hidden = on; doc.dispatchEvent(new Event('visibilitychange')); },
  // the browser lets the page keep site data (localStorage, sessionStorage) or blocks it: they throw
  siteData: ({ on }) => { siteData = on; },
  // the shell's reload (shell.js), once the newer offline copy is in place, for the latest one asked: 'reload' (the
  // page reloads now), 'stay' (called off meanwhile) or null (none asked)
  reloadDone: () => { const s = reloads.at(-1); return s === undefined ? null : !s || s() ? 'reload' : 'stay'; },
  // what the page keeps in sessionStorage under k (JSON), as the next page in this tab would find it
  stored: ({ k }) => JSON.parse(session.getItem(k)),
  // everything the page keeps in sessionStorage, [[key, value], …]: the next page in this tab starts with it (world.js reload)
  sessionAll: () => [...tabSession],
  // the tab stops for ms (a locked phone, a frozen background tab): no timer, no message, then everything late at once
  // → when it runs again, on the clock of its events (log)
  freeze: ({ ms: wait }) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, wait); return ms(); },
  // how many listeners the page has on window and document now, by type ({ 'window:pagehide': 1, … }; none: left out)
  listeners: () => Object.fromEntries([...live].filter(([, s]) => s.size).map(([k, s]) => [k, s.size])),
  net: o => { fake.set(o); return fake.state(); },
  // the device's clock is set back (by < 0) or on, as a phone's by the network: Date.now() from now on → it
  clock: ({ by }) => { skew += by; return Date.now(); },
  netState: () => ({ ...fake.state(), dc: rtc && rtc.count }),
  killDc: () => { rtc.kill(); },                          // the phone's OS dropped the direct links
  errors: () => errors.slice(),
  takeErrors: () => errors.splice(0),                     // what went wrong so far, read and forgotten (expected ones)
  // the open game (ihroteka.room): its state, and what it heard (events [ms, name, ...args] and messages [from, m],
  // of every game opened in this tab); and what it does
  game() {
    if (!game) return null;
    const g = game;
    const r = round && { active: round.active, id: round.id, seats: round.seats, mySeat: round.mySeat, runner: round.runner, runs: round.runs };
    return { me: g.me, players: g.players, waiting: g.waiting, seats: g.seats, seated: g.seated, host: g.host, role: g.role,
      linked: g.linked, weak: g.weak, round: r, events: gEvents.slice(), got: gGot.slice(), heard: heard.slice(), follows: follows.slice(), view };
  },
  // the game's next page runs its code late: it listens only when told (glisten), as a game that starts after the room
  gameLate: ({ on }) => { later = on; },
  // the game's page is slow to open (a new tab or device loading it): it opens only when this is off again
  gameSlow: ({ on }) => { slow = on; if (!on && view && !game) openGame(view); },
  glisten: () => { listen(); },
  // what the game calls → what the call returns (send, snapshot, share: whether it was done)
  gsend: ({ m, opts }) => game.send(m, opts),
  // the game's ihroteka.round: what it calls → what the call returns; its policy (merged into round.policy); roff: the
  // listener of ev that listen() added goes (round.off); rseatOf: round.seatOf(name)
  rstart: ({ setup, opts }) => round.start(setup, opts),
  rsave: ({ s }) => round.save(s),
  rover: ({ result }) => round.over(result),
  rquit: () => round.quit(),
  rpolicy: ({ p }) => { Object.assign(round.policy, p); return { ...round.policy }; },
  roff: ({ ev }) => { round.off(ev, roundOff.get(ev)); return true; },
  rseatOf: ({ name }) => round.seatOf(name),
  // the game's next round event ev makes it call round[call](arg) from its own listener (once; after listen()'s)
  ron({ ev, call, arg }) { const fn = () => { round.off(ev, fn); round[call](arg); }; round.on(ev, fn); return true; },
  gsnapshot: ({ s }) => game.snapshot(s),
  gshare: ({ k, v }) => game.share(k, v),
  gshared: ({ k }) => game.shared(k),
  gdiag: () => game.diag(),                                // the game's room.diag(): the report to copy
  // the game calls room.frame(now) every animation frame (16 ms), now on its own frame's clock: ahead of the page's by
  // ahead ms (null: it stops)
  gframes({ ahead }) { clearI(framing); framing = ahead == null ? null : setI(() => { if (game) game.frame(performance.now() + ahead); }, 16); },
  // the game's pulse policy says a few fields (a counter), and it counts the pulses it hears → that count so far
  gpulse() { let k = 0; game.pulse = () => ({ k: ++k }); game.on('pulse', () => { pulses++; }); },
  gpulses: () => pulses,
  // the game's listener of ev throws a TypeError saying msg (add it before glisten: ahead of the game's other listeners);
  // gbroke → how often the shell heard that the game broke
  gthrow({ ev, msg }) { game.on(ev, () => { throw new TypeError(msg); }); },
  gbroke: () => broke,
  // the game changes, in place, a value the library handed it (a game that keeps its state in it): that of its last
  // 'resume', of its last 'shared' event for key k, or what room.shared(k) returns ('get') → whether there was one
  gtouch({ ev, k, set }) {
    const e = ev === 'get' ? null : [...gEvents].reverse().find(x => x[1] === ev && (ev === 'resume' || x[2] === k));
    const v = ev === 'get' ? game.shared(k) : e && e[ev === 'resume' ? 2 : 3];
    if (!v || typeof v !== 'object') return false;
    Object.assign(v, set);
    return true;
  }
};

parentPort.on('message', async ({ id, cmd, args }) => {
  try {
    if (!cmds[cmd]) throw new Error('tab.js: no command ' + cmd);
    parentPort.postMessage({ id, ok: true, value: await cmds[cmd](args || {}) });
  } catch (e) {
    parentPort.postMessage({ id, ok: false, error: (e && e.stack) || String(e) });
  }
});
parentPort.postMessage({ ready: true, session: config.me, urls: fake.urls });
