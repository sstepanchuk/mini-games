// Nearby rooms: two devices on the same network (Wi-Fi, or one phone sharing a hotspot), no internet at all.
// They pair by showing each other a short code (as a QR code): the host's offer, then the guest's answer.
// After that the room works like an internet room, through the direct link only.
//
//   const room = joinNearby({ game });
//   host:  show(await room.pair.offer()) … await room.pair.finish(codeFromGuest)
//   guest: show(await room.pair.answer(codeFromHost))
// When the devices cannot reach each other, status 'failed' comes with room.pair.reason:
//   'here'   this device has no network address to offer (e.g. it shares the hotspot: its browser cannot see that network)
//   'there'  the other device has none
//   'blocked' both have addresses but cannot reach each other (the network keeps devices apart)
// room.pair.fallback is an internet room code both sides share: they can meet there instead.
// room.pair.report() describes what happened, for bug reports.
// The pairing screens (QR codes, camera) are the library's: app/invite.js.
import { closeRtc, wireDc } from './rtc.js';
import { ANSWER, OFFER, candidates, decode, describe, encode } from './code.js';
import { newRoomCode } from './config.js';
import { markLinked, newRoom, setRole, startWatch, stop } from './room.js';

const GATHER_MS = 3000, CONNECT_MS = 20000;

export function joinNearby({ game, lostAfter }) {
  const { N, room } = newRoom({ game, lostAfter, relay: false, close: N => stop(N, 'failTimer'), bye: () => {} });
  N.early = [];
  N.peerGone = N.byeFrom = () => ended(N);
  N.onDirect = open => {
    if (open && !N.linked && !N.closed) { stop(N, 'failTimer'); note('linked'); markLinked(N); startWatch(N); }
    else if (!open) ended(N);
  };
  const t0 = performance.now(), log = [navigator.userAgent];
  const note = text => log.push((performance.now() - t0 | 0) + ' ms  ' + text);
  const pair = room.pair = { fallback: '', local: 0, remote: 0, reason: '', report: () => log.join('\n') };

  const fresh = role => {
    closeRtc(N);
    const pc = new RTCPeerConnection({ iceServers: [] });   // nothing to reach: only this network's own addresses
    N.pc = pc;
    pc.oniceconnectionstatechange = () => note('ice ' + pc.iceConnectionState);
    pc.onconnectionstatechange = () => { if (N.pc === pc && pc.connectionState === 'failed') N.linked ? ended(N) : fail(N, pc, pair, note); };
    if (N.role !== role) setRole(N, role);
    return pc;
  };
  const ours = async (pc, kind) => {
    await gathered(pc);
    const sdp = pc.localDescription.sdp;
    pair.local = candidates(sdp).length;
    note('our addresses: ' + describe(sdp));
    return encode(sdp, kind, game, pair.fallback);
  };
  const theirs = (code, kind) => {
    const d = decode(code, game);
    if (d.kind !== kind) throw new Error('kind');
    pair.remote = d.candidates;
    if (d.room) pair.fallback = d.room;
    note('their addresses: ' + describe(d.sdp));
    return d.sdp;
  };
  const connecting = ms => {
    N.emit('status', 'connecting');
    stop(N, 'failTimer');
    N.failTimer = setTimeout(() => { if (!N.linked && !N.closed) fail(N, N.pc, pair, note); }, ms);
  };
  Object.assign(pair, {
    // host: a new offer → code to show (room: where to meet over the internet instead; a new one by default)
    async offer(room = newRoomCode()) {
      pair.fallback = room;
      const pc = fresh('host');
      wireDc(N, pc, pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      wireDc(N, pc, pc.createDataChannel('ctl', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      return ours(pc, OFFER);
    },
    // guest: the host's code → our answer's code to show (the link opens once the host has read it)
    async answer(code, room) {
      const sdp = theirs(code, OFFER);
      if (room) pair.fallback = room;
      const pc = fresh('guest');
      pc.ondatachannel = e => wireDc(N, pc, e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      const ans = await ours(pc, ANSWER);
      connecting(90000);                               // the host still has to scan our code
      return ans;
    },
    // host: the guest's code → the link opens (event 'linked') or fails (status 'failed')
    async finish(code) {
      if (!N.pc) throw new Error('kind');
      const sdp = theirs(code, ANSWER);
      await N.pc.setRemoteDescription({ type: 'answer', sdp });
      connecting(CONNECT_MS);
    }
  });
  queueMicrotask(() => { if (!N.closed) N.emit('status', 'pairing'); });
  return room;
}

// the candidates are in the description once gathering is done (offline it takes a moment)
const gathered = pc => new Promise(done => {
  if (pc.iceGatheringState === 'complete') return done();
  const t = setTimeout(done, GATHER_MS);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); done(); } });
});

// No link: say why (see the top of this file) and note what the browser tried.
async function fail(N, pc, pair, note) {
  if (N.failing || N.linked) return;
  N.failing = true;
  stop(N, 'failTimer');
  pair.reason = !pair.local ? 'here' : !pair.remote ? 'there' : 'blocked';
  try {
    const st = await pc.getStats(), pairs = [];
    st.forEach(r => {
      if (r.type !== 'candidate-pair') return;
      const a = st.get(r.localCandidateId), b = st.get(r.remoteCandidateId), side = c => c ? c.candidateType + ' ' + (c.address || c.ip || '?') + ':' + c.port : '?';
      pairs.push(side(a) + ' → ' + side(b) + ' ' + r.state + (r.requestsSent ? ', ' + r.requestsSent + ' checks sent, ' + (r.responsesReceived || 0) + ' answered' : ''));
    });
    note('pairs tried: ' + (pairs.join('; ') || 'none'));
  } catch (e) {}
  note('failed: ' + pair.reason);
  closeRtc(N);
  N.failing = false;
  N.emit('status', 'failed');
}

// the link is gone for good (a nearby link cannot be rebuilt without pairing again)
function ended(N) {
  if (!N.linked) return;
  N.linked = false; N.weak = false;
  stop(N, 'watchTimer');
  closeRtc(N);
  N.emit('peer-gone');
  N.emit('status', 'peer-left');
  N.refresh();
}
