// Delivery between us and one other player (a peer P, see room.js) over two paths: direct (WebRTC) and through
// the brokers. Each path's ping is measured on its own and all the time; messages take the faster one. Usually
// that is the direct path, but a "direct" link through a far-away TURN relay can be slower than the brokers.
//
// Messages are plain objects with a string `t` ('p', 'q', 'ak', 'bye' and those starting with '_' are the room's
// own: room.js RESERVED). Fast ones may be lost or reordered — the game numbers them itself if it cares. Reliable
// ones really are: each gets a number `_x` and stays in our outbox until the other side acknowledges it (`a` in
// every pulse: "I have everything up to here"); until then it is sent again, by whatever path works, with growing
// pauses. So nothing is lost to a dead direct link, brokers that are reconnecting, or a phone that was offline for
// a minute. The receiver runs them exactly once and in order: a message that overtook a missing one waits for it.
// That holds for one link: when a link starts over (a new one with the same player, or more than OUTBOX_MAX waiting
// with none acknowledged for STALL ms: the mode's restart), what was not acknowledged is gone, and the room says
// 'relinked' so that the game sends the full picture again. (A burst of more than OUTBOX_MAX on a link that keeps
// acknowledging is fine: it only bounds memory, at ten times that.)
// A reliable message becomes JSON once, before it gets its number (wire): one that cannot (a cycle, a BigInt)
// throws a TypeError at the call and takes no number, so nothing after it waits for it; and what is kept and sent
// again is that JSON read back, which a later change to the caller's object cannot touch.
// The relay budget (the public brokers throttle or ban whoever floods them): through the brokers, each 'latest' stream
// goes at most every RELAY_EVERY ms, and the other fast messages start a publish at most every FAST_EVERY ms per
// player (about 30 a second): what comes meanwhile waits and goes then, split only by RELAY_BYTES (the room says
// 'budget', once).
// Reliable messages go together at the end of the task that sent them (soon), in as few publishes as RELAY_BYTES allows
// (bytes of UTF-8, not characters; one bigger message goes alone); the link's own (acknowledgements, pings) go at once.
// Whatever goes takes everything waiting along, in order. What is not acknowledged goes again together, at most
// RESEND_BYTES a tick; to a player we no longer hear, only the oldest now and then, and everything at once when they
// are back.
import { BROKERS, TIMING } from './config.js';
import { bestBrokers, brokerDiag, kickBrokers, pubData, tendBrokers } from './brokers.js';
import { closeRtc, dcFresh, dcHear, dcLive, dcQuiet, probeLink, startRtc } from './rtc.js';
import { awaySince, holdOver, hostPeer, linkedPeers, stop, weakChanged } from './room.js';

const RELAY_EVERY = 33;                                // a "latest" stream goes through the brokers at most this often, ms
const FAST_EVERY = 33;                                 // other fast messages start a publish to one player at most this often, ms
const RELAY_BYTES = 16000;                             // a publish through the brokers carries at most this much JSON (one bigger message: alone)
const ACK_DELAY = 25;                                  // reliable messages that came: say so this soon (with the next ones)
const OUTBOX_MAX = 5000;                               // reliable messages not yet acknowledged: more, none acknowledged for STALL, and the link starts over
const STALL = 3000;                                    // more than OUTBOX_MAX waiting and none of ours acknowledged this long, ms
const HOLD_MAX = 4096;                                 // messages that overtook a missing one, waiting for it
const RESEND_BYTES = 32768;                            // what goes again: at most this much of its JSON per tick (the oldest first)
const ALIVE_EVERY = 50;                                // while a game is played: a quiet direct link is asked about this often, ms (tendAlive)
const TE = new TextEncoder();
const bytes = m => TE.encode(JSON.stringify(m)).length;   // a message's JSON in UTF-8 (a Cyrillic letter: 2 bytes)

// a new link with this player (or the same person in a new tab): measurements and numbering start over
export function resetPaths(P) {
  P.tx = 0; P.outbox = []; P.ackAt = 0; P.resendAt = -1e9; P.overfull = false; P.rxNext = 1; P.rxHold = new Map(); P.byeX = 0;
  P.pts = -1; P.suspect = -1e9;
  P.rD = P.rR = null; P.sD = []; P.sR = []; P.qD = P.qR = -1; P.slowDirect = false; P.peerRtt = null; P.aliveAt = 0;
}
// the direct link closed (rtc.js closeRtc): the brokers carry everything, and its ping is measured anew on the next one
export function directGone(P) {
  P.via = 'relay'; P.rD = null; P.sD = []; P.slowDirect = false;
}
// a link that carries nothing more (nearby.js broke): what waits for an acknowledgement, or for a missing one, is dropped
export function dropReliable(P) {
  P.outbox = []; P.rxHold.clear();
}

/* ---------- sending ---------- */
// fast: unordered, may be lost (state, aim). latest (with fast): each one makes the previous one of its stream
// useless (a full state, say): through the brokers only the newest goes, at most every RELAY_EVERY ms — less
// traffic, and nothing waits behind older ones. latest: true or a stream name.
export function send(P, m, { fast = false, latest = false } = {}) {
  const N = P.N;
  if (N.closed || !P.linked || (!N.relay && !P.pc)) return;   // (nearby, a link whose direct link closed carries nothing more: pairing again makes a new one)
  if (!fast) {
    m = wire(m);                                       // (throws before it takes a number)
    if (P.overfull) return;                            // (the link starts over: nothing new is kept for it; 'relinked' brings it all)
    m._x = ++P.tx;                                     // (a copy of its own: the same message may go to several players)
    const now = performance.now();
    if (!P.outbox.length) P.ackAt = now;               // (we wait for an acknowledgement from now on)
    P.outbox.push({ m, at: now, n: 1, b: bytes(m) + 1 });   // (more than OUTBOX_MAX not acknowledged: see watchPeer)
  }
  transmit(P, m, fast, fast && latest ? (latest === true ? '' : String(latest)) : null);
}
// A reliable message as it travels: its JSON read back, a copy nobody else holds. One that cannot become JSON (a
// cycle, a BigInt), or does not come back as an object with a string t (a toJSON that says otherwise), is a
// TypeError, thrown at the call.
export function wire(m) {
  let c;
  try { const s = JSON.stringify(m); c = s === undefined ? null : JSON.parse(s); } catch (e) { throw new TypeError('room: a reliable message must become JSON (' + e.message + ')'); }
  if (!c || typeof c !== 'object' || Array.isArray(c) || typeof c.t !== 'string') throw new TypeError('room: a reliable message must become JSON: an object with a string t');
  return c;
}
// by the path in use; while the direct link is not sure, through the brokers as well
function transmit(P, m, fast, stream) {
  const N = P.N;
  if (!N.relay) { dcSend(P, m, fast); return; }       // nearby: the direct link is all there is
  if (dcLive(P) && P.via === 'p2p') {
    dcSend(P, m, fast);
    if (dcFresh(P)) return;                            // the direct link is alive: that is enough
  }
  // through the brokers (no direct path, it went quiet, or it is slower), within the relay budget (see the top)
  if (!fast) { P.q.push(m); soon(P); return; }        // (at the end of this task, with whatever else goes to them in it)
  const now = performance.now();
  let wait;
  if (stream === null) {
    P.q.push(m); P.qFast++;
    wait = FAST_EVERY - (now - P.fastAt);
    if (wait > 0 && !N.budgetSaid) { N.budgetSaid = true; N.emit('budget'); }
  } else {
    P.qLatest.set(stream, m);                          // replaces an older one still waiting
    wait = RELAY_EVERY - (now - P.relayAt);
  }
  if (wait <= 0) { flushRelay(P); return; }
  if (P.qTimer && P.qDue <= now + wait) return;        // (a flush comes soon enough)
  clearTimeout(P.qTimer);
  P.qDue = now + wait; P.qTimer = setTimeout(() => flushRelay(P), wait);
}
// The other side has everything up to `a`: those leave the outbox. (More than we ever numbered is not an answer
// to us: a stranger, or an acknowledgement from before our numbering started over.)
function acked(P, a) {
  if (!Number.isInteger(a) || a > P.tx) return;
  let i = 0;
  while (i < P.outbox.length && P.outbox[i].m._x <= a) i++;
  if (i) { P.outbox.splice(0, i); P.ackAt = performance.now(); }
}
// Reliable messages not acknowledged in time go again: after twice the round trip (at least 300 ms), then with
// longer and longer pauses (up to 4×), the oldest first, at most RESEND_BYTES a tick, together (through the brokers: in
// as few publishes as RELAY_BYTES allows). To a player we no longer hear (weak), only the oldest that is due, once in
// 4 such pauses (they most likely cannot hear us either); heard again, everything they miss goes at once (setWeak).
// Nothing to a link that starts over (overfull).
function resend(P, now) {
  if (!P.outbox.length || P.overfull) return;
  const rtt = curRtt(P), rto = Math.max(300, (rtt == null ? 300 : rtt) * 2 + 100);
  if (P.weak && now - P.resendAt < 4 * rto) return;
  const q0 = P.q.length;
  let b = 0;
  for (const e of P.outbox) {
    if (now - e.at < rto * Math.min(e.n, 4)) continue;
    e.at = now; e.n++;
    transmit(P, e.m, false, null);
    if (P.weak) { P.resendAt = now; break; }           // (a probe: the oldest alone)
    b += e.b;
    if (b >= RESEND_BYTES) break;
  }
  if (P.q.length > q0) flushRelay(P);                  // (this tick's, together)
}
// Over the direct link, while both its channels are open: fast ones on 'fast', the rest on 'ctl' (rtc.js). One the
// channel refuses is lost here: a reliable one goes again (resend).
export function dcSend(P, m, fast) { if (dcLive(P)) { try { (fast ? P.dcF : P.dcC).send(JSON.stringify(m)); } catch (e) {} } }
function sendDirect(P, m) { dcSend(P, m, true); }
function sendRelay(P, m) { if (P.linked && P.N.relay) { P.q.push(m); flushRelay(P); } }
// Reliable messages through the brokers go at the end of the task that sent them, together: a burst, or a tick's
// resends, is a few publishes (each publish is sealed in the room's one chain, brokers.js: one per message flooded the
// brokers and kept a hello or a pulse behind thousands of them). Whatever ends the link or the page in the same task
// flushes first (room.js unlink, leave, pagehide).
function soon(P) {
  if (P.qSoon) return;
  P.qSoon = true;
  queueMicrotask(() => { if (P.qSoon) flushRelay(P); });   // (a flush meanwhile took them: qSoon is off)
}
// Everything waiting for the brokers goes now, in order, in publishes of at most RELAY_BYTES (measured only when more
// than one waits; one bigger message goes alone): a broker drops a packet over its limit whole.
export function flushRelay(P) {
  clearTimeout(P.qTimer); P.qTimer = null; P.qSoon = false;
  if (P.qLatest.size) {                                // the newest of each stream rides along
    for (const m of P.qLatest.values()) P.q.push(m);
    P.qLatest.clear(); P.relayAt = performance.now();
  }
  if (P.qFast) { P.qFast = 0; P.fastAt = performance.now(); }
  if (!P.q.length || !P.N.relay) return;
  const all = P.q; P.q = [];
  if (P.N.closed) return;
  let d = [], size = 0;
  for (const m of all) {
    const b = all.length > 1 ? bytes(m) + 1 : 0;
    if (d.length && size + b > RELAY_BYTES) { relay(P, d); d = []; size = 0; }
    d.push(m); size += b;
  }
  relay(P, d);
}
const relay = (P, d) => pubData(P.N, P, { t: 'd', to: P.id, d, k: P.k });   // k: the link's attempt (internet.js drops another one's)

/* ---------- receiving ---------- */
export function deliver(P, m, viaRelay) {
  const N = P.N;
  if (N.closed || !P.linked || !m || typeof m !== 'object' || typeof m.t !== 'string') return;
  const now = performance.now();
  P.lastSeen = now;
  if (now - N.heardAt > N.stall) N.stall = now - N.heardAt;   // the longest the page heard nothing since the last tick (watch)
  N.heardAt = now;
  const x = m._x;
  if (x === undefined) { signals(P, m, viaRelay, now); return; }   // fast: pulses, ping answers, the game's own
  if (!Number.isInteger(x) || x < P.rxNext) return;   // a copy that came by the other path, or a resend we already have
  if (m.t === 'bye' && P.byeX !== x) {                 // their tab closed (menu: they left for good): at once, whatever is missing
    P.byeX = x;                                        // (it still takes its place in the order below, or nothing after it would run)
    N.byeFrom(P, m.menu === 1, m.moved === 1);
    if (N.closed || !P.linked) return;
  }
  ackSoon(P);                                          // (also for one that waits: they learn what we still miss)
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

// Say soon which reliable messages we have, instead of waiting for the next pulse (up to 190 ms): the sender's
// outbox empties and nothing is sent again for nothing. One answer covers everything that came meanwhile.
function ackSoon(P) {
  if (P.ackTimer) return;
  P.ackTimer = setTimeout(() => {
    P.ackTimer = null;
    if (!P.linked || P.N.closed) return;
    const m = { t: 'ak', a: P.rxNext - 1 };
    if (dcLive(P) && (!P.N.relay || dcFresh(P))) sendDirect(P, m); else sendRelay(P, m);
  }, ACK_DELAY);
}

// the link's own fast messages: pulse and ping (p), ping answer (q), "I have your messages up to a" (ak);
// anything else fast is the game's (its fields mean nothing to the link: r and w count only in a pulse)
function signals(P, m, viaRelay, now) {
  const N = P.N;
  if (m.t === 'ak') { acked(P, m.a); return; }        // they have our reliable messages up to a
  if (m.t === 'p') {                                   // pulse and ping
    if (m.r === 1) P.suspect = now;                    // they say they cannot hear us directly
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

// One-way delay estimate: half the round trip of the path in use, as our own messages make it (the median of the
// last few pings). Not the browser's network measurement: a message also waits in the other phone's busy page and
// in the data channel's queue, and a game evens out what the players actually get.
export function lag(P) {
  const r = P.linked ? curRtt(P) : null;
  return r == null ? 0 : Math.min(300, r / 2);
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
  const head = ['room: ' + (N.relay ? 'internet' : 'nearby') + ', role: ' + (N.role || '—') + ', players: ' + N.members.map(m => m.n + (awaySince(N, m) ? ' (away)' : '')).join(', ') + ' (at most ' + N.max + ')'];
  if (N.relay) head.push('brokers' + (N.keyMs != null ? ' (sealed; the key took ' + Math.round(N.keyMs) + ' ms)' : '') + ': ' + brokerDiag(N));
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
  const now = performance.now(), gap = now - N.lastWatch;
  // A tick this late while the page heard someone at least every SLEEP meanwhile (N.stall) is no sleep: only our timers
  // were held back (a hidden tab the browser wakes once a minute, its sockets alive), the page itself ran and heard them.
  const ran = Math.max(N.stall, now - N.heardAt) <= TIMING.SLEEP, slept = gap > N.watchMs + TIMING.SLEEP && !ran;
  N.lastWatch = now; N.heardAt = now; N.stall = 0;
  if (N.closed) return;
  // Our own tab was asleep (phone locked, tab frozen): the silence was ours, not theirs.
  // Give the connections a few seconds to come back before judging the others. Away for longer than anyone
  // waits for the room's host: the others may have moved on, so the mode finds our way back (longSleep; true: it
  // started over).
  if (slept) {
    N.graceUntil = now + TIMING.GRACE;
    for (const P of N.peers.values()) P.lastSeen = now;
    kick(N);
    if (gap > TIMING.HOST_WAIT && N.longSleep(gap)) return;
  }
  if (N.relay) tendBrokers(N, now);
  tendAlive(N);
  holdOver(N, now);                                    // places kept too long go
  N.hubCheck(now);                                     // a guest whose host is away: someone else takes over (internet.js)
  for (const P of linkedPeers(N)) watchPeer(P, now);
  if (N.closed) return;
  if (N.statsDue) { N.statsDue = false; N.emit('stats', N.roomStats()); }
  if (N.linked) N.emit('tick', now);
}

function watchPeer(P, now) {
  const N = P.N;
  N.probe(P, now);                                     // e.g. a guest asks a quiet host whether we are still together
  if (dcLive(P) && now - P.statsAt > 2000) { P.statsAt = now; probeLink(P); }
  if (now - P.pingAt > 190) {
    P.pingAt = now; P.pN++;
    const p = pingMsg(P, now), dc = dcLive(P);
    if (dc) sendDirect(P, p);
    if (!dc || P.via !== 'p2p' || !dcFresh(P) || dcQuiet(P) || P.pN % 6 === 0) sendRelay(P, p);   // through the brokers when the game goes that way, the direct link is quiet, and now and then to measure
  }
  // they have not heard us for ages (or the link is overfull: the mode's restart said so): the link starts over (the
  // mode's; each tick until it has). Ten times OUTBOX_MAX waiting starts it over anyway (memory), acknowledged or not.
  if (P.overfull || (P.outbox.length > OUTBOX_MAX && now - P.ackAt > STALL) || P.outbox.length > OUTBOX_MAX * 10) N.restart(P);
  if (N.closed || !P.linked) return;
  resend(P, now);
  if (now < N.graceUntil) return;
  const quiet = now - P.lastSeen;
  setWeak(P, quiet > TIMING.WEAK);                     // the game pauses: nobody plays on while someone cannot
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
  else for (const e of P.outbox) e.at = -1e9;          // heard again: everything they miss goes at the next tick (resend)
  P.N.refresh(P);
  weakChanged(P.N);
}

// network changed, page came back, or silence: check the brokers now; a guest also retries the direct link soon.
// force: whatever was checked a moment ago (the browser is online again, or its network type changed: brokers.js)
export function kick(N, force = false) {
  if (N.closed || !N.relay || !kickBrokers(N, force)) return;
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

// While a game is played here (N.playing: the library's open game has someone to play with), the page is visible, the
// brokers work (internet rooms) and a direct link is open, the room asks about a quiet direct link by itself every
// ALIVE_EVERY ms (keepDirectAlive), as a game's room.frame(now) would each frame, so the game need not: a direct link
// gone dead moves to the brokers in about 0.7 s (measured: some 0.05–0.07 s sooner than the watchdog alone, see
// docs/ROADMAP.md, phase 2). No such timer anywhere else (the shelf, an idle room, a hidden page, a nearby room).
// Asked each watchdog tick, and when the page is hidden or shown. → whether it runs
export function tendAlive(N) {
  const on = !N.closed && N.relay && N.up && !document.hidden && N.playing() && linkedPeers(N).some(dcLive);
  if (on && !N.aliveTimer) N.aliveTimer = setInterval(() => { if (tendAlive(N)) keepDirectAlive(N); }, ALIVE_EVERY);
  else if (!on && N.aliveTimer) stop(N, 'aliveTimer');
  return on;
}
// A direct link went quiet: ask through the brokers right away (are they there?) instead of waiting for the next pulse,
// at most every 400 ms. By our own clock: a game's frame time (room.frame(now)) runs on its frame's, which started
// later. The regular pulse still goes on time (it says what changed since: r, that we cannot hear them directly).
export function keepDirectAlive(N) {
  if (!N.relay || N.closed) return;
  const now = performance.now();
  for (const P of linkedPeers(N)) {
    if ((dcQuiet(P) || (dcLive(P) && !dcFresh(P))) && now - P.nudged > 400) {
      P.nudged = now;
      const p = pingMsg(P, now); sendDirect(P, p); sendRelay(P, p);
    }
  }
}
