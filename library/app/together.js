/* =====================================================================
   Playing together. The library holds one room for two players (over the internet: a link; nearby:
   QR codes, no internet) for as long as they play, whatever game is open:
   - the view is shared: whatever one opens (a game, or the shelf) opens for the other too;
   - each game gets the room as ihroteka.room: it is linked while both players have that game open.
   Messages on the room (besides the games' own, wrapped in 'lib-g'):
     lib       { v: game id | null, s: seq }   "this is what we look at"; the higher seq wins, the host breaks ties
     lib-here  { v: game id | null }           "my copy of this game is open and listening"
   The screens for all this are in invite.js; it follows the room through onChange.
   ===================================================================== */
import { joinNearby, joinRoom, validRoomCode } from '../net/index.js';
import { safe } from './dom.js';

const LIB = 'ihroteka';                                  // the room namespace of the whole library
const LAST = 'ihroteka-room';                            // the last internet room: the same link keeps working

let shell = null;                                        // { current() → game id | null, follow(id), invite(), address(id) }
let room = null;                                         // the room (see ../net), with .kind and .lastStatus
let seq = 0;                                             // version of the shared view
let peerHere = null, myHere = null;                      // which game each side has open and listening
let ch = null;                                           // the open game's channel (ihroteka.room)
const listeners = new Set();

export function initTogether(s) {
  shell = s;
  const code = (new URLSearchParams(location.search).get('room') || '').toLowerCase();
  if (validRoomCode(code)) startInternet(code);         // opened from a friend's link
}

/* ---------- the room ---------- */
export const currentRoom = () => room;
export const linked = () => !!room && room.linked;
const inGame = () => linked() && !!ch && myHere === ch.id && peerHere === ch.id;
const send = m => { if (linked()) room.send(m); };
// the screens follow the room: fn(what) with what = linked | relinked | peer-gone | replaced | status | weak | stats | left
export const onChange = fn => listeners.add(fn);
const changed = what => { for (const fn of listeners) safe(fn, what); };

export function startInternet(code) {
  leave();
  try { localStorage.setItem(LAST, code); } catch (e) {}
  setQuery(code);
  return wire(joinRoom({ game: LIB, code }), 'internet');
}
export const lastInternetCode = () => { const c = safe(() => localStorage.getItem(LAST)); return validRoomCode(c) ? c : null; };
export function startNearby() {
  leave();
  return wire(joinNearby({ game: LIB }), 'nearby');
}
export function leave() {
  const r = room;
  room = null; peerHere = null;
  if (r) { r.leave(); setQuery(null); }
  update();
  changed('left');
}
// for checks from the console and tests
export const state = () => ({ kind: room && room.kind, role: room && room.role, linked: linked(), status: room && room.lastStatus, seq, myHere, peerHere, inGame: inGame() });

function wire(r, kind) {
  room = r; r.kind = kind; seq = 0; peerHere = null;
  const policy = name => () => inGame() && !!ch.policy(name);
  r.keepSeat = policy('keepSeat'); r.patient = policy('patient'); r.streaming = policy('streaming');
  r.pulse = now => { const g = inGame() && ch.pulseOut(now); return g ? { v: ch.id, g } : null; };
  const on = (name, fn) => r.on(name, (...a) => { if (room === r) { safe(fn, ...a); changed(name); } });
  const hello = () => {                                  // a (new) link: who shows the way, and where we are
    seq = 0; peerHere = null;
    if (r.role === 'host') sendView(shell.current(), true);   // whoever invited shows the way
    send({ t: 'lib-here', v: myHere });
  };
  on('linked', () => { hello(); update(); });
  on('relinked', () => { if (ch) ch.relinking = true; hello(); update(); });   // the friend reopened the library in a new tab
  on('peer-gone', () => {
    peerHere = null; update();
    if (r.kind === 'nearby') queueMicrotask(leave);      // a nearby link cannot come back without pairing again
  });
  on('replaced', () => queueMicrotask(leave));            // this library is open in another tab of ours
  on('status', st => { r.lastStatus = st; });
  on('weak', v => { if (ch && (inGame() || ch.weak)) { ch.weak = v; ch.emit('weak', v); } });
  on('stats', s => { if (ch) ch.emit('stats', s); });
  r.on('tick', now => { if (room === r && inGame()) ch.emit('tick', now); });
  r.on('pulse', p => { if (room === r && p && inGame() && p.v === ch.id && p.g && typeof p.g === 'object') ch.emit('pulse', p.g); });
  r.on('message', m => { if (room === r) onLibMessage(m); });
  changed('status');
  return r;
}

function onLibMessage(m) {
  const id = v => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v));
  if (m.t === 'lib' && id(m.v) && Number.isInteger(m.s)) {
    if (m.s > seq || (m.s === seq && room.role === 'guest')) {   // newer, or a tie the host wins
      seq = m.s;
      if (m.v !== shell.current()) shell.follow(m.v);
    } else if (m.s === seq && room.role === 'host') sendView(shell.current(), false);
  } else if (m.t === 'lib-here' && id(m.v)) {
    peerHere = m.v; update();
  } else if (m.t === 'lib-g' && ch && m.v === ch.id && myHere === ch.id) {
    ch.receive(m.m);
  }
}

function sendView(v, bump) {
  if (bump) seq++;
  send({ t: 'lib', v, s: seq });
}
// the shell switched to another view: on its own (tell the friend) or following the friend
export function viewChanged(id, byPeer) {
  if (!byPeer) sendView(id, true);
}

/* ---------- the address bar: an internet room stays in the link (?room=), so a reload rejoins ---------- */
export const query = () => room && room.kind === 'internet' ? '?room=' + room.code : '';
function setQuery(code) {
  try { history.replaceState(history.state, '', location.pathname + (code ? '?room=' + code : '')); } catch (e) {}
}

/* ---------- the room each game sees: ihroteka.room ---------- */
// attach: the game's page is loaded and about to run its code
export function attachGame(id) {
  detachGame();
  ch = channel(id);
  myHere = id;
  send({ t: 'lib-here', v: id });
  queueMicrotask(update);
  return ch.api;
}
export function detachGame() {
  if (!ch) return;
  ch.dispose();
  ch = null; myHere = null;
  send({ t: 'lib-here', v: null });
}

function channel(id) {
  const handlers = new Map(), inbox = [];
  const c = {
    id, was: false, relinking: false, weak: false, disposed: false,
    emit(name, ...a) { for (const fn of handlers.get(name) || []) safe(fn, ...a); },
    policy: name => typeof api[name] === 'function' && safe(api[name]),
    pulseOut: now => typeof api.pulse === 'function' ? safe(api.pulse, now) : null,
    receive(m) {
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (handlers.has('message')) c.emit('message', m);
      else if (inbox.length < 64) inbox.push(m);       // the game has not started listening yet
    },
    dispose() { handlers.clear(); inbox.length = 0; c.disposed = true; }
  };
  const api = {
    get role() { return room ? room.role : null; },    // 'host' or 'guest' (the host usually runs the game)
    get linked() { return inGame(); },                 // both players have this game open
    get weak() { return inGame() && room.weak; },      // the other player went quiet: pause and wait
    get leaving() { return inGame() && room.leaving; },
    get direct() { return !!room && room.direct; },
    get nearby() { return !!room && room.nearby; },
    // the game's policies (see ../net/room.js): keepSeat, patient, streaming, pulse
    keepSeat: null, patient: null, streaming: null, pulse: null,
    on(name, fn) {
      if (c.disposed) return api;
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      // late listeners still learn the current state (a game often starts after the link is up)
      if (name === 'linked' && inGame()) queueMicrotask(() => { if (!c.disposed && inGame()) safe(fn); });
      if (name === 'message' && inbox.length) queueMicrotask(() => { for (const m of inbox.splice(0)) c.emit('message', m); });
      return api;
    },
    send(msg, opts) { if (inGame() && msg && typeof msg.t === 'string') room.send({ t: 'lib-g', v: id, m: msg }, opts); },
    lag: () => room ? room.lag() : 0,
    stats: () => room ? room.stats() : { rtt: null, peerRtt: null, direct: false, relayed: false, turn: null },
    diag: () => room ? room.diag() : 'no room',
    frame: now => { if (room) room.frame(now); },
    kick: () => { if (room) room.kick(); },
    invite: () => shell.invite()
  };
  c.api = api;
  return c;
}

// tell the open game when the other player arrives in it or leaves it
function update() {
  if (!ch) return;
  const now = inGame();
  if (now === ch.was) return;
  ch.was = now;
  if (now) {
    const re = ch.relinking; ch.relinking = false;
    ch.emit(re ? 'relinked' : 'linked');
    if (ch.weak && !room.weak) { ch.weak = false; ch.emit('weak', false); }   // the silence ended while the game was not linked
  }
  else if (!ch.relinking) ch.emit('peer-gone');
}
