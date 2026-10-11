// The nearby pairing code: a WebRTC description squeezed into a short code and rebuilt on the other side.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ANSWER, OFFER, decode, encode } from '../library/net/code.js';

const FP = '42:9D:66:50:97:A4:68:BC:E1:98:48:FE:58:01:CF:45:AE:A9:C1:C8:67:D9:AF:26:5B:1E:D0:72:C0:AE:25:D9';
const sdp = cands => ['v=0', 'o=- 1 2 IN IP4 127.0.0.1', 's=-', 't=0 0', 'a=group:BUNDLE 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel', 'c=IN IP4 0.0.0.0', ...cands,
  'a=ice-ufrag:u6yM', 'a=ice-pwd:zjzG8m6eB7MPaW+xTqOLT5nH', 'a=fingerprint:sha-256 ' + FP, 'a=setup:actpass', 'a=mid:0', ''].join('\r\n');

test('a description survives the trip, with the best candidates first', () => {
  const code = encode(sdp([
    'a=candidate:1 1 udp 2113937151 84f05c5a-8e80-473a-a480-f8ba795c47e6.local 43213 typ host generation 0',
    'a=candidate:2 1 udp 2113939711 fe80::1c2:3:4:5 50001 typ host generation 0',
    'a=candidate:3 1 tcp 1518280447 192.168.1.20 9 typ host tcptype active',   // TCP: not used
    'a=candidate:4 1 udp 2122260223 192.168.43.17 50000 typ host generation 0'
  ]), OFFER, 'ihroteka');
  assert.match(code, /^[A-Z2-7]+$/);                                          // QR alphanumeric mode
  assert.ok(code.length < 200, code.length);
  const { kind, sdp: back } = decode(code, 'ihroteka');
  assert.equal(kind, OFFER);
  const lines = back.split('\r\n');
  assert.ok(lines.includes('a=ice-ufrag:u6yM') && lines.includes('a=ice-pwd:zjzG8m6eB7MPaW+xTqOLT5nH'));
  assert.ok(lines.includes('a=fingerprint:sha-256 ' + FP) && lines.includes('a=setup:actpass') && lines.includes('a=mid:0'));
  const addrs = lines.filter(l => l.startsWith('a=candidate')).map(l => l.split(' ')[4]);
  assert.deepEqual(addrs, ['192.168.43.17', 'fe80:0:0:0:1c2:3:4:5', '84f05c5a-8e80-473a-a480-f8ba795c47e6.local']);
});

test('an answer is rebuilt as the active side', () => {
  const { kind, sdp: back } = decode(encode(sdp(['a=candidate:1 1 udp 1 10.0.0.2 4000 typ host']), ANSWER, 'ihroteka'), 'ihroteka');
  assert.equal(kind, ANSWER);
  assert.match(back, /a=setup:active/);
});

test('a code says how many addresses it offers', () => {
  const code = encode(sdp(['a=candidate:1 1 udp 1 192.168.0.7 4000 typ host']), OFFER, 'ihroteka');
  assert.equal(decode(code, 'ihroteka').candidates, 1);
});

test('codes of other games and garbage are refused', () => {
  const code = encode(sdp([]), OFFER, 'ihroteka');
  assert.throws(() => decode(code, 'other'), /game/);
  for (const bad of ['', 'HELLO', code.slice(0, 30), code.replace(/A/g, '1')]) assert.throws(() => decode(bad, 'ihroteka'));
});
