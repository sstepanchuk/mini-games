/* =====================================================================
   Playing together. The library holds one room for up to 8 players (over the internet: a link; nearby: QR
   codes, no internet) for as long as they play, whatever game is open. Players are known by the name they
   come in with (net/room.js): from another tab, browser or device, the same name is the same player.
   - What everyone looks at, which game each player has open, and whose copy runs a round are shared state
     (roomstate.js): the same for everyone, whoever passes the messages on.
   - Each game gets the room as ihroteka.room, with as many seats as it has (game.json "players"): the first
     players to have it open, in the room's order, play; anyone after them waits for a seat. A player who
     dropped out keeps their seat while the room keeps their place, and one who is back (in a new tab or device, or
     after their place dropped) keeps it while their game opens there: the game pauses, and the library says whom we
     wait for and why (waitFacts; the game's screens, or its card: invite.js, screens.js), with a way not to wait for
     one who dropped out.
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
     never in a nearby room, and once per version and session. A copy's wire is that of the game code that runs (its
     own page says it: shell.js api), not the shelf's the page loaded with (a deploy while the page stayed open). A
     reload happens only once the newer copy is in place (update.js): one that cannot be stored or fetched leaves the
     page as it is, and is not tried again by itself for that version (the note's «Оновити» tries again).
   - The game's side is bounded (A1): a reliable message and a snapshot up to CAP bytes (UTF-8, as JSON), a shared
     value up to SHARE_BYTES, SHARE_KEYS keys per game; what is not JSON is a TypeError at the call; send, share and
     snapshot say whether they did it (true/false; on the dev server, once per reason, why not). The library's own
     messages are not bound by them: greet goes in chunks. A copy that cannot hear the others' messages yet (it
     listens late, or waits for its round's snapshot) gets them later, in order: every reliable one (up to KEEP_BYTES)
     and the newest KEEP_FAST fast ones (channel receive).
   - A trace for bug reports (trace.js): the room's events, what the open game is told, the shared state's keys that
     change, snapshots (their sizes), the page hidden and shown, errors (their types and places); never what a message,
     a snapshot or a value says. The last lines of it follow room.diag() (report) and are in state().
   - Each game also gets ihroteka.round (phase 4): its rounds as one shared record, with the mechanisms around it
     (round.js: its invariants are at its top). The room's own round words (contract 4: host, role, snapshot, 'resume',
     'role', 'peer-gone', 'relinked'; auth:<game>, lib-snap) stay as they were, for games that use them.
   The rules of all this (who plays, who runs the round, who is away, when the round moves) are in rules.js.
   Messages on the room, besides the games' own ('lib-g'):
     lib-state { e: entries }   the shared state, or a change to it (roomstate.js); greet sends all of it in chunks of
                                up to CAP bytes. Keys: view, here:<name>, auth:<game>, wire:<name> (a player's game wire
                                numbers, { game: number }; only they write it), round:<game> (round.js; only the round's
                                runner writes it), g:<game>:<key> (room.share); any other key is dropped (it would be
                                passed on for ever)
     lib-snap { v: game, s: snapshot | null, c: version, a: writer, p: [players seated] }   a round's latest (room.snapshot);
                                greet sends these before the rest of lib-state, so the update that links a game already
                                has the snapshot
     lib-save, lib-ask          ihroteka.round's: a round's snapshot, a request to its runner (round.js); greet sends the
                                round records first, then their snapshots
   What a library from before phase 1a does with each of these changes (it plays on with a new one): the wire: key it
   keeps and passes on, unread (it takes any key), and a lib-snap's a and p it ignores (it passes on only v, s, c; a
   lib-snap without a or p fits any seats here); a tombstone it takes as "no snapshot" (it deletes it, as it always
   did); chunked lib-state is plain lib-state; lib-snap before lib-state changes nothing for it. It writes no wire:
   key: its copies speak wire 1 (rules.sameWire), as every game does in this release, so it is seated with anyone
   (once a game raises its number, not in that game).
   And with phase 1b's: a player back after their place dropped counts as loading until a here: of theirs comes; a
   library from before 1b, back on the same page, never writes it again: its greeting (lib-state from it, with the
   here: we know) counts instead (onLibMessage), so the game waits for that, not for as long as a place is kept. (A
   page of 1b or later greets with a here: of its own naming a game only while it has that game open: see greet.)
   The screens for all this are in invite.js (and the waiting screens: waiting.js the words, screens.js where they
   show); it follows the room through onChange.
   ===================================================================== */
import { HOLD, joinNearby, joinRoom, NAME, PROTO, TIMING, validRoomCode } from '../net/index.js';
import { safe } from './dom.js';
import { roomState, validClock } from './roomstate.js';
import { rounds, validRecord } from './round.js';
import * as rules from './rules.js';
import * as trace from './trace.js';
import { screen } from './waiting.js';

const LIB = 'ihroteka';                                  // the room namespace of the whole library
const LAST = 'ihroteka-room', LAST_NAME = 'ihroteka-name';   // the last room (its link keeps working) and name
const AUTH_WAIT = TIMING.AUTH_WAIT;                      // a round's runner away this long: someone else runs it on
// (scaled as the room's TIMING: tests set window.__timeScale)
const SCALE = Number.isFinite(globalThis.__timeScale) && globalThis.__timeScale > 0 ? globalThis.__timeScale : 1;
export const CLOSED_GRACE = 2000 * SCALE;                // a round's player out of the game this long before the screens name
                                                         //   them (following the room into a game takes a moment)
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
                                                         //   wires() → { game: wire } (the shelf's), reload(still?, later?) →
                                                         //   Promise of what it did (see attempt), gameError() (each optional) }
let room = null;                                         // the room (see ../net: room.kind, room.status)
let st = null;                                           // its shared state (roomstate.js)
let myHere = null;                                       // the game we have open and listening
let ch = null;                                           // the open game's channel (ihroteka.room)
let replaced = null;                                     // { kind, code, name }: this player went on in another tab
const snaps = new Map();                                 // game → { s, c, a, p }: a round's latest snapshot (s: null, a tombstone)
const loading = new Map();                               // name → since when: back (a new tab or device, or after their place
                                                         //   dropped), its game not open there yet (rules.arrivesLoading)
const closedSince = new Map();                           // name → since when rules.roundWaits says 'closed' (waitFacts)
const GKEY = /^[\w-]{1,40}$/;                            // a game's shared key (see channel: shared, share)
const listeners = new Set();
let budgetWarned = false;                                // (the relay budget: see wire, 'budget')

export function initTogether(s) {
  shell = s;
  setInterval(watchRunner, 1000);
  let hiddenAt = 0;                                      // (the trace: how long the page was out of sight)
  globalThis.document?.addEventListener?.('visibilitychange', () => {
    if (document.hidden) { hiddenAt = performance.now(); trace.note('page hidden'); if (ch) ch.snapNow(); }
    else if (hiddenAt) { trace.note('page shown after ' + ((performance.now() - hiddenAt) / 1000).toFixed(1) + ' s'); hiddenAt = 0; }
  });
  // The page goes (a reload, a closed tab; a hidden one may never come back, above): the open game's latest snapshot,
  // if it still waits for its turn to go, goes now, or the round would go on one step behind (from the copy the others
  // keep). (Added before any room's own pagehide, net/room.js, so it goes out ahead of its goodbye.)
  globalThis.addEventListener?.('pagehide', () => { if (ch) ch.snapNow(); });
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
//   (and version: a friend's version differs, or no longer does, see versionGap; waiting: what the open game's screens
//   say changed, see waitFacts)
export const onChange = fn => listeners.add(fn);
const changed = what => { for (const fn of listeners) safe(fn, what); };

export function startInternet(code, name) {
  leave();
  remember(LAST, code); remember(LAST_NAME, name);
  setQuery(code);
  return wire(joinRoom({ game: LIB, code, name }));
}
export const lastInternetCode = () => { const c = safe(() => localStorage.getItem(LAST)); return validRoomCode(c) ? c : null; };
// a nearby room; its host adds players to it (pairing again), and a player whose link broke pairs again into
// it (to their place), so it is kept
export function startNearby(name) {
  if (room && room.kind === 'nearby' && (room.linked || room.role === 'host')) return room;
  leave();
  remember(LAST_NAME, name);
  return wire(joinNearby({ game: LIB, name }));
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
  room = null; st = null; snaps.clear(); loading.clear(); R.clear(); gapKey = ''; closedSince.clear();
  session.set(REJOIN, null);                             // (a reload under way does not bring us back: we left)
  if (r) { r.leave(); setQuery(null); trace.note('left the room'); }
  update();
  changed('left');
}
const remember = (k, v) => safe(() => localStorage.setItem(k, v));
// for checks from the console and tests
export const state = () => ({ site: SITE, trace: trace.read(), kind: room && room.kind, role: room && room.role, linked: linked(), online: !!room && room.online, status: room && room.status,
  me: room && room.me, players: room ? room.players : [], away: room ? room.players.filter(p => room.away(p)) : [], view: st && st.get('view'), myHere,
  here: room && st ? Object.fromEntries(room.players.map(p => [p, p === room.me ? myHere : st.get('here:' + p) ?? null])) : {},
  game: ch && { players: ch.seated, linked: ch.api.linked, role: ch.api.role, host: ch.api.host, waiting: ch.api.waiting, waitingFor: waitingFor(),
    screen: screen(waitFacts()),                         // what the game's screens say (waiting.js screen)
    round: { active: ch.round.api.active, id: ch.round.api.id, seats: ch.round.api.seats, runner: ch.round.api.runner, runs: ch.round.api.runs } },
  keys: st ? st.entries().map(([k]) => k) : [], snaps: Object.fromEntries([...snaps].map(([v, x]) => [v, { s: x.s, c: x.c, a: x.a, p: x.p }])),
  auth: st ? Object.fromEntries(st.entries().filter(([k]) => k.startsWith('auth:')).map(([k, e]) => [k.slice(5), e.v])) : {},   // game → whose copy runs its round
  rounds: st ? Object.fromEntries(st.entries().filter(([k]) => k.startsWith('round:')).map(([k, e]) => [k.slice(6), e.v])) : {},   // game → its round record (round.js)
  saves: R.state(),                                     // game → the latest snapshot of its round we keep (round.js)
  version: versionState() });
// (failed: why the update for this version did not happen, see attempt; null: it did not fail)
const versionState = () => { const gap = versionGap(); return { gap, reloading, offer: offerUpdate(), failed: failedWhy(gap) }; };

function wire(r) {
  room = r; st = roomState(r.me); snaps.clear(); loading.clear(); R.clear(); replaced = null; gapKey = ''; closedSince.clear();
  trace.note('room: ' + r.kind + ', as ' + r.me);
  // Which game we have open. A new tab of a player who is in a game says nothing yet: it follows the room into
  // that game in a moment, and a "not in the game" meanwhile would end the round for everyone (see staleHere).
  if (myHere) st.set('here:' + r.me, myHere);           // (the room's view: whoever opened the room shows the way)
  const w = myWires();                                  // the wire number of each game we have (whoever plays with us must speak it)
  if (w) st.set('wire:' + r.me, w);
  const policy = name => () => !!ch && ch.api.linked && !!ch.policy(name);
  r.streaming = policy('streaming');
  r.playing = () => !!ch && ch.api.linked;              // (the room then keeps the direct link alive by itself: net/link.js tendAlive)
  r.pulse = now => { const g = ch && ch.api.linked && ch.pulseOut(now); return g ? { v: ch.id, g } : null; };
  const on = (name, fn) => r.on(name, (...a) => {
    if (room !== r) return;
    if (name !== 'stats') trace.note('room ' + name + (a.length ? ' ' + trace.args(a) : ''));
    safe(fn, ...a); changed(name);
  });
  // Someone new, or back from another tab or device: the rounds (their snapshots, tombstones too), then everything
  // we know, in chunks of up to CAP bytes (players' wire numbers first: nobody is seated before their wire is known).
  // Not a here: of ours naming a game while we have none open: an older tab of ours wrote it, it is no news of this
  // one (from us, it would end the wait for our game to open: see onLibMessage, libraries from before phase 1b).
  // The round layer's first (round.js): the records, then their rounds' snapshots (each taken only from the runner its
  // record names, so the record goes first), and only then what may link a game.
  const greet = p => {
    const news = ([k, e]) => k !== 'here:' + r.me || !!myHere || !e.v, all = st.entries().filter(news);
    const isRound = ([k]) => k.startsWith('round:'), recs = all.filter(isRound);
    for (const e of chunks(recs)) send({ t: 'lib-state', e }, p);
    R.greet(p);
    for (const [v, s] of snaps) send(snapMsg(v, s), p);
    for (const e of chunks(all.filter(e => !isRound(e)).sort(([a], [b]) => b.startsWith('wire:') - a.startsWith('wire:')))) send({ t: 'lib-state', e }, p);
    trace.note('greet ' + p + ': ' + snaps.size + ' snapshots, ' + all.length + ' keys');
  };
  // Whoever comes in (back after their place dropped, or a room of ours started over) may hold our here: from before
  // and count us as loading until we write one after they came (rules.arrivesLoading): if we have a game open, we say
  // so again whenever a link starts ('linked', 'join', 'relinked': ours may be the link that is new to them; sayHere).
  // (Not a here: null meanwhile: a new tab on its way into its player's game would end the round, see above.)
  // (R.met: a round we quit hears it again from its runner, whenever we link with it)
  on('linked', () => {
    if (r.role === 'host' && st.get('view') === undefined) publish(st.set('view', shell.current()));
    sayHere();
    for (const p of r.players) if (p !== r.me) { greet(p); R.met(p); }
    update();
  });
  // Back after their place dropped: until a here: they wrote since arrives, their game is not open as far as we know.
  on('join', p => { sayHere(); greet(p); R.met(p); if (rules.arrivesLoading(facts, p, 'join')) loading.set(p, performance.now()); update(); });
  // Back in a new tab or device: until their game is open there again, the game waits for them (see 'here' below).
  // The same tab after its link started over: its game is still there, it only needs the full picture again.
  on('relinked', (p, fresh) => {
    sayHere();
    greet(p);
    R.met(p);
    if (rules.arrivesLoading(facts, p, 'relinked', fresh)) loading.set(p, performance.now());
    update();
    if (!fresh && ch && ch.others.includes(p) && !loading.has(p)) { ch.emit('relinked', p); ch.round.rejoin(p); }
  });
  // (a round's player gone for good: a round with policy endWhenSeatGone ends now, round.js)
  on('leave', p => { loading.delete(p); quitRounds(p); update(); R.tick(); });
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
  on('status', s => { if (s === 'version') versionCheck(); });
  on('weak', update);
  // the open game's fast messages waited for the relay budget (net/link.js): on the dev server the console says so, once
  on('budget', () => { if (DEV && !budgetWarned) { budgetWarned = true; console.warn('ihroteka.room: through the brokers, fast messages go out at most ~30 times a second per player; more of them wait and go together (a full state each time: send it with { fast: true, latest: … })'); } });
  on('stats', () => { update(); if (ch && ch.api.linked) ch.emit('stats', ch.api.stats()); });
  r.on('tick', now => { if (room === r && ch && ch.api.linked) ch.emit('tick', now); });
  r.on('pulse', (p, from) => { if (room === r && ch && ch.api.linked && p && p.v === ch.id && p.g && typeof p.g === 'object' && ch.others.includes(from)) ch.emit('pulse', p.g, from); });
  r.on('message', (m, from, reliable) => { if (room === r) onLibMessage(m, from, reliable); });
  changed('status');
  return r;
}

// a change of ours to the shared state: to everyone
const publish = entry => { trace.note('state → ' + entry[0]); send({ t: 'lib-state', e: [entry] }); };
// The game we have open, to everyone, with our wire numbers in the same message, ahead of it: one new to us may not
// have been greeted yet (as the room links, its list of players may not name them yet), and nobody seats our game by
// the number a missing one stands for (rules.sameWire).
function sayHere() {
  if (!room || !myHere) return;
  const w = st.entries().find(([k]) => k === 'wire:' + room.me), h = st.set('here:' + room.me, myHere);
  trace.note('state → ' + h[0]);
  send({ t: 'lib-state', e: w ? [w, h] : [h] });
}
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
    trace.note('snapshot ' + v + ': over (' + p + ' left)');
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
  if (k.startsWith('round:')) return validRecord(k, e);
  return /^g:[a-z0-9-]{1,40}:[\w-]{1,40}$/.test(k);
}

// (reliable: as the room delivered it; false: a fast message. A room from before it said nothing: reliable)
function onLibMessage(m, from, reliable) {
  if (m.t === 'lib-state' && Array.isArray(m.e)) {
    const known = m.e.filter(e => Array.isArray(e) && knownEntry(e)), keys = st.merge(known);
    if (keys.length) trace.note('state ← ' + from + ': ' + keys.join(' '));
    if (keys.includes('view')) { const v = st.get('view'); if (ID(v) && v !== shell.current()) shell.follow(v); }
    if (keys.includes('here:' + room.me)) staleHere(st.get('view'));
    if (keys.includes('wire:' + room.me)) staleWires();
    // a player back (in a new tab, or after their place dropped) says where they are now: no longer loading (nor
    // stale); if it is our game, that copy of it needs the full picture. Also when it is the here: we knew, from them:
    // a library from before phase 1b, back on the same page, greets with the one it had and never writes it again.
    const said = keys.filter(k => k.startsWith('here:')).map(k => k.slice(5));
    const h = st.get('here:' + from);
    if (loading.has(from) && h && m.e.some(e => Array.isArray(e) && e[0] === 'here:' + from && knownEntry(e) && e[1].v === h)) said.push(from);
    const back = [...new Set(said)].filter(p => loading.delete(p));
    R.merged(keys, known);                                // (round records: an end is final whatever its clock, round.js)
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
    trace.note('snapshot ' + m.v + ' ← ' + from + ': ' + (m.s === null ? 'over' : trace.size(m.s)), 'snap<' + from + m.v);
    snaps.set(m.v, { s: m.s, c: m.c, a: m.a, p: Array.isArray(m.p) && m.p.every(x => typeof x === 'string') ? m.p : undefined });   // (null: a tombstone)
    if (ch && ch.id === m.v) ch.maybeResume();
  } else if (m.t === 'lib-save' && typeof m.v === 'string') {
    R.onSave(m);
  } else if (m.t === 'lib-ask' && typeof m.v === 'string') {
    R.onAsk(m, from);
  } else if (m.t === 'lib-g' && ch && m.v === ch.id && myHere === ch.id) {
    ch.receive(m.m, from, reliable !== false);
  }
}

// the shell switched to another view: on its own (tell the others) or following someone
export function viewChanged(id, byPeer) {
  if (!byPeer && room) publish(st.set('view', id));
  if (room) staleHere(id);
}
// The others may know our wire numbers from our previous page (before it reloaded into a newer version; its clock may
// run ahead of ours), or from the shelf before the game's code that runs said its own (attachGame): ours win.
function staleWires() {
  const w = myWires(), k = 'wire:' + room.me;
  if (w && JSON.stringify(st.get(k)) !== JSON.stringify(w)) publish(st.set(k, w));
}
// What the others know of us may come from an older page of ours (another tab, or this one before it reloaded), whose
// clock may run ahead of ours (roomstate.js: what we write stays below it until we have merged it). Once merged, ours
// wins: the game we have open is said again; with none open, a here: naming a game we are not on our way into is set
// right.
function staleHere(next) {
  const k = 'here:' + room.me, h = st.get(k);
  if (myHere ? h !== myHere : h && h !== next) publish(st.set(k, myHere));
}

/* ---------- the address bar: an internet room stays in the link (?room=), so a reload rejoins ---------- */
export const query = () => room && room.kind === 'internet' ? '?room=' + room.code : '';
function setQuery(code) {
  try { history.replaceState(history.state, '', location.pathname + (code ? '?room=' + code : '')); } catch (e) {}
}

/* ---------- the room each game sees: ihroteka.room ---------- */
// attach: the game's page is loaded and about to run its code. wire: the wire its code speaks (its page's own GAME,
// shell.js api; none: the shelf's), which the page keeps for that game from now on: whoever plays with us must speak
// it, so the others learn it before our here: names the game (nobody seats us by the shelf's number meanwhile).
export function attachGame(id, wire) {
  detachGame();
  if (Number.isSafeInteger(wire) && wire > 0 && wire !== myWire(id)) {
    running.set(id, wire);
    trace.note('game ' + id + ': its code speaks wire ' + wire);
    if (room) staleWires();
  }
  ch = channel(id, Math.max(1, shell.seats(id)));
  myHere = id;
  trace.note('game ' + id + ' open (' + ch.seats + ' seats)');
  sayHere();
  queueMicrotask(update);
  versionCheck();                                        // (the versions may differ now; with a game open, no reload)
  return ch.api;
}
// the open game's ihroteka.round (round.js), next to the ihroteka.room that attachGame returned
export const openRound = () => ch ? ch.round.api : null;
export function detachGame() {
  if (!ch) return;
  trace.note('game ' + ch.id + ' closed');
  ch.dispose();
  ch = null; myHere = null; closedSince.clear();
  if (room) publish(st.set('here:' + room.me, null));
}

// The room as the rules see it (rules.js), read when they ask; only while there is a room.
const facts = {
  get me() { return room.me; },
  get players() { return room.players; },
  here: p => st.get('here:' + p),
  wire: (p, game) => p === room.me ? myWire(game) : (st.get('wire:' + p) || {})[game],
  loading,
  away: p => room.away(p),
  get nearby() { return room.nearby; },
  get role() { return room.role; },
  get host() { return room.host; },
  hold: HOLD,
  get now() { return performance.now(); }
};
// who has this game open, in the room's order; a player who dropped out keeps their place here too
const inGameOf = c => room ? rules.inGame(facts, c.id, myHere) : [];
// dropped out (their place is kept), or back and their game not open yet (rules.absence): for how long, ms
const awayMs = p => room ? rules.awayMs(facts, p) : 0;
// whose copy runs the round: the one the shared state names (authOf: a game's round record, round.js; else, for the
// room of contract 4, auth:<game>), if they play; else the first who plays
const authOf = c => st ? R.runnerOf(c.id) ?? st.get('auth:' + c.id) : undefined;
const runnerOf = c => rules.runnerOf(c.seated, authOf(c));
// The runner has been away for AUTH_WAIT: the first player here who plays takes the round over, if they can show
// it is not them who dropped out (rules.takeOver); only that one writes it, everyone sees it in the shared state.
// (A game on the round layer: R.tick, the same rule for its round.) Counted again each second too: a player still
// opening the game for as long as a place is kept goes stale (out of the game, rules.stale), with no event to say so.
let onlineSince = 0;
function watchRunner() {
  const now = performance.now();
  versionCheck();
  onlineSince = rules.onlineSince(onlineSince, !!room && room.online, now);
  if (!room) return;
  R.tick(now);
  if (!ch || !room) return;
  update();
  if (!ch || !ch.api.linked || R.record(ch.id)) return;
  if (rules.takeOver(facts, { inGame: ch.inGame, seated: ch.seated, runner: runnerOf(ch), since: onlineSince, now, wait: AUTH_WAIT })) { publish(st.set('auth:' + ch.id, room.me)); update(); }
}

// The rounds of ihroteka.round (round.js), on this room.
const R = rounds({
  room: () => room, st: () => st, publish: e => publish(e), send: (m, to) => send(m, to), facts, lookingAgain: () => lookingAgain(),
  wire: game => myWire(game), frame: () => ch, since: () => onlineSince, update: () => update(), play: (fn, ...a) => play(fn, ...a)
});

/* ---------- versions: the library's (PROTO) and each game's (wire) ---------- */
// Our wire number of each game we have: the shelf's (game.json "wire", as the page loaded it; null: the shell does not
// say, every game 1), but for a game whose code that runs here says another (attachGame: a deploy while the page stayed
// open; a game.bin from before the numbers speaks 1): that one, for the page's life.
let wires;
const running = new Map();                               // game → the wire its copy here speaks, where the shelf says otherwise
const shelfWires = () => { if (wires === undefined) { const w = shell && shell.wires && safe(shell.wires); wires = WIRES(w) ? w : null; } return wires; };
const myWires = () => running.size ? { ...(shelfWires() || {}), ...Object.fromEntries(running) } : shelfWires();
const myWire = game => running.has(game) ? running.get(game) : shelfWires() ? shelfWires()[game] : 1;
// A friend's library or game is another version (rules.versionGap) → null | { why, game, theirs, older, key }
export function versionGap() {
  if (!room || !st) return null;
  const others = room.players.filter(p => p !== room.me).map(p => st.get('wire:' + p));
  return rules.versionGap({ proto: PROTO, wires: myWire }, room.versionMismatch, others);
}
// The older page updates itself (rules.reloadNow): its offline copy first, then a reload (shell.reload), back into
// the same room without asking the name again (REJOIN). Asked whenever the versions or the rounds may have changed;
// the screens hear 'version' once a pass. Only while no game is open here: a round may run in it, even one played
// alone, which the library cannot see (the note over the game offers «Оновити» instead); and only if the page can note
// that it reloaded (RELOADED, noted as the reload really happens): one that cannot (site data blocked) would reload
// again on every visit, so it leaves it to the player. The offline copy may take a while (up to 30 s): if meanwhile a
// game opened or we left the room, the reload is called off (and tried again once the page is free). An update that
// brought nothing to reload into (see attempt) is not tried again by itself for that version.
let gapKey = '', reloading = null;
function versionCheck() {
  if (!room) return;
  const gap = versionGap(), key = gap ? gap.key + (gap.older ? '<' : '>') : '';
  const news = key !== gapKey;
  if (news) { gapKey = key; trace.note('versions: ' + (key || 'the same')); }
  const started = selfUpdate(gap);
  if (news || (started && quietFor !== gap.key)) changed('version');   // (once a pass: the screens say it once)
}
// whether the older page starts updating itself now
function selfUpdate(gap) {
  if (reloading || !gap || !gap.older || failedFor(gap)) return false;
  const was = session.get(RELOADED), done = new Set(Array.isArray(was) ? was : []);
  if (!rules.reloadNow(gap, { nearby: room.kind === 'nearby', playing: !!ch, done })) return false;
  if (!session.set(RELOADED, was)) return false;         // (can it note it? as it was, for now)
  reloading = gap.key;
  const r = room, key = gap.key;
  attempt(key, () => {
    if (room === r && !ch && session.set(RELOADED, [...done, key])) return true;
    reloading = null;                                    // (not now: tried again once the page is free)
    changed('version');
    return false;
  });
  return true;
}
// whether the note offers «Оновити»: on the older page only (rules.offerUpdate)
export const offerUpdate = () => rules.offerUpdate(versionGap(), { nearby: !!room && room.kind === 'nearby' });
// the newer version now (the note's «Оновити»: also after an update that failed), back into this room after it
export function updateNow() {
  const gap = versionGap();
  updateFailed = null; quietFor = null;
  clearTimeout(sameTimer);
  attempt(gap ? gap.key : '', null);
}
// One try at the newer version (shell.reload: the offline copy first, update.js; then the reload, unless still, asked
// once the copy is in place, says no). What came of it: 'reload' (the page goes), 'stay' (still said no), or, with no
// newer copy to reload into, the page stays as it is and the version says why (updateFailed): 'same' (the site has
// nothing newer yet: tried again by itself after SAME_AGAIN, quietly: the screens heard it the first time), 'storage'
// (no room on the device for it), 'failed' (no network, or the new version did not install), 'timeout' (still on its
// way: when it settles, the shell's later says how; it may have settled before the try said 'timeout').
const FAILS = new Set(['same', 'storage', 'failed', 'timeout']);
const SAME_AGAIN = 60000 * SCALE;
let updateFailed = null, sameTimer = null, tries = 0;   // updateFailed: { key: the version's gap.key, why }
let quietFor = null;                                     // the version whose update is tried again after 'same'
const failedFor = gap => !!gap && !!updateFailed && updateFailed.key === gap.key;
function attempt(key, still) {
  if (room && room.kind === 'internet') session.set(REJOIN, { code: room.code, name: room.me, at: Date.now() });
  if (!shell || !shell.reload) return;
  const n = ++tries;
  let said = false, after = null;                        // (the try said what came of it; how it ended after all, before that)
  const later = out => { if (said) settled(n, key, out); else after = out; };
  Promise.resolve(safe(() => shell.reload(still || undefined, later))).then(out => out, () => 'failed').then(out => {
    said = true;
    outcome(n, key, out);
    if (after) settled(n, key, after);
  });
}
function outcome(n, key, out) {
  if (n !== tries || !FAILS.has(out)) return;           // (a newer try under way; or the page reloads, or still said no)
  const quiet = out === 'same' && quietFor === key;
  reloading = null;
  updateFailed = { key, why: out };
  quietFor = null;
  clearTimeout(sameTimer);
  if (out === 'same') sameTimer = setTimeout(() => { if (updateFailed && updateFailed.key === key && updateFailed.why === 'same') { updateFailed = null; quietFor = key; versionCheck(); } }, SAME_AGAIN);
  trace.note('update: ' + out);
  if (!quiet) changed('version');
}
// an update that ran past its time settled after all: in place (the page may reload into it now), or why not
function settled(n, key, out) {
  if (n !== tries || !updateFailed || updateFailed.key !== key || updateFailed.why !== 'timeout') return;
  if (out !== 'activated') { outcome(n, key, out); return; }
  updateFailed = null;
  trace.note('update: in place after all');
  versionCheck();
}
// (for state() and the screens: why the update for the version gap now did not happen, or null)
const failedWhy = gap => failedFor(gap) ? updateFailed.why : null;

// what the trace does not tell the game's way (several a second): messages, pulses, ticks, link figures
const BUSY = new Set(['message', 'pulse', 'tick', 'stats']);
// what a game's copy keeps of the messages it cannot hear yet (it does not listen yet, or waits for its round's
// snapshot): every reliable one, up to KEEP_BYTES of them; of the fast ones, the newest KEEP_FAST (each says what is now)
const KEEP_FAST = 64, KEEP_BYTES = 8 * CAP;
function channel(id, seats) {
  const handlers = new Map(), inbox = [], late = [], warned = new Set(), used = new Set();
  let keptFast = 0, keptBytes = 0;                       // (in the inbox: its fast messages; its reliable ones' bytes)
  let pending = null, sendTimer = null, lastSent = 0;     // the latest snapshot not sent yet (at most two a second)
  const c = {
    id, seats, disposed: false, was: [], seen: '', weak: false, wait: '', role: null, runner: null, own: false,
    inGame: [], seated: [], waiting: [], others: [],
    emit(name, ...a) {
      // (a shared value and a round to resume: only their size)
      const told = name === 'shared' ? [a[0], trace.size(a[1])] : name === 'resume' ? [trace.size(a[0])] : a;
      if (!BUSY.has(name)) trace.note('→ ' + id + ' ' + name + (told.length ? ' ' + trace.args(told) : ''));
      for (const fn of handlers.get(name) || []) play(fn, ...a);
      c.heard(name);
    },
    // Listeners added late (the room's, and the round's as 'round:<event>'): one replay pass for all of them, in its
    // order; one that hears its event live first has nothing to replay.
    later(key, fn) { if (late.push([key, fn]) === 1) queueMicrotask(replay); },
    unlater(key, fn) { const i = late.findIndex(([k, f]) => k === key && f === fn); if (i >= 0) late.splice(i, 1); },
    heard(key) { for (let i = late.length; i--;) if (late[i][0] === key) late.splice(i, 1); },
    policy: name => typeof api[name] === 'function' && play(api[name]),
    pulseOut: now => typeof api.pulse === 'function' ? play(api.pulse, now) : null,
    // A game's message from another player (reliable: as the room delivered it). Kept, in order, until the game listens,
    // and while its round is on and our copy has not been told its part in it yet (round.js: 'run' comes before any
    // message): every reliable one (up to KEEP_BYTES of them; past that the newest are dropped, and the trace says so,
    // as the dev console does once), and of the fast ones the newest KEEP_FAST.
    receive(m, from, reliable = true) {
      if (!api.linked || !c.others.includes(from) || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (handlers.has('message') && !c.round.holds()) {
        c.deliverKept();                               // (kept ones first, in order)
        c.emit('message', m, from);
      } else if (!reliable) {
        if (keptFast < KEEP_FAST) keptFast++; else inbox.splice(inbox.findIndex(k => k.fast), 1);   // (the oldest fast one goes)
        inbox.push({ m, from, fast: true });
      } else {
        const size = bytes(JSON.stringify(m));
        if (keptBytes + size > KEEP_BYTES) { c.refuse('message: over ' + KEEP_BYTES + ' bytes of reliable messages wait for the game to hear them (it listens late, or waits for its round\'s snapshot): the newest are dropped'); return; }
        keptBytes += size;
        inbox.push({ m, from, fast: false });
      }
    },
    deliverKept() {
      if (!inbox.length || !handlers.has('message') || c.round.holds()) return;
      const kept = inbox.splice(0);
      keptFast = keptBytes = 0;
      for (const k of kept) c.emit('message', k.m, k.from);
    },
    // A call the game may not make now, or with this: false (on the dev server, once per reason, the console says why).
    refuse(why, of = 'room') { trace.note('refused: ' + why); if (DEV && !warned.has(why)) { warned.add(why); console.warn('ihroteka.' + of + ': ' + why); } return false; },
    // (dev) a game that keeps its rounds both ways, ihroteka.round's (start, save, over, quit) and the room's of contract
    // 4 (room.snapshot): said once, as the two do not know of each other
    uses(kind) {
      used.add(kind);
      if (DEV && used.size === 2 && !warned.has('v4')) { warned.add('v4'); console.warn('ihroteka.round: this game also keeps rounds with room.snapshot (contract 4); the two do not know of each other: a game on ihroteka.round needs none of room.snapshot, host, role, \'resume\', \'role\' and \'relinked\' (README "Game API")'); }
    },
    // We run the round now, we play with someone, and this copy of the game has nothing of it: it goes on from the
    // snapshot, if the snapshot is of a round with the players seated now (not a tombstone, not someone else's; a
    // player of it who left the room for good since does not count, rules.snapFits: in a game for 3+ the round goes on
    // without them, and its snapshot names them until the runner takes the next one). (A game not listening yet hears
    // it when it starts to.)
    maybeResume() {
      const s = snaps.get(id);
      if (api.role === 'host' && api.linked && !c.own && s && s.s !== null && rules.snapFits(s, c.seated, room.players) && handlers.has('resume')) { c.own = true; c.emit('resume', copy(s.s)); }
    },
    // The round is over for the game ('peer-gone'): its copy keeps nothing of it (so the next time we run it on, it
    // hears 'resume'). If one of its players left the room for good, it can never go on: a tombstone, for everyone.
    over(was) {
      c.own = false;
      if (!room || lookingAgain() || !rules.goneForGood(was, room.players, room.me) || !snaps.has(id) || snaps.get(id).s === null) return;
      pending = { s: null, c: st.next(), a: room.me };
      snaps.set(id, pending);
      trace.note('snapshot ' + id + ': over (a player left)');
      flush();
    },
    // the latest snapshot, if it still waits for its turn to go (at most two a second): now (the game closes, the page
    // goes or is hidden: it may never come back to send it)
    snapNow() { clearTimeout(sendTimer); flush(); c.round.snapNow(); },
    dispose() { c.snapNow(); c.round.dispose(); handlers.clear(); inbox.length = 0; keptFast = keptBytes = 0; late.length = 0; c.disposed = true; }
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
  const refuse = why => c.refuse(why);
  // What a game that starts listening late missed, as update() would have told it: who plays ('players'), its part in
  // the round of ihroteka.round ('run' or 'watch', round.js), the round it runs on ('resume'), that it plays with
  // someone ('linked'), that it waits ('weak'); then the messages kept for it until it listened. One pass for every
  // listener added meanwhile (the room's and the round's), in this order whatever order they came in.
  const replay = () => {
    const fresh = late.splice(0), to = name => fresh.filter(([n]) => n === name).map(([, fn]) => fn);
    if (c.disposed) return;
    trace.note('→ ' + id + ' listens: ' + [...new Set(fresh.map(([n]) => n))].join(' '));
    if (c.seen) for (const fn of to('players')) play(fn, api.players);
    c.round.replay(to);
    if (to('resume').length) c.maybeResume();
    if (api.linked) for (const fn of to('linked')) play(fn);
    if (c.weak) for (const fn of to('weak')) play(fn, true);
    c.deliverKept();
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
      c.later(name, fn);
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
      c.uses('v4');
      if (api.role !== 'host' || !room) return refuse('snapshot: only from the copy that runs the round (room.role host)');
      if (x !== null && bytes(x) > CAP) return refuse('snapshot: up to ' + CAP + ' bytes as JSON');
      // the round runs in our copy: we name it in the shared state (once), so a change of the room's order (a shaky
      // network may reorder it) cannot move the round to another copy; only a takeover does (watchRunner)
      if (x !== null && api.linked && authOf(c) !== room.me) publish(st.set('auth:' + id, room.me));
      c.own = true;
      const v = { s: x === null ? null : JSON.parse(x), c: st.next(), a: room.me, p: c.seated.slice() };
      snaps.set(id, v);                                // (null: a tombstone)
      trace.note('snapshot ' + id + ': ' + (x === null ? 'over' : bytes(x) + ' B'), 'snap>' + id);
      pending = v;
      if (v.s === null || performance.now() - lastSent > 500) flush();
      else if (!sendTimer) sendTimer = setTimeout(flush, 500);
      return true;
    },
    lag: p => !room ? 0 : p !== undefined ? room.lag(p) : c.others.reduce((m, q) => Math.max(m, room.lag(q)), 0),
    stats: p => statsOf(p !== undefined ? (room ? [p] : []) : c.others),
    diag: () => report(),                              // the connection, and what happened lately (report)
    frame: now => { if (room) room.frame(now); },     // an optional hint (now unused): while we play, the room does it itself (net/link.js tendAlive)
    kick: () => {},                                    // nothing to do: the room checks its network by itself (kept for games that call it)
    invite: () => shell.invite()
  };
  c.api = api;
  c.round = R.frame(c);                                  // ihroteka.round (round.js)
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
  const s = rules.seating(inGameOf(c), c.seats, room && room.me, room ? R.frozen(c.id) : null);
  c.inGame = s.inGame; c.seated = s.seated; c.waiting = s.waiting; c.others = s.others;
}

// Tell the open game who plays now: 'players', then what changed for the round (rules.playersChange: 'peer-gone'
// and 'linked', or 'leave' and 'join'), then whose copy runs it ('role', and 'resume' with the snapshot for the
// new one), then 'weak'. A round that goes on in our copy as we start to play with someone hears 'resume' before
// 'linked' (so the game knows it runs the round on when it hears it plays); and only while we play with someone.
// (Once at a time: what the game does on an event, say a round it starts or ends, comes in a pass of its own right
// after this one, never in the middle of it.)
let updating = false, again = false;
function update() {
  if (updating) { again = true; return; }
  updating = true;
  try { for (let n = 0; n < 8; n++) { again = false; updateOnce(); if (!again) break; } } finally { updating = false; }
}
function updateOnce() {
  if (!ch) return;
  const c = ch;
  recount(c);
  const now = c.others.length ? c.seated : [], was = c.was, seen = c.seated.join() + '|' + c.inGame.join();
  const runner = now.length ? runnerOf(c) : null, wasRunner = c.runner;
  c.runner = runner;
  if (seen !== c.seen) { c.seen = seen; c.emit('players', c.api.players); }
  c.round.update();                                      // the round of ihroteka.round: start, run or watch, rejoin, end
  if (ch !== c) return;
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
  // (what the screens say: whom we wait for and why, our seat, the version; the 1 s watchRunner update crosses
  // CLOSED_GRACE and RESTORE_SHOW)
  const wait = screen(waitFacts()).key;
  if (wait !== c.wait) { c.wait = wait; changed('waiting'); }
  versionCheck();
}

// For the screens (waitFacts): the players we wait for in the open game, of those we play with (rules.absence):
// dropped out, their seat kept ('link'), or back and opening the game ('loading')
// → [{ name, left: ms, why, release: whether «Не чекати» works from here }]
export function waitingFor() {
  if (!ch || !room || !ch.api.linked) return [];
  return rules.waitingFor(facts, ch.others);
}
// For the screens (waiting.js screen; invite.js, screens.js): whom the open game waits for and why (waitingFor of whom
// we play with; rules.roundWaits while nobody we play with has it open, a 'closed' one only after CLOSED_GRACE), our
// copy waiting for its round's snapshot (round.js restoring), a seat we wait for and who plays now, another version
// (gap.failed: why our update to it did not happen, see attempt; the screens say nothing of it yet)
// → { waits, restoring, seat, gap, offer, nearby } (waiting.js screen's facts)
export function waitFacts() {
  const gap = versionGap();
  const f = { waits: [], restoring: false, seat: null, gap: gap && { key: gap.key, older: gap.older, failed: failedWhy(gap) }, offer: offerUpdate(), nearby: !!room && room.kind === 'nearby' };
  if (!ch || !room) { closedSince.clear(); return f; }
  const now = performance.now(), r = ch.round.api;
  const round = rules.roundWaits(facts, ch.id, r.active ? r.seats : null, ch.inGame, ch.others);
  for (const p of [...closedSince.keys()]) if (!round.some(x => x.name === p && x.why === 'closed')) closedSince.delete(p);
  for (const x of round) if (x.why === 'closed' && !closedSince.has(x.name)) closedSince.set(x.name, now);
  f.waits = [...waitingFor(), ...round.filter(x => x.why !== 'closed' || now - closedSince.get(x.name) >= CLOSED_GRACE)];
  f.restoring = ch.round.restoring(now);
  if (!ch.api.seated && ch.waiting.includes(room.me)) f.seat = { players: rules.playingNow(R.frozen(ch.id), room.players, ch.seated) };
  return f;
}
// nobody waits for this player any longer: their place goes
export const release = p => { if (room) room.release(p); };

/* ---------- reports ---------- */
// What to copy into a bug report: the site's version, the connection (room.diag()) and the trace's last lines.
export const report = () => SITE + '\n' + (room ? room.diag() : 'no room') + '\ntrace:\n' + trace.read().join('\n');
// The game's own code, called by the library (its listeners, its policies): what it throws stops nothing else. It is
// reported (the console, the trace), and the shell may say the game broke (shell.gameError: while it is starting).
function play(fn, ...a) { try { return fn(...a); } catch (e) { console.error(e); gameError(e); } }
// an error of the open game (thrown in its window, ev: the ErrorEvent; or in its listeners), or of the library's page
export function gameError(e, ev) { trace.note('error in the game: ' + trace.error(e, ev)); if (shell && shell.gameError) safe(shell.gameError); }
export const pageError = (e, ev) => trace.note('error on the page: ' + trace.error(e, ev));
