// Where rooms meet and who we are: public MQTT brokers (signalling and fallback transport), STUN/TURN for
// direct links, the room's timing, session ids and room codes.

// Four brokers, so one outage does not matter: both players only need one broker in common.
// Two listen on port 443, which even strict networks (office Wi-Fi, some mobile carriers) leave open.
export const BROKERS = [
  { name: 'EMQX', url: 'wss://broker.emqx.io:8084/mqtt' },
  { name: 'HiveMQ', url: 'wss://broker.hivemq.com:8884/mqtt' },
  { name: 'Eclipse', url: 'wss://mqtt.eclipseprojects.io/mqtt' },
  { name: 'Shiftr', url: 'wss://public.cloud.shiftr.io', user: 'public', pass: 'public' }
];

// The MQTT client runs on the library's origin, so it is pinned to one exact file: the browser refuses
// anything whose hash differs. To upgrade: npm pack mqtt@<version>, then
// echo sha384-$(openssl dgst -sha384 -binary package/dist/mqtt.min.js | base64)
export const MQTT_LIB = {
  urls: ['https://cdn.jsdelivr.net/npm/mqtt@5.16.0/dist/mqtt.min.js', 'https://unpkg.com/mqtt@5.16.0/dist/mqtt.min.js'],
  integrity: 'sha384-9WWboT9UtuPFRlOLq4FygQkcJxzYcpz8SXGkNyCEXM+44n14xzjNlrRKYZwuF/A6'
};

// Your own TURN relay (optional). When two players cannot connect directly, traffic goes through a relay;
// the closer it is, the lower the ping. A free metered.ca account gives one near you: paste its URLs and
// credentials ("TURN Credentials") here.
const MY_TURN = { urls: [], username: '', credential: '' };

export const ICE = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
  // public Open Relay TURN (the PeerJS server used earlier was shut down in 2023)
  { urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turn:openrelay.metered.ca:443?transport=tcp'], username: 'openrelayproject', credential: 'openrelayproject' }
].concat(MY_TURN.username ? [MY_TURN] : []);

// How long the room waits, ms. The order matters and is checked here, at load (WEAK < GRACE < HOST_WAIT <=
// AUTH_WAIT < HOLD): a quiet player pauses the game first; the room's host moves on no later than a round's runner;
// a place goes long after both. window.__timeScale (tests only: set before the library loads) scales them all,
// and only them: the pulse and the watchdog's 200 ms do not scale, so below about 0.3 a linked player goes weak
// between two pulses (measured idle, two tabs: at 0.1 the host paused 7 times in 8 s; at 0.3 never).
const BASE = {
  WEAK: 1500,                                          // a player silent this long is weak: the game pauses (link.js)
  SLEEP: 1300,                                         // a watchdog tick this much later than due: our own tab was asleep (link.js)
  GRACE: 5000,                                         // after our tab slept, nobody is judged this long (link.js)
  HOST_WAIT: 10000,                                    // the room's host away this long: the first player here takes over (internet.js)
  AUTH_WAIT: 10000,                                    // a round's runner away this long: the first player here runs it on (app/together.js)
  HOLD: 180000,                                        // a player who dropped out keeps their place this long; a link silent this long is gone
  VERSION: 25000                                       // another library version not heard this long is forgotten (room.js otherVersion:
                                                       //   longer than two of a host's announcements with guests, 10 s apart; outside the order)
};
const SCALE = Number.isFinite(window.__timeScale) && window.__timeScale > 0 ? window.__timeScale : 1;
export const TIMING = Object.freeze(Object.fromEntries(Object.entries(BASE).map(([k, v]) => [k, v * SCALE])));
if (!(TIMING.WEAK < TIMING.GRACE && TIMING.GRACE < TIMING.HOST_WAIT && TIMING.HOST_WAIT <= TIMING.AUTH_WAIT && TIMING.AUTH_WAIT < TIMING.HOLD)) {
  throw new Error('net: TIMING must keep WEAK < GRACE < HOST_WAIT <= AUTH_WAIT < HOLD');
}

// The library's wire version, said in every handshake as pv (internet: who, host, hello, hi; nearby: _h). Bump it
// by hand, and only when what the libraries say to each other changes meaning: never per build, so friends whose
// pages differ only in other ways still play together. Two players whose versions differ are not linked: the room
// says status 'version', and room.versionMismatch is their number (room.js). A handshake without pv comes from a
// library older than the number: it speaks version 1 (the wire of the release that introduced the number, whose
// changes an old library ignores; see the headers of internet.js and nearby.js).
export const PROTO = 1;
// the version a handshake says it speaks: 1 when it says none; null when pv is not a version at all
export const pvOf = m => m.pv === undefined ? 1 : Number.isSafeInteger(m.pv) && m.pv > 0 ? m.pv : null;

const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';      // no look-alikes (0/o, 1/l)
const code = n => Array.from({ length: n }, () => ABC[Math.floor(Math.random() * ABC.length)]).join('');

// Room codes: short enough to read out loud, long enough not to collide with strangers.
export const newRoomCode = () => code(6);
export const validRoomCode = r => typeof r === 'string' && /^[a-z0-9]{6,12}$/.test(r);

// This tab's session: how the brokers and links tell tabs apart. (Players are known by name, see room.js.)
// window.__pid sets its first part (tests).
export const me = (window.__pid || code(12)) + '.' + code(6);
export const SENDER = /^[a-z0-9]{4,32}\.[a-z0-9]{4,12}$/;   // what a session id looks like

// The room's topic on the public brokers. Only a hash of game + code goes there, so someone listening to
// every topic learns no room codes. They do see the room's messages, though, and nothing is signed: whoever
// watches a room's topic could join that room or disturb it.
export async function roomTopic(game, room) {
  try {
    const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(game + ':' + room)));
    return 'ihroteka/' + Array.from(h.subarray(0, 16), b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) { return 'ihroteka/' + game + '/' + room; }   // no Web Crypto (page not served over https)
}
