// What every room has, however the players found each other: who is in it, the links between us, events, the
// game's policies and the public room object. internet.js and nearby.js add how players meet.
//
// Players are known by name: whoever comes in with a name is that player, from any tab, browser or device.
// The same name again takes the place over (the old tab or device is told so and steps aside); a player who
// drops out keeps their place for a while (HOLD) and gets it back by coming in with the same name.
//
// A room is a star: one host and up to max - 1 guests, each linked to the host only. (Over the internet the
// guests could reach each other too, but nearby they often cannot: one shape for both.) The host passes on what
// a guest sends to the others and keeps the list of players: who, in the order they came, and who is away
// (no link, or silent) since when. Everyone gets it. When the host goes away, the first player on the list who
// is here takes over (internet rooms, see internet.js); the old host keeps its place like anyone else.
//
// Room state is N; the link with each other tab is a peer P (link.js, rtc.js): a guest has one (with the host),
// the host one per guest. Links are by session (one per tab); places are by name.
import { me } from './config.js';
import { closeRtc } from './rtc.js';
import { deliver, diag, keepDirectAlive, kick, lag, refresh, resetPaths, send, stats, watch } from './link.js';

// Messages of the room itself on a link: p (pulse), q (ping answer), bye; and _r (the players), _h (nearby hello),
// _x (a guest asks the host to let a player's place go). A game's message types must not start with '_' and be
// none of these.
const RESERVED = new Set(['p', 'q', 'bye']);
export const MAX_PLAYERS = 8;
export const HOLD = 180000;                            // how long a player who dropped out keeps their place
export const NAME = /^\S(?:.{0,22}\S)?$/u;             // a name: 1 to 24 characters, no spaces around

/**
 * name    this player's name
 * relay   true: the brokers carry data when the direct link cannot (internet rooms)
 * max     players in the room, the host included (2…MAX_PLAYERS)
 * close   (N, final) => void: protocol-specific part of leaving
 * bye     (N) => void: protocol-specific goodbye when the tab closes
 */
export function newRoom({ game, code = '', name, relay, max = MAX_PLAYERS, close, bye }) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('room: a name of 1 to 24 characters');
  const ev = emitter();
  const N = {
    game, code, name, relay, lostAfter: HOLD, max: Math.max(2, Math.min(MAX_PLAYERS, max | 0 || MAX_PLAYERS)), emit: ev.emit, closed: false,
    // brokers (brokers.js); seq starts from the clock, so numbers of a new connection never collide with what
    // the other players remember from our previous one
    topic: '', clients: [], br: [], seq: Date.now(), last: new Map(), ready: false, up: false, kickAt: -1e9, kAt: 0, winAt: 0, pubN: 0,
    // our role, the host's session (when we are a guest), the links (session → peer), the players
    // ({ n: name, s: session, a: away since, 0 while here }, in the order they came; ours has s = me)
    role: null, host: null, peers: new Map(), members: [{ n: name, s: me, a: 0 }], sent: '', told: [],
    linked: false, weak: false, statsDue: false, strangers: new Map(),
    // the watchdog (link.js)
    lastWatch: 0, watchMs: 0, graceUntil: 0,
    // timers
    whoTimer: null, annTimer: null, helloTimer: null, failTimer: null, fullTimer: null, watchTimer: null
  };

  const room = {
    get code() { return code; },
    get me() { return name; },                         // our name
    get role() { return N.role; },                     // null until known, then 'host' or 'guest' ('out' when replaced)
    get host() { return N.role === 'host' ? name : (hostPeer(N) || {}).name || null; },
    get players() { return N.members.map(m => m.n); }, // everyone in the room, us included, in the order they came
    // a player who dropped out (their place is kept): for how long, ms; 0 while they are here
    away: n => { const m = memberOf(N, n); return m && m.a ? performance.now() - m.a : 0; },
    get max() { return N.max; },
    get linked() { return N.linked; },                 // someone else is here and we hear each other
    get weak() { return N.weak; },                     // someone linked went quiet
    get direct() { const l = linkedPeers(N); return l.length > 0 && l.every(P => P.via === 'p2p'); },
    get nearby() { return !relay; },                   // a nearby room (no internet involved)
    // a broker answers us: connected and heard lately (it echoes us every 5 s); a nearby room has none: always
    get online() { const t = performance.now(); return !relay || N.clients.some(c => c && c._ok && t - c._rx < 7000); },
    // The game's policy (replace these functions):
    streaming: () => false,                            // the host streams state every frame (a direct link counts as dead sooner)
    pulse: null,                                       // (now) => object: extra fields for the pulse sent 5 times a second
    on(name, fn) { ev.on(name, fn); return room; },
    // to everyone else, or { to: name }; also { fast, latest } (see link.js)
    send(msg, { to, ...opts } = {}) {
      if (!msg || typeof msg.t !== 'string' || RESERVED.has(msg.t) || msg.t[0] === '_') throw new Error('room: a message needs a string t, not starting with _ and other than ' + [...RESERVED].join(', '));
      if (to !== name) sendRoom(N, msg, to, opts);
    },
    // let the place of a player who dropped out go now (nobody wants to wait any longer)
    release: n => release(N, n),
    lag: n => pick(N, n, lag, Math.max, 0),            // one-way delay estimate, ms (to one player, or the slowest)
    stats: n => roomStats(N, n),                       // { rtt, peerRtt, direct, relayed, turn, weak }
    diag: () => diag(N),                               // multi-line connection report
    frame: now => keepDirectAlive(N, now),             // optional, every animation frame: notices a silent direct link sooner
    kick: () => kick(N),                               // the network changed or the page became visible
    // Final (default): we left for good, our place goes. Not final: as if the tab closed, our place is kept
    // (this player goes on in another tab or device).
    leave(final = true) {
      if (N.closed) return;
      for (const P of linkedPeers(N)) try { send(P, final ? { t: 'bye', menu: 1 } : { t: 'bye' }); } catch (e) {}
      N.closed = true; N.linked = false;
      close(N, final);
      stop(N, 'watchTimer');
      for (const P of N.peers.values()) closePeer(P);
      removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onShow);
      removeEventListener('pageshow', onShow);
    }
  };
  Object.assign(N, {
    streaming: () => safe(room.streaming),
    pulse: now => { try { return room.pulse && room.pulse(now); } catch (e) { console.error(e); return null; } },
    refresh: P => { refresh(P); N.statsDue = true; },
    arrive: (P, m, reliable) => arrive(N, P, m, reliable),
    roomStats: () => roomStats(N)
  });

  // closing the tab: say goodbye by every path we still can (our place is kept: maybe it was a reload)
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

/* ---------- links ---------- */
export const linkedPeers = N => { const out = []; for (const P of N.peers.values()) if (P.linked) out.push(P); return out; };
export const hostPeer = N => N.host ? N.peers.get(N.host) || null : null;

// the link with one other tab (its fields: link.js and rtc.js); name: whose tab, once known
export function newPeer(N, id, name = '') {
  const P = {
    N, id, name, linked: false, weak: false, weakAt: 0, lastSeen: performance.now(), early: [],
    // brokers: whether we listen to their mailbox, which brokers bring their data first, which bring ours to them
    heard: false, win: [], peerBest: [], peerBestAt: -1e9,
    // paths, numbering and ping (link.js)
    via: 'relay', viaAt: 0, q: [], qLatest: new Map(), relayAt: 0, qTimer: null, ackTimer: null, pingAt: 0, pN: 0, nudged: 0,
    // direct link (rtc.js)
    pc: null, dcF: null, dcC: null, dcSeen: 0, dcBorn: 0, iceQ: [], rtcK: null, rtcNext: 0, rtcTries: 0, rtcTimer: null,
    turn: null, cand: '', iceRtt: null, statsAt: 0, failing: false
  };
  resetPaths(P);
  N.peers.set(id, P);
  return P;
}
// the player goes on in another tab: the link carries on under the new session
export function renamePeer(N, P, id) {
  N.peers = new Map([...N.peers].map(([k, v]) => v === P ? [id, v] : [k, v]));
  if (N.host === P.id) N.host = id;
  P.id = id;
}
export function closePeer(P) {
  stop(P, 'qTimer'); stop(P, 'ackTimer');
  P.q = []; P.qLatest.clear();
  closeRtc(P);
}

// the link with P works: both hear each other
export function markLinked(P) {
  const N = P.N, first = !N.linked;
  P.linked = true; N.linked = true;
  P.lastSeen = performance.now();
  P.weak = false; P.weakAt = 0; P.rtcTries = 0; P.rtcNext = performance.now() + 300;
  resetPaths(P);
  if (N.watchTimer) startWatch(N);                     // at full pace from now on
  N.emit('status', 'ready');
  N.refresh(P);
  if (first) N.emit('linked');
  presence(N);
  const early = P.early;                               // what arrived a moment before the link opened
  P.early = [];
  for (const m of early) deliver(P, m, N.relay);
}

// the link with P is over (the tab is gone, or silent for too long). The player's place is not: see dropMember.
export function unlink(P) {
  const N = P.N;
  if (N.peers.get(P.id) !== P) return;
  const was = P.linked;
  P.linked = false;
  closePeer(P);
  if (N.onUnlink) N.onUnlink(P);                       // e.g. stop listening to their mailbox
  N.peers.delete(P.id);
  if (!was) return;
  N.linked = linkedPeers(N).length > 0;
  if (!N.linked) N.emit('peer-gone');
  weakChanged(N);
  N.statsDue = true;
}

/* ---------- the players ---------- */
export const memberOf = (N, n) => N.members.find(m => m.n === n) || null;

// Who is here now. The host: a player is here while a link to their tab works and is not silent, away since the
// moment it is not; when that changes, everyone hears it. A guest: as the host says, except the host itself,
// away while our link to it is (we see that first).
export function presence(N) {
  const now = performance.now();
  if (N.role === 'host') {
    for (const m of N.members) {
      if (m.s === me) { m.a = 0; continue; }
      const P = N.peers.get(m.s), here = !!P && P.linked && !P.weak;
      if (here) m.a = 0; else if (!m.a) m.a = P && P.weakAt ? P.weakAt : now;
    }
    const wire = N.members.map(m => [m.n, m.s, m.a ? Math.round(now - m.a) : 0]);
    const key = JSON.stringify(wire.map(([n, s, a]) => [n, s, !!a]));
    if (key !== N.sent) { N.sent = key; for (const P of linkedPeers(N)) send(P, { t: '_r', m: wire }); }
  } else {
    const H = hostPeer(N), hm = H && N.members.find(m => m.s === H.id);
    if (hm) { const away = !H.linked || H.weak; if (away && !hm.a) hm.a = H.weakAt || now; else if (!away) hm.a = 0; }
  }
  tell(N);
}
// a player comes in (or back, from any tab): their place, now on this session
export function seatMember(N, n, s) {
  const m = memberOf(N, n);
  if (m) { m.s = s; m.a = 0; } else N.members.push({ n, s, a: 0 });
  presence(N);
}
// a player's place goes (they left for good, nobody waits for them any more, or HOLD is over)
export function dropMember(N, n) {
  const m = memberOf(N, n);
  if (!m || m.s === me) return;
  N.members = N.members.filter(x => x !== m);
  const P = N.peers.get(m.s);
  if (P) unlink(P);
  presence(N);
}
// the host: places kept for longer than HOLD go
export function holdOver(N, now) {
  if (N.role !== 'host') return;
  for (const m of [...N.members]) if (m.a && now - m.a > HOLD) dropMember(N, m.n);
}
// The game hears who came, who left, who dropped out or is back, and who goes on in a new tab.
function tell(N) {
  const before = N.told, after = N.members.map(m => ({ n: m.n, s: m.s, away: !!m.a }));
  N.told = after;
  for (const b of before) if (!after.some(a => a.n === b.n)) N.emit('leave', b.n);
  for (const a of after) {
    const b = before.find(x => x.n === a.n);
    if (!b) { if (a.n !== N.name) N.emit('join', a.n); continue; }
    if (b.s !== a.s && a.n !== N.name) N.emit('relinked', a.n, true);   // (true: a new session — a new tab or device)
    if (b.away !== a.away) N.emit('away', a.n, a.away);
  }
  if (before.map(x => x.n).join('\n') !== after.map(x => x.n).join('\n')) N.emit('players', after.map(x => x.n));
}
// a guest: the players as the host sent them (we are in it; if not yet, we add ourselves for now)
function setMembers(N, wire) {
  const now = performance.now();
  N.members = wire.map(([n, s, a]) => ({ n, s, a: a ? now - a : 0 }));
  if (!memberOf(N, N.name)) N.members.push({ n: N.name, s: me, a: 0 });
  presence(N);
}
// A guest just linked with the host: until it sends the players, the list we had (the host here now, on its
// session) if it fits, else the two of us.
export function guestMembers(N, hostName) {
  const h = memberOf(N, hostName);
  if (h) { h.s = N.host; h.a = 0; } else N.members = [{ n: hostName, s: N.host, a: 0 }, { n: N.name, s: me, a: 0 }];
  presence(N);
}
const validWire = w => Array.isArray(w) && w.length <= MAX_PLAYERS && w.every(x => Array.isArray(x) && typeof x[0] === 'string' && NAME.test(x[0]) && typeof x[1] === 'string' && x[1].length < 64 && Number.isFinite(x[2]));

// Let a player's place go: the host does it; a guest asks the host. For the host itself, a guest moves on
// (internet.js: releaseHost).
function release(N, n) {
  if (n === N.name) return;
  if (N.role === 'host') {
    const m = memberOf(N, n), P = m && N.peers.get(m.s);
    if (P && P.linked) send(P, { t: 'bye', menu: 1 });   // if it is still there somewhere: it is not in the room any more
    dropMember(N, n);
    return;
  }
  const H = hostPeer(N);
  if (H && H.name === n) { if (N.releaseHost) N.releaseHost(); return; }
  if (H && H.linked) send(H, { t: '_x', n });
}

/* ---------- messages ---------- */
// to everyone else (to: undefined) or one player by name. A guest sends everything to the host, which passes it on.
function sendRoom(N, msg, to, opts) {
  if (N.role === 'host') {
    for (const P of linkedPeers(N)) if (to === undefined || P.name === to) send(P, msg, opts);
    return;
  }
  const H = hostPeer(N);
  if (!H || !H.linked) return;
  send(H, to === H.name ? msg : { ...msg, _t: to === undefined ? '*' : to }, opts);
}

// A message from P (reliable: it was numbered, see link.js). The host passes on what a guest sent to others:
// _t says to whom ('*': everyone), _f (only from the host) who wrote it.
function arrive(N, P, m, reliable) {
  if (m.t === '_r') {                                  // the players, from the host
    if (N.role === 'guest' && P.id === N.host && validWire(m.m)) setMembers(N, m.m);
    return;
  }
  if (m.t === '_x') {                                  // a guest: let this player's place go (only if they are away)
    if (N.role === 'host' && typeof m.n === 'string') { const t = memberOf(N, m.n); if (t && t.a) release(N, m.n); }
    return;
  }
  if (m.t[0] === '_') return;
  const to = m._t, from = N.role === 'host' ? P.name : typeof m._f === 'string' ? m._f : P.name;
  delete m._t; delete m._f;
  if (N.role === 'host' && to !== undefined) {
    for (const Q of linkedPeers(N)) if (Q !== P && (to === '*' || Q.name === to)) send(Q, { ...m, _f: from }, { fast: !reliable });
    if (to !== '*' && to !== N.name) return;
  }
  N.emit('message', m, from);
}

/* ---------- several links, one room ---------- */
// one player's figure, or the room's: the worst of all (a game waits for its slowest player)
function pick(N, n, fn, merge, none) {
  const ps = n === undefined ? linkedPeers(N) : linkedPeers(N).filter(P => P.name === n);
  return ps.length ? ps.map(fn).reduce(merge) : none;
}
// One player's link, or all of them: the worst. A player who dropped out counts as weak.
function roomStats(N, n) {
  const ps = n === undefined ? linkedPeers(N) : linkedPeers(N).filter(P => P.name === n);
  const away = n !== undefined && !!(memberOf(N, n) || {}).a;
  if (!ps.length) return { rtt: null, peerRtt: null, direct: false, relayed: false, turn: null, weak: away };
  const all = ps.map(stats), worst = (k, f) => { const v = all.map(s => s[k]).filter(x => x != null); return v.length ? f(...v) : null; };
  return { rtt: worst('rtt', Math.max), peerRtt: worst('peerRtt', Math.max), direct: all.every(s => s.direct), relayed: all.some(s => s.relayed),
    turn: all.some(s => s.turn === true) ? true : all.every(s => s.turn === false) ? false : null, weak: away || ps.some(P => P.weak) };
}
// the room is "weak" while anyone linked is: the game waits for them
export function weakChanged(N) {
  const v = linkedPeers(N).some(P => P.weak);
  if (v !== N.weak) { N.weak = v; N.emit('weak', v); }
  presence(N);
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
