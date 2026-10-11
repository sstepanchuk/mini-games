// Internet rooms: players meet on a room code through public MQTT brokers, which also carry the game whenever
// a direct WebRTC link cannot. Whoever came first is the host (the game usually runs the authoritative
// simulation there); everyone after is a guest, linked to the host (room.js). Roles settle themselves: if two
// think they are first, the one holding fewer players gives way, and between equals the "greater" id.
//
// Messages on the room topic: who (anyone here?), host (I hold the room; n: players with me), full,
// hello (guest → host), hi (host → guest: linked), go (host → guest: join this other host instead),
// moved (another tab of yours took your seat), bye (left; final if menu=1), rtc (direct link signalling),
// d (game data through the brokers, in per-pair mailboxes).
//
// When the host leaves, the first guest on the roster becomes the host and the others join it: everyone knows
// the roster, so they all agree without a word. If that fails (they left too), guests look around again.
import { me, samePlayer, roomTopic } from './config.js';
import { closeBrokers, loadTransport, mailbox, openBrokers, pubOn } from './brokers.js';
import { closeRtc, onRtc } from './rtc.js';
import { deliver, resetPaths, setWeak } from './link.js';
import { closePeer, linkedPeers, markLinked, newPeer, newRoom, renamePeer, setRole, startWatch, stop, unlink, updateRoster } from './room.js';

const BYE_GRACE = 5000, ABANDONED = 15000;           // when a seat may go to someone else (see seatFree)

/**
 * Join (or open) a room.
 *   game       short id of the game: rooms of different games never meet
 *   code       room code (see newRoomCode / validRoomCode)
 *   max        players at most, the host included (default and limit: 8)
 *   lostAfter  ms of silence before a player counts as gone (default 60 s; 90 s while room.patient())
 * Returns the room at once; it connects in the background and reports through events.
 */
export function joinRoom({ game, code, max, lostAfter }) {
  const { N, room } = newRoom({ game, code, max, lostAfter, relay: true, close, bye: N => pubOn(N, { t: 'bye' }) });
  Object.assign(N, { peerGone: P => peerGone(N, P), byeFrom: (P, final) => byeFrom(N, P, final), onUnlink: P => listen(N, P, false) });

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
  function close(N) {
    try { pubOn(N, { t: 'bye', menu: 1 }); } catch (e) {}
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
    N.onConnected = c => connected(N, c);
    N.onMessage = (m, c) => onMessage(N, m, c);
    N.onDown = () => signal(N);
    openBrokers(N);
    N.failTimer = setTimeout(() => { if (!N.closed && !N.ready) N.emit('status', 'no-signal'); }, 6000);
    startWatch(N);
  })();
  return room;
}

const pub = (N, obj) => { if (!N.closed) pubOn(N, obj); };
const seats = N => linkedPeers(N).length < N.max - 1;  // room for one more guest
const count = N => 1 + linkedPeers(N).length;          // players with us (as host)

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
  else if (N.role === null) pub(N, { t: 'who' });               // still looking: ask on this broker too
  else if (N.role === 'host' && !N.linked) pub(N, { t: 'host', n: 1 }); // waiting for guests: announce here too
}

// listen to the mailbox where P puts data for us (or stop)
function listen(N, P, on) {
  if (P.heard === on) return;
  P.heard = on;
  const topic = mailbox(N, P.id, me);
  for (const c of N.clients) if (c && c._ok) { try { if (on) c.subscribe(topic, { qos: 0 }); else c.unsubscribe(topic); } catch (e) {} }
}

// The seat can go to someone else only when its owner really left: closed the tab a few seconds ago or has
// been silent for long. A short hiccup does not free it (the same person in a new tab is another matter).
const seatFree = P => { const now = performance.now(); return (!!P.byeAt && now - P.byeAt > BYE_GRACE) || now - P.lastSeen > ABANDONED; };
const samePlayerPeer = (N, from) => linkedPeers(N).find(P => P.id !== from && samePlayer(P.id, from)) || null;

function onMessage(N, m, c) {
  const from = m.f, P = N.peers.get(from) || null;
  switch (m.t) {
    case 'who':                                        // someone came in and asks whether anyone is here
      if (N.role === 'host') {
        const free = !!P || seats(N) || !!samePlayerPeer(N, from) || linkedPeers(N).some(seatFree);
        pub(N, free ? { t: 'host', n: count(N), to: from } : { t: 'full', to: from });
      } else if (N.role === 'guest' && N.linked && from !== N.host && samePlayer(from, N.host)) {
        pub(N, { t: 'moved', to: N.host });            // the host's old tab should leave quietly
        hostGone(N, from);                             // the host came back in a new tab: one of us takes over
      } else if (N.role === null && me < from) { becomeHost(N); pub(N, { t: 'host', n: 1, to: from }); }
      break;
    case 'host': {                                     // someone holds the room
      const n = Number.isInteger(m.n) && m.n > 0 ? m.n : 1;
      if (N.role === 'guest' && from === N.host) {     // our host thinks we are not there: ask to join again
        if (N.linked) becomeGuest(N, from);
        break;
      }
      if (N.role === 'guest' && N.linked) {
        if (samePlayer(from, N.host)) hostGone(N, from);   // our host came back in a new tab
        break;                                         // (anyone else: our room stays as it is)
      }
      if (N.role === null || N.role === 'guest') becomeGuest(N, from);
      else if (N.role === 'host') {                    // two hosts: the one with fewer players (or the greater id) gives way
        const mine = count(N);
        if (n > mine || (n === mine && from < me)) giveWay(N, from);
        else pub(N, { t: 'host', n: mine, to: from });
      }
      break;
    }
    case 'full':
      if (N.linked || N.role === 'host' || N.role === 'out') break;
      N.emit('status', 'full');
      stop(N, 'whoTimer', 'helloTimer', 'fullTimer');
      N.fullTimer = setTimeout(() => { if (!N.closed && !N.linked) discover(N); }, 2000);
      break;
    case 'hello': {                                    // a guest says hello
      if (N.role !== 'host') break;
      if (P && P.linked) { pub(N, { t: 'hi', to: from }); break; }
      const same = samePlayerPeer(N, from), stale = !same && !seats(N) && linkedPeers(N).find(seatFree);
      if (same || stale) relink(N, same || stale, from);   // the same player in a new tab, or someone taking a seat that was left
      else if (seats(N)) { const G = P || newPeer(N, from); listen(N, G, true); pub(N, { t: 'hi', to: from }); linkUp(N, G); }
      else pub(N, { t: 'full', to: from });
      break;
    }
    case 'hi':
      if (N.role === 'guest' && N.host === from && P && !P.linked) linkUp(N, P);
      break;
    case 'go':                                         // our host gives way to another one: join it
      if (N.role === 'guest' && from === N.host && typeof m.h === 'string' && m.h !== me) becomeGuest(N, m.h);
      break;
    case 'moved':                                      // another tab of the same player took our seat
      if (P) leaveQuietly(N);
      break;
    case 'd':                                          // game data through the brokers (our mailbox from P)
      if (!P) { stranger(N, from); break; }
      if (!Array.isArray(m.d)) break;
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

// Someone talks to us as if we were linked, but we are not (we let them go after a long silence, or they missed
// that we did): the host asks them to say hello again; anyone else tells them we are not together, so they stop
// waiting for us. Once in a while per sender.
function stranger(N, from) {
  const now = performance.now(), told = N.told;
  if (now - (told.get(from) || -1e9) < 2000) return;
  if (told.size > 32) told.clear();
  told.set(from, now);
  if (N.role === 'host' && seats(N)) pub(N, { t: 'host', n: count(N), to: from });
  else if (N.role === 'host' || N.role === 'guest') pub(N, { t: 'bye', menu: 1, to: from });
}

// is anyone in the room? if nobody answers, we are first
function discover(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  dropAll(N);
  setRole(N, null);
  pub(N, { t: 'who' });
  setTimeout(() => { if (!N.closed && N.role === null) pub(N, { t: 'who' }); }, 450);
  N.whoTimer = setTimeout(() => { if (!N.closed && N.role === null) becomeHost(N); }, 1100);
}

function becomeHost(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  if (N.role !== 'host') dropAll(N);
  setRole(N, 'host');
  updateRoster(N);
  if (!N.linked) N.emit('status', 'waiting');
  const ann = () => { if (!N.closed && N.role === 'host' && !N.linked) pub(N, { t: 'host', n: 1 }); };
  ann();
  N.annTimer = setInterval(ann, 2500);
}

function becomeGuest(N, host) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  dropAll(N);
  N.host = host;
  const H = newPeer(N, host);
  listen(N, H, true);                                  // at once: the host may speak a moment before its 'hi' arrives
  setRole(N, 'guest');
  N.emit('status', 'joining');
  let tries = 0;
  const hello = () => {
    if (N.closed || H.linked || N.role !== 'guest' || N.host !== host) { clearInterval(N.helloTimer); return; }
    if (++tries > 6) { clearInterval(N.helloTimer); discover(N); return; }   // no answer: look around again
    pub(N, { t: 'hello', to: host });
  };
  hello();
  N.helloTimer = setInterval(hello, 1200);
}

function linkUp(N, P) {                                // P and we hear each other
  if (N.role === 'host') stop(N, 'annTimer');
  else stop(N, 'helloTimer');
  markLinked(P);
}

// two hosts on one code: ours joins the other, and our guests come along
function giveWay(N, other) {
  for (const P of linkedPeers(N)) pub(N, { t: 'go', h: other, to: P.id });
  becomeGuest(N, other);
}

// Our host is gone (left, silent for too long, or reopened in a new tab: newTab). The first guest on the
// roster takes over; everyone else joins it. The roster is the same for all of us, so we all pick the same one.
function hostGone(N, newTab) {
  const old = N.host, next = N.roster.find(id => id !== old && !samePlayer(id, old));
  if (next === me || !next) {
    becomeHost(N);
    if (newTab) pub(N, { t: 'host', n: 1, to: newTab });
  } else becomeGuest(N, next);
  if (!N.linked) N.emit('status', N.role === 'host' ? 'peer-left' : 'joining');
}

// A player said goodbye. If they just closed the tab in the middle of a round, their seat (and the round) is
// held for 20 seconds: maybe it was a reload or an accident. Leaving to the menu is final.
function byeFrom(N, P, final) {
  if (final || N.role !== 'host' || !N.keepSeat()) { peerGone(N, P); return; }
  P.byeAt = performance.now(); P.byePts = P.pts;      // a pulse newer than this means they came back
  closeRtc(P);
  setWeak(P, true);
}

// A guest came back in a new tab (or someone took a seat that was left). The round is not reset: the game sends
// the new tab a full picture and goes on after a short countdown.
function relink(N, P, from) {
  pub(N, { t: 'moved', to: P.id });
  listen(N, P, false);
  closePeer(P);
  renamePeer(N, P, from);
  listen(N, P, true);
  P.byeAt = 0; P.rtcTries = 0; P.lastSeen = performance.now();
  resetPaths(P);
  pub(N, { t: 'hi', to: from });
  N.emit('relinked', P.pid);
  if (P.weak) setWeak(P, false);
  N.refresh(P);
  updateRoster(N);
}

// another tab of ours took the seat: leave quietly and stop looking for the room
function leaveQuietly(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer', 'fullTimer');
  for (const P of N.peers.values()) { listen(N, P, false); closePeer(P); }
  N.peers.clear();
  N.linked = false; N.weak = false;
  setRole(N, 'out');
  N.emit('replaced');
}

// a player is gone: the host lets their seat go; a guest whose host is gone finds the next one
function peerGone(N, P) {
  if (N.role === 'guest' && P.id === N.host) { hostGone(N); return; }
  unlink(P);
  if (N.role === 'host' && !N.linked) { becomeHost(N); N.emit('status', 'peer-left'); }   // announce again: the link stays valid
}

// forget every link (a new role is coming)
function dropAll(N) {
  for (const P of [...N.peers.values()]) unlink(P);
  N.peers.clear();
  N.host = null;
}
