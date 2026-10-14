// Nearby rooms: devices on the same network (Wi-Fi, or one phone sharing a hotspot), no internet at all.
// They pair by showing each other a short code (as a QR code): the host's offer, then the guest's answer.
// The host pairs with each guest in turn (a star, see room.js); after that the room works like an internet
// room, through the direct links only. Every link starts with a hello (_h) that says who is on each end.
//
//   const room = joinNearby({ game, name, max });
//   host:  show(await room.pair.offer()) … await room.pair.finish(codeFromGuest)   (again for each guest)
//   guest: show(await room.pair.answer(codeFromHost))
// When the devices cannot reach each other, status 'failed' comes with room.pair.reason:
//   'here'   this device has no network address to offer (e.g. it shares the hotspot: its browser cannot see that network)
//   'there'  the other device has none
//   'blocked' both have addresses but cannot reach each other (the network keeps devices apart)
// or they reached each other and the host said no (status 'failed' at once, on both):
//   'name'   the other device's player has the host's name (one name, one place)
//   'full'   a new player, and the room is full (the host can pair while a place is held, for its player)
// A browser without WebRTC cannot pair at all: offer() and answer() throw Error('nortc'), pair.reason 'nortc'.
// room.pair.vpn: one of the devices runs a VPN (a likely reason for 'blocked').
// room.pair.report() describes the last pairing, for bug reports; room.pair.cancel() drops a pairing under way.
// The pairing screens (QR codes, camera) are the library's: app/invite.js.
//
// A link that breaks (a phone locked for long, the Wi-Fi gone, the page reloaded or closed) cannot come back by
// itself: there is nothing to find each other through. The player is then away, as over the internet: their place
// (and the round) waits for them as long as places are kept, and pairing again — the same name, from the same tab or
// another device — puts them back where they were; the host's page back from a reload too (the first guest that pairs
// with it again brings back the room's places; a guest pairs again once its link to the host is broken or silent, as
// a crashed page's channels may stay open a while). Only a player who leaves for good (a final bye) or whose place
// nobody waits for any more («Не чекати», HOLD) loses it (room.js, the places invariant). A name already in the room:
// the host's own is refused at once (the pairing fails, pair.reason 'name'); a guest's takes that place over, even
// from a device whose link still works (that device is told: role 'out', as over the internet).
//
// Messages (on a link only: there is no topic). The same as on an internet room's links (internet.js), through
// the direct channels only, plus the hello. Fast ones may be lost; reliable ones carry _x, their number, and go
// again until acknowledged (link.js):
//   _h     both, on 'ctl'      {id: session, n: name, pv, no?, m?} who is on this end: the guest's as soon as both
//                              channels open, the host's in answer to it; the link counts once it comes (the host seats
//                              them by name; a guest learns its host). pv: the library's wire version (config.js PROTO);
//                              from another version the link does not count: the pairing ends (status 'version',
//                              room.versionMismatch: their number), and ours goes back first if it had not gone yet, so
//                              they learn it too (before 'version' is said here: whoever hears it may leave at once).
//                              no: 'name' | 'full', the host's answer: the pairing ends (status 'failed', pair.reason);
//                              the link closes a moment later. m: a guest pairing again in its room, the places it knows
//                              (as in _r): a host back from a reload, with nobody else yet, that m names under an older
//                              session takes them as its room's (adopt)
//   p      both, fast          {ts, a, rt?, g?} pulse and ping, 5 a second. a: their reliable ones we have; rt: our
//                              ping; g: the game's pulse fields
//   q      both, fast          {ts} the ping's answer
//   ak     both, fast          {a} their reliable ones we have, 25 ms after some came (more than we numbered: ignored)
//   bye    both, reliable      {menu?, moved?} the tab closes (a reload: the place is kept, the link closes and its
//                              player is away until paired again); menu: 1, its player left for good. moved: 1, host →
//                              a guest's old device, another device of its player took the place: step aside (role
//                              'out'). Acted on at once
//   _r     host → guests, rel. {m: [[name, session, away ms], …]} the players
//   _x     guest → host, rel.  {n} let n's place go («Не чекати»; the host does it only while n is away)
//   (game) any, fast or rel.   the game's own (t: not one of these, not starting with '_': room.send refuses them).
//                              A guest sends all of it to the host, with _t: to whom ('*': everyone; none: the host
//                              only); the host passes it on with _f: its author
// What a library from before PROTO (phase 0) does with each change since, so that both still pair and play:
//   pv on _h                   ignores it (an unknown field); a new library takes an _h without pv as version 1
//   the host's _h only after   an old host says its own at once; a new guest takes it either way (and an old guest
//     the guest's, no on _h    says its own at once too). An old guest takes a refusal (no) as a welcome: linked a
//                              moment, then the link closes and it is away, as it is today when a link breaks
//   an _h with our own name    a new guest refuses it by itself ('name'), so an old host's welcome cannot link two
//                              devices of one name; an old host ignores it, as before (its pairing times out)
//   moved on bye               an old guest takes it as its host's tab closing: its room ends (peer-left)
//   m on a guest's _h          an old host ignores it: back from a reload, its room starts over as the two of them (the
//                              guest hears the others leave), as before; an old guest says none (the same)
//   a bye that keeps the place an old library ends the link (peer-left), as before
//   the link's guards          nothing on the wire (room.send refuses 'ak'; an ak above what we numbered and an r
//                              outside a pulse are ignored; a reliable message that cannot become JSON is refused at
//                              the call): see internet.js, Versions
import { me, PROTO, pvOf, SENDER, TIMING } from './config.js';
import { closeRtc, dcLive, openChannels, wireDc } from './rtc.js';
import { ANSWER, OFFER, candidates, decode, describe, encode } from './code.js';
import { dropMember, guestMembers, linkedPeers, markLinked, memberOf, NAME, newPeer, newRoom, otherVersion, renamePeer, seatMember, setStatus,
  startWatch, stop, unlink, validWire } from './room.js';
import { send, setWeak } from './link.js';

const GATHER_MS = 3000, CONNECT_MS = 20000, REFUSED_MS = 1000;   // REFUSED_MS: a refused link closes after this (our _h first)

export function joinNearby({ game, name, max }) {
  const { N, room } = newRoom({ game, name, max, relay: false, mode: {             // (the hooks: room.js)
    peerGone: Q => ended(N, Q, false), restart: Q => broke(N, Q), close: () => stop(N, 'failTimer'), onDirect, onHello, longSleep,
    byeFrom: (Q, final, moved) => moved ? movedOut(N, Q) : final ? ended(N, Q, true) : broke(N, Q)
  } });
  let P = null;                                        // the link being paired now
  // a link that opens: the guest says who it is (the host answers it, see onHello); one that closes leaves its player
  // away (the watch: weak at once, gone only when places are no longer kept — see the top)
  function onDirect(Q, open) {
    if (open && N.role !== 'host') say(Q);
  }
  function say(Q, no) {
    Q.said = true;
    // (a guest pairing again in its room: the places it knows, for a host back from a reload, see adopt)
    const now = performance.now(), m = N.role === 'guest' && N.members.length > 1 ? N.members.map(x => [x.n, x.s, x.a ? Math.round(now - x.a) : 0]) : null;
    try { Q.dcC.send(JSON.stringify({ t: '_h', id: me, n: N.name, pv: PROTO, ...(no && { no }), ...(m && { m }) })); } catch (e) {}
  }
  // Who is on the other end: now the link counts. The host seats them by name (a name it knows: their place, the
  // old link steps aside) and answers; a guest learns the host's name. Another library version, our own name or no
  // place left: the pairing ends (see the top).
  function onHello(Q, m) {
    if (Q.linked || Q.no || N.closed || typeof m.id !== 'string' || !SENDER.test(m.id) || m.id === me) return;
    if (pvOf(m) !== PROTO) {
      if (pvOf(m) === null) return;                    // (a pv that is no version: ignored, as any broken hello)
      // ours goes first and the pairing is over before anyone hears 'version': whoever hears it may leave the room at
      // once (the library's dialog does), and the other phone must still learn it
      if (!Q.said) say(Q);
      if (Q === P) { stop(N, 'failTimer'); note('another library version: ' + m.pv); P = null; }
      Q.no = 'version';
      setTimeout(() => unlink(Q), REFUSED_MS);         // (our _h on its way first)
      otherVersion(N, m);
      return;
    }
    if (typeof m.n !== 'string' || !NAME.test(m.n)) return;
    if (m.no === 'name' || m.no === 'full') { refuse(Q, m.no); return; }   // the host said no
    if (m.n === N.name) { refuse(Q, 'name'); return; }
    if (N.role === 'host' && !memberOf(N, m.n) && N.members.filter(x => x.s !== m.id).length >= N.max) { refuse(Q, 'full'); return; }
    // the same player paired again (their old link broke, or another device of theirs): the new link takes over
    const olds = [...N.peers.values()].filter(X => X !== Q && X.linked && (X.id === m.id || X.name === m.n));
    // the same tab, its link started over, or back to a place its session holds with no link left (a host back from a
    // reload, adopt): 'relinked' below, so that whoever holds the room gives it the full picture
    const again = olds.some(X => X.id === m.id && X.name === m.n) || (N.role === 'host' && (memberOf(N, m.n) || {}).s === m.id);
    for (const X of olds) if (X.id === m.id) renamePeer(N, X, 'old.' + X.id);   // (its session goes to the new link)
    renamePeer(N, Q, m.id);
    Q.name = m.n;
    if (Q === P) { stop(N, 'failTimer'); note('linked'); P = null; }
    if (N.role === 'guest') { N.host = m.id; markLinked(Q); guestMembers(N, m.n); }   // (linked first: what the room says of the host goes to it)
    else {
      if (N.members.length === 1 && validWire(m.m) && m.m.length <= N.max && m.m.some(([n, s]) => n === N.name && s !== me)) adopt(N, m.m);
      say(Q);                                          // our answer first: then the list of players, to them too
      markLinked(Q);
      seatMember(N, m.n, m.id);                        // (a name it knows: its place; a session it knows under another name: that player left)
    }
    // the old links go quietly (the new one counts already); another device whose link still works is told
    for (const X of olds) {
      const tell = N.role === 'host' && X.name === m.n && !X.id.startsWith('old.') && dcLive(X);
      if (tell) send(X, { t: 'bye', moved: 1 });
      unlink(X, { quiet: true, linger: tell ? REFUSED_MS : 0 });
    }
    if (again) N.emit('relinked', m.n, false);         // (another session tells itself: see room.js tell)
    if (!N.watchTimer) startWatch(N);
  }
  // the host said no, or we do (to them: so they learn it at once): no link, the pairing fails with that reason
  function refuse(Q, why) {
    Q.no = why;
    if (N.role === 'host' || !Q.said) say(Q, why);
    if (Q === P) { stop(N, 'failTimer'); note('refused: ' + why); P = null; }
    pair.reason = why;
    setStatus(N, 'failed');
    setTimeout(() => unlink(Q), REFUSED_MS);         // (our _h on its way first)
  }
  // We slept longer than places are kept: the others have let us go by now (and our links are likely dead). They are
  // away from now on, not here for GRACE; whoever is still there is back with the first thing they send. (A shorter
  // sleep: GRACE, as for any sleep; nobody nearby moves on without us.)
  function longSleep(gap) {
    if (gap <= N.lostAfter) return;
    const now = performance.now();
    N.graceUntil = 0;
    for (const Q of linkedPeers(N)) { Q.lastSeen = Math.min(Q.lastSeen, now - TIMING.WEAK - 1); setWeak(Q, true); }
  }

  let t0, log, tried;
  const note = text => log.push((performance.now() - t0 | 0) + ' ms  ' + text);
  const pair = room.pair = { local: 0, remote: 0, vpn: false, reason: '', report: () => log.join('\n'), tried: () => tried,
    get pending() { return !!P; } };
  // a new pairing: its own peer, its own report
  const begin = role => {
    t0 = performance.now(); log = [navigator.userAgent]; tried = '';   // (first: a refusal below says nothing of the last one)
    Object.assign(pair, { local: 0, remote: 0, vpn: false, reason: '' });
    if (P) { unlink(P); P = null; }
    // full: as many players here as the room holds (a place held for someone away may be theirs, pairing again)
    if (role === 'host' && N.members.filter(m => !m.a).length >= N.max) throw new Error('full');
    // a guest pairs again only when its link to the host broke or went silent (weak: a browser keeps a dead link's
    // channels open until ICE gives up, ~15 s in Chromium, and the host's new page must not wait for that; the new
    // link replaces the old one at both ends, onHello); a guest never starts pairing others
    if (role === 'guest' && (N.role === 'host' || linkedPeers(N).some(Q => dcLive(Q) && !Q.weak))) throw new Error('kind');
    if (role === 'host' && N.role === 'guest') throw new Error('kind');
    // a browser without WebRTC cannot pair at all (nothing is left pending)
    if (typeof RTCPeerConnection !== 'function') { pair.reason = 'nortc'; throw new Error('nortc'); }
    P = newPeer(N, 'pairing.' + Math.random().toString(36).slice(2, 8));
    const Q = P, pc = new RTCPeerConnection({ iceServers: [] });   // nothing to reach: only this network's own addresses
    Q.pc = pc;
    // Chrome forgets the address pairs it tried once the link fails: note them while it tries
    pc.oniceconnectionstatechange = () => {
      note('ice ' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'checking') sample(Q, pc);
    };
    pc.onconnectionstatechange = () => {
      if (Q.pc !== pc || pc.connectionState !== 'failed' || N.peers.get(Q.id) !== Q) return;
      if (Q.linked) broke(N, Q); else fail(N, Q, pair, note);   // linked: away from now on (see the top)
    };
    N.role = role;
    return pc;
  };
  const sample = async (Q, pc) => {
    while (Q.pc === pc && !Q.linked && pc.connectionState !== 'failed' && pc.connectionState !== 'closed') {
      const now = await pairsOf(pc);
      if (now) tried = now;
      await new Promise(r => setTimeout(r, 1000));
    }
  };
  const ours = async (pc, kind) => {
    await gathered(pc);
    const sdp = pc.localDescription.sdp;
    const mine = candidates(sdp);
    pair.local = mine.length;
    pair.vpn = pair.vpn || viaVpn(mine);
    note('our addresses: ' + describe(sdp));
    return encode(sdp, kind, game);
  };
  const read = (code, kind) => {                       // a code of this game, and of the expected kind (or it throws)
    const d = decode(code, game);
    if (d.kind !== kind) throw new Error('kind');
    return d;
  };
  const theirs = d => {
    pair.remote = d.candidates;
    pair.vpn = pair.vpn || viaVpn(candidates(d.sdp));
    note('their addresses: ' + describe(d.sdp));
    return d.sdp;
  };
  const connecting = (Q, ms) => {
    setStatus(N, 'connecting');
    stop(N, 'failTimer');
    N.failTimer = setTimeout(() => { if (Q === P && !Q.linked && !N.closed) fail(N, Q, pair, note); }, ms);
  };
  Object.assign(pair, {
    // host: a new offer → code to show (throws Error('full') when the room is full)
    async offer() {
      const pc = begin('host');
      openChannels(P, pc);
      await pc.setLocalDescription(await pc.createOffer());
      return ours(pc, OFFER);
    },
    // guest: the host's code → our answer's code to show (the link opens once the host has read it)
    async answer(code) {
      const d = read(code, OFFER), pc = begin('guest'), Q = P, sdp = theirs(d);
      pc.ondatachannel = e => wireDc(Q, pc, e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      const ans = await ours(pc, ANSWER);
      connecting(Q, TIMING.PAIR_WAIT);                 // the host still has to scan our code
      return ans;
    },
    // the pairing under way is dropped (the players already linked stay)
    cancel() {
      stop(N, 'failTimer');
      if (P && !P.linked) unlink(P);
      P = null;
    },
    // host: the guest's code → the link opens (event 'linked' or 'join') or fails (status 'failed')
    async finish(code) {
      const Q = P;
      if (!Q || !Q.pc || N.role !== 'host') throw new Error('kind');
      const sdp = theirs(read(code, ANSWER));
      await Q.pc.setRemoteDescription({ type: 'answer', sdp });
      connecting(Q, CONNECT_MS);
    }
  });
  queueMicrotask(() => { if (!N.closed) setStatus(N, 'pairing'); });
  return room;
}

// an address in 100.64.0.0/10: a VPN such as Tailscale is on, and may send even local traffic into its tunnel
const viaVpn = list => list.some(c => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c.text));

// the candidates are in the description once gathering is done (offline it takes a moment)
const gathered = pc => new Promise(done => {
  if (pc.iceGatheringState === 'complete') return done();
  const t = setTimeout(done, GATHER_MS);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); done(); } });
});

// No link: say why (see the top of this file) and note what the browser tried.
async function fail(N, P, pair, note) {
  if (P.failing || P.linked || !P.pc) return;
  P.failing = true;
  stop(N, 'failTimer');
  pair.reason = !pair.local ? 'here' : !pair.remote ? 'there' : 'blocked';
  note('pairs tried: ' + ((await pairsOf(P.pc)) || pair.tried() || 'none'));
  P.failing = false;
  if (N.closed || P.linked) return;                    // linked (or left) meanwhile
  note('failed: ' + pair.reason);
  closeRtc(P);
  setStatus(N, 'failed');
}

// what the browser tried: "host 192.168.0.5 → host 192.168.0.7 in-progress, sent 9/answered 0, got 0/answered 0"
async function pairsOf(pc) {
  try {
    const st = await pc.getStats(), out = [];
    const side = c => c ? c.candidateType + ' ' + (c.address || c.ip || '?') + ':' + c.port : '?';
    st.forEach(r => {
      if (r.type !== 'candidate-pair') return;
      out.push(side(st.get(r.localCandidateId)) + ' → ' + side(st.get(r.remoteCandidateId)) + ' ' + r.state +
        ', sent ' + (r.requestsSent || 0) + '/answered ' + (r.responsesReceived || 0) + ', got ' + (r.requestsReceived || 0) + '/answered ' + (r.responsesSent || 0));
    });
    return out.join('; ');
  } catch (e) { return ''; }
}

// A link is gone for good: silent as long as places are kept, or they left. The host keeps the player's place
// (unless they left for good) until then.
function ended(N, P, final) {
  if (!P.linked) return;
  if (final && N.role === 'host') dropMember(N, P.name);
  else unlink(P);
  if (P.id === N.host) N.host = null;                  // the host is gone: there is no one to pass anything on
  if (!N.linked) setStatus(N, 'peer-left');
}
// The direct link broke (it failed, the other tab closed or reloaded: a bye that keeps the place, or it cannot be
// hearing us: restart): it cannot come back by itself. The link stays, carrying nothing (link.js send); its player goes
// away (weak, then away) and keeps their place until paired again (see the top) or until places are no longer kept.
function broke(N, Q) {
  if (!Q.linked) return;
  closeRtc(Q);
  Q.outbox = []; Q.rxHold.clear();
  N.refresh(Q);
}
// The host's page is back from a reload (a new page, nobody here but us) and the first guest that pairs again knew our
// player in this room under an older session (its _h, m): the places it knows are the room's again, in their order (on
// this page knowing none, the room would start over as the two of us, and that guest would hear everyone else leave,
// their rounds over). Ours on this page; the others away (since they dropped out, else from now on) until they pair
// again, or their places are no longer kept (that guest's: seatMember, next).
function adopt(N, wire) {
  const now = performance.now(), seen = new Set();
  N.members = wire.filter(([n]) => !seen.has(n) && seen.add(n)).map(([n, s, a]) => n === N.name ? { n, s: me, a: 0 } : { n, s, a: now - Math.max(1, a) });
}
// Our host says another device of our player took our place: this one steps aside (as over the internet: role 'out').
function movedOut(N, Q) {
  if (Q.id !== N.host || N.role !== 'guest') { broke(N, Q); return; }
  N.shut(false, true);
  N.role = 'out';
  N.emit('replaced');
}
