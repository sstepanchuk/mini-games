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
// room.pair.vpn: one of the devices runs a VPN (a likely reason for 'blocked').
// room.pair.report() describes what happened, for bug reports.
// The pairing screens (QR codes, camera) are the library's: app/invite.js.
import { closeRtc, openChannels, wireDc } from './rtc.js';
import { ANSWER, OFFER, candidates, decode, describe, encode } from './code.js';
import { markLinked, newRoom, setRole, startWatch, stop } from './room.js';

const GATHER_MS = 3000, CONNECT_MS = 20000;

export function joinNearby({ game, lostAfter }) {
  const { N, room } = newRoom({ game, lostAfter, relay: false, close: N => stop(N, 'failTimer'), bye: () => {} });
  N.peerGone = N.byeFrom = () => ended(N);
  N.onDirect = open => {
    if (open && !N.linked && !N.closed) { stop(N, 'failTimer'); note('linked'); markLinked(N); startWatch(N); }
    else if (!open) ended(N);
  };
  const t0 = performance.now(), log = [navigator.userAgent];
  let tried = '';
  const sample = async pc => {
    while (N.pc === pc && !N.linked && pc.connectionState !== 'failed' && pc.connectionState !== 'closed') {
      const now = await pairsOf(pc);
      if (now) tried = now;
      await new Promise(r => setTimeout(r, 1000));
    }
  };
  const note = text => log.push((performance.now() - t0 | 0) + ' ms  ' + text);
  const pair = room.pair = { local: 0, remote: 0, vpn: false, reason: '', report: () => log.join('\n'), tried: () => tried };

  const fresh = role => {
    closeRtc(N);
    const pc = new RTCPeerConnection({ iceServers: [] });   // nothing to reach: only this network's own addresses
    N.pc = pc;
    // Chrome forgets the address pairs it tried once the link fails: note them while it tries
    pc.oniceconnectionstatechange = () => {
      note('ice ' + pc.iceConnectionState);
      if (pc.iceConnectionState === 'checking') sample(pc);
    };
    pc.onconnectionstatechange = () => { if (N.pc === pc && pc.connectionState === 'failed') N.linked ? ended(N) : fail(N, pc, pair, note); };
    if (N.role !== role) setRole(N, role);
    return pc;
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
  const theirs = (code, kind) => {
    const d = decode(code, game);
    if (d.kind !== kind) throw new Error('kind');
    pair.remote = d.candidates;
    pair.vpn = pair.vpn || viaVpn(candidates(d.sdp));
    note('their addresses: ' + describe(d.sdp));
    return d.sdp;
  };
  const connecting = ms => {
    N.emit('status', 'connecting');
    stop(N, 'failTimer');
    N.failTimer = setTimeout(() => { if (!N.linked && !N.closed) fail(N, N.pc, pair, note); }, ms);
  };
  Object.assign(pair, {
    // host: a new offer → code to show
    async offer() {
      const pc = fresh('host');
      openChannels(N, pc);
      await pc.setLocalDescription(await pc.createOffer());
      return ours(pc, OFFER);
    },
    // guest: the host's code → our answer's code to show (the link opens once the host has read it)
    async answer(code) {
      const sdp = theirs(code, OFFER);
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

// an address in 100.64.0.0/10: a VPN such as Tailscale is on, and may send even local traffic into its tunnel
const viaVpn = list => list.some(c => /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c.text));

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
  note('pairs tried: ' + ((await pairsOf(pc)) || pair.tried() || 'none'));
  if (N.closed || N.linked) { N.failing = false; return; }   // linked (or left) meanwhile
  note('failed: ' + pair.reason);
  closeRtc(N);
  N.failing = false;
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
