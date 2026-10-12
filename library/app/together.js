/* =====================================================================
   Playing together. The library holds one room for up to 8 players (over the internet: a link; nearby: QR
   codes, no internet) for as long as they play, whatever game is open. Players are known by the name they
   come in with (net/room.js): from another tab, browser or device, the same name is the same player.
   - What everyone looks at, which game each player has open, and whose copy runs a round are shared state
     (roomstate.js): the same for everyone, whoever passes the messages on.
   - Each game gets the room as ihroteka.room, with as many seats as it has (game.json "players"): the first
     players to have it open, in the room's order, play; anyone after them waits for a seat. A player who
     dropped out keeps their seat while the room keeps their place: the game pauses, and the library shows who
     we wait for, with a way not to (invite.js).
   - A round outlives the device that runs it: the game hands the library snapshots (room.snapshot) and every
     player keeps the latest. If the player whose copy runs the round has been away for AUTH_WAIT, the next one
     here runs it on from the snapshot (event 'resume'); whoever comes back simply plays on.
   The rules of all this (who plays, who runs the round, who is away, when the round moves) are in rules.js.
   Messages on the room, besides the games' own ('lib-g'): lib-state { e: entries } (the shared state, or a change
   to it), lib-snap { v: game, s: snapshot | null, c: version }.
   The screens for all this are in invite.js; it follows the room through onChange.
   ===================================================================== */
import { HOLD, joinNearby, joinRoom, NAME, TIMING, validRoomCode } from '../net/index.js';
import { safe } from './dom.js';
import { roomState } from './roomstate.js';
import * as rules from './rules.js';

const LIB = 'ihroteka';                                  // the room namespace of the whole library
const LAST = 'ihroteka-room', LAST_NAME = 'ihroteka-name';   // the last room (its link keeps working) and name
const AUTH_WAIT = TIMING.AUTH_WAIT;                      // a round's runner away this long: someone else runs it on
const ID = v => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v));
// the site's version, first in room.diag() and state() (the build writes it into the page, tools/build.js siteVersion;
// 'dev' on the dev server, '?' where the page has none: an old page, a worker tab)
const SITE = 'Ігротека ' + (globalThis.document?.querySelector?.('meta[name="ihroteka-version"]')?.content || '?');

let shell = null;                                        // { current(), follow(id), invite(), address(), seats(id), askName(...) }
let room = null;                                         // the room (see ../net), with .kind and .lastStatus
let st = null;                                           // its shared state (roomstate.js)
let myHere = null;                                       // the game we have open and listening
let ch = null;                                           // the open game's channel (ihroteka.room)
let replaced = null;                                     // { kind, code, name }: this player went on in another tab
const snaps = new Map();                                 // game → { s, c }: the latest snapshot of a round
const loading = new Map();                               // name → since when: back in a new tab or device, its game not open yet
const stale = new Set();                                 // names whose new tab did not open their game for as long as a place is kept
const GKEY = /^[\w-]{1,40}$/;                            // a game's shared key (see channel: shared, share)
const listeners = new Set();

export function initTogether(s) {
  shell = s;
  setInterval(watchRunner, 1000);
  const code = (new URLSearchParams(location.search).get('room') || '').toLowerCase();
  if (validRoomCode(code)) shell.askName(name => startInternet(code, name), () => setQuery(null));   // opened from a link
}

/* ---------- the room ---------- */
export const currentRoom = () => room;
export const linked = () => !!room && room.linked;
export const elsewhere = () => replaced;
export const lastName = () => { const n = safe(() => localStorage.getItem(LAST_NAME)) || ''; return NAME.test(n) ? n : ''; };
export const validName = n => NAME.test(n);
const send = (m, to) => { if (linked()) room.send(m, to === undefined ? undefined : { to }); };
// the screens follow the room: fn(what) with what = linked | join | leave | away | relinked | peer-gone |
// replaced | status | weak | stats | left
export const onChange = fn => listeners.add(fn);
const changed = what => { for (const fn of listeners) safe(fn, what); };

export function startInternet(code, name) {
  leave();
  remember(LAST, code); remember(LAST_NAME, name);
  setQuery(code);
  return wire(joinRoom({ game: LIB, code, name }), 'internet');
}
export const lastInternetCode = () => { const c = safe(() => localStorage.getItem(LAST)); return validRoomCode(c) ? c : null; };
// a nearby room; its host adds players to it (pairing again), and a player whose link broke pairs again into
// it (to their place), so it is kept
export function startNearby(name) {
  if (room && room.kind === 'nearby' && (room.linked || room.role === 'host')) return room;
  leave();
  remember(LAST_NAME, name);
  return wire(joinNearby({ game: LIB, name }), 'nearby');
}
// this player went on in another tab or device; come back here (that one steps aside in turn)
export function comeBack() {
  const r = replaced;
  if (!r) return;
  replaced = null;
  if (r.kind === 'internet') startInternet(r.code, r.name);
}
export function leave() {
  const r = room;
  room = null; st = null; snaps.clear(); loading.clear(); stale.clear();
  if (r) { r.leave(); setQuery(null); }
  update();
  changed('left');
}
const remember = (k, v) => safe(() => localStorage.setItem(k, v));
// for checks from the console and tests
export const state = () => ({ site: SITE, kind: room && room.kind, role: room && room.role, linked: linked(), online: !!room && room.online, status: room && room.lastStatus,
  me: room && room.me, players: room ? room.players : [], away: room ? room.players.filter(p => room.away(p)) : [], view: st && st.get('view'), myHere,
  here: room && st ? Object.fromEntries(room.players.map(p => [p, p === room.me ? myHere : st.get('here:' + p) ?? null])) : {},
  game: ch && { players: ch.seated, linked: ch.api.linked, role: ch.api.role, host: ch.api.host, waiting: ch.api.waiting } });

function wire(r, kind) {
  room = r; r.kind = kind; st = roomState(r.me); snaps.clear(); loading.clear(); stale.clear(); replaced = null;
  // Which game we have open. A new tab of a player who is in a game says nothing yet: it follows the room into
  // that game in a moment, and a "not in the game" meanwhile would end the round for everyone (see staleHere).
  if (myHere) st.set('here:' + r.me, myHere);           // (the room's view: whoever opened the room shows the way)
  const policy = name => () => !!ch && ch.api.linked && !!ch.policy(name);
  r.streaming = policy('streaming');
  r.pulse = now => { const g = ch && ch.api.linked && ch.pulseOut(now); return g ? { v: ch.id, g } : null; };
  const on = (name, fn) => r.on(name, (...a) => { if (room === r) { safe(fn, ...a); changed(name); } });
  // someone new, or back from another tab or device: everything we know, and the rounds in progress
  const greet = p => {
    send({ t: 'lib-state', e: st.entries() }, p);
    for (const [v, s] of snaps) send({ t: 'lib-snap', v, s: s.s, c: s.c }, p);
  };
  on('linked', () => {
    if (r.role === 'host' && st.get('view') === undefined) publish(st.set('view', shell.current()));
    for (const p of r.players) if (p !== r.me) greet(p);
    update();
  });
  on('join', p => { greet(p); if (rules.arrivesLoading(facts, p, 'join')) loading.set(p, performance.now()); update(); });
  // Back in a new tab or device: until their game is open there again, the game waits for them (see 'here' below).
  // The same tab after its link started over: its game is still there, it only needs the full picture again.
  on('relinked', (p, fresh) => {
    greet(p);
    if (rules.arrivesLoading(facts, p, 'relinked', fresh)) loading.set(p, performance.now());
    update();
    if (!fresh && ch && ch.others.includes(p) && !loading.has(p)) ch.emit('relinked', p);
  });
  on('leave', update);
  on('away', update);
  on('peer-gone', () => {
    update();
    // nearby, nobody is left whose place is kept (they were away as long as places are kept): the room is over
    if (r.kind === 'nearby') queueMicrotask(() => { if (room === r && !r.linked) leave(); });
  });
  on('replaced', () => {                                  // this player went on in another tab or device
    replaced = { kind: r.kind, code: r.code, name: r.me };
    queueMicrotask(leave);
  });
  on('status', s => { r.lastStatus = s; });
  on('weak', update);
  on('stats', () => { update(); if (ch && ch.api.linked) ch.emit('stats', ch.api.stats()); });
  r.on('tick', now => { if (room === r && ch && ch.api.linked) ch.emit('tick', now); });
  r.on('pulse', (p, from) => { if (room === r && ch && ch.api.linked && p && p.v === ch.id && p.g && typeof p.g === 'object' && ch.others.includes(from)) ch.emit('pulse', p.g, from); });
  r.on('message', (m, from) => { if (room === r) onLibMessage(m, from); });
  changed('status');
  return r;
}

// a change of ours to the shared state: to everyone
const publish = entry => send({ t: 'lib-state', e: [entry] });

function onLibMessage(m, from) {
  if (m.t === 'lib-state' && Array.isArray(m.e)) {
    // a player's own key only from them (or passed on as they wrote it)
    const ok = m.e.filter(([k, e]) => typeof k === 'string' && e && (!k.startsWith('here:') || e.a === k.slice(5)) && (!k.startsWith('g:') || /^g:[a-z0-9-]{1,40}:[\w-]{1,40}$/.test(k)) && (k === 'view' || k.startsWith('auth:') ? ID(e.v) || NAME.test(e.v) : true));
    const keys = st.merge(ok);
    if (keys.includes('view')) { const v = st.get('view'); if (ID(v) && v !== shell.current()) shell.follow(v); }
    if (keys.includes('here:' + room.me)) staleHere(st.get('view'));
    // a player back in a new tab has a game open there now: that copy of the game needs the full picture
    for (const k of keys) if (k.startsWith('here:')) stale.delete(k.slice(5));
    const back = keys.filter(k => k.startsWith('here:') && loading.delete(k.slice(5))).map(k => k.slice(5));
    if (keys.length) update();
    if (ch) {
      for (const p of back) if (ch.others.includes(p) && st.get('here:' + p) === ch.id) ch.emit('relinked', p);
      const pre = 'g:' + ch.id + ':';
      for (const k of keys) if (k.startsWith(pre)) ch.emit('shared', k.slice(pre.length), st.get(k));
    }
  } else if (m.t === 'lib-snap' && ID(m.v) && m.v && Number.isFinite(m.c)) {
    st.seen(m.c);
    const cur = snaps.get(m.v);
    if (cur && cur.c >= m.c) return;
    if (m.s === null) snaps.delete(m.v); else snaps.set(m.v, { s: m.s, c: m.c });
    if (ch && ch.id === m.v) ch.maybeResume();
  } else if (m.t === 'lib-g' && ch && m.v === ch.id && myHere === ch.id) {
    ch.receive(m.m, from);
  }
}

// the shell switched to another view: on its own (tell the others) or following someone
export function viewChanged(id, byPeer) {
  if (!byPeer && room) publish(st.set('view', id));
  if (room) staleHere(id);
}
// What the others know of us may come from our previous tab (a game we no longer have open): once we are not
// on our way into that game, we set it right.
function staleHere(next) {
  const k = 'here:' + room.me, h = st.get(k);
  if (!myHere && h && h !== next) publish(st.set(k, null));
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
  if (room) publish(st.set('here:' + room.me, id));
  queueMicrotask(update);
  return ch.api;
}
export function detachGame() {
  if (!ch) return;
  ch.dispose();
  ch = null; myHere = null;
  if (room) publish(st.set('here:' + room.me, null));
}

// The room as the rules see it (rules.js), read when they ask; only while there is a room.
const facts = {
  get me() { return room.me; },
  get players() { return room.players; },
  here: p => st.get('here:' + p),
  stale, loading,
  away: p => room.away(p),
  weak: p => room.stats(p).weak,
  get nearby() { return room.nearby; },
  get role() { return room.role; },
  get host() { return room.host; },
  get now() { return performance.now(); }
};
// who has this game open, in the room's order; a player who dropped out keeps their place here too
const inGameOf = c => room ? rules.inGame(facts, c.id, myHere) : [];
// dropped out (their place is kept), or back in a new tab or device whose game is not open yet: for how long, ms
const awayMs = p => room ? rules.awayMs(facts, p) : 0;
// whose copy runs the round: the one the shared state names (authOf), if they play; else the first who plays
const authOf = c => st && st.get('auth:' + c.id);
const runnerOf = c => rules.runnerOf(c.seated, authOf(c));
// The runner has been away for AUTH_WAIT: the first player here who plays takes the round over, if they can show
// it is not them who dropped out (rules.takeOver); only that one writes it, everyone sees it in the shared state.
// A player whose new tab has not opened their game for as long as a place is kept goes stale (out of the game).
let onlineSince = 0;
function watchRunner() {
  const now = performance.now();
  onlineSince = rules.onlineSince(onlineSince, !!room && room.online, now);
  for (const p of rules.loadingTooLong(loading, now, HOLD)) if (loading.delete(p)) { stale.add(p); update(); }
  if (!ch || !room || !ch.api.linked) return;
  if (rules.takeOver(facts, { seated: ch.seated, runner: runnerOf(ch), since: onlineSince, now, wait: AUTH_WAIT })) { publish(st.set('auth:' + ch.id, room.me)); update(); }
}

function channel(id, seats) {
  const handlers = new Map(), inbox = [];
  let pending = null, sendTimer = null, lastSent = 0;     // the latest snapshot not sent yet (at most two a second)
  const c = {
    id, seats, disposed: false, was: [], seen: '', weak: false, role: null, runner: null, own: false,
    inGame: [], seated: [], waiting: [], others: [],
    emit(name, ...a) { for (const fn of handlers.get(name) || []) safe(fn, ...a); },
    policy: name => typeof api[name] === 'function' && safe(api[name]),
    pulseOut: now => typeof api.pulse === 'function' ? safe(api.pulse, now) : null,
    receive(m, from) {
      if (!api.linked || !c.others.includes(from) || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (handlers.has('message')) c.emit('message', m, from);
      else if (inbox.length < 64) inbox.push([m, from]);   // the game has not started listening yet
    },
    // we run the round now, and this copy of the game has nothing of it: it goes on from the snapshot
    maybeResume() {
      const s = snaps.get(id);
      if (api.role === 'host' && !c.own && s && handlers.has('resume')) { c.own = true; c.emit('resume', s.s); }   // (a game not listening yet hears it when it starts to)
    },
    dispose() { handlers.clear(); inbox.length = 0; c.disposed = true; clearTimeout(sendTimer); }
  };
  const flush = () => {
    sendTimer = null;
    if (!pending || !room || c.disposed) return;
    const s = pending; pending = null; lastSent = performance.now();
    for (const p of c.others) send({ t: 'lib-snap', v: id, s: s.s, c: s.c }, p);
  };
  const api = {
    get me() { return room ? room.me : null; },        // our name
    get players() { return c.seated.slice(); },        // who plays: up to `seats` players, in the room's order
    get waiting() { return c.waiting.slice(); },       // who has the game open too, waiting for a seat
    get seats() { return seats; },
    get seated() { return !!room && c.seated.includes(room.me); },   // we have a seat
    get host() { return runnerOf(c); },                // whose copy runs the round
    get role() { return !api.seated ? null : rules.roleOf(c.seated, room.me, authOf(c)); },
    get linked() { return c.others.length > 0; },      // we have a seat, and someone else plays too
    get weak() { return c.weak; },                     // a player is away or went quiet: pause and wait
    away: p => c.seated.includes(p) ? awayMs(p) : 0,   // a player who dropped out (or whose game is not open yet): for how long, ms
    get direct() { return api.linked && c.others.every(p => room.stats(p).direct); },
    get nearby() { return !!room && room.nearby; },
    // the game's policies (see ../net/room.js): streaming, pulse
    streaming: null, pulse: null,
    on(name, fn) {
      if (c.disposed) return api;
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      // late listeners still learn the current state (a game often starts after the link is up)
      if (name === 'linked' && api.linked) queueMicrotask(() => { if (!c.disposed && api.linked) safe(fn); });
      if (name === 'resume') queueMicrotask(() => { if (!c.disposed) c.maybeResume(); });
      if (name === 'message' && inbox.length) queueMicrotask(() => { for (const [m, from] of inbox.splice(0)) c.emit('message', m, from); });
      return api;
    },
    // to every other player, or { to: name }; { fast, latest } as in ../net/link.js
    send(msg, { to, ...opts } = {}) {
      if (!api.linked || !msg || typeof msg.t !== 'string') return;
      const o = c.others, out = { t: 'lib-g', v: id, m: msg };
      if (to !== undefined) { if (o.includes(to)) room.send(out, { to, ...opts }); }
      else if (o.length === room.players.length - 1) room.send(out, opts);   // everyone else plays: one message for all
      else for (const p of o) room.send(out, { to: p, ...opts });
    },
    // What the game's players share, the same for everyone whoever passes it on (the room's state, see
    // roomstate.js): a key → a JSON-able value. A change reaches everyone (us too) as the event 'shared' (key, value);
    // when two change one key at once, everyone keeps the same one of them.
    shared: k => st && GKEY.test(k) ? st.get('g:' + id + ':' + k) : undefined,
    share(k, v) {
      if (!st || !api.seated || !GKEY.test(k)) return;
      let x;
      try { x = JSON.stringify(v === undefined ? null : v); } catch (e) { return; }
      if (x.length > 8000) return;
      publish(st.set('g:' + id + ':' + k, JSON.parse(x)));
      c.emit('shared', k, JSON.parse(x));
    },
    // The round as it is now, from the copy that runs it (a plain JSON-able value; null: no round any more).
    // Every player keeps the latest, so the round can go on elsewhere (see the top).
    snapshot(s) {
      if (api.role !== 'host' || !room) return;
      c.own = true;
      const v = { s: s === undefined ? null : s, c: st.next() };
      if (v.s === null) snaps.delete(id); else snaps.set(id, v);
      pending = v;
      if (v.s === null || performance.now() - lastSent > 500) flush();
      else if (!sendTimer) sendTimer = setTimeout(flush, 500);
    },
    lag: p => !room ? 0 : p !== undefined ? room.lag(p) : c.others.reduce((m, q) => Math.max(m, room.lag(q)), 0),
    stats: p => statsOf(p !== undefined ? (room ? [p] : []) : c.others),
    diag: () => SITE + '\n' + (room ? room.diag() : 'no room'),
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

// who has the game open, who of them plays, who waits, and who we play with: counted again whenever any of it
// may have changed, so the game's many questions (several per frame) cost nothing
function recount(c) {
  const s = rules.seating(inGameOf(c), c.seats, room && room.me);
  c.inGame = s.inGame; c.seated = s.seated; c.waiting = s.waiting; c.others = s.others;
}

// Tell the open game who plays now: 'players', then what changed for the round (rules.playersChange: 'peer-gone'
// and 'linked', or 'leave' and 'join'), then whose copy runs it ('role', and 'resume' with the snapshot for the
// new one), then 'weak'.
function update() {
  if (!ch) return;
  const c = ch;
  recount(c);
  const now = c.others.length ? c.seated : [], was = c.was, seen = c.seated.join() + '|' + c.inGame.join();
  const runner = now.length ? runnerOf(c) : null, wasRunner = c.runner;
  c.runner = runner;
  if (seen !== c.seen) { c.seen = seen; c.emit('players', c.api.players); }
  if (now.join() !== was.join()) {
    c.was = now;
    for (const [e, ...a] of rules.playersChange(c.seats, was, now, wasRunner)) c.emit(e, ...a);
  }
  const role = c.api.role;
  if (role !== c.role) {
    const before = c.role;
    c.role = role;
    if (role !== 'host') c.own = false;
    if (before && role && c.api.linked) c.emit('role', role);
    c.maybeResume();
  }
  const weak = c.api.linked && rules.paused(facts, c.others);
  if (weak !== c.weak) { c.weak = weak; c.emit('weak', weak); }
}

// for the screens: the players we wait for in the open game (dropped out, their seat kept) → [{ name, left ms }]
export function waitingFor() {
  if (!ch || !room || !ch.api.linked) return [];
  return rules.waitingFor(facts, ch.others, HOLD);
}
// nobody waits for this player any longer: their place goes
export const release = p => { if (room) room.release(p); };
