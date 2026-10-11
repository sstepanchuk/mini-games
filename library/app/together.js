/* =====================================================================
   Playing together. The library holds one room for up to 8 players (over the internet: a link; nearby:
   QR codes, no internet) for as long as they play, whatever game is open:
   - the view is shared: whatever one opens (a game, or the shelf) opens for everyone;
   - each game gets the room as ihroteka.room, with as many seats as the game has (game.json "players"):
     the first players to have the game open (in the room's order) play, the others wait for a seat.
   Messages on the room (besides the games' own, wrapped in 'lib-g'):
     lib       { v: game id | null, s: seq, b: by }  "this is what we look at"; the higher seq wins, and between
                                                     equal ones the smaller player id (b: who chose it), so all agree
     lib-here  { v: game id | null }                 "my copy of this game is open and listening"
   The screens for all this are in invite.js; it follows the room through onChange.
   ===================================================================== */
import { joinNearby, joinRoom, playerOf, tabId, validRoomCode } from '../net/index.js';
import { safe } from './dom.js';

const LIB = 'ihroteka';                                  // the room namespace of the whole library
const LAST = 'ihroteka-room';                            // the last internet room: the same link keeps working
const ID = v => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v));

let shell = null;                                        // { current() → game id | null, follow(id), invite(), address(), seats(id) }
let room = null;                                         // the room (see ../net), with .kind and .lastStatus
const NOBODY = '\uffff';                                 // sorts after every player id
let seq = 0, by = NOBODY;                                // version of the shared view, and who chose it
let myHere = null;                                       // the game we have open and listening
const here = new Map();                                  // player → the game they have open
let ch = null;                                           // the open game's channel (ihroteka.room)
const listeners = new Set();

export function initTogether(s) {
  shell = s;
  if (tabs) tabs.onmessage = e => onTab(e.data || {});
  const code = (new URLSearchParams(location.search).get('room') || '').toLowerCase();
  if (validRoomCode(code)) openLink(code);              // opened from a link
}

/* ---------- tabs of this browser: one room, one tab ----------
   Opening the room's link again (the game was only minimised) must not break the game for the others. If
   another tab of this browser is in that room: a guest's seat simply moves to the new tab (the round goes on,
   see net/internet.js); a host's game lives in its tab, so the player is asked first; a tab still alone gives
   way at once. A frozen or closed tab does not answer: then the new one joins as usual. */
const tabs = (() => { try { return new BroadcastChannel('ihroteka-tabs'); } catch (e) { return null; } })();
const ME = playerOf(tabId);                              // this player (the same in every tab of this browser)
function onTab(m) {
  if (!room || room.kind !== 'internet' || m.code !== room.code || m.p !== ME) return;
  if (m.q === 'room?') tabs.postMessage({ a: 'here', code: room.code, p: ME, role: room.role, linked: room.linked });
  else if (m.q === 'take') { leave(); changed('taken'); }   // the player moved this room to another tab
}
// another tab of ours in this room? → { role, linked } or null
function otherTab(code) {
  return new Promise(done => {
    if (!tabs) return done(null);
    const ask = new BroadcastChannel('ihroteka-tabs');
    const t = setTimeout(() => { ask.close(); done(null); }, 400);
    ask.onmessage = e => { const m = e.data || {}; if (m.a === 'here' && m.code === code && m.p === ME) { clearTimeout(t); ask.close(); done(m); } };
    ask.postMessage({ q: 'room?', code, p: ME });
  });
}
async function openLink(code) {
  const other = await otherTab(code);
  if (!other || (other.role === 'guest' && other.linked)) return startInternet(code);   // a guest's seat moves here by itself
  const take = () => { tabs.postMessage({ q: 'take', code, p: ME }); setTimeout(() => startInternet(code), 1200); };
  if (other.role === 'host' && other.linked) shell.elsewhere(take, () => setQuery(null));   // the player decides
  else take();
}

/* ---------- the room ---------- */
export const currentRoom = () => room;
export const linked = () => !!room && room.linked;
const send = (m, to) => { if (linked()) room.send(m, to === undefined ? undefined : { to }); };
// the screens follow the room: fn(what) with what = linked | join | leave | relinked | peer-gone | replaced |
// status | weak | stats | left
export const onChange = fn => listeners.add(fn);
const changed = what => { for (const fn of listeners) safe(fn, what); };

export function startInternet(code) {
  leave();
  try { localStorage.setItem(LAST, code); } catch (e) {}
  setQuery(code);
  return wire(joinRoom({ game: LIB, code }), 'internet');
}
export const lastInternetCode = () => { const c = safe(() => localStorage.getItem(LAST)); return validRoomCode(c) ? c : null; };
// a nearby room; the host of one adds players to it (pairing again), so it is kept
export function startNearby() {
  if (room && room.kind === 'nearby' && room.role === 'host' && room.linked) return room;
  leave();
  return wire(joinNearby({ game: LIB }), 'nearby');
}
export function leave() {
  const r = room;
  room = null; here.clear();
  if (ch) ch.relinking.clear();
  if (r) { r.leave(); setQuery(null); }
  update();
  changed('left');
}
// for checks from the console and tests
export const state = () => ({ kind: room && room.kind, role: room && room.role, linked: linked(), status: room && room.lastStatus,
  players: room ? room.players : [], seq, myHere, here: Object.fromEntries(here), game: ch && { players: ch.seated, linked: ch.api.linked, role: ch.api.role } });

function wire(r, kind) {
  room = r; r.kind = kind; seq = 0; by = NOBODY; here.clear();
  const policy = name => () => !!ch && ch.api.linked && !!ch.policy(name);
  r.keepSeat = policy('keepSeat'); r.patient = policy('patient'); r.streaming = policy('streaming');
  r.pulse = now => { const g = ch && ch.api.linked && ch.pulseOut(now); return g ? { v: ch.id, g } : null; };
  const on = (name, fn) => r.on(name, (...a) => { if (room === r) { safe(fn, ...a); changed(name); } });
  // Someone new (or a new tab of theirs): everyone tells them the view as they know it (so whoever missed a change
  // while away catches up: the newest, by the same order everywhere, wins) and where they are.
  const greet = p => {
    send({ t: 'lib', v: shell.current(), s: seq, b: by === NOBODY ? r.me : by }, p);
    send({ t: 'lib-here', v: myHere }, p);
  };
  on('linked', () => { if (r.role === 'host') sendView(shell.current(), true); update(); });
  on('join', p => { greet(p); update(); });
  on('leave', p => { here.delete(p); if (ch) ch.relinking.delete(p); update(); });
  on('relinked', p => {                                  // their new tab is coming: if they played, their seat waits for it
    if (here.get(p) === myHere && myHere) { if (ch) ch.relinking.add(p); send({ t: 'lib-relinking', p }); }
    here.delete(p); greet(p); update();
  });
  on('peer-gone', () => {
    here.clear(); if (ch) ch.relinking.clear(); update();
    if (r.kind === 'nearby') queueMicrotask(leave);      // nearby, a room cannot come back without pairing again
  });
  on('replaced', () => queueMicrotask(leave));            // this library is open in another tab of ours
  on('status', st => { r.lastStatus = st; });
  on('weak', () => { if (ch) ch.weakNow(); });
  on('stats', () => { if (ch) { ch.weakNow(); if (ch.api.linked) ch.emit('stats', ch.api.stats()); } });
  r.on('tick', now => { if (room === r && ch && ch.api.linked) ch.emit('tick', now); });
  r.on('pulse', (p, from) => { if (room === r && ch && ch.api.linked && p && p.v === ch.id && p.g && typeof p.g === 'object' && ch.seated.includes(from)) ch.emit('pulse', p.g, from); });
  r.on('message', (m, from) => { if (room === r) onLibMessage(m, from); });
  changed('status');
  return r;
}

function onLibMessage(m, from) {
  if (m.t === 'lib' && ID(m.v) && Number.isInteger(m.s) && typeof m.b === 'string') {
    if (m.s > seq || (m.s === seq && m.b < by)) {      // newer, or as new and chosen by a smaller id: everyone agrees on it
      seq = m.s; by = m.b;
      if (m.v !== shell.current()) shell.follow(m.v);
    }
  } else if (m.t === 'lib-relinking' && typeof m.p === 'string') {   // the host says a player's new tab is coming
    if (ch && here.get(m.p) === ch.id) { ch.relinking.add(m.p); update(); }
  } else if (m.t === 'lib-here' && ID(m.v)) {
    here.set(from, m.v);
    if (ch && m.v === ch.id && ch.relinking.delete(from) && ch.seated.includes(from)) ch.emit('relinked', from);
    update();
  } else if (m.t === 'lib-g' && ch && m.v === ch.id && myHere === ch.id) {
    ch.receive(m.m, from);
  }
}

function sendView(v, bump) {
  if (bump) { seq++; by = room.me; }
  send({ t: 'lib', v, s: seq, b: by });
}
// the shell switched to another view: on its own (tell the others) or following someone
export function viewChanged(id, byPeer) {
  if (!byPeer && linked()) sendView(id, true);
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
  ch = channel(id, Math.max(1, shell.seats(id)));
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

// who has this game open, in the room's order (the host first, then by arrival); a player whose new tab
// is on its way keeps their place
function inGameOf(c) {
  if (!linked() || myHere !== c.id) return [];
  return room.players.filter(p => p === room.me || here.get(p) === c.id || c.relinking.has(p));
}
// who has the game open, who of them plays, and who we play with: counted again whenever any of it may have
// changed (update), so the game's many questions (several per frame) cost nothing
function recount(c) {
  const all = inGameOf(c), seated = all.slice(0, c.seats);
  c.inGame = all; c.seated = seated;
  c.others = room && seated.includes(room.me) ? seated.filter(p => p !== room.me) : [];
}

function channel(id, seats) {
  const handlers = new Map(), inbox = [];
  const others = () => c.others;                       // who we play with
  const c = {
    id, seats, disposed: false, relinking: new Set(), was: [], weak: false, inGame: [], seated: [], others: [],
    emit(name, ...a) { for (const fn of handlers.get(name) || []) safe(fn, ...a); },
    policy: name => typeof api[name] === 'function' && safe(api[name]),
    pulseOut: now => typeof api.pulse === 'function' ? safe(api.pulse, now) : null,
    receive(m, from) {
      if (!api.linked || !others().includes(from) || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (handlers.has('message')) c.emit('message', m, from);
      else if (inbox.length < 64) inbox.push([m, from]);   // the game has not started listening yet
    },
    // the game waits while one of its players went quiet
    weakNow() {
      const v = api.linked && others().some(p => room.stats(p).weak);
      if (v !== c.weak) { c.weak = v; c.emit('weak', v); }
    },
    dispose() { handlers.clear(); inbox.length = 0; c.disposed = true; }
  };
  const worst = (fn, merge, none) => { const o = others(); return o.length ? o.map(fn).reduce(merge) : none; };
  const api = {
    get me() { return room ? room.me : null; },        // our player id
    get players() { return c.seated.slice(); },        // who plays: up to `seats` players, the game's host first
    get waiting() { return c.inGame.slice(seats); },   // who has the game open too, waiting for a seat
    get seats() { return seats; },
    get seated() { return !!room && c.seated.includes(room.me); },   // we have a seat
    get host() { return c.seated[0] || null; },        // the player whose copy usually runs the game
    get role() { return !api.seated ? null : c.seated[0] === room.me ? 'host' : 'guest'; },
    get linked() { return c.others.length > 0; },      // we have a seat, and someone else is playing too
    get weak() { return c.weak; },                     // a player went quiet: pause and wait
    get leaving() { return api.linked && room.leaving; },
    get direct() { return api.linked && others().every(p => room.stats(p).direct); },
    get nearby() { return !!room && room.nearby; },
    // the game's policies (see ../net/room.js): keepSeat, patient, streaming, pulse
    keepSeat: null, patient: null, streaming: null, pulse: null,
    on(name, fn) {
      if (c.disposed) return api;
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      // late listeners still learn the current state (a game often starts after the link is up)
      if (name === 'linked' && api.linked) queueMicrotask(() => { if (!c.disposed && api.linked) safe(fn); });
      if (name === 'message' && inbox.length) queueMicrotask(() => { for (const [m, from] of inbox.splice(0)) c.emit('message', m, from); });
      return api;
    },
    // to every other player, or { to: player id }; { fast, batch } as in ../net/link.js
    send(msg, { to, ...opts } = {}) {
      if (!api.linked || !msg || typeof msg.t !== 'string') return;
      const o = others(), out = { t: 'lib-g', v: id, m: msg };
      if (to !== undefined) { if (o.includes(to)) room.send(out, { to, ...opts }); }
      else if (o.length === room.players.length - 1) room.send(out, opts);   // everyone else plays: one message for all
      else for (const p of o) room.send(out, { to: p, ...opts });
    },
    lag: p => !room ? 0 : p !== undefined ? room.lag(p) : worst(q => room.lag(q), Math.max, 0),
    stats: p => statsOf(p !== undefined ? (room ? [p] : []) : others()),
    diag: () => room ? room.diag() : 'no room',
    frame: now => { if (room) room.frame(now); },
    kick: () => { if (room) room.kick(); },
    invite: () => shell.invite()
  };
  c.api = api;
  return c;
}
// the worst of these players' links: a game goes as fast as its slowest player
function statsOf(ps) {
  if (!room || !ps.length) return { rtt: null, peerRtt: null, direct: false, relayed: false, turn: null, weak: false };
  const all = ps.map(p => room.stats(p)), max = k => { const v = all.map(s => s[k]).filter(x => x != null); return v.length ? Math.max(...v) : null; };
  return { rtt: max('rtt'), peerRtt: max('peerRtt'), direct: all.every(s => s.direct), relayed: all.some(s => s.relayed),
    turn: all.some(s => s.turn === true) ? true : all.every(s => s.turn === false) ? false : null, weak: all.some(s => s.weak) };
}

// Tell the open game who plays now. Its host leaving (or a new one) ends the round: 'peer-gone', then 'linked'
// again if someone is left to play with; otherwise players coming and going are 'join' and 'leave'. In a game
// for two, the other player is the round: someone else taking the seat is 'peer-gone', then 'linked' as well.
function update() {
  if (!ch) return;
  recount(ch);
  const now = ch.api.linked ? ch.seated : [], was = ch.was, seen = ch.seated.join() + '|' + ch.inGame.join();
  if (seen !== ch.seen) { ch.seen = seen; if (now.join() === was.join()) ch.emit('players', ch.api.players); }   // also for those waiting
  if (now.join() === was.join()) return;
  ch.was = now;
  const hostChanged = now[0] !== was[0] || (ch.seats === 2 && now[1] !== was[1]);
  if (was.length && (!now.length || hostChanged)) ch.emit('peer-gone');
  if (now.length && (!was.length || hostChanged)) {
    ch.emit('linked');
    if (ch.weak && !room.weak) { ch.weak = false; ch.emit('weak', false); }   // the silence ended while the game was not linked
  } else if (now.length) {
    for (const p of was) if (!now.includes(p)) ch.emit('leave', p);
    for (const p of now) if (!was.includes(p)) ch.emit('join', p);
  }
  ch.emit('players', ch.api.players);
  ch.weakNow();
}
