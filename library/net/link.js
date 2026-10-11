// Delivery between us and one other player (a peer P, see room.js) over two paths: direct (WebRTC) and through
// the brokers. Each path's ping is measured on its own and all the time; messages take the faster one. Usually
// that is the direct path, but a "direct" link through a far-away TURN relay can be slower than the brokers.
//
// Messages are plain objects with a string `t` ('p', 'q', 'bye' and those starting with '_' are the room's own).
// Fast ones may be lost or reordered — the game numbers them itself if it cares. Reliable ones really are: each
// gets a number `_x` and stays in our outbox until the other side acknowledges it (`a` in every pulse: "I have
// everything up to here"); until then it is sent again, by whatever path works, with growing pauses. So nothing
// is lost to a dead direct link, brokers that are reconnecting, or a phone that was offline for a minute. The
// receiver runs them exactly once and in order: a message that overtook a missing one waits for it.
import { BROKERS } from './config.js';
import { bestBrokers, brokerDiag, kickBrokers, pubData, tendBrokers } from './brokers.js';
import { closeRtc, dcFresh, dcHear, dcLive, dcQuiet, probeLink, startRtc } from './rtc.js';
import { holdOver, hostPeer, linkedPeers, weakChanged } from './room.js';

const OUTBOX_MAX = 5000;                               // reliable messages not yet acknowledged: more means they are gone
const HOLD_MAX = 4096;                                 // messages that overtook a missing one, waiting for it
const RESEND_PER_TICK = 64;

// a new link with this player (or the same person in a new tab): measurements and numbering start over
export function resetPaths(P) {
  P.tx = 0; P.outbox = []; P.rxNext = 1; P.rxHold = new Map(); P.byeX = 0;
  P.pts = -1; P.suspect = -1e9;
  P.rD = P.rR = null; P.sD = []; P.sR = []; P.qD = P.qR = -1; P.slowDirect = false; P.peerRtt = null; P.aliveAt = 0;
}

/* ---------- sending ---------- */
// fast: unordered, may be lost (state, aim); batch: through the brokers, wait up to 45 ms for two more
export function send(P, m, { fast = false, batch = false } = {}) {
  const N = P.N;
  if (N.closed || !P.linked) return;
  if (!fast) {
    m = { ...m, _x: ++P.tx };                          // a copy: the same message may go to several players
    P.outbox.push({ m, at: performance.now(), n: 1 });
    if (P.outbox.length > OUTBOX_MAX) { queueMicrotask(() => { if (P.linked) N.peerGone(P); }); return; }   // they have not heard us for ages (not now: we may be in a loop over the links)
  }
  transmit(P, m, fast, batch);
}
// by the path in use; while the direct link is not sure, through the brokers as well
function transmit(P, m, fast, batch) {
  const N = P.N;
  if (!N.relay) { if (dcLive(P)) { try { (fast ? P.dcF : P.dcC).send(JSON.stringify(m)); } catch (e) {} } return; }   // nearby: the direct link is all there is
  if (dcLive(P) && P.via === 'p2p') {
    try { (fast ? P.dcF : P.dcC).send(JSON.stringify(m)); } catch (e) {}
    if (dcFresh(P)) return;                            // the direct link is alive: that is enough
  }
  // through the brokers (no direct path, it went quiet, or it is slower)
  P.q.push(m);
  if (!batch || P.q.length >= 3) flushRelay(P);
  else if (!P.qTimer) P.qTimer = setTimeout(() => flushRelay(P), 45);
}
// The other side has everything up to `a`: those leave the outbox.
function acked(P, a) {
  if (!Number.isInteger(a)) return;
  let i = 0;
  while (i < P.outbox.length && P.outbox[i].m._x <= a) i++;
  if (i) P.outbox.splice(0, i);
}
// Reliable messages not acknowledged in time go again: after twice the round trip (at least 300 ms), then with
// longer and longer pauses (up to 4×), the oldest first, a few dozen per tick.
function resend(P, now) {
  if (!P.outbox.length) return;
  const rtt = curRtt(P), rto = Math.max(300, (rtt == null ? 300 : rtt) * 2 + 100);
  let k = 0;
  for (const e of P.outbox) {
    if (now - e.at < rto * Math.min(e.n, 4)) continue;
    e.at = now; e.n++;
    transmit(P, e.m, false, false);
    if (++k >= RESEND_PER_TICK) break;
  }
}
function sendDirect(P, m) { if (dcLive(P)) { try { P.dcF.send(JSON.stringify(m)); } catch (e) {} } }
function sendRelay(P, m) { if (P.linked && P.N.relay) { P.q.push(m); flushRelay(P); } }
export function flushRelay(P) {
  clearTimeout(P.qTimer); P.qTimer = null;
  if (!P.q.length || !P.N.relay) return;
  const d = P.q; P.q = [];
  if (!P.N.closed) pubData(P.N, P, { t: 'd', to: P.id, d });
}

/* ---------- receiving ---------- */
export function deliver(P, m, viaRelay) {
  const N = P.N;
  if (N.closed || !P.linked || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
  const now = performance.now();
  P.lastSeen = now;
  const x = m._x;
  if (x === undefined) { signals(P, m, viaRelay, now); return; }   // fast: pulses, ping answers, the game's own
  if (!Number.isInteger(x) || x < P.rxNext) return;   // a copy that came by the other path, or a resend we already have
  if (m.t === 'bye' && P.byeX !== x) {                 // their tab closed (menu: they left for good): at once, whatever is missing
    P.byeX = x;                                        // (it still takes its place in the order below, or nothing after it would run)
    N.byeFrom(P, m.menu === 1);
    if (N.closed || !P.linked) return;
  }
  if (x > P.rxNext) { if (P.rxHold.size < HOLD_MAX) P.rxHold.set(x, m); return; }   // one before it is missing: it waits
  for (;;) {                                           // this one, and whatever was waiting behind it
    delete m._x;
    P.rxNext++;
    if (m.t !== 'bye') { N.arrive(P, m, true); if (N.closed || !P.linked) return; }
    m = P.rxHold.get(P.rxNext);
    if (!m) return;
    P.rxHold.delete(P.rxNext);
  }
}

// the link's own fast messages: pulse and ping (p), ping answer (q); anything else fast is the game's
function signals(P, m, viaRelay, now) {
  const N = P.N;
  if (m.r === 1) P.suspect = now;                      // they say they cannot hear us directly
  if (m.t === 'p') {                                   // pulse and ping
    if (!Number.isFinite(m.ts)) return;
    const q = { t: 'q', ts: m.ts };
    if (viaRelay) sendRelay(P, q); else sendDirect(P, q);   // answer by the same path, so each path is measured on its own
    acked(P, m.a);
    if (m.ts <= P.pts) return;                         // the copy from the other path was already counted
    P.pts = m.ts;
    if (viaRelay) P.aliveAt = now;                     // a pulse the direct link has not brought: they are there
    if (typeof m.rt === 'number' && m.rt >= 0 && m.rt < 5000) P.peerRtt = m.rt;
    if (Array.isArray(m.w)) { P.peerBest = m.w.filter(i => Number.isInteger(i) && i >= 0 && i < BROKERS.length).slice(0, 2); P.peerBestAt = now; }
    if (m.g && typeof m.g === 'object') N.emit('pulse', m.g, P.name);
    return;
  }
  if (m.t === 'q') {
    if (!Number.isFinite(m.ts)) return;
    const rtt = now - m.ts;
    if (rtt < 0 || rtt > 5000) return;
    if (viaRelay) {                                    // the answer came through the brokers: that path's ping
      if (m.ts > P.dcSeen) P.aliveAt = now;            // they answered a ping sent after the direct link went quiet
      if (m.ts <= P.qR) return;
      P.qR = m.ts; P.sR.push(rtt); if (P.sR.length > 7) P.sR.shift(); P.rR = med(P.sR);
    } else {                                           // it came through the direct link: the direct path's ping
      if (m.ts <= P.qD) return;
      P.qD = m.ts; P.sD.push(rtt); if (P.sD.length > 7) P.sD.shift(); P.rD = med(P.sD);
    }
    return;
  }
  N.arrive(P, m, false);
}

/* ---------- ping and path choice ---------- */
const med = a => a.length ? [...a].sort((x, y) => x - y)[a.length >> 1] : null;
// round trip of the path in use
const curRtt = P => P.via === 'p2p' ? (P.rD != null ? P.rD : P.rR) : (P.rR != null ? P.rR : P.rD);
// round trip to show: on the direct path the browser's own network measurement (unaffected by how busy the page is)
const netRtt = P => { const r = curRtt(P); return r != null && P.via === 'p2p' && P.iceRtt != null ? Math.min(r, P.iceRtt + 1) : r; };

// One-way delay estimate: half the round trip of the path in use. On the direct path the browser's own
// network measurement is used when smaller: what needs evening out is the network, not a busy phone.
export function lag(P) {
  let r = P.linked ? curRtt(P) : null;
  if (r == null) return 0;
  if (P.via === 'p2p' && P.iceRtt != null) r = Math.min(r, P.iceRtt + 12);
  return Math.min(300, r / 2);
}

function pickRoute(P) {
  if (!P.N.relay) return 'p2p';
  if (!dcFresh(P)) return 'relay';                     // no direct path, or it went quiet
  if (P.rD == null || P.rR == null) return 'p2p';
  if (P.slowDirect) { if (P.rD <= P.rR + 10) P.slowDirect = false; }      // back to direct as soon as it is not worse
  else if (P.rR + 30 < P.rD * .8) P.slowDirect = true;                    // the brokers are clearly faster: use them
  return P.slowDirect ? 'relay' : 'p2p';
}

// what the game may show about this link: ping both ways and whether it is direct
export function stats(P) {
  const rtt = P.linked && !P.weak ? netRtt(P) : null;
  return { rtt: rtt == null ? null : Math.round(rtt), peerRtt: P.peerRtt, direct: P.via === 'p2p', relayed: P.via !== 'p2p' || P.turn === true, turn: P.turn, weak: P.weak };
}
// choose the path again (the room tells the game: event 'stats')
export function refresh(P) {
  P.via = pickRoute(P); P.viaAt = performance.now();
}

// Detailed connection state for bug reports (not shown to players).
export function diag(N) {
  const f = v => v == null ? '—' : Math.round(v) + ' ms';
  const head = ['room: ' + (N.relay ? 'internet' : 'nearby') + ', role: ' + (N.role || '—') + ', players: ' + N.members.map(m => m.n + (m.a ? ' (away)' : '')).join(', ') + ' (at most ' + N.max + ')'];
  if (N.relay) head.push('brokers: ' + brokerDiag(N));
  return head.concat(linkedPeers(N).map(P => {
    const used = P.via === 'p2p' ? (P.turn ? 'direct link through a TURN relay' : P.turn === false ? 'direct' : 'direct link') : 'brokers';
    const lines = ['— ' + P.name + ': ' + used + (P.slowDirect ? ' (direct link exists but is slower)' : '') + (P.weak ? ', quiet' : ''),
      '  direct ping: ' + f(P.rD) + ' (browser: ' + f(P.iceRtt) + '), candidates: ' + (P.cand || '—') + ', open: ' + (dcLive(P) ? 'yes' : 'no') + ', hearing: ' + (dcHear(P) ? 'yes' : 'no')];
    if (N.relay) lines.push('  broker ping: ' + f(P.rR) + '; they hear us best through: ' + (P.peerBest.map(i => BROKERS[i].name).join(', ') || '—') +
      '; we hear them best through: ' + (bestBrokers(P).map(i => BROKERS[i].name).join(', ') || '—'));
    return lines.join('\n');
  })).join('\n');
}

/* ---------- watchdog ---------- */
// Pulse and ping, broker upkeep, silence from the others, rebuilding direct links. Switching networks (Wi-Fi ↔
// mobile) breaks both the direct link and the broker connections. So: a short silence pauses the game and
// waits; brokers reconnect on their own; the direct link is rebuilt. Only a really long silence ends a link.
export function watch(N) {
  const now = performance.now(), gap = now - N.lastWatch, slept = gap > N.watchMs + 1300;
  N.lastWatch = now;
  if (N.closed) return;
  // Our own tab was asleep (phone locked, timers throttled): the silence was ours, not theirs.
  // Give the connections a few seconds to come back before judging the others. Away for longer than anyone
  // waits: they have let us go, so we find our way back (internet.js: longSleep).
  if (slept) {
    N.graceUntil = now + 5000;
    for (const P of N.peers.values()) P.lastSeen = now;
    kick(N);
    if (gap > N.lostAfter && N.longSleep) { N.longSleep(); return; }
  }
  if (N.relay) tendBrokers(N, now);
  holdOver(N, now);                                    // places kept too long go
  if (N.hubCheck) N.hubCheck(now);                     // a guest whose host is away: someone else takes over (internet.js)
  for (const P of linkedPeers(N)) watchPeer(P, now);
  if (N.closed) return;
  if (N.statsDue) { N.statsDue = false; N.emit('stats', N.roomStats()); }
  if (N.linked) N.emit('tick', now);
}

function watchPeer(P, now) {
  const N = P.N;
  if (N.probe) N.probe(P, now);
  if (dcLive(P) && now - P.statsAt > 2000) { P.statsAt = now; probeLink(P); }
  if (now - P.pingAt > 190) {
    P.pingAt = now; P.pN++;
    const p = pingMsg(P, now), dc = dcLive(P);
    if (dc) sendDirect(P, p);
    if (!dc || P.via !== 'p2p' || !dcFresh(P) || dcQuiet(P) || P.pN % 6 === 0) sendRelay(P, p);   // through the brokers when the game goes that way, the direct link is quiet, and now and then to measure
  }
  resend(P, now);
  if (now < N.graceUntil) return;
  const quiet = now - P.lastSeen;
  setWeak(P, quiet > 1500);                            // the game pauses: nobody plays on while someone cannot
  if (quiet > N.lostAfter) { N.peerGone(P); return; }   // silent as long as a place is kept: that tab is gone
  // a direct link that went quiet for long is closed; the guest then tries to build a new one
  // (not nearby: there the direct link cannot be rebuilt without the players)
  if (N.relay && dcLive(P) && now - (P.dcSeen || P.dcBorn) > 4000) closeRtc(P);
  if (N.relay && N.role === 'guest' && !P.pc && !P.weak && now >= P.rtcNext) {
    P.rtcNext = now + [4000, 8000, 15000, 30000][Math.min(P.rtcTries, 3)];
    P.rtcTries++;
    startRtc(P);
  }
  if (pickRoute(P) !== P.via || now - P.viaAt > 1000) N.refresh(P);
}

// this player went quiet or came back
export function setWeak(P, v) {
  if (P.weak === v) return;
  P.weak = v; P.weakAt = v ? P.lastSeen : 0;           // (silent since the last thing they sent)
  if (v) kick(P.N);                                    // silence: check our broker connections at once
  P.N.refresh(P);
  weakChanged(P.N);
}

// network changed, page came back, or silence: check the brokers now; a guest also retries the direct link soon
export function kick(N) {
  if (N.closed || !N.relay || !kickBrokers(N)) return;
  const H = N.role === 'guest' && hostPeer(N);
  if (H && H.linked) H.rtcNext = Math.min(H.rtcNext, performance.now() + 1500);
}

function pingMsg(P, now) {
  const N = P.N, m = { t: 'p', ts: Math.round(now * 10) / 10, a: P.rxNext - 1 };   // a: what we have of theirs
  const rt = netRtt(P);
  if (rt != null) m.rt = Math.round(rt);               // our measured ping: they show it too
  const extra = N.pulse && N.pulse(now);               // the game's own fields (see room.pulse)
  if (extra) m.g = extra;
  if (!N.relay) return m;
  if (dcLive(P) && !dcHear(P)) m.r = 1;                // "I can't hear you directly": both sides then also use the brokers
  if (!dcFresh(P)) { const w = bestBrokers(P); if (w.length) m.w = w; }   // which brokers bring your data to me first
  return m;
}

// A direct link went quiet: ask through the brokers right away (are they there?) instead of waiting for the next pulse.
export function keepDirectAlive(N, now) {
  if (!N.relay || N.closed) return;
  for (const P of linkedPeers(N)) {
    if ((dcQuiet(P) || (dcLive(P) && !dcFresh(P))) && now - P.nudged > 400) {
      P.nudged = now; P.pingAt = now;
      const p = pingMsg(P, now); sendDirect(P, p); sendRelay(P, p);
    }
  }
}
