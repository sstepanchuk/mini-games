// What every room has, however the players found each other: the players and their links, events, the
// game's policies and the public room object. internet.js and nearby.js add how players meet.
//
// A room is a star: one host and up to max - 1 guests, each linked to the host only. (Over the internet the
// guests could reach each other too, but nearby they often cannot: one shape for both.) The host passes on
// what a guest sends to the others, and keeps the list of players (the roster) that everyone sees. When the
// host leaves, the first guest on the roster takes over (internet rooms; see internet.js).
//
// Room state is N; the link with each other player is a peer P (link.js, rtc.js): a guest has one, the host
// one per guest. Players are known to games by their player id (config.js: playerOf), the same in every tab.
import { me, playerOf } from './config.js';
import { closeRtc } from './rtc.js';
import { deliver, diag, keepDirectAlive, kick, lag, refresh, resetPaths, send, stats, watch } from './link.js';

// Messages of the room itself on a link: p (pulse), q (ping answer), bye; and _r (roster), _h (nearby hello).
// A game's message types must not start with '_' and be none of these.
const RESERVED = new Set(['p', 'q', 'bye']);
export const MAX_PLAYERS = 8;

/**
 * relay   true: the brokers carry data when the direct link cannot (internet rooms)
 * max     players in the room, the host included (2…MAX_PLAYERS)
 * close   (N) => void: protocol-specific part of leaving
 * bye     (N) => void: protocol-specific goodbye when the tab closes
 */
export function newRoom({ game, code = '', lostAfter = 60000, relay, max = MAX_PLAYERS, close, bye }) {
  const ev = emitter();
  const N = {
    game, code, lostAfter, relay, max: Math.max(2, Math.min(MAX_PLAYERS, max | 0 || MAX_PLAYERS)), emit: ev.emit, closed: false,
    // brokers (brokers.js); seq starts from the clock, so numbers of a new connection never collide with what
    // the other players remember from our previous one
    topic: '', clients: [], br: [], seq: Date.now(), last: new Map(), ready: false, up: false, kickAt: -1e9, kAt: 0, winAt: 0, pubN: 0,
    // who is who: our role, the host (when we are a guest), every link (id → peer, in the order they joined)
    role: null, host: null, peers: new Map(), roster: [me], linked: false, weak: false, statsDue: false,
    // the watchdog (link.js)
    lastWatch: 0, watchMs: 0, graceUntil: 0,
    // timers
    whoTimer: null, annTimer: null, helloTimer: null, failTimer: null, fullTimer: null, watchTimer: null
  };

  const room = {
    get code() { return code; },
    get me() { return playerOf(me); },                 // our player id
    get role() { return N.role; },                     // null until known, then 'host' or 'guest' ('out' when replaced)
    get host() { return N.role === 'host' ? playerOf(me) : N.host && playerOf(N.host); },
    get players() { return N.roster.map(playerOf); },  // everyone in the room, us included: the host first, then in order of arrival
    get max() { return N.max; },
    get linked() { return N.linked; },                 // someone else is here and we hear each other
    get weak() { return N.weak; },                     // someone went quiet (or said bye and may come back)
    get leaving() { return linkedPeers(N).some(P => !!P.byeAt); },   // someone closed their tab; their seat is held for 20 s
    get direct() { const l = linkedPeers(N); return l.length > 0 && l.every(P => P.via === 'p2p'); },
    get nearby() { return !relay; },                   // a nearby room (no internet involved)
    // The game's policy (replace these functions):
    keepSeat: () => false,                             // a round is on: hold the seat when a player closes the tab
    patient: () => false,                              // the game is paused: allow a longer silence
    streaming: () => false,                            // the host streams state every frame (a direct link counts as dead sooner)
    pulse: null,                                       // (now) => object: extra fields for the pulse sent 5 times a second
    on(name, fn) { ev.on(name, fn); return room; },
    // to everyone else, or { to: player id }; also { fast, batch } (see link.js)
    send(msg, { to, ...opts } = {}) {
      if (!msg || typeof msg.t !== 'string' || RESERVED.has(msg.t) || msg.t[0] === '_') throw new Error('room: a message needs a string t, not starting with _ and other than ' + [...RESERVED].join(', '));
      if (to === undefined || to !== playerOf(me)) sendRoom(N, msg, to, opts);
    },
    lag: id => pick(N, id, lag, Math.max, 0),          // one-way delay estimate, ms (to one player, or the slowest)
    stats: id => roomStats(N, id),                     // { rtt, peerRtt, direct, relayed, turn, weak }
    diag: () => diag(N),                               // multi-line connection report
    frame: now => keepDirectAlive(N, now),             // optional, every animation frame: notices a silent direct link sooner
    kick: () => kick(N),                               // the network changed or the page became visible
    leave() {                                          // final: tell the others and disconnect
      if (N.closed) return;
      for (const P of linkedPeers(N)) try { send(P, { t: 'bye', menu: 1 }); } catch (e) {}
      N.closed = true; N.linked = false;
      close(N);
      stop(N, 'watchTimer');
      for (const P of N.peers.values()) closePeer(P);
      removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onShow);
      removeEventListener('pageshow', onShow);
    }
  };
  Object.assign(N, {
    keepSeat: () => safe(room.keepSeat), streaming: () => safe(room.streaming), patient: () => safe(room.patient),
    pulse: now => { try { return room.pulse && room.pulse(now); } catch (e) { console.error(e); return null; } },
    refresh: P => { refresh(P); N.statsDue = true; },
    arrive: (P, m, reliable) => arrive(N, P, m, reliable),
    roomStats: () => roomStats(N)
  });

  // closing the tab: say goodbye by every path we still can
  const onPageHide = () => {
    if (N.closed) return;
    for (const P of linkedPeers(N)) try { send(P, { t: 'bye' }); } catch (e) {}
    try { bye(N); } catch (e) {}
  };
  addEventListener('pagehide', onPageHide);
  // back on screen (a background tab may have been throttled to a timer a second, too little to count as sleep)
  const onShow = () => { if (!document.hidden) kick(N); };
  document.addEventListener('visibilitychange', onShow);
  addEventListener('pageshow', onShow);
  return { N, room };
}

/* ---------- peers ---------- */
export const linkedPeers = N => { const out = []; for (const P of N.peers.values()) if (P.linked) out.push(P); return out; };
export const hostPeer = N => N.host ? N.peers.get(N.host) || null : null;

// the link with one other player (its fields: link.js and rtc.js)
export function newPeer(N, id) {
  const P = {
    N, id, pid: playerOf(id), linked: false, weak: false, byeAt: 0, lastSeen: performance.now(), early: [],
    // brokers: whether we listen to their mailbox, which brokers bring their data first, which bring ours to them
    heard: false, win: [], peerBest: [], peerBestAt: -1e9,
    // paths, numbering and ping (link.js)
    via: 'relay', viaAt: 0, q: [], qTimer: null, pingAt: 0, pN: 0, nudged: 0,
    // direct link (rtc.js)
    pc: null, dcF: null, dcC: null, dcSeen: 0, dcBorn: 0, iceQ: [], rtcK: null, rtcNext: 0, rtcTries: 0, rtcTimer: null,
    turn: null, cand: '', iceRtt: null, statsAt: 0, failing: false
  };
  resetPaths(P);
  N.peers.set(id, P);
  return P;
}
// the same player in a new tab: the link (and their place on the roster) carries on under the new id
export function renamePeer(N, P, id) {
  const entries = [...N.peers].map(([k, v]) => v === P ? [id, v] : [k, v]);
  N.peers = new Map(entries);
  if (N.host === P.id) N.host = id;
  P.id = id; P.pid = playerOf(id);
}
export function closePeer(P) {
  stop(P, 'qTimer');
  P.q = [];
  closeRtc(P);
}

// the link with P works: both hear each other
export function markLinked(P) {
  const N = P.N, first = !N.linked;
  P.linked = true; N.linked = true;
  P.lastSeen = performance.now();
  P.weak = false; P.byeAt = 0; P.rtcTries = 0; P.rtcNext = performance.now() + 300;
  resetPaths(P);
  if (N.watchTimer) startWatch(N);                     // at full pace from now on
  N.emit('status', 'ready');
  N.refresh(P);
  if (N.role === 'host') updateRoster(N);
  else setRoster(N, [N.host, me]);                     // until the host sends the whole roster
  if (first) N.emit('linked');
  const early = P.early;                               // what arrived a moment before the link opened
  P.early = [];
  for (const m of early) deliver(P, m, N.relay);
}

// the link with P is over (they left, or went silent for too long)
export function unlink(P) {
  const N = P.N;
  if (!N.peers.has(P.id)) return;
  const was = P.linked;
  P.linked = false;
  closePeer(P);
  if (N.onUnlink) N.onUnlink(P);                       // e.g. stop listening to their mailbox
  N.peers.delete(P.id);
  if (!was) return;
  N.linked = linkedPeers(N).length > 0;
  weakChanged(N);
  if (N.role === 'host') updateRoster(N);
  else setRoster(N, [me]);
  if (!N.linked) N.emit('peer-gone');
  N.statsDue = true;
}

/* ---------- the roster ---------- */
// the host: us and every linked guest, in the order they came; everyone gets it whenever it changes
export function updateRoster(N) {
  const ids = [me, ...linkedPeers(N).map(P => P.id)];
  if (!setRoster(N, ids)) return;
  for (const P of linkedPeers(N)) send(P, { t: '_r', ids });
}
// → true if it changed; tells the game who came and who left
function setRoster(N, ids) {
  const before = N.roster.map(playerOf), after = ids.map(playerOf);
  const same = ids.length === N.roster.length && ids.every((id, i) => id === N.roster[i]);
  N.roster = ids;
  if (same) return false;
  for (const p of before) if (!after.includes(p)) N.emit('leave', p);
  for (const p of after) if (!before.includes(p)) N.emit('join', p);
  N.emit('players', after);
  return true;
}

/* ---------- messages ---------- */
// to everyone else (to: undefined) or one player. A guest sends everything to the host, which passes it on.
function sendRoom(N, msg, to, opts) {
  if (N.role === 'host') {
    for (const P of linkedPeers(N)) if (to === undefined || P.pid === to) send(P, msg, opts);
    return;
  }
  const H = hostPeer(N);
  if (!H || !H.linked) return;
  send(H, to === H.pid ? msg : { ...msg, _t: to === undefined ? '*' : to }, opts);
}

// A message from P (reliable: it was numbered, see link.js). The host passes on what a guest sent to others:
// _t says to whom ('*': everyone), _f (only from the host) who wrote it.
function arrive(N, P, m, reliable) {
  if (m.t === '_r') {                                  // the roster, from the host
    if (N.role === 'guest' && P.id === N.host && Array.isArray(m.ids) && m.ids.length <= MAX_PLAYERS && m.ids.every(i => typeof i === 'string' && i.length < 64)) setRoster(N, m.ids);
    return;
  }
  if (m.t[0] === '_') return;
  const to = m._t, from = N.role === 'host' ? P.pid : typeof m._f === 'string' ? m._f : P.pid;
  delete m._t; delete m._f;
  if (N.role === 'host' && to !== undefined) {
    for (const Q of linkedPeers(N)) if (Q !== P && (to === '*' || Q.pid === to)) send(Q, { ...m, _f: from }, { fast: !reliable });
    if (to !== '*' && to !== playerOf(me)) return;
  }
  N.emit('message', m, from);
}

/* ---------- several links, one room ---------- */
// one player's figure, or the room's: the worst of all (a game waits for its slowest player)
function pick(N, id, fn, merge, none) {
  const ps = id === undefined ? linkedPeers(N) : linkedPeers(N).filter(P => P.pid === id);
  return ps.length ? ps.map(fn).reduce(merge) : none;
}
function roomStats(N, id) {
  const ps = id === undefined ? linkedPeers(N) : linkedPeers(N).filter(P => P.pid === id);
  if (!ps.length) return { rtt: null, peerRtt: null, direct: false, relayed: false, turn: null, weak: false };
  const all = ps.map(stats), worst = (k, f) => { const v = all.map(s => s[k]).filter(x => x != null); return v.length ? f(...v) : null; };
  return { rtt: worst('rtt', Math.max), peerRtt: worst('peerRtt', Math.max), direct: all.every(s => s.direct), relayed: all.some(s => s.relayed),
    turn: all.some(s => s.turn === true) ? true : all.every(s => s.turn === false) ? false : null, weak: ps.some(P => P.weak) };
}
// the room is "weak" while anyone linked is: the game waits for them
export function weakChanged(N) {
  const v = linkedPeers(N).some(P => P.weak);
  if (v === N.weak) return;
  N.weak = v;
  N.emit('weak', v);
}

// The watchdog (link.js): 5 times a second while linked, once a second while not (there is only broker upkeep
// to do then). It changes pace by itself; the time before its first tick is not sleep.
const pace = N => N.linked ? 200 : 1000;
export function startWatch(N) {
  stop(N, 'watchTimer');
  N.watchMs = pace(N); N.lastWatch = performance.now();
  N.watchTimer = setInterval(() => { watch(N); if (!N.closed && pace(N) !== N.watchMs) startWatch(N); }, N.watchMs);
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
export const stop = (o, ...timers) => { for (const k of timers) { clearTimeout(o[k]); o[k] = null; } };
function safe(fn) { try { return !!fn(); } catch (e) { return false; } }
