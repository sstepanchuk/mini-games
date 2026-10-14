// Internet rooms: players meet on a room code through public MQTT brokers, which also carry the game whenever
// a direct WebRTC link cannot. Whoever came first is the host; everyone after is a guest, linked to the host
// (a star, see room.js). Roles settle themselves: if two think they are first, the one with fewer players here
// gives way, and between equals the "greater" session; but a host back from a sleep or an outage longer than HOST_WAIT
// gives way to one that was not away (y, below), so in a room of two the side that was cut off comes back as a guest.
//
// Places are by name (room.js): a fresh hello (the player's own act: see room.js, the takeover invariant) with a name
// the room knows takes that place, from whatever tab (the old one is told 'moved'); with the host's own name, the host
// steps aside and the new tab gets its place from whoever takes over. A name the player typed (ask) whose place another
// device holds that is still on the line (or the host's own) is asked about first: the host answers 'taken' and the
// player says whether it is them (room.take: the hello again with take) or comes in under another name (owner, q18); a
// place that is away or weak is taken without a question (a return after dropping out). A hello a tab says by itself
// (not fresh) for a place another session holds is told 'moved': a replaced tab never takes its place back. When the
// host is away for HOST_WAIT (config.js TIMING) or says bye, the first player on the list who is here becomes the host
// and the others join it: everyone has the same list, so they agree without a word; guests that hear another session
// ask for the room ('who') with their host's name while the host is quiet move on at once (heir: that player went on
// there, on a new device; owner, q03). The host keeps announcing itself now and then even with guests, so two rooms
// that formed on one code (a broker hiccup at the wrong moment) find each other and merge, the one that gives way
// bringing its places along (keepAlong: nobody hears anyone leave); a host back from a sleep longer than HOST_WAIT, or
// from an outage that long (no broker brought it anything: brokers.js deafBack; also one that took the room over alone
// meanwhile; not one that heard a player of its own all the while, by a direct link: it was not cut off from its room),
// asks who holds the room, and gives way to whoever does (its guests have moved on), or else goes on as it was (they
// slept too, or nobody took over). A fresh page that nobody answers takes back the places the page before it in this
// tab kept (a reload while everyone else was away: room.js restorePlaces, 'restored'; owner, q29). A page back
// from the back-forward cache (Safari: its pagehide said bye) says hello again at once as a guest, or asks so as a
// host (back). The network back ('online', or another network type), the brokers are checked at once, whatever was
// checked a moment before (link.js kick, force).
//
// Messages on the room's topic: JSON to every broker, sealed with the room's key (seal.js: its topic and key come from
// the code, through PBKDF2; a stranger can neither read nor forge them). brokers.js adds f (the sender's session) and q
// (its number: a copy through another broker, or one sent again, is dropped); one with `to` is for that session only.
//   k      a tab → itself      the brokers echo it: alive, and how fast (brokers.js; the others ignore it)
//   who    newcomer → all      {n: name, pv} anyone here? The host answers 'host' or 'full'; a tab still looking
//          | a host            whose session is smaller takes the room and answers 'host'; a guest whose host has that
//                              name and is quiet moves on (heir). To one host: in answer to its 'host' to all (below)
//   host   host → all | one    {c: players here with it, pv, u?, y?} I hold the room: alone every 2.5 s, with guests
//                              every 10 s (two rooms on one code merge), and to whoever asks. u: 1, to a tab that
//                              talks as if linked: I do not know you (or our link must start over), say hello again.
//                              y: 1, I am back from a sleep or an outage longer than HOST_WAIT and give way meanwhile:
//                              between two hosts the one that does not say it wins, else fewer players here gives way.
//                              Joined or given way to only when said to us (to: our session): one to all, which a
//                              stranger may have recorded long ago and sent again, is answered with a 'who' to it
//   full   host → newcomer     no place left (it looks again in 2 s)
//   hello  guest → host        {n: name, k: attempt, pv, fresh, m?, ask?, take?} let me in (every 1.2 s until 'hi' or
//                              'taken'; after 6, it looks again). fresh: false once this room has linked (a hello said by
//                              itself: after 'host' u: 1, 'go', a long sleep, the host gone, or the link starting over);
//                              missing: fresh. A new k from a linked guest: its link starts over (both sides resync,
//                              'relinked'); a hello numbered (q) below the one that set the link's k is an older attempt's,
//                              late (a slow broker, or a stranger sends it again): ignored. m: the list of the room we
//                              come from, which gave way (giveWay, 'go'; as in _r): the host keeps the places it lacks,
//                              away (keepAlong). ask: 1, a fresh hello with a typed name: a place of it whose device is
//                              still on the line is not taken but answered 'taken'; take: 1, the player said it is them
//                              (room.take): the place is taken as ever
//   hi     host → guest        {k, n: the host's name, pv} linked, or the link started over (k: of the hello it answers)
//   taken  host → guest        that name's place is held by a device still on the line (a hello with ask): nobody is
//                              seated or moved; the guest stops saying hello and asks its player (status 'taken')
//   go     host → its guests   {h: session} I give way to that host: join it (said twice)
//   here   guest → its host    are we still together? (every 3 s while the host is quiet)
//   moved  host → a tab        another tab of your player took your place, or (to a hello not fresh) holds it: step
//                              aside (role 'out'; from our host only)
//   bye    a tab → all | one   {menu?, w?} it closes (leave, pagehide); menu: 1, its player left for good (only room.leave;
//                              «Не чекати» tells the released tab nothing: room.js, the places invariant). To one tab, never menu: it steps aside
//                              (leaveQuietly), or a guest tells a stranger we are not together. w: [[session, k, [link
//                              messages]], …], a page's last words (pagehide: brokers.js lastWords), what it meant to send
//                              each of its links through the brokers; delivered before the bye
//   rtc    guest ⇄ host        {k: attempt, sdp | ice} direct link signalling (the guest offers, rtc.js)
//   d      a tab → its peer    {d: [link messages], k} through the brokers, in the pair's own mailbox: topic/d/from/to.
//                              k: the attempt of the link they belong to (P.k); one of another attempt is dropped
// Messages on a link (with one tab: the direct channels, or inside 'd'). Fast ones may be lost; reliable ones carry
// _x, their number, and go again until acknowledged (link.js):
//   p      both, fast          {ts, a, rt?, g?, r?, w?} pulse and ping, 5 a second. a: their reliable ones we have;
//                              rt: our ping; g: the game's pulse fields; r: 1, I cannot hear you directly; w: the
//                              brokers that bring your data to me first
//   q      both, fast          {ts} the ping's answer, by the path the ping came (each path is measured on its own)
//   ak     both, fast          {a} their reliable ones we have, 25 ms after some came (more than we numbered: ignored)
//   bye    both, reliable      {menu?} as on the topic; acted on at once, even if something before it is missing
//   _r     host → guests, rel. {m: [[name, session, away ms], …]} the players
//   _x     guest → host, rel.  {n} let n's place go («Не чекати»; the host does it only while n is away)
//   (game) any, fast or rel.   the game's own (t: not one of these, not starting with '_': room.send refuses them).
//                              A guest sends all of it to the host, with _t: to whom ('*', room.js EVERYONE: everyone, so
//                              it is nobody's own name; none: the host only); the host passes it on with _f: its author
//
// Versions. pv is the library's wire version (config.js PROTO): who, host, hello and hi from another version are
// not acted on (no link, no merge); the room says status 'version' and keeps their number (room.versionMismatch,
// while it is heard: room.js otherVersion), and a host still answers such a 'who' with 'host', so the newcomer learns
// ours. A handshake without pv is version 1. What a library from before PROTO (phase 0) does with each change since,
// so that both still play together:
//   pv on who, host, hello, hi    ignores it (an unknown field); a new library takes its handshakes as version 1
//   k on 'd'                      ignores it; a new library takes a 'd' without k (from an old one) as ours
//   'ak' refused by room.send     nothing on the wire (no library sends a game's own 'ak': games are wrapped, lib-g)
//   ak above what we numbered     nothing on the wire: a new library ignores it, an old one acknowledges up to it
//   r only in a pulse, 'moved'    nothing on the wire: only what an old library itself never sends is ignored
//     only from our host
//   fresh on hello                ignores it, and an old guest says none: its hellos count as fresh (it takes its
//                                 place back as it always did)
//   no final bye where one went   nothing new on the wire: an old library keeps the place, as for any closed tab (a tab
//     (dropAll: none at all; to   released by «Не чекати» that still hears us waits for its host, as after HOLD, and is
//     a stranger: without menu;   back as a new player once heard)
//     «Не чекати»: none)
//   hi to a linked guest's new k  an old guest ignores 'hi' while linked (it never starts its link over by itself)
//   reliable messages as JSON     nothing on the wire: a message that cannot become JSON is refused at the call
//     once, before their number   instead of stalling the link
//   y on host                     ignores it: an old host settles a tie as before (fewer players here, or the session)
//   a late hello ignored (q)      nothing on the wire: what both send is the same
//   ask, take on hello; taken     an older host ignores ask and take and seats as ever (it asks nothing); an older guest
//                                 says no ask: the place moves as ever (and it never hears 'taken')
//   m on hello                    an older host ignores it: the places of a room that gave way go there until their
//                                 players come, as before
//   a guest moves on when another nothing on the wire: an older guest waits HOST_WAIT for its quiet host, as before
//     session asks with its
//     host's name (heir)
//   «*» not taken as our name     nothing on the wire: '*' from an older page is still a name (NAME), only ours is refused
// Version 2 (phase 5, J2) seals everything on the brokers, on a topic of its own (seal.js), so a library of version 1
// meets nobody of version 2 there; it hears of us only at the door (door, below): on its own plain topic, the hash of the
// code, which we listen to but never speak on first. When it asks who holds the room ('who') we answer 'host', when it
// says it does ('host' to everyone) we ask 'who' (to it): {pv: 2}, from a session of the door's own and nothing more
// (no name, no players). It says 'version' and, the older one, updates itself (app/together.js); we say 'version' too.
// (A library from before the number, phase 0, is not answered: it would take our 'host' for a room to join.)
// Its 'hello' and 'hi' are for others; our own guests and hosts never see any of it. A 'host' to all that we only answer
// (above) is new in version 2 as well; nearby, only the number changed (nearby.js).
import { me, PROTO, secure, TIMING } from './config.js';
import { closeBrokers, lastWords, loadTransport, mailbox, openBrokers, pubLegacy, pubOn } from './brokers.js';
import { roomKeys } from './seal.js';
import { onRtc } from './rtc.js';
import { deliver, kick, resetPaths, setWeak } from './link.js';
import { closePeer, dropMember, guestMembers, hostPeer, linkedPeers, markLinked, memberOf, NAME, newPeer, newRoom,
  otherVersion, presence, restorePlaces, seatMember, setStatus, startWatch, stop, unlink, validWire } from './room.js';

const ANNOUNCE = 2500, ANNOUNCE_LINKED = 4;            // the host says it is here every 2.5 s, every 10 s with guests

/**
 * Join (or open) a room.
 *   game   short id of the game: rooms of different games never meet
 *   code   room code (see newRoomCode / validRoomCode)
 *   name   this player's name (see room.js)
 *   max    players at most, the host included (default and limit: 8)
 *   ask    true: a name the player typed: a place of that name whose device is still on the line is not taken before
 *          the player says so (status 'taken', room.take(); room.js newRoom)
 * Returns the room at once; it connects in the background and reports through events.
 */
export function joinRoom({ game, code, name, max, ask }) {
  const { N, room } = newRoom({ game, code, name, max, ask, relay: true, mode: {        // (the hooks: room.js)
    peerGone: P => linkGone(N, P), restart: P => restart(N, P), byeFrom: (P, final) => byeFrom(N, P, final),
    onConnected: c => connected(N, c), onMessage: (m, c) => onMessage(N, m, c), onDown: () => signal(N), onLegacy: m => door(N, m),
    close, bye: () => lastWords(N), back: () => back(N), onUnlink: P => listen(N, P, false), probe: (P, now) => probe(N, P, now),
    hubCheck: now => hubCheck(N, now), longSleep: gap => longSleep(N, gap), deafBack: () => deafBack(N), releaseHost: () => hostGone(N, true),
    take: () => take(N)
  } });

  // Browsers report a network change even when they only refined a speed estimate: react only when the
  // network type really changed (Wi-Fi ↔ mobile) or we have no connection anyway. A new network type, or the
  // browser online again: the brokers are checked now, even if they were a moment ago (the network was not back then).
  let kind = navigator.connection && navigator.connection.type;
  const onConnection = () => {
    const changed = navigator.connection.type !== kind;
    kind = navigator.connection.type;
    if (changed || !N.ready || N.weak) kick(N, changed);
  };
  const onOnline = () => kick(N, true);
  addEventListener('online', onOnline);
  try { navigator.connection.addEventListener('change', onConnection); } catch (e) {}
  function close(final = true, out = false) {
    if (!out) try { pubOn(N, final ? { t: 'bye', menu: 1 } : { t: 'bye' }); } catch (e) {}
    stop(N, 'whoTimer', 'annTimer', 'helloTimer', 'failTimer', 'fullTimer');
    closeBrokers(N);
    removeEventListener('online', onOnline);
    try { navigator.connection.removeEventListener('change', onConnection); } catch (e) {}
  }

  (async () => {
    await null;                                        // let the caller subscribe to events first
    if (N.closed) return;
    setStatus(N, 'connecting');
    if (!secure()) { setStatus(N, 'unavailable'); return; }   // no Web Crypto: no broker hears of this room (config.js secure)
    const t0 = performance.now(), keys = roomKeys(game, code).then(K => { N.keyMs = performance.now() - t0; return K; });   // (meanwhile)
    keys.catch(() => {});
    try { await loadTransport(); } catch (e) { if (!N.closed) setStatus(N, 'unavailable'); return; }
    let K;
    try { K = await keys; } catch (e) { console.error(e); if (!N.closed) setStatus(N, 'unavailable'); return; }   // (a browser without PBKDF2 or HKDF)
    if (N.closed) return;
    N.keys = K; N.topic = K.topic; N.legacy = K.legacy;
    openBrokers(N);
    N.failTimer = setTimeout(() => { if (!N.closed && !N.ready) setStatus(N, 'no-signal'); }, 6000);
    startWatch(N);
  })();
  return room;
}

const pub = (N, obj) => { if (!N.closed) pubOn(N, obj); };
// The host: players here (us included), whose link we heard lately (within WEAK: what the room says lags behind a
// sleep of ours that the watchdog has not noticed yet; two hosts merge the right way round, see 'host')
const here = N => {
  const now = performance.now(), heard = P => !!P && P.linked && now - P.lastSeen <= TIMING.WEAK;
  return N.members.filter(m => m.s === me || (!m.a && heard(N.peers.get(m.s)))).length;
};
// a link that counts and is not quiet: the device on it is still on the line
const live = P => !!P && P.linked && !P.weak;
const who = N => ({ t: 'who', n: N.name, pv: PROTO });
const hostSays = (N, o) => ({ t: 'host', c: here(N), pv: PROTO, ...(performance.now() < N.yieldUntil && { y: 1 }), ...o });   // (o: to, u)
const name = n => typeof n === 'string' && NAME.test(n) ? n : null;

// Whether any broker works, told once per change while nobody is linked (when linked, 'weak' tells it):
// a waiting room that lost the internet says so instead of "waiting".
function signal(N) {
  const up = N.clients.some(c => c && c._ok);
  if (up === N.up) return;
  N.up = up;
  if (N.closed || N.linked || !N.ready) return;
  setStatus(N, !up ? 'no-signal' : N.role === 'host' ? 'waiting' : N.role === 'guest' ? 'joining' : 'connecting');
}

// a broker just connected: bring it up to date with what is going on in the room
function connected(N, c) {
  signal(N);
  for (const P of N.peers.values()) if (P.heard) { try { c.subscribe(mailbox(N, P.id, me), { qos: 0 }); } catch (e) {} }
  if (!N.ready) { N.ready = true; clearTimeout(N.failTimer); discover(N); }
  else if (N.role === null) pub(N, who(N));         // still looking: ask on this broker too
  else if (N.role === 'host' && performance.now() < N.yieldUntil) pub(N, who(N));   // giving way for a while (yieldRoom): ask here too
  else if (N.role === 'host' && !N.linked) pub(N, hostSays(N));   // waiting for guests: announce here too
}

// listen to the mailbox where P puts data for us (or stop)
function listen(N, P, on) {
  if (P.heard === on) return;
  P.heard = on;
  const topic = mailbox(N, P.id, me);
  for (const c of N.clients) if (c && c._ok) { try { if (on) c.subscribe(topic, { qos: 0 }); else c.unsubscribe(topic); } catch (e) {} }
}

function onMessage(N, m, c) {
  const from = m.f, P = N.peers.get(from) || null;
  switch (m.t) {
    case 'who':                                        // someone came in and asks whether anyone is here
      if (otherVersion(N, m)) {                        // another library version: not one of us, but it learns ours
        if (N.role === 'host') pub(N, hostSays(N, { to: from }));
        break;
      }
      if (N.role === 'host') {
        const known = name(m.n) && memberOf(N, m.n);
        pub(N, known || N.members.length < N.max ? hostSays(N, { to: from }) : { t: 'full', to: from });
      } else if (N.role === null && me < from) { becomeHost(N); pub(N, hostSays(N, { to: from })); }
      else if (N.role === 'guest' && heir(N, m.n, from) && N.role === 'host') pub(N, hostSays(N, { to: from }));   // (we took over: come in)
      break;
    case 'host': {                                     // someone holds the room
      if (otherVersion(N, m)) break;                   // in another library version: not ours to join or merge with
      const c = Number.isInteger(m.c) && m.c > 0 ? m.c : 1;
      if (N.role === 'guest' && from === N.host) {     // our host says it does not know us: our link starts over
        if (P && P.linked && m.to === me && m.u) restart(N, P);
        break;                                         // (its announcements to everyone change nothing)
      }
      if ((N.role === 'guest' && N.linked) || N.role === 'out') break;   // someone else's room on our code: ours stays (its host merges)
      // Still looking, or a guest not linked yet: we join it. Two hosts: the one back from a long sleep or an outage gives
      // way (yieldRoom: y); both or neither, fewer players here (or the greater session) does. Only to a 'host' said to us,
      // though (see the top): one to everyone we ask first, and give way when it answers; a host that does not give way
      // says so, to it.
      const mine = here(N), mineY = performance.now() < N.yieldUntil, theirY = m.y === 1;
      const yields = N.role !== 'host' || (mineY !== theirY ? mineY : c > mine || (c === mine && from < me));
      if (!yields) pub(N, hostSays(N, { to: from }));
      else if (m.to !== me) pub(N, { ...who(N), to: from });
      else if (N.role === 'host') giveWay(N, from);
      else becomeGuest(N, from);
      break;
    }
    case 'full':
      if (N.linked || N.role === 'host' || N.role === 'out') break;
      setStatus(N, 'full');
      stop(N, 'whoTimer', 'helloTimer', 'fullTimer');
      N.fullTimer = setTimeout(() => { if (!N.closed && !N.linked) discover(N); }, 2000);
      break;
    case 'hello':                                      // a player's tab says hello
      if (N.role === 'host' && name(m.n) && !otherVersion(N, m)) hello(N, from, m.n, m.k, m.fresh !== false, m.q, m.m, m.ask === 1 && m.take !== 1);
      break;
    case 'taken':                                      // our host asks: that name's place is held by a device still on the line
      if (N.role === 'guest' && N.host === from && P && !P.linked && !N.took) { stop(N, 'helloTimer'); N.asked = true; setStatus(N, 'taken'); }
      break;
    case 'hi':                                         // our host answers this attempt's hello: linked (or our link started over)
      if (N.role === 'guest' && N.host === from && P && m.k === P.k && name(m.n) && !otherVersion(N, m)) {
        stop(N, 'helloTimer');
        if (P.linked) {                                // (the host is there: our link works again)
          if (P.again) { P.again = false; P.lastSeen = performance.now(); setWeak(P, false); N.emit('relinked', P.name, false); }
          break;
        }
        P.name = m.n;
        N.along = null;                                // (in: the host has what we brought along)
        guestMembers(N, m.n);
        markLinked(P);
      }
      break;
    case 'here':                                       // a guest asks whether we are still together
      if (!P || !P.linked) stranger(N, from);
      break;
    case 'go':                                         // our host gives way to another one: join it
      if (N.role === 'guest' && from === N.host && typeof m.h === 'string' && m.h !== me) becomeGuest(N, m.h, true);
      break;
    case 'moved':                                      // this player goes on in another tab (as our host says)
      if (P && from === N.host) leaveQuietly(N);
      break;
    case 'd':                                          // game data through the brokers (our mailbox from P)
      if (!P) { stranger(N, from); break; }
      if (!Array.isArray(m.d) || (m.k !== undefined && m.k !== P.k)) break;   // (k: of another attempt, an older link)
      if (!P.linked) {                                 // a moment before 'hi'
        if (N.role === 'guest' && from === N.host) for (const x of m.d) if (P.early.length < 64) P.early.push(x);
        break;
      }
      {
        const ci = N.clients.indexOf(c);               // this broker delivered first: it scores a point
        if (ci >= 0) P.win[ci] = (P.win[ci] || 0) + 1;
      }
      for (const x of m.d) deliver(P, x, true);
      break;
    case 'bye':
      if (P && P.linked && lastWordsFrom(N, P, m.w)) byeFrom(N, P, m.menu === 1);
      break;
    case 'rtc':                                        // direct link signalling
      if (P && P.linked) onRtc(P, m);
      else if (!P) stranger(N, from);
      break;
  }
}

// A page's last words (brokers.js lastWords): what its link with us meant to send through the brokers (of this link's
// attempt k), delivered as if it had come in a 'd'. → whether the link is still there for its bye
function lastWordsFrom(N, P, w) {
  if (!Array.isArray(w)) return true;
  for (const e of w) {
    if (!Array.isArray(e) || e[0] !== me || (e[1] != null && e[1] !== P.k) || !Array.isArray(e[2])) continue;
    for (const x of e[2]) { deliver(P, x, true); if (N.closed || !P.linked) return false; }
  }
  return true;
}

// The door (see the top): a library before PROTO 2 on our code, plain on its own topic. A 'who' or a 'host' of its own
// (not one in answer to us) gets ours, once in 2 s per tab; whatever it says, we say 'version' (otherVersion). Only a
// page that says its version (pv) is answered: one from before the number (phase 0) knows nothing of versions, and
// would take our 'host' for a room to join.
function door(N, m) {
  if ((m.t !== 'who' && m.t !== 'host') || !otherVersion(N, m) || m.to !== undefined || m.pv === undefined || !due(N, m.f)) return;
  pubLegacy(N, m.t === 'who' ? { t: 'host', c: 1, pv: PROTO, to: m.f } : { t: 'who', pv: PROTO, to: m.f });
}

// The host: a tab says hello with a name. A name the room knows takes that place (the player is back, or goes on
// in this tab, if fresh: see room.js, the takeover invariant); a new one gets a place if there is one. Our own name,
// fresh: this player goes on in that tab, so we step aside (the guests move on to a new host at once, and that tab
// gets our place from it). A hello not fresh for a place another session holds (ours too): 'moved'. q: its number on
// the brokers (one below that of the hello that set the link's attempt is older: see the top). along: the list of a
// room that gave way to ours (keepAlong). ask: a typed name, not yet said to be the player's (asked first: 'taken').
function hello(N, from, n, k, fresh, q, along, ask) {
  if (from === me) return;
  const m = memberOf(N, n);
  if (m && m.s !== from && !fresh && !m.along) { pub(N, { t: 'moved', to: from }); return; }   // a replaced tab never takes its place back by itself
  // a typed name (ask) whose place another device holds, still on the line (or ours: we are here): ask first
  if (fresh && ask && (n === N.name || (m && m.s !== from && !m.along && live(N.peers.get(m.s))))) { pub(N, { t: 'taken', to: from }); return; }
  if (n === N.name) { leaveQuietly(N, true); return; }
  if (!m && N.members.filter(x => x.s !== from).length >= N.max) { pub(N, { t: 'full', to: from }); return; }
  let P = N.peers.get(from);
  if (P && P.linked && P.name === n) {                 // linked already: our hi was lost, or their link starts over
    if (q < P.helloQ) return;                          // (an older attempt's, late: it changes nothing)
    if (k !== P.k) { resync(N, P, k); P.helloQ = q; }
    pub(N, { t: 'hi', to: from, k, n: N.name, pv: PROTO });
    return;
  }
  // this session's link under another name: that player left for good (its bye lost; see seatMember)
  if (P) { if (P.name !== n && (memberOf(N, P.name) || {}).s === from) dropMember(N, P.name); unlink(P); }
  const old = m && m.s !== from ? N.peers.get(m.s) : null, back = !!m && m.s === from;
  if (m && m.s !== from && !m.along) pub(N, { t: 'moved', to: m.s });   // their place, from another tab: that one steps aside
  P = newPeer(N, from, n);
  P.k = k; P.helloQ = q;
  listen(N, P, true);
  pub(N, { t: 'hi', to: from, k, n: N.name, pv: PROTO });
  markLinked(P);                                       // linked first: the list of players that follows goes to them too
  if (validWire(along)) keepAlong(N, along, n, from);   // (fresh too: a page that took its places back has never linked)
  seatMember(N, n, from);                              // (the new session first: nobody hears the player leave…)
  if (old) unlink(old, { quiet: true });               // (…when the old link goes)
  if (back) N.emit('relinked', n, false);              // the same tab on a new link (it lost ours): the full picture again
}
// A tab comes over from a room that gave way to ours (giveWay, 'go'), with that room's list: the places it knew that we
// lack stay, in its order (up to max), away (since they dropped out there, else from now on) until their players say
// hello (seatMember), held as any place (HOLD), so nobody hears anyone leave meanwhile. Their sessions are only what
// that room knew (along: no 'moved' for them, see hello).
function keepAlong(N, wire, n, from) {
  const now = performance.now();
  let room = N.max - N.members.length - (memberOf(N, n) ? 0 : 1);   // (the newcomer's own place comes first)
  for (const [x, s, a] of wire) {
    if (x === N.name || memberOf(N, x)) continue;
    if (x === n) N.members.push({ n, s: from, a: now });   // (its own place, in that order: seated next)
    else if (room > 0 && s !== me && !N.members.some(y => y.s === s)) { N.members.push({ n: x, s, a: now - Math.max(1, a), along: true }); room--; }
  }
}

// Someone talks to us as if we were linked, but we are not (we let them go after a long silence, or they missed
// that we did), or a guest of ours must start our link over (restart): the host asks them to say hello again; anyone
// else tells them we are not together (a bye that keeps every place), so they stop waiting for us and move on. Once
// in a while per sender.
function stranger(N, from) {
  if (!due(N, from)) return;
  if (N.role === 'host') pub(N, hostSays(N, { to: from, u: 1 }));
  else if (N.role === 'guest') pub(N, { t: 'bye', to: from });
}

// whether a stranger (or an older page at the door) may be answered now: once in 2 s per sender (N.strangers)
function due(N, from) {
  const now = performance.now(), told = N.strangers;
  if (now - (told.get(from) || -1e9) < 2000) return false;
  if (told.size > 32) told.clear();
  told.set(from, now);
  return true;
}

// Is anyone in the room? If nobody answers, we are first. Every place we know stays (as in hostGone: their players
// may be on their way to the same room), and whoever we were linked with is not told anything.
function discover(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  dropAll(N);
  N.role = null;
  presence(N);
  pub(N, who(N));
  setTimeout(() => { if (!N.closed && N.role === null) pub(N, who(N)); }, 450);
  N.whoTimer = setTimeout(() => { if (!N.closed && N.role === null) becomeHost(N, true); }, 1100);
}

// We hold the room. Every place we know stays (taking over from a host that went away, or still looking: their
// players come to us). unanswered: nobody answered our 'who' (discover): a fresh page takes back the places the page
// before it in this tab kept (room.js restorePlaces; 'restored').
function becomeHost(N, unanswered = false) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  if (N.role !== 'host') dropAll(N);
  N.role = 'host';
  const restored = unanswered && restorePlaces(N);
  presence(N);
  if (!N.linked) setStatus(N, 'waiting');
  if (restored) N.emit('restored');
  // Alone: often, so friends find us; with guests: now and then (see the top). Not while we give way (yieldRoom), nor
  // while linked and the watchdog has not yet seen that we slept (longSleep decides first: by our count we would be
  // alone, and the new host would give way to us while we give way to it).
  let i = 0;
  const ann = () => {
    const now = performance.now();
    if (N.closed || N.role !== 'host' || now < N.yieldUntil || (N.linked && now - N.lastWatch > N.watchMs + TIMING.SLEEP)) return;
    if (here(N) === 1 || i++ % ANNOUNCE_LINKED === 0) pub(N, hostSays(N));
  };
  ann();
  N.annTimer = setInterval(ann, ANNOUNCE);
}

// Whoever we were linked with is not told we left: they come along (go, hostGone), or it is our host again. along: we
// come over from a room that gave way (giveWay, 'go'): its places come with us (N.along, in our hellos: keepAlong).
function becomeGuest(N, host, along = false) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  const now = performance.now();
  N.along = along ? N.members.map(m => [m.n, m.s, m.a ? Math.max(1, Math.round(now - m.a)) : 0]) : null;
  N.asked = false;                                     // (a new hello: whoever answers it asks again, if at all)
  dropAll(N);
  N.host = host;
  const H = newPeer(N, host);
  H.k = attempt();                                     // this attempt: the host starts our link over when it sees a new one
  listen(N, H, true);                                  // at once: the host may speak a moment before its 'hi' arrives
  N.role = 'guest';
  setStatus(N, 'joining');
  sayHello(N, H);
}
const attempt = () => Math.random() * 1e9 | 0;
// Hello to our host H, every 1.2 s until it answers this attempt (hi), or asks us first ('taken': we wait for the
// player, room.take). Fresh until this room has linked once (room.js, the takeover invariant); with the places of a room
// that gave way (m: N.along); a typed name's says ask, or take once the player said it is them. 6 unanswered: we look
// around again — unless the link counts already (it is starting over, see restart): then on until the host answers,
// or its silence moves us on (hubCheck: HOST_WAIT).
function sayHello(N, H) {
  stop(N, 'helloTimer');
  let tries = 0;
  const hello = () => {
    if (N.closed || N.role !== 'guest' || hostPeer(N) !== H) { stop(N, 'helloTimer'); return; }
    if (++tries > 6 && !H.linked) { stop(N, 'helloTimer'); discover(N); return; }   // no answer: look around again
    pub(N, { t: 'hello', to: H.id, n: N.name, k: H.k, pv: PROTO, fresh: !N.ever, ...(N.along && { m: N.along }),
      ...(N.ask && !N.ever && (N.took ? { take: 1 } : { ask: 1 })) });
  };
  hello();
  N.helloTimer = setInterval(hello, 1200);
}

// two hosts on one code: ours joins the other, and our guests come along (told twice: one message may be lost;
// one who misses both finds out by asking, see probe)
function giveWay(N, other) {
  const ids = linkedPeers(N).map(P => P.id), go = () => { for (const id of ids) pub(N, { t: 'go', h: other, to: id }); };
  go(); setTimeout(go, 1000);
  N.yieldUntil = 0;                                    // (given way: done, see longSleep)
  becomeGuest(N, other, true);                         // (our places come along)
}

// Our host is gone: it left (gone: its place goes too), said bye, or has been away for HOST_WAIT. The first
// player on the list who is here (as the host last said: everyone has the same list) takes over; everyone else joins
// that one.
function hostGone(N, gone = false) {
  const H = hostPeer(N), old = N.host;
  const next = N.members.find(m => m.s !== old && (!m.a || m.s === me));
  if (gone && H) N.members = N.members.filter(m => m.s !== old);
  if (!next || next.s === me) {
    if (H) unlink(H);
    N.host = null;
    becomeHost(N);                                     // the others' places (and the old host's, unless it left) stay
    if (!N.linked) setStatus(N, 'peer-left');
  } else becomeGuest(N, next.s);
}
// a guest: the host has been away too long, or its player went on in another session that asked for the room (heir)
// while it was quiet, and it has not been heard since
function hubCheck(N, now) {
  const H = hostPeer(N);
  if (N.role === 'guest' && H && H.linked && H.weak && (now - H.weakAt > TIMING.HOST_WAIT || N.heirAt > H.lastSeen)) hostGone(N);
}
// A guest: another session asks for the room ('who') with our host's name: that player goes on there. A host that hears
// it steps aside (hello); one that is away cannot, so we move on as for its bye (hostGone, its place kept: the new
// session takes it from whoever holds the room): now, or as soon as it is weak, unless we hear it again first (hubCheck).
// → whether we moved on
function heir(N, n, from) {
  const H = hostPeer(N);
  if (!H || !H.linked || from === H.id || name(n) !== H.name) return false;
  N.heirAt = performance.now();
  if (!H.weak) return false;
  hostGone(N);
  return true;
}

// The player says it is them (room.take, after 'taken'): our hellos say take: 1 from now on, and one goes at once (the
// same attempt), so the host gives us the place as ever (the device that held it is told 'moved').
function take(N) {
  const H = hostPeer(N);
  if (N.role === 'guest' && H && !H.linked) { setStatus(N, 'joining'); sayHello(N, H); }
}

// A tab closes (its player's place is kept: maybe a reload), or the player leaves for good (final).
function byeFrom(N, P, final) {
  if (N.role === 'guest' && P.id === N.host) { hostGone(N, final); return; }
  if (final) dropMember(N, P.name);
  else unlink(P);
}

// a link went silent for as long as a place is kept: that tab is gone
function linkGone(N, P) {
  if (N.role === 'guest' && P.id === N.host) hostGone(N);
  else unlink(P);
}

// So much of ours is unacknowledged that the other side cannot be hearing us (link.js), or our host does not know
// us ('host' u: 1): the link starts over, with nothing moving on (any failover waits for HOST_WAIT, as for silence).
// A guest takes a new attempt and says hello again (the host, seeing it, starts over too: resync), and the game hears
// 'relinked' (the full picture again, both ways; ours when the host answers). The host asks the guest to (stranger:
// once in 2 s; link.js asks again each tick until it has), and keeps nothing more for that link meanwhile (overfull:
// it goes with the old link, resetPaths).
function restart(N, P) {
  if (N.role === 'guest' && P.id === N.host) { resync(N, P, attempt(), true); sayHello(N, P); }
  else if (N.role === 'host') { P.overfull = true; stranger(N, P.id); }
}

// A guest whose host went quiet asks now and then whether they are still together (the host may have let us
// go after a long silence; it then asks us to say hello again, see stranger).
function probe(N, P, now) {
  if (N.role !== 'guest' || P.id !== N.host || !P.weak || now - (P.probeAt || 0) < 3000) return;
  P.probeAt = now;
  pub(N, { t: 'here', to: P.id });
}

// Back from the back-forward cache, after our pagehide's bye: our host let our link go (we say hello again at once, on a
// new attempt: restart), or our guests moved on to the first of them (we ask who holds the room and join it: yieldRoom).
function back(N) {
  N.stash = null;
  const H = hostPeer(N);
  if (N.role === 'guest' && H && H.linked) restart(N, H);
  else if (N.role === 'host' && N.linked) yieldRoom(N);
}

// We were away (a phone locked, a tab frozen) gap ms, longer than the room waits for its host. A host: its guests
// may have moved on to another host by now (the first of them who was here), or slept too (yieldRoom). A guest away
// longer than HOLD: its host has let it go; it says hello again (back in its place, if the host still keeps it).
function longSleep(N, gap) {
  if (N.role === 'host' && N.linked) { yieldRoom(N); return false; }
  if (N.role === 'guest' && N.host && gap > N.lostAfter) { becomeGuest(N, N.host); return true; }
  return false;
}

// No broker brought us anything for longer than HOST_WAIT (brokers.js: we were cut off), and one does again. A host
// that keeps someone else's place (linked or not: a guest that took the room over alone has no link) may have been
// replaced meanwhile by the first of them who was here: it gives way as after a long sleep (yieldRoom). Not one that
// still hears a player of its own (a direct link carried the room): it was not cut off from it, its guests stayed, and
// whoever took a room alone on its code meanwhile joins ours, as ever (giving way would move the room in play over).
function deafBack(N) {
  if (N.role === 'host' && N.members.length > 1 && !linkedPeers(N).some(P => !P.weak)) yieldRoom(N);
}

// A host that was away (longSleep, deafBack, back) asks who holds the room, and for HOST_WAIT gives way to any host
// that answers (or announces itself), and says so (y): it joins it as a guest, its guests come along ('go'), every place
// kept (counting its own links, alive-looking for GRACE, it would win the merge instead). If nobody took over, nobody
// answers, and nothing starts over.
function yieldRoom(N) {
  N.yieldUntil = performance.now() + TIMING.HOST_WAIT;
  pub(N, who(N));
}

// The link with P starts over (a new hello attempt k: theirs, or ours as a guest) — numbering, paths, the direct link.
// The game hears 'relinked' and sends them the full picture again (the same tab); ours (a guest starting over, again)
// only once the host answers (hi), so that what it sends then reaches the host's new link.
function resync(N, P, k, again = false) {
  P.k = k;
  closePeer(P);                                        // (after the new k: what waits for the old attempt goes nowhere, room.js)
  resetPaths(P);
  P.lastSeen = performance.now();
  P.again = again;
  if (!again) { setWeak(P, false); N.emit('relinked', P.name, false); }   // (their hello: they are there)
  N.refresh(P);
  N.sent = '';                                         // and the players (unchanged, so presence would not send them)
  presence(N);
}

// This tab steps aside (another tab of this player took its place): the room closes without a word (so leaving
// later says nothing: this player is still in the room). tell: say bye first, keeping every place (the room's host
// does, so its guests move on at once instead of waiting for it).
function leaveQuietly(N, tell = false) {
  if (tell) for (const P of linkedPeers(N)) pub(N, { t: 'bye', to: P.id });
  N.shut(false, true);
  N.role = 'out';
  N.emit('replaced');
}

// Forget every link (a new role is coming). They are not told: we are still in the room (they come along, or we
// find each other again; a guest that still talks to us hears it, see stranger).
function dropAll(N) {
  for (const P of [...N.peers.values()]) unlink(P);
  N.peers.clear();
  N.host = null;
  N.heirAt = 0;
}
