// Internet rooms: players meet on a room code through public MQTT brokers, which also carry the game whenever
// a direct WebRTC link cannot. Whoever came first is the host; everyone after is a guest, linked to the host
// (a star, see room.js). Roles settle themselves: if two think they are first, the one with fewer players here
// gives way, and between equals the "greater" session.
//
// Places are by name (room.js): a hello with a name the room knows takes that place, from whatever tab (the
// old one is told 'moved'); with the host's own name, the host steps aside and the new tab gets its place
// from whoever takes over. When the host is away for HOST_WAIT (config.js TIMING) or says bye, the first player
// on the list who is here becomes the host and the others join it: everyone has the same list, so they agree
// without a word. The host keeps announcing itself now and then even with guests, so two rooms that formed on
// one code (a broker hiccup at the wrong moment, a host back from a long sleep) find each other and merge.
//
// Messages on the room's topic: JSON to every broker. brokers.js adds f (the sender's session) and q (its number:
// a copy through another broker is dropped); one with `to` is for that session only.
//   k      a tab → itself      {ts} the brokers echo it: alive, and how fast (brokers.js; the others ignore it)
//   who    newcomer → all      {n: name, pv} anyone here? The host answers 'host' or 'full'; a tab still looking
//                              whose session is smaller takes the room and answers 'host'
//   host   host → all | one    {c: players here with it, pv, u?} I hold the room: alone every 2.5 s, with guests
//                              every 10 s (two rooms on one code merge), and to whoever asks. u: 1, to a tab that
//                              talks as if linked: I do not know you, say hello again
//   full   host → newcomer     no place left (it looks again in 2 s)
//   hello  guest → host        {n: name, k: attempt, pv} let me in (every 1.2 s until 'hi'; after 6, it looks again)
//   hi     host → guest        {k, n: the host's name, pv} linked (k: of the hello it answers)
//   go     host → its guests   {h: session} I give way to that host: join it (said twice)
//   here   guest → its host    are we still together? (every 3 s while the host is quiet)
//   moved  host → a tab        another tab of your player took your place: step aside (role 'out'; from our host only)
//   bye    a tab → all | one   {menu?} it closes (leave, pagehide); menu: 1, its player left for good. To one tab: it
//                              steps aside (leaveQuietly), it starts over and drops our link (dropAll, menu: 1), or
//                              a guest tells a stranger we are not together (menu: 1)
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
//                              A guest sends all of it to the host, with _t: to whom ('*': everyone; none: the host
//                              only); the host passes it on with _f: its author
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
//   reliable messages as JSON     nothing on the wire: a message that cannot become JSON is refused at the call
//     once, before their number   instead of stalling the link
import { me, PROTO, roomTopic, TIMING } from './config.js';
import { closeBrokers, loadTransport, mailbox, openBrokers, pubOn } from './brokers.js';
import { onRtc } from './rtc.js';
import { deliver, resetPaths } from './link.js';
import { closePeer, dropMember, guestMembers, hostPeer, linkedPeers, markLinked, memberOf, NAME, newPeer, newRoom,
  otherVersion, presence, seatMember, setRole, startWatch, stop, unlink } from './room.js';

const ANNOUNCE = 2500, ANNOUNCE_LINKED = 4;            // the host says it is here every 2.5 s, every 10 s with guests

/**
 * Join (or open) a room.
 *   game   short id of the game: rooms of different games never meet
 *   code   room code (see newRoomCode / validRoomCode)
 *   name   this player's name (see room.js)
 *   max    players at most, the host included (default and limit: 8)
 * Returns the room at once; it connects in the background and reports through events.
 */
export function joinRoom({ game, code, name, max }) {
  const { N, room } = newRoom({ game, code, name, max, relay: true, mode: {        // (the hooks: room.js)
    peerGone: P => linkGone(N, P), byeFrom: (P, final) => byeFrom(N, P, final),
    onConnected: c => connected(N, c), onMessage: (m, c) => onMessage(N, m, c), onDown: () => signal(N),
    close, bye: () => pubOn(N, { t: 'bye' }), onUnlink: P => listen(N, P, false), probe: (P, now) => probe(N, P, now),
    hubCheck: now => hubCheck(N, now), longSleep: () => { longSleep(N); return true; }, releaseHost: () => hostGone(N, true)
  } });

  // Browsers report a network change even when they only refined a speed estimate: react only when the
  // network type really changed (Wi-Fi ↔ mobile) or we have no connection anyway.
  let kind = navigator.connection && navigator.connection.type;
  const onConnection = () => {
    const changed = navigator.connection.type !== kind;
    kind = navigator.connection.type;
    if (changed || !N.ready || N.weak) room.kick();
  };
  addEventListener('online', room.kick);
  try { navigator.connection.addEventListener('change', onConnection); } catch (e) {}
  function close(final = true) {
    try { pubOn(N, final ? { t: 'bye', menu: 1 } : { t: 'bye' }); } catch (e) {}
    stop(N, 'whoTimer', 'annTimer', 'helloTimer', 'failTimer', 'fullTimer');
    closeBrokers(N);
    removeEventListener('online', room.kick);
    try { navigator.connection.removeEventListener('change', onConnection); } catch (e) {}
  }

  (async () => {
    await null;                                        // let the caller subscribe to events first
    if (N.closed) return;
    N.emit('status', 'connecting');
    try { await loadTransport(); } catch (e) { if (!N.closed) N.emit('status', 'unavailable'); return; }
    N.topic = await roomTopic(game, code);
    if (N.closed) return;
    openBrokers(N);
    N.failTimer = setTimeout(() => { if (!N.closed && !N.ready) N.emit('status', 'no-signal'); }, 6000);
    startWatch(N);
  })();
  return room;
}

const pub = (N, obj) => { if (!N.closed) pubOn(N, obj); };
const here = N => N.members.filter(m => !m.a).length;   // players here (us included)
const who = N => ({ t: 'who', n: N.name, pv: PROTO });
const hostSays = (N, o) => ({ t: 'host', c: here(N), pv: PROTO, ...o });   // (o: to, u)
const name = n => typeof n === 'string' && NAME.test(n) ? n : null;

// Whether any broker works, told once per change while nobody is linked (when linked, 'weak' tells it):
// a waiting room that lost the internet says so instead of "waiting".
function signal(N) {
  const up = N.clients.some(c => c && c._ok);
  if (up === N.up) return;
  N.up = up;
  if (N.closed || N.linked || !N.ready) return;
  N.emit('status', !up ? 'no-signal' : N.role === 'host' ? 'waiting' : N.role === 'guest' ? 'joining' : 'connecting');
}

// a broker just connected: bring it up to date with what is going on in the room
function connected(N, c) {
  signal(N);
  for (const P of N.peers.values()) if (P.heard) { try { c.subscribe(mailbox(N, P.id, me), { qos: 0 }); } catch (e) {} }
  if (!N.ready) { N.ready = true; clearTimeout(N.failTimer); discover(N); }
  else if (N.role === null) pub(N, who(N));         // still looking: ask on this broker too
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
      break;
    case 'host': {                                     // someone holds the room
      if (otherVersion(N, m)) break;                   // in another library version: not ours to join or merge with
      const c = Number.isInteger(m.c) && m.c > 0 ? m.c : 1;
      if (N.role === 'guest' && from === N.host) {     // our host says it does not know us: ask to join again
        if (N.linked && m.to === me && m.u) becomeGuest(N, from);
        break;                                         // (its announcements to everyone change nothing)
      }
      if (N.role === 'guest' && N.linked) break;       // someone else's room on our code: ours stays (its host merges)
      if (N.role === null || N.role === 'guest') becomeGuest(N, from);
      else if (N.role === 'host') {                    // two hosts: fewer players here (or the greater session) gives way
        const mine = here(N);
        if (c > mine || (c === mine && from < me)) giveWay(N, from);
        else pub(N, hostSays(N, { to: from }));
      }
      break;
    }
    case 'full':
      if (N.linked || N.role === 'host' || N.role === 'out') break;
      N.emit('status', 'full');
      stop(N, 'whoTimer', 'helloTimer', 'fullTimer');
      N.fullTimer = setTimeout(() => { if (!N.closed && !N.linked) discover(N); }, 2000);
      break;
    case 'hello':                                      // a player's tab says hello
      if (N.role === 'host' && name(m.n) && !otherVersion(N, m)) hello(N, from, m.n, m.k);
      break;
    case 'hi':
      if (N.role === 'guest' && N.host === from && P && !P.linked && m.k === P.k && name(m.n) && !otherVersion(N, m)) {
        stop(N, 'helloTimer');
        P.name = m.n;
        guestMembers(N, m.n);
        markLinked(P);
      }
      break;
    case 'here':                                       // a guest asks whether we are still together
      if (!P || !P.linked) stranger(N, from);
      break;
    case 'go':                                         // our host gives way to another one: join it
      if (N.role === 'guest' && from === N.host && typeof m.h === 'string' && m.h !== me) becomeGuest(N, m.h);
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
      if (P && P.linked) byeFrom(N, P, m.menu === 1);
      break;
    case 'rtc':                                        // direct link signalling
      if (P && P.linked) onRtc(P, m);
      else if (!P) stranger(N, from);
      break;
  }
}

// The host: a tab says hello with a name. A name the room knows takes that place (the player is back, or goes on
// in this tab); a new one gets a place if there is one. Our own name: this player goes on in that tab, so we
// step aside (the guests move on to a new host at once, and that tab gets our place from it).
function hello(N, from, n, k) {
  if (n === N.name) { if (from !== me) leaveQuietly(N, true); return; }
  const m = memberOf(N, n);
  if (!m && N.members.length >= N.max) { pub(N, { t: 'full', to: from }); return; }
  let P = N.peers.get(from);
  if (P && P.linked && P.name === n) {                 // linked already: our hi was lost, or they started over
    if (k !== P.k) resync(N, P, k);
    pub(N, { t: 'hi', to: from, k, n: N.name, pv: PROTO });
    return;
  }
  if (m && m.s !== from) {                             // their place, from another tab: that one steps aside
    const old = N.peers.get(m.s);
    pub(N, { t: 'moved', to: m.s });
    if (old) unlink(old);
  }
  if (P && !P.linked) unlink(P);
  P = newPeer(N, from, n);
  P.k = k;
  listen(N, P, true);
  pub(N, { t: 'hi', to: from, k, n: N.name, pv: PROTO });
  markLinked(P);                                       // linked first: the list of players that follows goes to them too
  seatMember(N, n, from);
}

// Someone talks to us as if we were linked, but we are not (we let them go after a long silence, or they missed
// that we did): the host asks them to say hello again; anyone else tells them we are not together, so they stop
// waiting for us. Once in a while per sender.
function stranger(N, from) {
  const now = performance.now(), told = N.strangers;
  if (now - (told.get(from) || -1e9) < 2000) return;
  if (told.size > 32) told.clear();
  told.set(from, now);
  if (N.role === 'host') pub(N, hostSays(N, { to: from, u: 1 }));
  else if (N.role === 'guest') pub(N, { t: 'bye', menu: 1, to: from });
}

// is anyone in the room? if nobody answers, we are first
function discover(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  dropAll(N, true);
  N.members = [{ n: N.name, s: me, a: 0 }];
  setRole(N, null);
  presence(N);
  pub(N, who(N));
  setTimeout(() => { if (!N.closed && N.role === null) pub(N, who(N)); }, 450);
  N.whoTimer = setTimeout(() => { if (!N.closed && N.role === null) becomeHost(N); }, 1100);
}

// keep: the players (taking over from a host that went away: their places stay, they come to us)
function becomeHost(N, keep = false) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  if (N.role !== 'host') dropAll(N, !keep);
  if (!keep) N.members = [{ n: N.name, s: me, a: 0 }];
  setRole(N, 'host');
  presence(N);
  if (!N.linked) N.emit('status', 'waiting');
  let i = 0;                                           // alone: often, so friends find us; with guests: now and then (see the top)
  const ann = () => { if (!N.closed && N.role === 'host' && (here(N) === 1 || i++ % ANNOUNCE_LINKED === 0)) pub(N, hostSays(N)); };
  ann();
  N.annTimer = setInterval(ann, ANNOUNCE);
}

// Whoever we were linked with is not told we left: they come along (go, hostGone), or it is our host again.
function becomeGuest(N, host) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  dropAll(N, false);
  N.host = host;
  const H = newPeer(N, host);
  H.k = Math.random() * 1e9 | 0;                       // this attempt: the host starts our link over when it sees a new one
  listen(N, H, true);                                  // at once: the host may speak a moment before its 'hi' arrives
  setRole(N, 'guest');
  N.emit('status', 'joining');
  let tries = 0;
  const hello = () => {
    if (N.closed || H.linked || N.role !== 'guest' || N.host !== host) { clearInterval(N.helloTimer); return; }
    if (++tries > 6) { clearInterval(N.helloTimer); discover(N); return; }   // no answer: look around again
    pub(N, { t: 'hello', to: host, n: N.name, k: H.k, pv: PROTO });
  };
  hello();
  N.helloTimer = setInterval(hello, 1200);
}

// two hosts on one code: ours joins the other, and our guests come along (told twice: one message may be lost;
// one who misses both finds out by asking, see probe)
function giveWay(N, other) {
  const ids = linkedPeers(N).map(P => P.id), go = () => { for (const id of ids) pub(N, { t: 'go', h: other, to: id }); };
  go(); setTimeout(go, 1000);
  becomeGuest(N, other);
}

// Our host is gone: it left (gone: its place goes too), said bye, or has been away for HOST_WAIT. The first
// player on the list who is here takes over; everyone else joins that one.
function hostGone(N, gone = false) {
  const H = hostPeer(N), old = N.host;
  const next = N.members.find(m => m.s !== old && (!m.a || m.s === me));
  if (gone && H) N.members = N.members.filter(m => m.s !== old);
  if (!next || next.s === me) {
    if (H) unlink(H);
    N.host = null;
    becomeHost(N, true);                               // the others' places (and the old host's, unless it left) stay
    if (!N.linked) N.emit('status', 'peer-left');
  } else becomeGuest(N, next.s);
}
// a guest: the host has been away too long
function hubCheck(N, now) {
  const H = hostPeer(N);
  if (N.role === 'guest' && H && H.linked && H.weak && now - H.weakAt > TIMING.HOST_WAIT) hostGone(N);
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

// A guest whose host went quiet asks now and then whether they are still together (the host may have let us
// go after a long silence; it then asks us to say hello again, see stranger).
function probe(N, P, now) {
  if (N.role !== 'guest' || P.id !== N.host || !P.weak || now - (P.probeAt || 0) < 3000) return;
  P.probeAt = now;
  pub(N, { t: 'here', to: P.id });
}

// We were away (a phone locked, a tab frozen) for longer than anyone waits: the others have moved on. A guest
// says hello to its host again; a host starts over and finds the room by its announcements (two hosts merge).
function longSleep(N) {
  if (N.role === 'guest' && N.host) becomeGuest(N, N.host);
  else if (N.role === 'host' && N.linked) { dropAll(N, true); N.role = null; becomeHost(N); }
}

// the link with P starts over (they started over: a new hello attempt) — numbering, paths, the direct link
function resync(N, P, k) {
  P.k = k;
  closePeer(P);
  resetPaths(P);
  P.lastSeen = performance.now();
  N.emit('relinked', P.name, false);                   // the game sends them the full picture again (the same tab)
  N.refresh(P);
  N.sent = '';                                         // and the players (unchanged, so presence would not send them)
  presence(N);
}

// This tab steps aside (another tab of this player took its place). tell: say bye first (the room's host does,
// so its guests move on at once instead of waiting for it).
function leaveQuietly(N, tell = false) {
  if (tell) for (const P of linkedPeers(N)) pub(N, { t: 'bye', to: P.id });
  stop(N, 'whoTimer', 'annTimer', 'helloTimer', 'fullTimer');
  for (const P of [...N.peers.values()]) { listen(N, P, false); closePeer(P); }
  N.peers.clear();
  N.linked = false; N.weak = false; N.closed = true;  // (so leaving later says nothing: this player is still in the room)
  stop(N, 'watchTimer');
  closeBrokers(N);
  setRole(N, 'out');
  N.emit('replaced');
}

// forget every link (a new role is coming); tell: let them know we left
function dropAll(N, tell) {
  for (const P of [...N.peers.values()]) {
    if (tell) pub(N, { t: 'bye', menu: 1, to: P.id });
    unlink(P);
  }
  N.peers.clear();
  N.host = null;
}
