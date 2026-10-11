// What every room has, however the players found each other: the state of the link (N), events, the
// game's policies and the public room object. internet.js and nearby.js add how players meet.
import { closeRtc } from './rtc.js';
import { deliver, diag, keepDirectAlive, kick, lag, refresh, resetPaths, send, stats, watch } from './link.js';

const RESERVED = new Set(['p', 'q', 'bye']);          // message types the link itself uses (link.js)

/**
 * relay   true: the brokers carry data when the direct link cannot (internet rooms)
 * close   (N) => void: protocol-specific part of leaving
 * bye     (N) => void: protocol-specific goodbye when the tab closes
 */
export function newRoom({ game, code = '', lostAfter = 60000, relay, close, bye }) {
  const ev = emitter();
  const N = {
    game, code, lostAfter, relay, emit: ev.emit, closed: false,
    // brokers (brokers.js); seq starts from the clock, so numbers of a new connection never collide with what
    // the other player remembers from our previous one
    topic: '', clients: [], br: [], seq: Date.now(), last: new Map(), ready: false, kickAt: -1e9, kAt: 0,
    heard: null, win: [], winAt: 0, peerBest: [], peerBestAt: -1e9, pubN: 0, early: [],
    // who is who
    role: null, other: null, linked: false, weak: false, byeAt: 0, lastSeen: 0, lastWatch: 0, watchMs: 0, graceUntil: 0, failing: false, up: false,
    // paths, numbering and ping (link.js)
    via: 'relay', viaAt: 0, q: [], qTimer: null, pingAt: 0, pN: 0, nudged: 0,
    // direct link (rtc.js)
    pc: null, dcF: null, dcC: null, dcSeen: 0, dcBorn: 0, iceQ: [], rtcK: null, rtcNext: 0, rtcTries: 0, turn: null, cand: '', iceRtt: null, statsAt: 0,
    // timers
    whoTimer: null, annTimer: null, helloTimer: null, rtcTimer: null, failTimer: null, fullTimer: null, watchTimer: null
  };
  resetPaths(N);

  const room = {
    get code() { return code; },
    get role() { return N.role; },                     // null until known, then 'host' or 'guest' ('out' when replaced)
    get linked() { return N.linked; },                 // both players are here and hear each other
    get weak() { return N.weak; },                     // the other player went quiet (or said bye and may come back)
    get leaving() { return !!N.byeAt; },               // they closed their tab; their seat is held for 20 s
    get direct() { return N.via === 'p2p'; },
    get nearby() { return !relay; },                   // a nearby room (no internet involved)
    // The game's policy (replace these functions):
    keepSeat: () => false,                             // a round is on: hold the seat when the other player closes the tab
    patient: () => false,                              // the game is paused: allow a longer silence
    streaming: () => false,                            // the other player streams state every frame (the direct link counts as dead sooner)
    pulse: null,                                       // (now) => object: extra fields for the pulse sent 5 times a second
    on(name, fn) { ev.on(name, fn); return room; },
    send(msg, opts) {                                  // { fast, batch }: see link.js
      if (!msg || typeof msg.t !== 'string' || RESERVED.has(msg.t)) throw new Error('room: a message needs a string t other than ' + [...RESERVED].join(', '));
      send(N, msg, opts);
    },
    lag: () => lag(N),                                 // one-way delay estimate, ms
    stats: () => stats(N),                             // { rtt, peerRtt, direct, relayed, turn }
    diag: () => diag(N),                               // multi-line connection report
    frame: now => keepDirectAlive(N, now),             // optional, every animation frame: notices a silent direct link sooner
    kick: () => kick(N),                               // the network changed or the page became visible
    leave() {                                          // final: tell the other player and disconnect
      if (N.closed) return;
      try { if (N.linked) send(N, { t: 'bye', menu: 1 }); } catch (e) {}
      N.closed = true; N.linked = false;
      close(N);
      stop(N, 'qTimer', 'watchTimer');
      closeRtc(N);
      removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onShow);
      removeEventListener('pageshow', onShow);
    }
  };
  Object.assign(N, {
    keepSeat: () => safe(room.keepSeat), streaming: () => safe(room.streaming), patient: () => safe(room.patient),
    pulse: now => { try { return room.pulse && room.pulse(now); } catch (e) { console.error(e); return null; } },
    refresh: () => refresh(N)
  });

  // closing the tab: say goodbye by every path we still can
  const onPageHide = () => {
    if (N.closed) return;
    try { if (N.linked) send(N, { t: 'bye' }); } catch (e) {}
    try { bye(N); } catch (e) {}
  };
  addEventListener('pagehide', onPageHide);
  // back on screen (a background tab may have been throttled to a timer a second, too little to count as sleep)
  const onShow = () => { if (!document.hidden) kick(N); };
  document.addEventListener('visibilitychange', onShow);
  addEventListener('pageshow', onShow);
  return { N, room };
}

// The watchdog (link.js): 5 times a second while linked, once a second while not (there is only broker upkeep
// to do then). It changes pace by itself; the time before its first tick is not sleep.
const pace = N => N.linked ? 200 : 1000;
export function startWatch(N) {
  stop(N, 'watchTimer');
  N.watchMs = pace(N); N.lastWatch = performance.now();
  N.watchTimer = setInterval(() => { watch(N); if (!N.closed && pace(N) !== N.watchMs) startWatch(N); }, N.watchMs);
}

// both players are here and the link works
export function markLinked(N) {
  N.linked = true;
  N.lastSeen = performance.now();
  N.weak = false; N.byeAt = 0; N.rtcTries = 0; N.rtcNext = performance.now() + 300;
  resetPaths(N);
  if (N.watchTimer) startWatch(N);                     // at full pace from now on
  N.emit('status', 'ready');
  refresh(N);
  N.emit('linked');
  const early = N.early;                               // what arrived a moment before the link opened
  N.early = [];
  for (const m of early) deliver(N, m, N.relay);
}

export function setRole(N, role) {
  N.role = role;
  N.emit('role', role);
}

// A tiny event emitter. A throwing listener is reported and does not stop the others
// (nor the network code that emitted the event).
function emitter() {
  const handlers = new Map();
  return {
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
    emit(name, ...args) {
      for (const fn of handlers.get(name) || []) { try { fn(...args); } catch (e) { console.error(e); } }
    }
  };
}

// timeouts and intervals share one id space, so clearTimeout stops either
export const stop = (N, ...timers) => { for (const k of timers) { clearTimeout(N[k]); N[k] = null; } };
function safe(fn) { try { return !!fn(); } catch (e) { return false; } }
