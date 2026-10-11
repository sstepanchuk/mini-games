// Nearby rooms: two devices on the same network (Wi-Fi, or one phone sharing a hotspot), no internet at all.
// They pair by showing each other a short code (as a QR code): the host's offer, then the guest's answer.
// After that the room works like an internet room, through the direct link only.
//
//   const room = joinNearby({ game });
//   host:  show(await room.pair.offer()) … await room.pair.finish(codeFromGuest)
//   guest: show(await room.pair.answer(codeFromHost))
// The pairing screens (QR codes, camera) are the library's: app/together.js.
import { closeRtc, wireDc } from './rtc.js';
import { ANSWER, OFFER, decode, encode } from './code.js';
import { markLinked, newRoom, setRole, startWatch, stop } from './room.js';

const GATHER_MS = 3000, CONNECT_MS = 20000;

export function joinNearby({ game, lostAfter }) {
  const { N, room } = newRoom({ game, lostAfter, relay: false, close: N => stop(N, 'failTimer'), bye: () => {} });
  N.early = [];
  N.peerGone = N.byeFrom = () => ended(N);
  N.onDirect = open => {
    if (open && !N.linked && !N.closed) { stop(N, 'failTimer'); markLinked(N); startWatch(N); }
    else if (!open) ended(N);
  };

  const fresh = role => {
    closeRtc(N);
    const pc = new RTCPeerConnection({ iceServers: [] });   // nothing to reach: only this network's own addresses
    N.pc = pc;
    pc.onconnectionstatechange = () => { if (N.pc === pc && pc.connectionState === 'failed') N.linked ? ended(N) : failed(N); };
    if (N.role !== role) setRole(N, role);
    return pc;
  };
  const connecting = ms => {
    N.emit('status', 'connecting');
    stop(N, 'failTimer');
    N.failTimer = setTimeout(() => { if (!N.linked && !N.closed) failed(N); }, ms);
  };
  room.pair = {
    // host: a new offer → code to show
    async offer() {
      const pc = fresh('host');
      wireDc(N, pc, pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
      wireDc(N, pc, pc.createDataChannel('ctl', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await gathered(pc);
      return encode(pc.localDescription.sdp, OFFER, game);
    },
    // guest: the host's code → our answer's code to show (the link opens once the host has read it)
    async answer(code) {
      const { kind, sdp } = decode(code, game);
      if (kind !== OFFER) throw new Error('kind');
      const pc = fresh('guest');
      pc.ondatachannel = e => wireDc(N, pc, e.channel);
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await gathered(pc);
      connecting(90000);                               // the host still has to scan our code
      return encode(pc.localDescription.sdp, ANSWER, game);
    },
    // host: the guest's code → the link opens (event 'linked') or fails (status 'failed')
    async finish(code) {
      const { kind, sdp } = decode(code, game);
      if (kind !== ANSWER || !N.pc) throw new Error('kind');
      await N.pc.setRemoteDescription({ type: 'answer', sdp });
      connecting(CONNECT_MS);
    }
  };
  queueMicrotask(() => { if (!N.closed) N.emit('status', 'pairing'); });
  return room;
}

// the candidates are in the description once gathering is done (offline it takes a moment)
const gathered = pc => new Promise(done => {
  if (pc.iceGatheringState === 'complete') return done();
  const t = setTimeout(done, GATHER_MS);
  pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') { clearTimeout(t); done(); } });
});

function failed(N) {
  stop(N, 'failTimer');
  closeRtc(N);
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

