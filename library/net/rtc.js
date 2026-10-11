// Direct browser-to-browser link with one other player (a peer P, see room.js). Signalling goes through the
// brokers. Two data channels: 'fast' (unordered, no retransmits: state and aim) and 'ctl' (ordered, reliable:
// commands). A direct channel counts as alive only while something actually arrives through it.
//
// Every attempt has a number k carried by the offer, the answer and the candidates, so a late answer or
// candidate from an earlier attempt cannot spoil a newer one. Only the guest starts attempts (no glare).
import { ICE } from './config.js';
import { pubOn } from './brokers.js';
import { deliver, flushRelay } from './link.js';

const ICE_MAX = 50;                                    // candidates kept while waiting for an offer

export const dcLive = P => !!(P.dcF && P.dcC && P.dcF.readyState === 'open' && P.dcC.readyState === 'open');

// Do we hear them through the direct link? Something arriving through it says yes. Silence is suspicious after
// a third of a second while they stream state every frame (1.3 s otherwise), but it counts as a broken link only
// if they reached us through the brokers meanwhile (aliveAt: they are there, the direct link is not). If nothing
// came by either path, they just stalled (a busy phone, a hiccup in the network): moving to the brokers would
// not bring their messages sooner, only add delay to everything after. 3 s of silence is a broken link anyway.
export function dcHear(P) {
  if (!dcLive(P)) return false;
  const quiet = performance.now() - P.dcSeen;
  if (quiet < (P.via === 'p2p' && P.N.streaming() ? 350 : 1300)) return true;
  return P.aliveAt <= P.dcSeen && quiet < 3000;
}
// a moment of silence on the direct link: worth asking through the brokers whether they are still there
export const dcQuiet = P => dcLive(P) && performance.now() - P.dcSeen > 350;
// use the direct link only while we hear through it and they have not said they don't hear us
export const dcFresh = P => dcHear(P) && performance.now() - P.suspect > 1500;

const signal = (P, m) => { if (P.linked) pubOn(P.N, Object.assign(m, { t: 'rtc', to: P.id })); };

// the offering side opens both channels: 'fast' (unordered, no resends) and 'ctl' (ordered, reliable)
export function openChannels(P, pc) {
  wireDc(P, pc, pc.createDataChannel('fast', { ordered: false, maxRetransmits: 0 }));
  wireDc(P, pc, pc.createDataChannel('ctl', { ordered: true }));
}

export function closeRtc(P) {
  clearTimeout(P.rtcTimer); P.rtcTimer = null;
  const pc = P.pc, a = P.dcF, b = P.dcC;
  P.pc = null; P.dcF = null; P.dcC = null; P.iceQ = []; P.rtcK = null; P.via = 'relay'; P.turn = null; P.cand = ''; P.iceRtt = null; P.rD = null; P.sD = []; P.slowDirect = false;
  try { if (a) a.close(); } catch (e) {}
  try { if (b) b.close(); } catch (e) {}
  try { if (pc) pc.close(); } catch (e) {}
}

function newPc(P) {
  if (!window.RTCPeerConnection) return null;
  closeRtc(P);
  let pc;
  try { pc = new RTCPeerConnection({ iceServers: ICE, iceCandidatePoolSize: 1 }); } catch (e) { return null; }
  P.pc = pc;
  pc.onicecandidate = e => { if (e.candidate && !P.N.closed && P.pc === pc) signal(P, { k: P.rtcK, ice: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.onconnectionstatechange = () => {
    if (P.pc === pc && (pc.connectionState === 'failed' || pc.connectionState === 'closed')) { closeRtc(P); P.N.refresh(P); }
  };
  // no direct link within 15 seconds: stay on the brokers, quietly
  P.rtcTimer = setTimeout(() => { if (P.pc === pc && !dcLive(P)) { closeRtc(P); P.N.refresh(P); } }, 15000);
  return pc;
}

export function wireDc(P, pc, dc) {
  const key = dc.label === 'fast' ? 'dcF' : 'dcC';
  dc.onopen = () => {
    if (P.N.closed || P.pc !== pc) return;
    P[key] = dc;
    if (!dcLive(P)) return;                            // wait until both channels are open
    flushRelay(P);
    P.dcBorn = performance.now();
    P.dcSeen = 0; P.rtcTries = 0;                      // it becomes "alive" when the first message arrives through it
    if (P.N.onDirect) P.N.onDirect(P, true);
    P.N.refresh(P);
  };
  dc.onclose = () => { if (P.pc === pc) { closeRtc(P); if (P.N.onDirect) P.N.onDirect(P, false); P.N.refresh(P); } };
  dc.onmessage = e => {
    if (P.N.closed || P.pc !== pc) return;
    P.dcSeen = performance.now();
    let x; try { x = JSON.parse(e.data); } catch (err) { return; }
    if (!P.linked) {                                   // before the link counts: a nearby hello, or a moment early
      if (x && x.t === '_h' && P.N.onHello) P.N.onHello(P, x);
      else if (P.early.length < 64) P.early.push(x);
      return;
    }
    try { deliver(P, x, false); } catch (err) { console.error(err); }   // one bad message must not break the channel
  };
}

export function startRtc(P) {
  const pc = newPc(P);
  if (!pc) return;
  P.rtcK = Date.now() % 1e9;
  openChannels(P, pc);
  pc.createOffer().then(o => pc.setLocalDescription(o)).then(() => {
    if (P.pc === pc) signal(P, { k: P.rtcK, sdp: { type: 'offer', sdp: pc.localDescription.sdp } });
  }).catch(() => {});
}

function drainIce(P, pc) {
  const list = P.iceQ; P.iceQ = [];
  for (const q of list) if (q.k === P.rtcK) pc.addIceCandidate(q.c).catch(() => {});
}

export function onRtc(P, m) {
  if (m.sdp && m.sdp.type === 'offer' && typeof m.sdp.sdp === 'string') {
    const early = P.iceQ.filter(q => q.k === m.k);     // candidates of this attempt that overtook the offer
    const pc = newPc(P);
    if (!pc) return;
    P.rtcK = m.k; P.iceQ = early;
    pc.ondatachannel = e => wireDc(P, pc, e.channel);
    pc.setRemoteDescription(m.sdp).then(() => { drainIce(P, pc); return pc.createAnswer(); })
      .then(a => pc.setLocalDescription(a))
      .then(() => { if (P.pc === pc) signal(P, { k: m.k, sdp: { type: 'answer', sdp: pc.localDescription.sdp } }); })
      .catch(() => {});
  } else if (m.sdp && m.sdp.type === 'answer' && typeof m.sdp.sdp === 'string') {
    const pc = P.pc;
    if (pc && m.k === P.rtcK && pc.signalingState === 'have-local-offer') pc.setRemoteDescription(m.sdp).then(() => drainIce(P, pc)).catch(() => {});
  } else if (m.ice && typeof m.ice === 'object') {
    const pc = P.pc;
    if (pc && m.k === P.rtcK && pc.remoteDescription) pc.addIceCandidate(m.ice).catch(() => {});
    else if (P.iceQ.length < ICE_MAX) P.iceQ.push({ k: m.k, c: m.ice });
  }
}

// Ask the browser about the direct link: is it really direct or through a relay (both players behind strict
// routers), and what is its network round trip.
export function probeLink(P) {
  const pc = P.pc;
  if (!pc || !pc.getStats) return;
  pc.getStats().then(st => {
    if (P.pc !== pc) return;
    let pair = null;
    st.forEach(r => { if (r.type === 'transport' && r.selectedCandidatePairId) pair = st.get(r.selectedCandidatePairId) || pair; });
    if (!pair) st.forEach(r => { if (!pair && r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r; });
    if (!pair) return;
    const a = st.get(pair.localCandidateId), b = st.get(pair.remoteCandidateId);
    P.turn = !!((a && a.candidateType === 'relay') || (b && b.candidateType === 'relay'));
    P.cand = (a ? a.candidateType + '/' + (a.relayProtocol || a.protocol || '?') : '?') + ' - ' + (b ? b.candidateType : '?');
    if (typeof pair.currentRoundTripTime === 'number') P.iceRtt = pair.currentRoundTripTime * 1000;
  }).catch(() => {});
}
