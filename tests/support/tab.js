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
let hidden = false, siteData = true;                     // siteData: false, as a browser set to block it (cmds.siteData)
const storage = m => ({ getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: k => { m.delete(k); } });
const local = storage(new Map()), session = storage(new Map());
const blocked = s => () => { if (!siteData) throw new DOMException('The site data is blocked', 'SecurityError'); return s; };
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
  RTCPeerConnection: undefined
});
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
const gEvents = [], gGot = [], heard = [];               // heard: the names of what it heard, messages ('message:' t) too, in order
const GAME_EVENTS = ['linked', 'join', 'leave', 'players', 'weak', 'peer-gone', 'relinked', 'role', 'resume', 'shared'];
let seatsOf = {}, shell = false, later = false;          // later: the game's code starts listening only when told (glisten)
const reloads = [];                                      // what together.js asked of the shell's reload: its still, or null
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
// the game's page runs: it gets ihroteka.room and listens to everything a game may hear (at once, or when told)
function openGame(id) {
  game = T.attachGame(id);
  if (!later) listen();
}
function listen() {
  for (const ev of GAME_EVENTS) game.on(ev, (...a) => { gEvents.push([ms(), ev, ...a]); heard.push(ev); });
  game.on('message', (m, from) => { gGot.push([from, m]); heard.push('message:' + m.t); });
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
    T = T || await import(lib('app/together.js'));
    seatsOf = seats;
    if (!shell) {
      shell = true;
      T.initTogether({ current: () => view, follow: id => go(id, true), invite() {}, address: () => globalThis.location.href, seats: id => seatsOf[id] || 2, askName() {},
        reload: still => { reloads.push(still || null); }, ...(wires && { wires: () => wires }) });
    }
    watchRoom(T.startInternet(code, name));
    return config.me;
  },
  open: ({ id }) => { go(id); },                          // open a game (or the shelf: null) ourselves
  // this tab's session, the brokers, the room's topic (for a spy), the room's timing (TIMING, scaled) and the library's
  // wire version (PROTO; undefined before it had one)
  info: async ({ code, game: g = 'test' } = {}) => ({ session: config.me, urls: fake.urls, topic: code ? await config.roomTopic(g, code) : null, timing: config.TIMING,
    proto: config.PROTO }),
  state() {
    const r = room();
    if (!r) return null;
    return { session: config.me, me: r.me, role: r.role, host: r.host, players: r.players, away: r.players.filter(p => r.away(p)),
      linked: r.linked, weak: r.weak, online: r.online, direct: r.direct, version: r.versionMismatch ?? null, pairing: r.pair ? r.pair.pending : null,
      lib: T ? T.state() : null };
  },
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
  leave: ({ final = true } = {}) => { if (T) T.leave(); else need().leave(final); },   // (the library always leaves for good)
  kick: () => { need().kick(); },
  // the page closes: it says goodbye (pagehide), and is gone: nothing more goes out or comes in
  pagehide: () => { win.dispatchEvent(new Event('pagehide')); fake.set({ up: false }); },
  hide: ({ on }) => { hidden = on; doc.dispatchEvent(new Event('visibilitychange')); },
  // the browser lets the page keep site data (localStorage, sessionStorage) or blocks it: they throw
  siteData: ({ on }) => { siteData = on; },
  // the shell's reload (shell.js), once the newer offline copy is in place, for the latest one asked: 'reload' (the
  // page reloads now), 'stay' (called off meanwhile) or null (none asked)
  reloadDone: () => { const s = reloads.at(-1); return s === undefined ? null : !s || s() ? 'reload' : 'stay'; },
  // what the page keeps in sessionStorage under k (JSON), as the next page in this tab would find it
  stored: ({ k }) => JSON.parse(session.getItem(k)),
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
      linked: g.linked, weak: g.weak, events: gEvents.slice(), got: gGot.slice(), heard: heard.slice(), follows: follows.slice(), view };
  },
  // the game's next page runs its code late: it listens only when told (glisten), as a game that starts after the room
  gameLate: ({ on }) => { later = on; },
  glisten: () => { listen(); },
  // what the game calls → what the call returns (send, snapshot, share: whether it was done)
  gsend: ({ m, opts }) => game.send(m, opts),
  gsnapshot: ({ s }) => game.snapshot(s),
  gshare: ({ k, v }) => game.share(k, v),
  gshared: ({ k }) => game.shared(k),
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
