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
     here runs it on from the snapshot (event 'resume'); whoever comes back simply plays on. A game closed mid-round
     (the room went to the shelf, a frame closed) waits too: opened again, the runner's copy goes on from the
     snapshot, if the same players are seated (owner, decision 3). A round is over for good when the game says so
     (snapshot(null)) or one of its players left the room for good: the snapshot becomes a tombstone ({ s: null }
     with its version), so an older copy that someone still keeps can never bring it back.
   - Versions (owner, decision 9): a friend whose library (config.js PROTO: the room does not link us) or whose copy of
     a game (game.json "wire": we are not seated together) is another version sees «Онови сторінку — у друга інша
     версія»; the older page updates its offline copy and reloads itself when no round may run here (no game open),
     never in a nearby room, and once per version and session.
   - The game's side is bounded (A1): a reliable message and a snapshot up to CAP bytes (UTF-8, as JSON), a shared
     value up to SHARE_BYTES, SHARE_KEYS keys per game; what is not JSON is a TypeError at the call; send, share and
     snapshot say whether they did it (true/false; on the dev server, once per reason, why not). The library's own
     messages are not bound by them: greet goes in chunks.
   The rules of all this (who plays, who runs the round, who is away, when the round moves) are in rules.js.
   Messages on the room, besides the games' own ('lib-g'):
     lib-state { e: entries }   the shared state, or a change to it (roomstate.js); greet sends all of it in chunks of
                                up to CAP bytes. Keys: view, here:<name>, auth:<game>, wire:<name> (a player's game wire
                                numbers, { game: number }; only they write it), g:<game>:<key> (room.share); any other
                                key is dropped (it would be passed on for ever)
     lib-snap { v: game, s: snapshot | null, c: version, a: writer, p: [players seated] }   a round's latest; greet
                                sends these before lib-state, so the update that links a game already has the snapshot
   What a library from before phase 1a does with each of these changes (it plays on with a new one): the wire: key it
   keeps and passes on, unread (it takes any key), and a lib-snap's a and p it ignores (it passes on only v, s, c; a
   lib-snap without a or p fits any seats here); a tombstone it takes as "no snapshot" (it deletes it, as it always
   did); chunked lib-state is plain lib-state; lib-snap before lib-state changes nothing for it. It writes no wire:
   key: its copies speak wire 1 (rules.sameWire), as every game does in this release, so it is seated with anyone
   (once a game raises its number, not in that game).
   The screens for all this are in invite.js; it follows the room through onChange.
   ===================================================================== */
import { HOLD, joinNearby, joinRoom, NAME, PROTO, TIMING, validRoomCode } from '../net/index.js';
import { safe } from './dom.js';
import { roomState, validClock } from './roomstate.js';
import * as rules from './rules.js';

const LIB = 'ihroteka';                                  // the room namespace of the whole library
const LAST = 'ihroteka-room', LAST_NAME = 'ihroteka-name';   // the last room (its link keeps working) and name
const AUTH_WAIT = TIMING.AUTH_WAIT;                      // a round's runner away this long: someone else runs it on
const ID = v => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v));
// the site's version, first in room.diag() and state() (the build writes it into the page, tools/build.js siteVersion;
// 'dev' on the dev server, '?' where the page has none: an old page, a worker tab)
const SITE = 'Ігротека ' + (globalThis.document?.querySelector?.('meta[name="ihroteka-version"]')?.content || '?');
const DEV = SITE === 'Ігротека dev';                    // the dev server: a refused call says why in the console
// what a game may hand the library: rules.js (CAP, SHARE_BYTES, SHARE_KEYS); counted in bytes of its JSON, UTF-8
const { CAP, SHARE_BYTES, SHARE_KEYS } = rules;
const UTF8 = new TextEncoder(), bytes = s => UTF8.encode(s).length;
// a game's value as JSON; one that cannot be (a cycle, a BigInt) is a mistake in the game: a TypeError, at the call
function json(v, what) {
  try { const x = JSON.stringify(v); return x === undefined ? 'null' : x; } catch (e) { throw new TypeError('ihroteka.room.' + what + ': not JSON (' + e.message + ')'); }
}
// What the library hands a game (a round to resume, a shared value) is a copy of what it keeps: a game that keeps its
// state in it and changes it must not change the round's snapshot or the room's state (which greet passes on).
const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
const REJOIN = 'ihroteka-rejoin', RELOADED = 'ihroteka-reloaded';   // (sessionStorage) see versionCheck
// (set → whether it was kept: a browser that blocks site data throws)
const session = { get: k => { try { return JSON.parse(sessionStorage.getItem(k)); } catch (e) { return null; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } } };

let shell = null;                                        // { current(), follow(id), invite(), address(), seats(id), askName(...),
                                                         //   wires() → { game: wire } (optional), reload(still?) (optional) }
let room = null;                                         // the room (see ../net), with .kind and .lastStatus
let st = null;                                           // its shared state (roomstate.js)
let myHere = null;                                       // the game we have open and listening
let ch = null;                                           // the open game's channel (ihroteka.room)
let replaced = null;                                     // { kind, code, name }: this player went on in another tab
const snaps = new Map();                                 // game → { s, c, a, p }: a round's latest snapshot (s: null, a tombstone)
const loading = new Map();                               // name → since when: back in a new tab or device, its game not open yet
const stale = new Set();                                 // names whose new tab did not open their game for as long as a place is kept
const GKEY = /^[\w-]{1,40}$/;                            // a game's shared key (see channel: shared, share)
const listeners = new Set();

export function initTogether(s) {
  shell = s;
  setInterval(watchRunner, 1000);
  const code = (new URLSearchParams(location.search).get('room') || '').toLowerCase();
  // the page reloaded itself into a newer version (versionCheck): straight back into its room, once the shell has
  // shown the address's view (so we follow the room's view instead of announcing ours)
  const back = session.get(REJOIN);
  session.set(REJOIN, null);
  if (back && back.code === code && NAME.test(back.name) && Date.now() - back.at < 60000) setTimeout(() => startInternet(code, back.name));
  else if (validRoomCode(code)) shell.askName(name => startInternet(code, name), () => setQuery(null));   // opened from a link
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
//   (and version: a friend's version differs, or no longer does; see versionGap)
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
  room = null; st = null; snaps.clear(); loading.clear(); stale.clear(); gapKey = '';
  session.set(REJOIN, null);                             // (a reload under way does not bring us back: we left)
  if (r) { r.leave(); setQuery(null); }
  update();
  changed('left');
}
const remember = (k, v) => safe(() => localStorage.setItem(k, v));
// for checks from the console and tests
export const state = () => ({ site: SITE, kind: room && room.kind, role: room && room.role, linked: linked(), online: !!room && room.online, status: room && room.lastStatus,
  me: room && room.me, players: room ? room.players : [], away: room ? room.players.filter(p => room.away(p)) : [], view: st && st.get('view'), myHere,
  here: room && st ? Object.fromEntries(room.players.map(p => [p, p === room.me ? myHere : st.get('here:' + p) ?? null])) : {},
  game: ch && { players: ch.seated, linked: ch.api.linked, role: ch.api.role, host: ch.api.host, waiting: ch.api.waiting },
  keys: st ? st.entries().map(([k]) => k) : [], snaps: Object.fromEntries([...snaps].map(([v, x]) => [v, { s: x.s, c: x.c, a: x.a, p: x.p }])),
  auth: st ? Object.fromEntries(st.entries().filter(([k]) => k.startsWith('auth:')).map(([k, e]) => [k.slice(5), e.v])) : {},   // game → whose copy runs its round
  version: { gap: versionGap(), reloading, offer: offerUpdate() } });

function wire(r, kind) {
  room = r; r.kind = kind; st = roomState(r.me); snaps.clear(); loading.clear(); stale.clear(); replaced = null; gapKey = '';
  // Which game we have open. A new tab of a player who is in a game says nothing yet: it follows the room into
  // that game in a moment, and a "not in the game" meanwhile would end the round for everyone (see staleHere).
  if (myHere) st.set('here:' + r.me, myHere);           // (the room's view: whoever opened the room shows the way)
  const w = myWires();                                  // the wire number of each game we have (whoever plays with us must speak it)
  if (w) st.set('wire:' + r.me, w);
  const policy = name => () => !!ch && ch.api.linked && !!ch.policy(name);
  r.streaming = policy('streaming');
  r.pulse = now => { const g = ch && ch.api.linked && ch.pulseOut(now); return g ? { v: ch.id, g } : null; };
  const on = (name, fn) => r.on(name, (...a) => { if (room === r) { safe(fn, ...a); changed(name); } });
  // Someone new, or back from another tab or device: the rounds (their snapshots, tombstones too), then everything
  // we know, in chunks of up to CAP bytes (players' wire numbers first: nobody is seated before their wire is known).
  const greet = p => {
    for (const [v, s] of snaps) send(snapMsg(v, s), p);
    for (const e of chunks(st.entries().sort(([a], [b]) => b.startsWith('wire:') - a.startsWith('wire:')))) send({ t: 'lib-state', e }, p);
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
  on('leave', p => { quitRounds(p); update(); });
  on('away', update);
  on('players', update);                                // (the room's order changed: the seats may have)
  on('peer-gone', () => {
    update();
    // nearby, nobody is left whose place is kept (they were away as long as places are kept): the room is over
    if (r.kind === 'nearby') queueMicrotask(() => { if (room === r && !r.linked) leave(); });
  });
  on('replaced', () => {                                  // this player went on in another tab or device
    replaced = { kind: r.kind, code: r.code, name: r.me };
    queueMicrotask(leave);
  });
  on('status', s => { r.lastStatus = s; if (s === 'version') versionCheck(); });
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
const snapMsg = (v, s) => ({ t: 'lib-snap', v, s: s.s, c: s.c, ...(s.a !== undefined && { a: s.a }), ...(s.p && { p: s.p }) });
// We are looking for the room again (net/internet.js discover: our list of players is only us until the room's comes
// back): whoever is missing from it now did not leave, so no round is over because of it.
const lookingAgain = () => !room || room.role === null;
// A player's place went for good (they left, «Не чекати», or it ran out): every round they played in is over, also in
// a game nobody has open (owner, decision 3: it waits for a closed game, not for a player who quit), so it does not
// come back when they come in again. A tombstone, to everyone. The open game, if it plays that round with them now,
// follows its own rule instead (channel over: 'peer-gone').
function quitRounds(p) {
  if (lookingAgain()) return;
  for (const [v, s] of snaps) {
    if (s.s === null || !s.p || !s.p.includes(p) || (ch && ch.id === v && ch.was.includes(p))) continue;
    const t = { s: null, c: st.next(), a: room.me };
    snaps.set(v, t);
    send(snapMsg(v, t));
  }
}
// entries → lists of them, each up to CAP bytes as JSON (one bigger than that alone in its own)
function chunks(entries) {
  const out = [];
  let cur = [], size = 0;
  for (const e of entries) {
    const n = bytes(JSON.stringify(e)) + 1;
    if (cur.length && size + n > CAP) { out.push(cur); cur = []; size = 0; }
    cur.push(e); size += n;
  }
  if (cur.length) out.push(cur);
  return out;
}
// What the shared state takes from others: only the keys it knows, each as it must look (a player's own keys only
// from them, or passed on as they wrote them). (So a key that a later library adds is dropped here, and never passed
// on to a newcomer through us: such a key comes with a PROTO bump, net/config.js, or must work without that.)
const WIRES = w => !!w && typeof w === 'object' && !Array.isArray(w) && Object.keys(w).length <= 64 && Object.entries(w).every(([g, n]) => ID(g) && g && Number.isSafeInteger(n) && n > 0);
function knownEntry([k, e]) {
  if (typeof k !== 'string' || !e || typeof e !== 'object') return false;
  if (k === 'view') return ID(e.v);
  if (k.startsWith('here:')) return e.a === k.slice(5) && ID(e.v);
  if (k.startsWith('wire:')) return e.a === k.slice(5) && WIRES(e.v);
  if (k.startsWith('auth:')) return /^auth:[a-z0-9-]{1,40}$/.test(k) && (e.v === null || NAME.test(e.v));
  return /^g:[a-z0-9-]{1,40}:[\w-]{1,40}$/.test(k);
}

function onLibMessage(m, from) {
  if (m.t === 'lib-state' && Array.isArray(m.e)) {
    const keys = st.merge(m.e.filter(e => Array.isArray(e) && knownEntry(e)));
    if (keys.includes('view')) { const v = st.get('view'); if (ID(v) && v !== shell.current()) shell.follow(v); }
    if (keys.includes('here:' + room.me)) staleHere(st.get('view'));
    if (keys.includes('wire:' + room.me)) staleWires();
    // a player back in a new tab has a game open there now: that copy of the game needs the full picture
    for (const k of keys) if (k.startsWith('here:')) stale.delete(k.slice(5));
    const back = keys.filter(k => k.startsWith('here:') && loading.delete(k.slice(5))).map(k => k.slice(5));
    if (keys.length) update();
    if (keys.some(k => k.startsWith('wire:'))) versionCheck();
    if (ch) {
      for (const p of back) if (ch.others.includes(p) && st.get('here:' + p) === ch.id) ch.emit('relinked', p);
      const pre = 'g:' + ch.id + ':';
      for (const k of keys) if (k.startsWith(pre)) ch.emit('shared', k.slice(pre.length), copy(st.get(k)));
    }
  } else if (m.t === 'lib-snap' && ID(m.v) && m.v && validClock(m.c) && m.s !== undefined) {
    // its version is a clock of the shared state (roomstate.js validClock: a wild one would win over every later
    // snapshot); its writer (none from an older library), a player of this room; whether it fits the seats is asked
    // when a round would go on from it (rules.snapFits)
    if (m.a !== undefined && !(typeof m.a === 'string' && room.players.includes(m.a))) return;
    st.seen(m.c);
    const cur = snaps.get(m.v);
    if (cur && cur.c >= m.c) return;
    snaps.set(m.v, { s: m.s, c: m.c, a: m.a, p: Array.isArray(m.p) && m.p.every(x => typeof x === 'string') ? m.p : undefined });   // (null: a tombstone)
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
// The others may know our wire numbers from our previous page (before it reloaded into a newer version): ours win.
function staleWires() {
  const w = myWires(), k = 'wire:' + room.me;
  if (w && JSON.stringify(st.get(k)) !== JSON.stringify(w)) publish(st.set(k, w));
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
  wire: (p, game) => p === room.me ? myWire(game) : (st.get('wire:' + p) || {})[game],
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
  versionCheck();
  onlineSince = rules.onlineSince(onlineSince, !!room && room.online, now);
  for (const p of rules.loadingTooLong(loading, now, HOLD)) if (loading.delete(p)) { stale.add(p); update(); }
  if (!ch || !room || !ch.api.linked) return;
  if (rules.takeOver(facts, { seated: ch.seated, runner: runnerOf(ch), since: onlineSince, now, wait: AUTH_WAIT })) { publish(st.set('auth:' + ch.id, room.me)); update(); }
}

/* ---------- versions: the library's (PROTO) and each game's (wire) ---------- */
// our wire number of each game we have (the shelf's game.json "wire"; null: the shell does not say, every game 1)
let wires;
const myWires = () => { if (wires === undefined) { const w = shell && shell.wires && safe(shell.wires); wires = WIRES(w) ? w : null; } return wires; };
const myWire = game => { const w = myWires(); return w ? w[game] : 1; };
// A friend's library or game is another version (rules.versionGap) → null | { why, game, theirs, older, key }
export function versionGap() {
  if (!room || !st) return null;
  const others = room.players.filter(p => p !== room.me).map(p => st.get('wire:' + p));
  return rules.versionGap({ proto: PROTO, wires: myWire }, room.versionMismatch, others);
}
// The older page updates itself (rules.reloadNow): its offline copy first, then a reload (shell.reload), back into
// the same room without asking the name again (REJOIN). Asked whenever the versions or the rounds may have changed.
// Only while no game is open here: a round may run in it, even one played alone, which the library cannot see (the
// note over the game offers «Оновити» instead); and only once the page has noted that it did (RELOADED): one that
// cannot note it (site data blocked) would reload again on every visit, so it leaves it to the player. The offline
// copy may take a while (up to 30 s): if meanwhile a game opened or we left the room, the reload is called off (and
// tried again once the page is free).
let gapKey = '', reloading = null;
function versionCheck() {
  if (!room) return;
  const gap = versionGap(), key = gap ? gap.key + (gap.older ? '<' : '>') : '';
  if (key !== gapKey) { gapKey = key; changed('version'); }
  if (reloading || !gap || !gap.older) return;
  const was = session.get(RELOADED), done = new Set(Array.isArray(was) ? was : []);
  if (!rules.reloadNow(gap, { nearby: room.kind === 'nearby', playing: !!ch, done })) return;
  if (!session.set(RELOADED, [...done, gap.key])) return;
  reloading = gap.key;
  changed('version');
  const r = room;
  reload(() => {
    if (room === r && !ch) return true;
    reloading = null;
    session.set(RELOADED, [...done]);                   // (not reloaded after all)
    changed('version');
    return false;
  });
}
// whether the note offers «Оновити»: on the older page only (rules.offerUpdate)
export const offerUpdate = () => rules.offerUpdate(versionGap(), { nearby: !!room && room.kind === 'nearby' });
// the newer version now (also when the player asks: the note's «Оновити»), back into this room after it
export const updateNow = () => reload(null);
// still: (by itself) asked once the offline copy is in place, whether the page reloads after all
function reload(still) {
  if (room && room.kind === 'internet') session.set(REJOIN, { code: room.code, name: room.me, at: Date.now() });
  if (shell && shell.reload) shell.reload(still || undefined);
}

function channel(id, seats) {
  const handlers = new Map(), inbox = [], late = [], warned = new Set();
  let pending = null, sendTimer = null, lastSent = 0;     // the latest snapshot not sent yet (at most two a second)
  const c = {
    id, seats, disposed: false, was: [], seen: '', weak: false, role: null, runner: null, own: false,
    inGame: [], seated: [], waiting: [], others: [],
    emit(name, ...a) {
      for (const fn of handlers.get(name) || []) safe(fn, ...a);
      for (let i = late.length; i--;) if (late[i][0] === name) late.splice(i, 1);   // (heard it now: nothing to replay)
    },
    policy: name => typeof api[name] === 'function' && safe(api[name]),
    pulseOut: now => typeof api.pulse === 'function' ? safe(api.pulse, now) : null,
    receive(m, from) {
      if (!api.linked || !c.others.includes(from) || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (!handlers.has('message')) { if (inbox.length < 64) inbox.push([m, from]); return; }   // the game has not started listening yet
      for (const [x, f] of inbox.splice(0)) c.emit('message', x, f);   // (kept ones first, in order)
      c.emit('message', m, from);
    },
    // We run the round now, we play with someone, and this copy of the game has nothing of it: it goes on from the
    // snapshot, if the snapshot is of a round with the players seated now (not a tombstone, not someone else's).
    // (A game not listening yet hears it when it starts to.)
    maybeResume() {
      const s = snaps.get(id);
      if (api.role === 'host' && api.linked && !c.own && s && s.s !== null && rules.snapFits(s, c.seated) && handlers.has('resume')) { c.own = true; c.emit('resume', copy(s.s)); }
    },
    // The round is over for the game ('peer-gone'): its copy keeps nothing of it (so the next time we run it on, it
    // hears 'resume'). If one of its players left the room for good, it can never go on: a tombstone, for everyone.
    over(was) {
      c.own = false;
      if (!room || lookingAgain() || !rules.goneForGood(was, room.players, room.me) || !snaps.has(id) || snaps.get(id).s === null) return;
      pending = { s: null, c: st.next(), a: room.me };
      snaps.set(id, pending);
      flush();
    },
    dispose() { handlers.clear(); inbox.length = 0; late.length = 0; c.disposed = true; clearTimeout(sendTimer); }
  };
  // the latest snapshot to whoever plays with us; a tombstone to everyone (whoever keeps the round, waiting for a
  // seat too, must learn it is over)
  const flush = () => {
    sendTimer = null;
    if (!pending || !room || c.disposed) return;
    const s = pending; pending = null; lastSent = performance.now();
    if (s.s === null) send(snapMsg(id, s));
    else for (const p of c.others) send(snapMsg(id, s), p);
  };
  // A call the game may not make now, or with this: false (on the dev server, once per reason, the console says why).
  const refuse = why => { if (DEV && !warned.has(why)) { warned.add(why); console.warn('ihroteka.room: ' + why); } return false; };
  // What a game that starts listening late missed, as update() would have told it: who plays ('players'), the round
  // it runs on ('resume'), that it plays with someone ('linked'), that it waits ('weak'); then the messages kept for
  // it until it listened. One pass for every listener added meanwhile, in this order whatever order they came in.
  const replay = () => {
    const fresh = late.splice(0), to = name => fresh.filter(([n]) => n === name).map(([, fn]) => fn);
    if (c.disposed) return;
    if (c.seen) for (const fn of to('players')) safe(fn, api.players);
    if (to('resume').length) c.maybeResume();
    if (api.linked) for (const fn of to('linked')) safe(fn);
    if (c.weak) for (const fn of to('weak')) safe(fn, true);
    if (handlers.has('message')) for (const [m, from] of inbox.splice(0)) c.emit('message', m, from);
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
      if (c.disposed || typeof fn !== 'function') return api;
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      // late listeners still learn the current state (a game often starts after the link is up): see replay
      if (late.push([name, fn]) === 1) queueMicrotask(replay);
      return api;
    },
    // To every other player, or { to: name }; { fast, latest } as in ../net/link.js. A reliable message becomes JSON
    // here, once (not JSON: a TypeError), is sent as that copy, and is at most CAP bytes. → whether it went
    send(msg, { to, ...opts } = {}) {
      if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return refuse('send: a message is an object with a string t');
      if (!opts.fast) {
        const x = json(msg, 'send');
        if (bytes(x) > CAP) return refuse('send: a reliable message of up to ' + CAP + ' bytes as JSON');
        msg = JSON.parse(x);
      }
      if (!api.linked) return refuse('send: not linked (nobody to play with)');
      const o = c.others, out = { t: 'lib-g', v: id, m: msg };
      if (to !== undefined) { if (!o.includes(to)) return refuse('send: ' + to + ' is not a player we play with'); room.send(out, { to, ...opts }); }
      else if (o.length === room.players.length - 1) room.send(out, opts);   // everyone else plays: one message for all
      else for (const p of o) room.send(out, { to: p, ...opts });
      return true;
    },
    // What the game's players share, the same for everyone whoever passes it on (the room's state, see
    // roomstate.js): a key → a JSON-able value. A change reaches everyone (us too) as the event 'shared' (key, value);
    // when two change one key at once, everyone keeps the same one of them. → whether it was set
    shared: k => st && GKEY.test(k) ? copy(st.get('g:' + id + ':' + k)) : undefined,
    share(k, v) {
      const x = json(v === undefined ? null : v, 'share');
      if (!st || !api.seated) return refuse('share: only a player with a seat');
      if (typeof k !== 'string' || !GKEY.test(k)) return refuse('share: a key of 1 to 40 letters, digits, _ or -');
      if (bytes(x) > SHARE_BYTES) return refuse('share: a value of up to ' + SHARE_BYTES + ' bytes as JSON');
      const key = 'g:' + id + ':' + k, pre = 'g:' + id + ':', keys = st.entries().filter(([e]) => e.startsWith(pre));
      if (keys.length >= SHARE_KEYS && !keys.some(([e]) => e === key)) return refuse('share: up to ' + SHARE_KEYS + ' keys per game');
      publish(st.set(key, JSON.parse(x)));
      c.emit('shared', k, JSON.parse(x));
      return true;
    },
    // The round as it is now, from the copy that runs it (a plain JSON-able value of up to CAP bytes, kept as a copy;
    // null: no round any more). Every player keeps the latest, so the round can go on elsewhere (see the top).
    // → whether it was taken
    snapshot(s) {
      const x = s === undefined || s === null ? null : json(s, 'snapshot');
      if (api.role !== 'host' || !room) return refuse('snapshot: only from the copy that runs the round (room.role host)');
      if (x !== null && bytes(x) > CAP) return refuse('snapshot: up to ' + CAP + ' bytes as JSON');
      // the round runs in our copy: we name it in the shared state (once), so a change of the room's order (a shaky
      // network may reorder it) cannot move the round to another copy; only a takeover does (watchRunner)
      if (x !== null && api.linked && authOf(c) !== room.me) publish(st.set('auth:' + id, room.me));
      c.own = true;
      const v = { s: x === null ? null : JSON.parse(x), c: st.next(), a: room.me, p: c.seated.slice() };
      snaps.set(id, v);                                // (null: a tombstone)
      pending = v;
      if (v.s === null || performance.now() - lastSent > 500) flush();
      else if (!sendTimer) sendTimer = setTimeout(flush, 500);
      return true;
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
// new one), then 'weak'. A round that goes on in our copy as we start to play with someone hears 'resume' before
// 'linked' (so the game knows it runs the round on when it hears it plays); and only while we play with someone.
function update() {
  if (!ch) return;
  const c = ch;
  recount(c);
  const now = c.others.length ? c.seated : [], was = c.was, seen = c.seated.join() + '|' + c.inGame.join();
  const runner = now.length ? runnerOf(c) : null, wasRunner = c.runner;
  c.runner = runner;
  if (seen !== c.seen) { c.seen = seen; c.emit('players', c.api.players); }
  const role = c.api.role, before = c.role;
  if (role !== before) { c.role = role; if (role !== 'host') c.own = false; }
  if (now.join() !== was.join()) {
    c.was = now;
    for (const [e, ...a] of rules.playersChange(c.seats, was, now, wasRunner)) {
      if (e === 'linked') c.maybeResume();
      c.emit(e, ...a);
      if (e === 'peer-gone') c.over(was);
    }
  }
  if (role !== before && before && role && c.api.linked) c.emit('role', role);
  c.maybeResume();
  const weak = c.api.linked && rules.paused(facts, c.others);
  if (weak !== c.weak) { c.weak = weak; c.emit('weak', weak); }
  versionCheck();
}

// for the screens: the players we wait for in the open game (dropped out, their seat kept) → [{ name, left ms }]
export function waitingFor() {
  if (!ch || !room || !ch.api.linked) return [];
  return rules.waitingFor(facts, ch.others, HOLD);
}
// nobody waits for this player any longer: their place goes
export const release = p => { if (room) room.release(p); };
