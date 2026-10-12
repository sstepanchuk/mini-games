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
// room.pair.vpn: one of the devices runs a VPN (a likely reason for 'blocked').
// room.pair.report() describes the last pairing, for bug reports; room.pair.cancel() drops a pairing under way.
// The pairing screens (QR codes, camera) are the library's: app/invite.js.
//
// A link that breaks (a phone locked for long, the Wi-Fi gone) cannot come back by itself: there is nothing to
// find each other through. The player is then away, as over the internet: their place (and the round) waits for
// them as long as places are kept, and pairing again — the same name, from the same tab or another device —
// puts them back where they were.
//
// Messages (on a link only: there is no topic). The same as on an internet room's links (internet.js), through
// the direct channels only, plus the hello. Fast ones may be lost; reliable ones carry _x, their number, and go
// again until acknowledged (link.js):
//   _h     both, on 'ctl'      {id: session, n: name, pv} who is on this end, as soon as both channels open; the link
//                              counts once it comes (the host seats them by name; a guest learns its host). pv: the
//                              library's wire version (config.js PROTO); from another version the link does not
//                              count: the pairing ends (status 'version', room.versionMismatch: their number), and
//                              ours goes back first if it had not gone yet, so they learn it too
//   p      both, fast          {ts, a, rt?, g?} pulse and ping, 5 a second. a: their reliable ones we have; rt: our
//                              ping; g: the game's pulse fields
//   q      both, fast          {ts} the ping's answer
//   ak     both, fast          {a} their reliable ones we have, 25 ms after some came (more than we numbered: ignored)
//   bye    both, reliable      {menu?} the tab closes; menu: 1, its player left for good. Acted on at once
//   _r     host → guests, rel. {m: [[name, session, away ms], …]} the players
//   _x     guest → host, rel.  {n} let n's place go («Не чекати»; the host does it only while n is away)
//   (game) any, fast or rel.   the game's own (t: not one of these, not starting with '_': room.send refuses them).
//                              A guest sends all of it to the host, with _t: to whom ('*': everyone; none: the host
//                              only); the host passes it on with _f: its author
// What a library from before PROTO (phase 0) does with each change since, so that both still pair and play:
//   pv on _h                   ignores it (an unknown field); a new library takes an _h without pv as version 1
//   the link's guards          nothing on the wire (room.send refuses 'ak'; an ak above what we numbered and an r
//                              outside a pulse are ignored; a reliable message that cannot become JSON is refused at
//                              the call): see internet.js, Versions
import { me, PROTO, pvOf, SENDER } from './config.js';
import { closeRtc, dcLive, openChannels, wireDc } from './rtc.js';
import { ANSWER, OFFER, candidates, decode, describe, encode } from './code.js';
import { closePeer, dropMember, guestMembers, linkedPeers, markLinked, NAME, newPeer, newRoom, otherVersion, renamePeer, seatMember, setRole, startWatch, stop,
  unlink, weakChanged } from './room.js';

const GATHER_MS = 3000, CONNECT_MS = 20000, REFUSED_MS = 1000;   // REFUSED_MS: a link of another version closes after this

export function joinNearby({ game, name, max }) {
  const { N, room } = newRoom({ game, name, max, relay: false, mode: {             // (the hooks: room.js)
    peerGone: Q => ended(N, Q, false), byeFrom: (Q, final) => ended(N, Q, final),
    close: () => stop(N, 'failTimer'), onDirect, onHello
  } });
  let P = null;                                        // the link being paired now
  // a link that opens says who we are; one that closes leaves its player away (the watch: weak at once, gone
  // only when places are no longer kept — see the top)
  function onDirect(Q, open) {
    if (open) say(Q);
  }
  function say(Q) {
    Q.said = true;
    try { Q.dcC.send(JSON.stringify({ t: '_h', id: me, n: N.name, pv: PROTO })); } catch (e) {}
  }
  // who is on the other end: now the link counts. The host seats them by name (a name it knows: their place,
  // the old link steps aside); a guest learns the host's name. Another library version: the pairing ends (see the top).
  function onHello(Q, m) {
    if (Q.linked || N.closed || typeof m.id !== 'string' || !SENDER.test(m.id) || m.id === me) return;
    if (otherVersion(N, m)) {
      if (pvOf(m) === null) return;                    // (a pv that is no version: ignored, as any broken hello)
      if (!Q.said) say(Q);
      if (Q === P) { stop(N, 'failTimer'); note('another library version: ' + m.pv); P = null; }
      setTimeout(() => unlink(Q), REFUSED_MS);         // (our _h on its way first)
      return;
    }
    if (typeof m.n !== 'string' || !NAME.test(m.n) || m.n === N.name) return;
    // the same player paired again (their old link broke): the new link takes over from the old one
    const olds = [...N.peers.values()].filter(X => X !== Q && (X.id === m.id || X.name === m.n));
    if (olds.some(X => X.linked && dcLive(X))) return;  // (still linked and alive: not a second link for one player)
    const again = olds.some(X => X.linked);
    for (const X of olds) retire(N, X);
    renamePeer(N, Q, m.id);
    Q.name = m.n;
    if (Q === P) { stop(N, 'failTimer'); note('linked'); P = null; }
    if (N.role === 'guest') { N.host = m.id; guestMembers(N, m.n); markLinked(Q); }
    else {
      markLinked(Q);                                   // linked first: the list of players that follows goes to them too
      seatMember(N, m.n, m.id);
    }
    if (again) N.emit('relinked', m.n, false);         // (a new session tells itself: see room.js tell)
    if (!N.watchTimer) startWatch(N);
  }

  let t0, log, tried;
  const note = text => log.push((performance.now() - t0 | 0) + ' ms  ' + text);
  const pair = room.pair = { local: 0, remote: 0, vpn: false, reason: '', report: () => log.join('\n'), tried: () => tried,
    get pending() { return !!P; } };
  // a new pairing: its own peer, its own report
  const begin = role => {
    if (P) { unlink(P); P = null; }
    if (role === 'host' && N.members.length >= N.max) throw new Error('full');
    // a guest pairs again only when its link to the host broke; a guest never starts pairing others
    if (role === 'guest' && (N.role === 'host' || linkedPeers(N).some(dcLive))) throw new Error('kind');
    if (role === 'host' && N.role === 'guest') throw new Error('kind');
    t0 = performance.now(); log = [navigator.userAgent]; tried = '';
    Object.assign(pair, { local: 0, remote: 0, vpn: false, reason: '' });
    P = newPeer(N, 'pairing.' + Math.random().toString(36).slice(2, 8));
    const Q = P, pc = new RTCPeerConnection({ iceServers: [] });   // nothing to reach: only this network's own addresses
    Q.pc = pc;
    // Chrome forgets the address pairs it tried once the link fails: note them while it tries
    pc.oniceconnectionstatechange = () => {
      note('ice ' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'checking') sample(Q, pc);
    };
    pc.onconnectionstatechange = () => {
      if (Q.pc !== pc || pc.connectionState !== 'failed') return;
      if (Q.linked) { closeRtc(Q); N.refresh(Q); } else fail(N, Q, pair, note);   // linked: away from now on (see the top)
    };
    if (N.role !== role) setRole(N, role);
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
    N.emit('status', 'connecting');
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
      connecting(Q, 90000);                            // the host still has to scan our code
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
  queueMicrotask(() => { if (!N.closed) N.emit('status', 'pairing'); });
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
  N.emit('status', 'failed');
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

// A link replaced by a new pairing of the same player: it goes quietly (the new one is linked already, so
// nobody hears that anyone left).
function retire(N, X) {
  X.linked = false;
  closePeer(X);
  if (N.peers.get(X.id) === X) N.peers.delete(X.id);
  N.linked = linkedPeers(N).length > 0;
  weakChanged(N);
}

// A link is gone for good: silent as long as places are kept, or they left. The host keeps the player's place
// (unless they left for good) until then.
function ended(N, P, final) {
  if (!P.linked) return;
  if (final && N.role === 'host') dropMember(N, P.name);
  else unlink(P);
  if (P.id === N.host) N.host = null;                  // the host is gone: there is no one to pass anything on
  if (!N.linked) N.emit('status', 'peer-left');
}
