// A fake WebRTC for worker tabs (tab.js, world option rtc): RTCPeerConnection with data channels between the tabs of
// one world, over a BroadcastChannel of its own. As much as library/net/rtc.js and nearby.js use: an offer and an
// answer (an SDP that only looks real: its ice-ufrag names the connection, so it survives a nearby code, code.js;
// a=x-fake-channels names the channels, else they are 'fast' and 'ctl'; signalling goes through the fake brokers or
// the codes), no ICE candidates as events, gathering complete at once, channels that open once both descriptions
// are set (what comes before ours opened waits for it, as on a real link), send and close, getStats with nothing in it.
// iceConnectionState: the answering side's goes 'connected' once its answer is set and the offerer's connection is there
// and live (its device answers the checks before it has read the answer: Chromium, ~2 s), and 'failed' (with its
// connectionState) when the offerer's closes before they connected; both sides' go 'connected' as their channels open.
// A message takes dcMs (5 ms); the ordered channel keeps its order, the unordered one ('fast') loses what the
// network's loss says. Both ends drop everything while either tab's network or direct links are off (fakenet.js:
// up, direct: a network switch, before the links fail); kill() closes this tab's links (the phone's OS dropped them),
// and the other end sees them close, after what was sent before (as on a real link). The links keep real time: their
// timers are the real ones, taken when this module loads (tab.js throttle holds back only the page's).

// (the real timers, before a tab can hold the page's back)
const { setTimeout } = globalThis;

/**
 * Install RTCPeerConnection on this worker's global.
 *   bus     the world's BroadcastChannel name (the links use bus + '/dc')
 *   pid     this tab (connection ids start with it)
 *   live()  whether our direct links work now; loss(): the chance that a 'fast' message is lost
 * → { kill(), count: { sent, lost } }
 */
export function install({ bus, pid, live, loss = () => 0, dcMs = 5 }) {
  const ch = new BroadcastChannel(bus + '/dc'), pcs = new Map(), count = { sent: 0, lost: 0 };
  let n = 0;
  const post = m => ch.postMessage(m);
  ch.onmessage = e => { const m = e.data || {}; const pc = pcs.get(m.to); if (pc) pc.recv(m); };
  const later = fn => setTimeout(fn, dcMs);

  class DataChannel {
    constructor(pc, label, { ordered = true } = {}) {
      Object.assign(this, { pc, label, ordered, readyState: 'connecting', onopen: null, onclose: null, onmessage: null, early: [] });
    }
    send(s) {
      if (this.readyState !== 'open') throw new Error('InvalidStateError: the channel is not open');
      if (typeof s !== 'string') throw new TypeError('fakertc: strings only');
      if (!live() || (!this.ordered && Math.random() < loss())) { count.lost++; return; }
      count.sent++;
      post({ to: this.pc.remote, label: this.label, s });
    }
    close() { if (this.readyState === 'closed') return; this.readyState = 'closed'; later(() => this.onclose && this.onclose()); }
  }

  // what a description says: its connection (ice-ufrag) and channels
  const sdp = (pc, type) => ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0', 'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0', 'a=candidate:1 1 udp 2122260223 192.168.77.' + (n % 250 + 1) + ' 50000 typ host generation 0', 'a=ice-ufrag:' + pc.id,
    'a=ice-pwd:fakertcfakertcfakertc00', 'a=fingerprint:sha-256 ' + Array(32).fill('AB').join(':'), 'a=setup:' + (type === 'offer' ? 'actpass' : 'active'),
    'a=mid:0', 'a=x-fake-channels:' + ([...pc.channels.keys()].join(',') || '-'), ''].join('\r\n');
  const line = (s, k) => (String(s).match(new RegExp('^a=' + k + ':(\\S+)', 'm')) || [])[1];

  class PeerConnection {
    constructor() {
      Object.assign(this, { id: pid + '#' + (++n), remote: null, labels: [], channels: new Map(), connectionState: 'new', signalingState: 'stable',
        iceGatheringState: 'new', iceConnectionState: 'new', localDescription: null, remoteDescription: null, onicecandidate: null, onconnectionstatechange: null,
        oniceconnectionstatechange: null, ondatachannel: null, checker: null });
      pcs.set(this.id, this);
    }
    createDataChannel(label, o) { const dc = new DataChannel(this, label, o); this.channels.set(label, dc); return dc; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: sdp(this, 'offer') }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: sdp(this, 'answer') }); }
    setLocalDescription(d) {
      this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; this.iceGatheringState = 'complete';
      if (d.type === 'answer' && this.remote && live()) post({ to: this.remote, from: this.id, check: true });   // (ICE: are they there?)
      return Promise.resolve();
    }
    addEventListener() {}
    setRemoteDescription(d) {
      const id = line(d.sdp, 'ice-ufrag'), labels = line(d.sdp, 'x-fake-channels') || 'fast,ctl';   // (a nearby code carries no channels)
      this.remoteDescription = d; this.remote = id;
      if (d.type === 'offer') { this.labels = labels.split(',').filter(l => l !== '-'); this.signalingState = 'have-remote-offer'; }
      else { this.signalingState = 'stable'; if (live()) { post({ to: id, from: this.id, connect: true }); this.open(); } }   // the offerer: both sides are set
      return Promise.resolve();
    }
    addIceCandidate() { return Promise.resolve(); }
    getStats() { return Promise.resolve(new Map()); }
    // what the other end sent: an ICE check (to the offerer, before it has read the answer: it answers while live) and its
    // answer, the connection (to the answering side: its channels come), its closing, or data
    recv(m) {
      if (m.check) { if (live()) { this.checker = m.from; post({ to: m.from, from: this.id, checked: true }); } return; }
      if (m.from && m.from !== this.remote) return;
      if (m.checked) { if (live() && this.connectionState === 'new') this.ice('connected'); return; }
      if (m.connect) {
        if (this.connectionState !== 'new') return;
        for (const l of this.labels) { const dc = this.createDataChannel(l, { ordered: l !== 'fast' }); if (this.ondatachannel) this.ondatachannel({ channel: dc }); }
        this.open();
      } else if (m.close) {                              // (after what came before it: dcMs, in order)
        // never connected, ICE had reached them: no more answers to its checks, ICE fails (and the connection with it)
        if (this.connectionState === 'new' && this.iceConnectionState === 'connected') later(() => { this.ice('failed'); this.state('failed'); });
        else later(() => this.end('closed'));
      }
      else if (live()) {
        const dc = this.channels.get(m.label);
        if (dc && dc.readyState === 'connecting') dc.early.push(m.s);   // sent the moment the other end opened: it waits for ours
        else if (dc && dc.readyState === 'open') later(() => { if (dc.readyState === 'open' && live() && dc.onmessage) dc.onmessage({ data: m.s }); });
      }
    }
    open() {
      this.ice('connected');
      this.state('connected');
      later(() => {
        for (const dc of this.channels.values()) if (this.connectionState === 'connected' && dc.readyState === 'connecting') { dc.readyState = 'open'; if (dc.onopen) dc.onopen(); }
        for (const dc of this.channels.values()) for (const s of dc.early.splice(0)) if (dc.readyState === 'open' && dc.onmessage) dc.onmessage({ data: s });
      });
    }
    state(s) { if (this.connectionState === s) return; this.connectionState = s; if (this.onconnectionstatechange) later(() => this.onconnectionstatechange && this.onconnectionstatechange()); }
    ice(s) { if (this.iceConnectionState === s) return; this.iceConnectionState = s; if (this.oniceconnectionstatechange) later(() => this.oniceconnectionstatechange && this.oniceconnectionstatechange()); }
    // the connection ends: its channels close (they hear it at once, the connection's state a moment later)
    end(s) {
      if (this.connectionState === 'closed') return;
      for (const dc of this.channels.values()) dc.close();
      this.state(s);
      pcs.delete(this.id);
    }
    close() {
      if (this.connectionState === 'closed') return;
      const to = this.remote || this.checker;            // (an offerer that has not read the answer: whoever checked it)
      if (to && live()) post({ to, from: this.id, close: true });
      this.iceConnectionState = 'closed';                // (closed by us: no event, as in a browser)
      this.end('closed');
    }
  }

  globalThis.RTCPeerConnection = PeerConnection;
  return { count, kill: () => { for (const pc of [...pcs.values()]) pc.close(); } };
}
