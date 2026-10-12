// One browser tab in a worker thread, for node:test (tests/net, tests/app): a few browser shims, the fake brokers
// (fakenet.js) and, if asked, fake direct links (fakertc.js; else no WebRTC: everything goes through the brokers),
// then the real library/net, and for a library tab library/app/together.js with a stand-in for the shell and one
// open game. The test drives it with messages (world.js: { id, cmd, args } → { id, ok, value | error }); the
// commands are below (cmds).
//
// workerData: { pid: the session's first part (window.__pid), bus: the world's BroadcastChannel, scale:
// window.__timeScale (config.js TIMING), brokerMs, rtc: fake direct links, net: fakenet switches to start with,
// library: another library/ folder to run (say, a checkout of an older version; default: this repository's) }.
// Like a browser, an exception thrown by a timer or a listener does not stop the tab: it goes to `errors`
// (console.error and console.warn too), which the test reads.
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';
import { install } from './fakenet.js';
import { install as installRtc } from './fakertc.js';

const { pid, bus, scale = 1, brokerMs = 25, rtc: withRtc = false, net: start = {}, library } = workerData;
const root = library ? pathToFileURL(library.replace(/\/?$/, '/')) : new URL('../../library/', import.meta.url);
const lib = p => new URL(p, root).href;
const t0 = performance.now(), ms = () => Math.round(performance.now() - t0);

/* ---------- the browser, as much as the library uses of it ---------- */
const errors = [];
const say = (...a) => errors.push(a.map(x => (x && x.stack) || String(x)).join(' '));
console.error = say; console.warn = say;
process.on('uncaughtException', say);
process.on('unhandledRejection', say);

const win = new EventTarget(), doc = new EventTarget();
let hidden = false;
const store = new Map();
Object.assign(globalThis, {
  window: globalThis, self: globalThis, __pid: pid, __timeScale: scale,
  addEventListener: win.addEventListener.bind(win), removeEventListener: win.removeEventListener.bind(win), dispatchEvent: win.dispatchEvent.bind(win),
  document: {
    get hidden() { return hidden; }, get visibilityState() { return hidden ? 'hidden' : 'visible'; },
    addEventListener: doc.addEventListener.bind(doc), removeEventListener: doc.removeEventListener.bind(doc),
    createElement() { throw new Error('tab.js: no DOM in a worker tab'); }
  },
  location: { href: 'http://127.0.0.1:8000/', origin: 'http://127.0.0.1:8000', pathname: '/', search: '' },
  history: { state: null, replaceState() {}, pushState() {} },
  localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: k => { store.delete(k); } },
  RTCPeerConnection: undefined
});
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
const ROOM_EVENTS = ['status', 'linked', 'join', 'leave', 'players', 'away', 'relinked', 'replaced', 'role', 'peer-gone', 'weak'];
function watchRoom(r) {
  for (const ev of ROOM_EVENTS) r.on(ev, (...a) => events.push([ms(), ev, ...a]));
  r.on('message', (m, from) => got.push([from, m]));
}
const room = () => (T ? T.currentRoom() : netRoom);
const need = () => { const r = room(); if (!r) throw new Error('tab.js: no room yet'); return r; };

/* ---------- a library tab: the shell, as together.js sees it, and the open game ---------- */
let view = null, game = null;
const follows = [];
const gEvents = [], gGot = [];
const GAME_EVENTS = ['linked', 'join', 'leave', 'players', 'weak', 'peer-gone', 'relinked', 'role', 'resume', 'shared'];
let seatsOf = {}, shell = false;
// Go to a view (null: the shelf; else a game, which opens a moment later, as its frame would). byPeer: following.
function go(id, byPeer = false) {
  if (id === view) return;
  if (view) T.detachGame();
  game = null;
  view = id;
  if (byPeer) follows.push(id);
  T.viewChanged(id, byPeer);
  if (id) setTimeout(() => { if (view === id && !game) openGame(id); }, 5);
}
// the game's page runs: it gets ihroteka.room and listens to everything a game may hear
function openGame(id) {
  game = T.attachGame(id);
  for (const ev of GAME_EVENTS) game.on(ev, (...a) => gEvents.push([ms(), ev, ...a]));
  game.on('message', (m, from) => gGot.push([from, m]));
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
  // the library's room (together.js: startInternet, as if from a room link) and a shell around it; seats: game id →
  // seats (default 2). Again in the same tab: that room is left, as the library does.
  async lib({ code, name, seats = {} }) {
    T = T || await import(lib('app/together.js'));
    seatsOf = seats;
    if (!shell) {
      shell = true;
      T.initTogether({ current: () => view, follow: id => go(id, true), invite() {}, address: () => globalThis.location.href, seats: id => seatsOf[id] || 2, askName() {} });
    }
    watchRoom(T.startInternet(code, name));
    return config.me;
  },
  open: ({ id }) => { go(id); },                          // open a game (or the shelf: null) ourselves
  // this tab's session, the brokers, the room's topic (for a spy) and the room's timing (TIMING, scaled)
  info: async ({ code, game: g = 'test' } = {}) => ({ session: config.me, urls: fake.urls, topic: code ? await config.roomTopic(g, code) : null, timing: config.TIMING }),
  state() {
    const r = room();
    if (!r) return null;
    return { session: config.me, me: r.me, role: r.role, host: r.host, players: r.players, away: r.players.filter(p => r.away(p)),
      linked: r.linked, weak: r.weak, online: r.online, direct: r.direct, lib: T ? T.state() : null };
  },
  // what happened since: events [ms, name, ...args] and messages [from, m] (from: an index to read only the new ones)
  log: ({ from = 0, gfrom = 0 } = {}) => ({ events: events.slice(from), got: got.slice(gfrom) }),
  // room.send for each of list (or m), → the first error thrown (its message), or null
  send({ m, list = [m], opts }) {
    const r = need();
    for (const x of list) { try { r.send(x, opts); } catch (e) { return e.message || String(e); } }
    return null;
  },
  release: ({ n }) => { need().release(n); },
  leave: ({ final = true } = {}) => { if (T) T.leave(); else need().leave(final); },   // (the library always leaves for good)
  kick: () => { need().kick(); },
  // the page closes: it says goodbye (pagehide), and is gone: nothing more goes out or comes in
  pagehide: () => { win.dispatchEvent(new Event('pagehide')); fake.set({ up: false }); },
  hide: ({ on }) => { hidden = on; doc.dispatchEvent(new Event('visibilitychange')); },
  // the tab stops for ms (a locked phone, a frozen background tab): no timer, no message, then everything late at once
  freeze: ({ ms }) => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); },
  net: o => { fake.set(o); return fake.state(); },
  netState: () => ({ ...fake.state(), dc: rtc && rtc.count }),
  killDc: () => { rtc.kill(); },                          // the phone's OS dropped the direct links
  errors: () => errors.slice(),
  // the open game (ihroteka.room): its state, and what it heard (events [ms, name, ...args] and messages [from, m],
  // of every game opened in this tab); and what it does
  game() {
    if (!game) return null;
    const g = game;
    return { me: g.me, players: g.players, waiting: g.waiting, seats: g.seats, seated: g.seated, host: g.host, role: g.role,
      linked: g.linked, weak: g.weak, events: gEvents.slice(), got: gGot.slice(), follows: follows.slice(), view };
  },
  gsend({ m, opts }) { game.send(m, opts); },
  gsnapshot({ s }) { game.snapshot(s); },
  gshare({ k, v }) { game.share(k, v); },
  gshared: ({ k }) => game.shared(k)
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
