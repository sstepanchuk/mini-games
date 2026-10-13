// Internet rooms: players meet on a room code through public MQTT brokers, which also carry the game whenever
// a direct WebRTC link cannot. Whoever came first is the host; everyone after is a guest, linked to the host
// (a star, see room.js). Roles settle themselves: if two think they are first, the one with fewer players here
// gives way, and between equals the "greater" session.
//
// Places are by name (room.js): a fresh hello (the player's own act: see room.js, the takeover invariant) with a name
// the room knows takes that place, from whatever tab (the old one is told 'moved'); with the host's own name, the host
// steps aside and the new tab gets its place from whoever takes over. A hello a tab says by itself (not fresh) for a
// place another session holds is told 'moved': a replaced tab never takes its place back. When the host is away for
// HOST_WAIT (config.js TIMING) or says bye, the first player on the list who is here becomes the host and the others
// join it: everyone has the same list, so they agree without a word. The host keeps announcing itself now and then
// even with guests, so two rooms that formed on one code (a broker hiccup at the wrong moment) find each other and
// merge; a host back from a sleep longer than HOST_WAIT asks who holds the room, and gives way to whoever does (its
// guests have moved on), or else goes on as it was (they slept too).
//
// Messages on the room's topic: JSON to every broker. brokers.js adds f (the sender's session) and q (its number:
// a copy through another broker is dropped); one with `to` is for that session only.
//   k      a tab → itself      {ts} the brokers echo it: alive, and how fast (brokers.js; the others ignore it)
//   who    newcomer → all      {n: name, pv} anyone here? The host answers 'host' or 'full'; a tab still looking
//                              whose session is smaller takes the room and answers 'host'
//   host   host → all | one    {c: players here with it, pv, u?} I hold the room: alone every 2.5 s, with guests
//                              every 10 s (two rooms on one code merge), and to whoever asks. u: 1, to a tab that
//                              talks as if linked: I do not know you (or our link must start over), say hello again
//   full   host → newcomer     no place left (it looks again in 2 s)
//   hello  guest → host        {n: name, k: attempt, pv, fresh} let me in (every 1.2 s until 'hi'; after 6, it looks
//                              again). fresh: false once this room has linked (a hello said by itself: after 'host' u: 1,
//                              'go', a long sleep, the host gone, or the link starting over); missing: fresh. A new k
//                              from a linked guest: its link starts over (both sides resync, 'relinked')
//   hi     host → guest        {k, n: the host's name, pv} linked, or the link started over (k: of the hello it answers)
//   go     host → its guests   {h: session} I give way to that host: join it (said twice)
//   here   guest → its host    are we still together? (every 3 s while the host is quiet)
//   moved  host → a tab        another tab of your player took your place, or (to a hello not fresh) holds it: step
//                              aside (role 'out'; from our host only)
//   bye    a tab → all | one   {menu?} it closes (leave, pagehide); menu: 1, its player left for good (only room.leave
//                              and «Не чекати»: room.js, the places invariant). To one tab, never menu: it steps aside
//                              (leaveQuietly), or a guest tells a stranger we are not together
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
//   fresh on hello                ignores it, and an old guest says none: its hellos count as fresh (it takes its
//                                 place back as it always did)
//   no final bye where one went   nothing new on the wire: an old library keeps the place, as for any closed tab
//     (dropAll: none at all; to
//     a stranger: without menu)
//   hi to a linked guest's new k  an old guest ignores 'hi' while linked (it never starts its link over by itself)
//   reliable messages as JSON     nothing on the wire: a message that cannot become JSON is refused at the call
//     once, before their number   instead of stalling the link
import { me, PROTO, roomTopic, secure, TIMING } from './config.js';
import { closeBrokers, loadTransport, mailbox, openBrokers, pubOn } from './brokers.js';
import { onRtc } from './rtc.js';
import { deliver, resetPaths, setWeak } from './link.js';
import { closePeer, dropMember, guestMembers, hostPeer, linkedPeers, markLinked, memberOf, NAME, newPeer, newRoom,
  otherVersion, presence, seatMember, setStatus, startWatch, stop, unlink } from './room.js';

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
    peerGone: P => linkGone(N, P), restart: P => restart(N, P), byeFrom: (P, final) => byeFrom(N, P, final),
    onConnected: c => connected(N, c), onMessage: (m, c) => onMessage(N, m, c), onDown: () => signal(N),
    close, bye: () => pubOn(N, { t: 'bye' }), onUnlink: P => listen(N, P, false), probe: (P, now) => probe(N, P, now),
    hubCheck: now => hubCheck(N, now), longSleep: gap => longSleep(N, gap), releaseHost: () => hostGone(N, true)
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
  function close(final = true, out = false) {
    if (!out) try { pubOn(N, final ? { t: 'bye', menu: 1 } : { t: 'bye' }); } catch (e) {}
    stop(N, 'whoTimer', 'annTimer', 'helloTimer', 'failTimer', 'fullTimer');
    closeBrokers(N);
    removeEventListener('online', room.kick);
    try { navigator.connection.removeEventListener('change', onConnection); } catch (e) {}
  }

  (async () => {
    await null;                                        // let the caller subscribe to events first
    if (N.closed) return;
    setStatus(N, 'connecting');
    if (!secure()) { setStatus(N, 'unavailable'); return; }   // no Web Crypto: no broker hears of this room (config.js secure)
    try { await loadTransport(); } catch (e) { if (!N.closed) setStatus(N, 'unavailable'); return; }
    N.topic = await roomTopic(game, code);
    if (N.closed) return;
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
  setStatus(N, !up ? 'no-signal' : N.role === 'host' ? 'waiting' : N.role === 'guest' ? 'joining' : 'connecting');
}

// a broker just connected: bring it up to date with what is going on in the room
function connected(N, c) {
  signal(N);
  for (const P of N.peers.values()) if (P.heard) { try { c.subscribe(mailbox(N, P.id, me), { qos: 0 }); } catch (e) {} }
  if (!N.ready) { N.ready = true; clearTimeout(N.failTimer); discover(N); }
  else if (N.role === null) pub(N, who(N));         // still looking: ask on this broker too
  else if (N.role === 'host' && !N.linked) pub(N, hostSays(N));   // waiting for guests: announce here too
  else if (N.role === 'host' && performance.now() < N.yieldUntil) pub(N, who(N));   // awake from a long sleep: ask here too (longSleep)
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
      if (N.role === 'guest' && from === N.host) {     // our host says it does not know us: our link starts over
        if (P && P.linked && m.to === me && m.u) restart(N, P);
        break;                                         // (its announcements to everyone change nothing)
      }
      if (N.role === 'guest' && N.linked) break;       // someone else's room on our code: ours stays (its host merges)
      if (N.role === null || N.role === 'guest') becomeGuest(N, from);
      else if (N.role === 'host') {                    // two hosts: fewer players here (or the greater session) gives way;
        const mine = here(N);                          // just awake from a long sleep, we do (longSleep)
        if (c > mine || (c === mine && from < me) || performance.now() < N.yieldUntil) giveWay(N, from);
        else pub(N, hostSays(N, { to: from }));
      }
      break;
    }
    case 'full':
      if (N.linked || N.role === 'host' || N.role === 'out') break;
      setStatus(N, 'full');
      stop(N, 'whoTimer', 'helloTimer', 'fullTimer');
      N.fullTimer = setTimeout(() => { if (!N.closed && !N.linked) discover(N); }, 2000);
      break;
    case 'hello':                                      // a player's tab says hello
      if (N.role === 'host' && name(m.n) && !otherVersion(N, m)) hello(N, from, m.n, m.k, m.fresh !== false);
      break;
    case 'hi':                                         // our host answers this attempt's hello: linked (or our link started over)
      if (N.role === 'guest' && N.host === from && P && m.k === P.k && name(m.n) && !otherVersion(N, m)) {
        stop(N, 'helloTimer');
        if (P.linked) {                                // (the host is there: our link works again)
          if (P.again) { P.again = false; P.lastSeen = performance.now(); setWeak(P, false); N.emit('relinked', P.name, false); }
          break;
        }
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
// in this tab, if fresh: see room.js, the takeover invariant); a new one gets a place if there is one. Our own name,
// fresh: this player goes on in that tab, so we step aside (the guests move on to a new host at once, and that tab
// gets our place from it). A hello not fresh for a place another session holds (ours too): 'moved'.
function hello(N, from, n, k, fresh) {
  if (from === me) return;
  const m = memberOf(N, n);
  if (m && m.s !== from && !fresh) { pub(N, { t: 'moved', to: from }); return; }   // a replaced tab never takes its place back by itself
  if (n === N.name) { leaveQuietly(N, true); return; }
  if (!m && N.members.filter(x => x.s !== from).length >= N.max) { pub(N, { t: 'full', to: from }); return; }
  let P = N.peers.get(from);
  if (P && P.linked && P.name === n) {                 // linked already: our hi was lost, or their link starts over
    if (k !== P.k) resync(N, P, k);
    pub(N, { t: 'hi', to: from, k, n: N.name, pv: PROTO });
    return;
  }
  // this session's link under another name: that player left for good (its bye lost; see seatMember)
  if (P) { if (P.name !== n && (memberOf(N, P.name) || {}).s === from) dropMember(N, P.name); unlink(P); }
  const old = m && m.s !== from ? N.peers.get(m.s) : null, back = !!m && m.s === from;
  if (m && m.s !== from) pub(N, { t: 'moved', to: m.s });   // their place, from another tab: that one steps aside
  P = newPeer(N, from, n);
  P.k = k;
  listen(N, P, true);
  pub(N, { t: 'hi', to: from, k, n: N.name, pv: PROTO });
  markLinked(P);                                       // linked first: the list of players that follows goes to them too
  seatMember(N, n, from);                              // (the new session first: nobody hears the player leave…)
  if (old) unlink(old, { quiet: true });               // (…when the old link goes)
  if (back) N.emit('relinked', n, false);              // the same tab on a new link (it lost ours): the full picture again
}

// Someone talks to us as if we were linked, but we are not (we let them go after a long silence, or they missed
// that we did), or a guest of ours must start our link over (restart): the host asks them to say hello again; anyone
// else tells them we are not together (a bye that keeps every place), so they stop waiting for us and move on. Once
// in a while per sender.
function stranger(N, from) {
  const now = performance.now(), told = N.strangers;
  if (now - (told.get(from) || -1e9) < 2000) return;
  if (told.size > 32) told.clear();
  told.set(from, now);
  if (N.role === 'host') pub(N, hostSays(N, { to: from, u: 1 }));
  else if (N.role === 'guest') pub(N, { t: 'bye', to: from });
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
  N.whoTimer = setTimeout(() => { if (!N.closed && N.role === null) becomeHost(N); }, 1100);
}

// We hold the room. Every place we know stays (taking over from a host that went away, or still looking: their
// players come to us).
function becomeHost(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  if (N.role !== 'host') dropAll(N);
  N.role = 'host';
  presence(N);
  if (!N.linked) setStatus(N, 'waiting');
  let i = 0;                                           // alone: often, so friends find us; with guests: now and then (see the top);
  const ann = () => {                                  // awake from a long sleep, not while we give way (longSleep)
    if (!N.closed && N.role === 'host' && performance.now() >= N.yieldUntil && (here(N) === 1 || i++ % ANNOUNCE_LINKED === 0)) pub(N, hostSays(N));
  };
  ann();
  N.annTimer = setInterval(ann, ANNOUNCE);
}

// Whoever we were linked with is not told we left: they come along (go, hostGone), or it is our host again.
function becomeGuest(N, host) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
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
// Hello to our host H, every 1.2 s until it answers this attempt (hi). Fresh until this room has linked once (room.js,
// the takeover invariant). 6 unanswered: we look around again — unless the link counts already (it is starting over,
// see restart): then on until the host answers, or its silence moves us on (hubCheck: HOST_WAIT).
function sayHello(N, H) {
  stop(N, 'helloTimer');
  let tries = 0;
  const hello = () => {
    if (N.closed || N.role !== 'guest' || hostPeer(N) !== H) { stop(N, 'helloTimer'); return; }
    if (++tries > 6 && !H.linked) { stop(N, 'helloTimer'); discover(N); return; }   // no answer: look around again
    pub(N, { t: 'hello', to: H.id, n: N.name, k: H.k, pv: PROTO, fresh: !N.ever });
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
  becomeGuest(N, other);
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

// So much of ours is unacknowledged that the other side cannot be hearing us (link.js), or our host does not know
// us ('host' u: 1): the link starts over, with nothing moving on (any failover waits for HOST_WAIT, as for silence).
// A guest takes a new attempt and says hello again (the host, seeing it, starts over too: resync), and the game hears
// 'relinked' (the full picture again, both ways; ours when the host answers). The host asks the guest to (stranger:
// once in 2 s).
function restart(N, P) {
  if (N.role === 'guest' && P.id === N.host) { resync(N, P, attempt(), true); sayHello(N, P); }
  else if (N.role === 'host') stranger(N, P.id);
}

// A guest whose host went quiet asks now and then whether they are still together (the host may have let us
// go after a long silence; it then asks us to say hello again, see stranger).
function probe(N, P, now) {
  if (N.role !== 'guest' || P.id !== N.host || !P.weak || now - (P.probeAt || 0) < 3000) return;
  P.probeAt = now;
  pub(N, { t: 'here', to: P.id });
}

// We were away (a phone locked, a tab frozen) gap ms, longer than the room waits for its host. A host: its guests
// may have moved on to another host by now (the first of them who was here), or slept too. It asks who holds the room,
// and for HOST_WAIT gives way to any host that answers (or announces itself): it joins it as a guest, its guests come
// along ('go'), every place kept (counting its own links, alive-looking for GRACE, it would win the merge instead). If
// nobody took over, nobody answers, and nothing starts over. A guest away longer than HOLD: its host has let it go; it
// says hello again (back in its place, if the host still keeps it).
function longSleep(N, gap) {
  if (N.role === 'host' && N.linked) { N.yieldUntil = performance.now() + TIMING.HOST_WAIT; pub(N, who(N)); return false; }
  if (N.role === 'guest' && N.host && gap > N.lostAfter) { becomeGuest(N, N.host); return true; }
  return false;
}

// The link with P starts over (a new hello attempt k: theirs, or ours as a guest) — numbering, paths, the direct link.
// The game hears 'relinked' and sends them the full picture again (the same tab); ours (a guest starting over, again)
// only once the host answers (hi), so that what it sends then reaches the host's new link.
function resync(N, P, k, again = false) {
  P.k = k;
  closePeer(P);
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
}
