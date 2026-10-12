// What every room has, however the players found each other: who is in it, the links between us, events, the
// game's policies and the public room object. internet.js and nearby.js add how players meet (the mode, below).
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
// the host one per guest. Links are by session (one per tab); places are by name. (Fields: Room, Peer below.)
//
// The places invariant. A place (an entry of N.members) goes only when
//   - its player leaves for good: a final bye (menu: 1) → the mode's byeFrom → dropMember (our host's: hostGone);
//   - someone presses «Не чекати»: room.release → dropMember on the host (a guest asks it with _x; for the host
//     itself, the mode's releaseHost);
//   - HOLD runs out: holdOver, on the host.
// A link that ends (a closed tab, a silent link, another tab of the same player) never takes a place with it, and
// a player who comes back from any session gets the same place (seatMember). The host's list is the room's: a guest
// takes it as sent (_r). Known exceptions today (to be fixed; do not rely on them): starting over (internet.js:
// discover, becomeHost without keep) resets the list to us alone, and dropAll(N, true) says a final bye to the links
// it drops; when two rooms on one code merge (giveWay), the places of the one that gives way go unless their players
// are here to come along; a guest linked to a host missing from its list starts it as the two of us (guestMembers).
//
// Roles (N.role; the 'role' event tells the game each change):
//   null     looking for the room: internet, asking 'who'; nearby, before pairing
//   'host'   holds the room. Internet: nobody answered 'who' (or, still looking, we heard a 'who' from a greater
//            session), or our host is gone and we are the first player here (hostGone). Nearby: pair.offer().
//   'guest'  linked or linking to N.host. Internet: a host answered (also 'go', 'host' u:1, hostGone, giveWay,
//            longSleep: a hello to the same or another host). Nearby: pair.answer().
//   'out'    another tab of this player took our place (internet: 'moved', or a hello with the host's own name):
//            final, the room is closed.
// Over the internet the roles change back and forth: null → 'host' | 'guest'; 'guest' → 'host' (hostGone), 'guest'
// (another host), null (6 hellos unanswered: discover); 'host' → 'guest' (two hosts on one code: giveWay), 'host'
// (a sleep longer than HOLD: role null without an event, then 'host' again); any → 'out'. Nearby, a room never
// changes kind: null → 'host' or null → 'guest', and pairing again keeps it.
import { me, TIMING } from './config.js';
import { closeRtc } from './rtc.js';
import { deliver, diag, keepDirectAlive, kick, lag, refresh, resetPaths, send, stats, watch } from './link.js';

// Messages of the room itself on a link: p (pulse), q (ping answer), bye; and _r (the players), _h (nearby hello),
// _x (a guest asks the host to let a player's place go). A game's message types must not start with '_' and be
// none of these. (Nor 'ak', the link's acknowledgement: room.send does not refuse it yet, but one sent fast would
// be taken for an acknowledgement. Every message, both modes: internet.js and nearby.js, at the top.)
const RESERVED = new Set(['p', 'q', 'bye']);
export const MAX_PLAYERS = 8;
export const HOLD = TIMING.HOLD;                       // how long a player who dropped out keeps their place
export const NAME = /^\S(?:.{0,22}\S)?$/u;             // a name: 1 to 24 characters, no spaces around

/**
 * The mode: what internet.js and nearby.js plug into a room. newRoom takes it as `mode` and puts each hook on N
 * (each one is the mode's closure over its N). A missing optional hook is a no-op; a missing required one throws.
 *
 * Required:
 *   peerGone(P)          link.js: P has been silent for N.lostAfter (HOLD), or so much is unacknowledged that they
 *                        cannot be hearing us. The link is over: unlink P (our host: move on). Their place stays.
 *   byeFrom(P, final)    link.js: a 'bye' from P on the link (at once, ahead of anything still missing; internet.js
 *                        also on the topic). final (menu: 1): the player left for good, their place goes (dropMember);
 *                        else only their tab closed: unlink P, the place is kept. From our host: move on (hostGone).
 * Required in rooms with brokers (relay; brokers.js calls them):
 *   onConnected(client)  a broker connected and listens to the room's topic
 *   onMessage(m, client) a message on the room's topic or in our mailbox (copies through other brokers dropped)
 *   onDown()             a broker that worked went down
 * Optional:
 *   close(final)         room.leave(), after the links said bye and before they close: the mode's goodbye and cleanup
 *   bye()                the tab closes (pagehide; our place is kept): a goodbye by the mode's own path too
 *   onUnlink(P)          unlink(): the link with P is over, just before P leaves N.peers (internet: stop listening)
 *   probe(P, now)        each watchdog tick, for each linked P (internet: a guest asks a quiet host 'here')
 *   hubCheck(now)        each watchdog tick (internet: a guest whose host has been away HOST_WAIT moves on)
 *   longSleep()          our tab slept longer than N.lostAfter. → true: the mode started over, and the rest of that
 *                        tick is skipped (internet: hello again, or a new room); falsy: the tick goes on (nearby)
 *   releaseHost()        a guest's room.release(n) for its own host (internet: hostGone, the host's place goes)
 *   onDirect(P, open)    rtc.js: P's direct channels both opened (true), or one closed (false) (nearby: say _h)
 *   onHello(P, m)        rtc.js, rooms without brokers: an _h on a direct link that does not count yet
 * Also on N, from newRoom for link.js and rtc.js (not the mode's): emit, streaming(), pulse(now), refresh(P),
 * arrive(P, m, reliable), roomStats().
 */
const REQUIRED = ['peerGone', 'byeFrom'], BROKER_HOOKS = ['onConnected', 'onMessage', 'onDown'];
const HOOKS = [...REQUIRED, ...BROKER_HOOKS, 'close', 'bye', 'onUnlink', 'probe', 'hubCheck', 'longSleep', 'releaseHost', 'onDirect', 'onHello'];
function modeHooks(mode, relay) {
  for (const k of Object.keys(mode)) if (!HOOKS.includes(k) || (mode[k] != null && typeof mode[k] !== 'function')) throw new Error('room: not a mode hook (or not a function): ' + k);
  for (const k of relay ? [...REQUIRED, ...BROKER_HOOKS] : REQUIRED) if (!mode[k]) throw new Error('room: the mode needs ' + k);
  return Object.fromEntries(HOOKS.map(k => [k, mode[k] || (() => {})]));
}

/**
 * N, a room's state (one per room, in this tab). Fields by purpose; the mode's hooks are above.
 * @typedef {object} Room
 * What it is (newRoom):
 * @property {string} game           the game: rooms of different games never meet
 * @property {string} code           the room code ('' nearby)
 * @property {string} name           our player's name
 * @property {boolean} relay         true: the brokers carry data when the direct link cannot (internet rooms)
 * @property {number} max            players at most, the host included (2…MAX_PLAYERS)
 * @property {number} lostAfter      HOLD: a link silent this long is gone; a sleep of ours this long: longSleep
 * @property {boolean} closed        we left, or another tab took our place: nothing goes out any more
 * @property {Function} emit         (event, ...args): to the room's listeners
 * Brokers (internet rooms, brokers.js):
 * @property {string} topic          the room's topic (a hash of game and code)
 * @property {Array} clients         per broker, its MQTT client (null while it waits to retry); c._ok: subscribed,
 *                                   c._rx: last heard, c._lat: echo delay, c._echo: it echoes us
 * @property {Array} br              per broker: { state: 'connecting' | 'ok' | 'wait', since, fails, timer }
 * @property {number} seq            our last message number on the brokers (from the clock: never one used before)
 * @property {Map} last              sender → the numbers seen lately (a copy through another broker is dropped)
 * @property {boolean} ready         a broker has connected: we looked for the room
 * @property {boolean} up            some broker works (as the status last said)
 * @property {number} kickAt         when the brokers were last checked at once (kickBrokers: at most every 3 s)
 * @property {number} kAt            when the last echo test went ('k', every 5 s)
 * @property {number} winAt          when the brokers' scores were last halved (every 2 s)
 * @property {number} pubN           data messages sent (every 24th goes through every broker)
 * Role and players:
 * @property {?string} role          null, 'host', 'guest' or 'out' (see the top)
 * @property {?string} host          a guest's host: its session (null for the host)
 * @property {Map<string, Peer>} peers   session → the link with that tab
 * @property {Array<{n: string, s: string, a: number}>} members   the places in the order they came: name, session
 *                                   (ours: me), away since (performance.now(); 0 while here)
 * @property {string} sent           the host: the list as last sent (_r), so an unchanged one does not go again
 * @property {Array} told            the list as the game last heard it (tell)
 * @property {Map} strangers         session → when we last told it we are not linked (internet.js: stranger)
 * The room as a whole:
 * @property {boolean} linked        someone else is here and we hear each other
 * @property {boolean} weak          someone linked went quiet: the game pauses
 * @property {boolean} statsDue      a 'stats' event is due at the next tick
 * Watchdog (link.js):
 * @property {number} lastWatch      its last tick
 * @property {number} watchMs        its pace now: 200 ms while linked, 1000 not
 * @property {number} graceUntil     after our own sleep: nobody is judged before this
 * Timers (stop(N, ...) clears them):
 * @property {*} whoTimer            internet: nobody answered 'who', we hold the room
 * @property {*} annTimer            internet: the host says it is here
 * @property {*} helloTimer          internet: a guest says hello until it is linked
 * @property {*} failTimer           internet: no broker within 6 s; nearby: the pairing under way gives up
 * @property {*} fullTimer           internet: the room was full, look again
 * @property {*} watchTimer          the watchdog
 */

/**
 * P, the link with one other tab (a peer). Fields by purpose:
 * @typedef {object} Peer
 * Who:
 * @property {Room} N                our room
 * @property {string} id             their session (nearby: 'pairing.…' until their _h says)
 * @property {string} name           their player's name, once known ('' until then)
 * @property {number} [k]            internet: the guest's hello attempt this link belongs to
 * @property {number} [probeAt]      internet: when a guest last asked its quiet host 'here'
 * The link:
 * @property {boolean} linked        it counts: we hear each other
 * @property {boolean} weak          they went quiet (TIMING.WEAK): the game pauses
 * @property {number} weakAt         silent since (0 while not weak)
 * @property {number} lastSeen       when anything of theirs last came, by either path
 * @property {Array} early           what came a moment before the link counted (≤ 64), delivered once it does
 * Brokers (internet rooms):
 * @property {boolean} heard         we listen to their mailbox
 * @property {number[]} win          per broker: how often it brought their data first (halved every 2 s)
 * @property {number[]} peerBest     the brokers that bring our data to them first, as they say (w; ≤ 2)
 * @property {number} peerBestAt     when they said so
 * Paths, numbering and ping (link.js; resetPaths starts the numbering and the measurements over):
 * @property {string} via            the path in use: 'p2p' (direct) or 'relay' (the brokers)
 * @property {number} viaAt          when it was last chosen
 * @property {Array} q               messages waiting to go through the brokers (one 'd' per flush)
 * @property {Map} qLatest           stream → the newest 'latest' message waiting for the brokers
 * @property {number} relayAt        when the 'latest' streams last went through the brokers
 * @property {*} qTimer              the next flush of qLatest
 * @property {*} ackTimer            an 'ak', due
 * @property {number} pingAt         when the last pulse went
 * @property {number} pN             pulses sent (every 6th through the brokers too)
 * @property {number} nudged         when a quiet direct link was last checked through the brokers (keepDirectAlive)
 * @property {number} tx             the last reliable number we gave (_x)
 * @property {Array} outbox          reliable messages not acknowledged yet: { m, at: last sent, n: times sent }
 * @property {number} rxNext         the next reliable number we expect from them
 * @property {Map} rxHold            number → a reliable message that overtook a missing one
 * @property {number} byeX           the number of the bye we already acted on
 * @property {number} pts            their last pulse counted (its copy by the other path is not)
 * @property {number} suspect        when they last said they cannot hear us directly (r: 1)
 * @property {?number} rD            round trip of the direct path (the median of sD); rR: through the brokers (sR)
 * @property {?number} rR
 * @property {number[]} sD           the last few samples of each path
 * @property {number[]} sR
 * @property {number} qD             the last ping answer counted on each path
 * @property {number} qR
 * @property {boolean} slowDirect    the direct link works but the brokers are clearly faster: use them
 * @property {?number} peerRtt       their ping as they measure it
 * @property {number} aliveAt        when they last reached us through the brokers and not the direct link
 * Direct link (rtc.js):
 * @property {?RTCPeerConnection} pc
 * @property {?RTCDataChannel} dcF   'fast': unordered, no resends
 * @property {?RTCDataChannel} dcC   'ctl': ordered, reliable
 * @property {number} dcSeen         when something last came through it (0: nothing yet)
 * @property {number} dcBorn         when both channels opened
 * @property {Array} iceQ            candidates that came before their offer: { k, c }
 * @property {?number} rtcK          the attempt under way
 * @property {number} rtcNext        a guest's next attempt, not before
 * @property {number} rtcTries       attempts so far (the pause between them grows)
 * @property {*} rtcTimer            the attempt gives up (15 s)
 * @property {?boolean} turn         through a TURN relay (null: not known)
 * @property {string} cand           the candidate pair in use (diag)
 * @property {?number} iceRtt        the browser's own round trip, ms
 * @property {number} statsAt        when the browser was last asked (probeLink)
 * @property {boolean} failing       nearby: a failed pairing is being described
 */

/**
 * A new room → { N, room }.
 *   game, code   which room (code: internet rooms)
 *   name         this player's name
 *   relay        true: the brokers carry data when the direct link cannot (internet rooms)
 *   max          players in the room, the host included (2…MAX_PLAYERS)
 *   mode         the mode's hooks (above)
 */
export function newRoom({ game, code = '', name, relay, max = MAX_PLAYERS, mode = {} }) {
  if (typeof name !== 'string' || !NAME.test(name)) throw new Error('room: a name of 1 to 24 characters');
  const hooks = modeHooks(mode, relay);
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
      N.close(final);
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
  }, hooks);

  // closing the tab: say goodbye by every path we still can (our place is kept: maybe it was a reload)
  const onPageHide = () => {
    if (N.closed) return;
    for (const P of linkedPeers(N)) try { send(P, { t: 'bye' }); } catch (e) {}
    try { N.bye(); } catch (e) {}
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
  N.onUnlink(P);                                       // e.g. stop listening to their mailbox
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
  if (H && H.name === n) { N.releaseHost(); return; }
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
