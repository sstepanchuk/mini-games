// A fake WebRTC for worker tabs (tab.js, world option rtc): RTCPeerConnection with data channels between the tabs of
// one world, over a BroadcastChannel of its own. As much as library/net/rtc.js uses: an offer and an answer (the
// "SDP" only names the connection and its channels; signalling still goes through the fake brokers), no ICE
// candidates, channels that open once both descriptions are set, send and close, getStats with nothing in it.
// A message takes dcMs (5 ms); the ordered channel keeps its order, the unordered one ('fast') loses what the
// network's loss says. Both ends drop everything while either tab's network or direct links are off (fakenet.js:
// up, direct: a network switch, before the links fail); kill() closes this tab's links (the phone's OS dropped them),
// and the other end sees them close.

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
      Object.assign(this, { pc, label, ordered, readyState: 'connecting', onopen: null, onclose: null, onmessage: null });
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

  class PeerConnection {
    constructor() {
      Object.assign(this, { id: pid + '#' + (++n), remote: null, labels: [], channels: new Map(), connectionState: 'new', signalingState: 'stable',
        localDescription: null, remoteDescription: null, onicecandidate: null, onconnectionstatechange: null, ondatachannel: null });
      pcs.set(this.id, this);
    }
    createDataChannel(label, o) { const dc = new DataChannel(this, label, o); this.channels.set(label, dc); return dc; }
    createOffer() { return Promise.resolve({ type: 'offer', sdp: 'fake ' + this.id + ' ' + [...this.channels.keys()].join(',') }); }
    createAnswer() { return Promise.resolve({ type: 'answer', sdp: 'fake ' + this.id }); }
    setLocalDescription(d) { this.localDescription = d; this.signalingState = d.type === 'offer' ? 'have-local-offer' : 'stable'; return Promise.resolve(); }
    setRemoteDescription(d) {
      const [, id, labels = ''] = String(d.sdp).split(' ');
      this.remoteDescription = d; this.remote = id;
      if (d.type === 'offer') { this.labels = labels.split(',').filter(Boolean); this.signalingState = 'have-remote-offer'; }
      else { this.signalingState = 'stable'; if (live()) { post({ to: id, from: this.id, connect: true }); this.open(); } }   // the offerer: both sides are set
      return Promise.resolve();
    }
    addIceCandidate() { return Promise.resolve(); }
    getStats() { return Promise.resolve(new Map()); }
    // what the other end sent: the connection (to the answering side: its channels come), its closing, or data
    recv(m) {
      if (m.from && m.from !== this.remote) return;
      if (m.connect) {
        if (this.connectionState !== 'new') return;
        for (const l of this.labels) { const dc = this.createDataChannel(l, { ordered: l !== 'fast' }); if (this.ondatachannel) this.ondatachannel({ channel: dc }); }
        this.open();
      } else if (m.close) this.end('closed');
      else if (live()) {
        const dc = this.channels.get(m.label);
        if (dc && dc.readyState === 'open') later(() => { if (dc.readyState === 'open' && live() && dc.onmessage) dc.onmessage({ data: m.s }); });
      }
    }
    open() {
      this.state('connected');
      later(() => { for (const dc of this.channels.values()) if (this.connectionState === 'connected' && dc.readyState === 'connecting') { dc.readyState = 'open'; if (dc.onopen) dc.onopen(); } });
    }
    state(s) { if (this.connectionState === s) return; this.connectionState = s; if (this.onconnectionstatechange) later(() => this.onconnectionstatechange && this.onconnectionstatechange()); }
    // the connection ends: its channels close (they hear it at once, the connection's state a moment later)
    end(s) {
      if (this.connectionState === 'closed') return;
      for (const dc of this.channels.values()) dc.close();
      this.state(s);
      pcs.delete(this.id);
    }
    close() {
      if (this.connectionState === 'closed') return;
      if (this.remote && live()) post({ to: this.remote, from: this.id, close: true });
      this.end('closed');
    }
  }

  globalThis.RTCPeerConnection = PeerConnection;
  return { count, kill: () => { for (const pc of [...pcs.values()]) pc.close(); } };
}
