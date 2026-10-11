// Internet rooms: two players meet on a room code through public MQTT brokers, which also carry the game
// whenever the direct WebRTC link cannot. Whoever came first is the host (the game usually runs the
// authoritative simulation there), the second is the guest. Roles settle themselves: if both think they are
// first, the "greater" id gives way. Messages on the room topic: who (anyone here?), host (I hold the room),
// full, hello (guest → host), hi (host → guest: linked), moved (another tab of yours took your seat),
// bye (left; final if menu=1), rtc (direct link signalling), d (game data through the brokers).
import { me, samePlayer, roomTopic } from './config.js';
import { closeBrokers, loadTransport, openBrokers, pubOn } from './brokers.js';
import { closeRtc, onRtc } from './rtc.js';
import { deliver, refresh, resetPaths, setWeak } from './link.js';
import { markLinked, newRoom, setRole, startWatch, stop } from './room.js';

const BYE_GRACE = 5000, ABANDONED = 15000;           // when a seat may go to someone else (see seatFree)

/**
 * Join (or open) a two-player room.
 *   game       short id of the game: rooms of different games never meet
 *   code       room code (see newRoomCode / validRoomCode)
 *   lostAfter  ms of silence before the other player counts as gone (default 60 s; 90 s while room.patient())
 * Returns the room at once; it connects in the background and reports through events.
 */
export function joinRoom({ game, code, lostAfter }) {
  const { N, room } = newRoom({ game, code, lostAfter, relay: true, close, bye: N => pubOn(N, { t: 'bye' }) });
  Object.assign(N, { early: [], peerGone: () => peerGone(N), byeFrom: final => byeFrom(N, final) });

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
    N.onDown = () => signal(N);
    N.onMessage = (m, c) => onMessage(N, m, c);
    openBrokers(N);
    N.failTimer = setTimeout(() => { if (!N.closed && !N.ready) N.emit('status', 'no-signal'); }, 6000);
    startWatch(N);
  })();
  return room;
}

const dropQueue = N => { N.q = []; stop(N, 'qTimer'); };

const pub = (N, obj) => { if (!N.closed) pubOn(N, obj); };

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
  if (N.heard) { try { c.subscribe(N.topic + '/d/' + N.heard, { qos: 0 }); } catch (e) {} }   // the mailbox we listen to, here too
  if (!N.ready) { N.ready = true; clearTimeout(N.failTimer); discover(N); }
  else if (N.role === null) pub(N, { t: 'who' });               // still looking: ask on this broker too
  else if (N.role === 'host' && !N.linked) pub(N, { t: 'host' }); // waiting for the guest: announce here too
}

// The seat can go to someone else only when its owner really left: closed the tab a few seconds ago or has
// been silent for long. A short hiccup does not free it (the same person in a new tab is another matter).
const seatFree = N => { const now = performance.now(); return (!!N.byeAt && now - N.byeAt > BYE_GRACE) || now - N.lastSeen > ABANDONED; };

function onMessage(N, m, c) {
  const from = m.f;
  switch (m.t) {
    case 'who':                                        // someone came in and asks whether anyone is here
      if (N.role === 'host') {
        const free = !N.linked || from === N.other || samePlayer(from, N.other) || seatFree(N);
        pub(N, { t: free ? 'host' : 'full', to: from });
      } else if (N.role === 'guest' && N.linked && samePlayer(from, N.other)) {
        pub(N, { t: 'moved', to: N.other });           // the host's old tab should leave quietly
        peerGone(N);                                   // the host came back in a new tab: we hold the room now
        pub(N, { t: 'host', to: from });
      } else if (N.role === null && me < from) { becomeHost(N); pub(N, { t: 'host', to: from }); }
      break;
    case 'host':                                       // someone holds the room
      if (N.linked && from === N.other) {              // the player we are linked with thinks they are alone: they forgot us
        dropPeer(N);
        if (N.role === 'guest') becomeGuest(N, from);  // ask to join them again
        else { becomeHost(N); pub(N, { t: 'host', to: from }); }   // two hosts: settled as usual
        break;
      }
      if (N.role === 'guest' && N.linked && from !== N.other && samePlayer(from, N.other)) peerGone(N);   // our host came back in a new tab
      if (N.role === null || (N.role === 'guest' && !N.linked && N.other !== from)) becomeGuest(N, from);
      else if (N.role === 'host' && !N.linked) {       // two players both think they are first: the "greater" id gives way
        if (from < me) becomeGuest(N, from); else pub(N, { t: 'host', to: from });
      }
      break;
    case 'full':
      if (N.linked || N.role === 'host' || N.role === 'out') break;
      N.emit('status', 'full');
      stop(N, 'whoTimer', 'helloTimer', 'fullTimer');
      N.fullTimer = setTimeout(() => { if (!N.closed && !N.linked) discover(N); }, 2000);
      break;
    case 'hello':                                      // the guest says hello
      if (N.role !== 'host') break;
      if (!N.linked) { N.other = from; pub(N, { t: 'hi', to: from }); linkUp(N); }
      else if (from === N.other) pub(N, { t: 'hi', to: from });
      else if (samePlayer(from, N.other) || seatFree(N)) relink(N, from);   // the same player in a new tab, or someone taking a seat that was left
      else pub(N, { t: 'full', to: from });
      break;
    case 'hi':
      if (N.role === 'guest' && N.other === from && !N.linked) linkUp(N);
      break;
    case 'moved':                                      // another tab of the same player took our seat
      if (from === N.other) leaveQuietly(N);
      break;
    case 'd':                                          // game data through the brokers
      if (!N.linked && from === N.other && Array.isArray(m.d) && N.role === 'guest') {   // a moment before 'hi'
        for (const x of m.d) if (N.early.length < 64) N.early.push(x);
        break;
      }
      if (N.linked && from === N.other && Array.isArray(m.d)) {
        const ci = N.clients.indexOf(c);               // this broker delivered first: it scores a point
        if (ci >= 0) N.win[ci] = (N.win[ci] || 0) + 1;
        for (const x of m.d) deliver(N, x, true);
      }
      break;
    case 'rtc':
      if (N.linked && from === N.other) onRtc(N, m);
      break;
    case 'bye':
      if (from === N.other) byeFrom(N, !!m.menu);
      break;
  }
}

// is anyone in the room? if nobody answers, we are first
function discover(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  N.other = null; N.early = [];
  listenTo(N, null);
  setRole(N, null);
  pub(N, { t: 'who' });
  setTimeout(() => { if (!N.closed && N.role === null) pub(N, { t: 'who' }); }, 450);
  N.whoTimer = setTimeout(() => { if (!N.closed && N.role === null) becomeHost(N); }, 1100);
}

function becomeHost(N) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  N.other = null;
  listenTo(N, null);
  setRole(N, 'host');
  N.emit('status', 'waiting');
  const ann = () => { if (!N.closed && N.role === 'host' && !N.linked) pub(N, { t: 'host' }); };
  ann();
  N.annTimer = setInterval(ann, 2500);
}

function becomeGuest(N, host) {
  stop(N, 'whoTimer', 'annTimer', 'helloTimer');
  N.other = host;
  listenTo(N, host);                                   // at once: the host may speak a moment before its 'hi' arrives
  setRole(N, 'guest');
  N.emit('status', 'joining');
  let tries = 0;
  const hello = () => {
    if (N.closed || N.linked || N.role !== 'guest') { clearInterval(N.helloTimer); return; }
    if (++tries > 6) { clearInterval(N.helloTimer); discover(N); return; }   // no answer: look around again
    pub(N, { t: 'hello', to: host });
  };
  hello();
  N.helloTimer = setInterval(hello, 1200);
}

function linkUp(N) {                                   // both players are here
  listenTo(N, N.other);
  stop(N, 'annTimer', 'helloTimer');
  markLinked(N);
}

// listen to this player's data "mailbox" (and stop listening to the previous one)
function listenTo(N, id) {
  if (N.heard === id) return;
  for (const c of N.clients) if (c && c._ok) {
    try { if (N.heard) c.unsubscribe(N.topic + '/d/' + N.heard); } catch (e) {}
    try { if (id) c.subscribe(N.topic + '/d/' + id, { qos: 0 }); } catch (e) {}
  }
  N.heard = id;
}

// The other player said goodbye. If they just closed the tab in the middle of a round, their seat (and the
// round) is held for 20 seconds: maybe it was a reload or an accident. Leaving to the menu is final.
function byeFrom(N, final) {
  if (!N.linked) return;
  if (final || N.role !== 'host' || !N.keepSeat()) { peerGone(N); return; }
  N.byeAt = performance.now(); N.byePts = N.pts;      // a pulse newer than this means they came back
  closeRtc(N);
  setWeak(N, true);
}

// The guest came back in a new tab (or someone took a seat that was left). The round is not reset:
// the game sends the new tab a full picture and goes on after a short countdown.
function relink(N, from) {
  const old = N.other;
  if (old && old !== from) pub(N, { t: 'moved', to: old });
  closeRtc(N);
  dropQueue(N);
  N.other = from; N.byeAt = 0;
  listenTo(N, from);
  N.rtcTries = 0;
  resetPaths(N);
  N.lastSeen = performance.now();
  pub(N, { t: 'hi', to: from });
  N.emit('relinked');
  if (N.weak) setWeak(N, false);
  refresh(N);
}

// another tab of ours took the seat: leave the game quietly and stop looking for the room
function leaveQuietly(N) {
  N.linked = false;
  N.weak = false;
  stop(N, 'whoTimer', 'annTimer', 'helloTimer', 'fullTimer');
  listenTo(N, null);                                   // and no longer take in the host's data stream
  closeRtc(N);
  setRole(N, 'out');
  N.emit('replaced');
  refresh(N);
}

// the other player is gone: whoever stayed holds the room
function peerGone(N) {
  if (!N.linked) return;
  dropPeer(N);
  becomeHost(N);
  N.emit('status', 'peer-left');
}

// end the link with the other player (the game ends its round)
function dropPeer(N) {
  N.linked = false;
  N.weak = false; N.byeAt = 0;
  listenTo(N, null);
  closeRtc(N);
  dropQueue(N);
  N.emit('peer-gone');
  refresh(N);
}
