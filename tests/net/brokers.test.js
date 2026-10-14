// The brokers (library/net/brokers.js) one by one, in worker tabs (tests/support: fakenet.js impairs each broker on its
// own, lat and hear). Game data for a player goes through two brokers: those that deliver it to them first, by what they
// tell us, else the fastest to answer us; and every 24th packet through all four, so they can keep comparing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const NAMES = ['emqx', 'hivemq', 'eclipse', 'shiftr'];
const broker = url => NAMES.find(n => url.includes(n));
// the brokers each packet on topic went through (a packet: its number q), of those first seen between S.seen[from] and
// S.seen[to] → Map q → 'a+b' (sorted). (Its copies through the slower brokers come later: wait a while before asking.)
function through(S, topic, from, to) {
  const by = new Map();
  S.seen.forEach((x, i) => {
    if (x.topic !== topic || i < from || (i >= to && !by.has(x.m.q))) return;
    const s = by.get(x.m.q) || new Set();
    s.add(broker(x.url)); by.set(x.m.q, s);
  });
  return new Map([...by].map(([q, s]) => [q, [...s].sort().join('+')]));
}
const ALL = [...NAMES].sort().join('+');

test('a broker that delivers nothing to one player: the data goes through the others, nothing reliable lost', { timeout: 60000 }, async t => {
  const W = world(t), S = W.spy();
  const [A, B] = await room(W, 'brokers1', ['Аня', 'Богдан'], { net: { lat: [5, 40, 60, 80] } });
  const { topic } = await A.info('brokers1');
  const mb = topic + '/d/' + A.session + '/' + B.session;    // Аня's mailbox to Богдан
  await sleep(4000);
  const cut = S.seen.length;
  await sleep(200);                                          // (what is on its way through the slower brokers)
  const before = [...through(S, mb, 0, cut).values()];
  assert.ok(before.length >= 24, 'Аня sent Богдан data: ' + before.length + ' packets');
  assert.deepEqual([...new Set(before)].sort(), ['emqx+hivemq', ALL].sort(), 'through the two fastest, now and then through all: ' + before.join(' '));

  const deaf = S.seen.length;
  await B.net({ hear: [false, false, true, true] });         // EMQX and HiveMQ bring Богдан nothing from now on
  const t0 = Date.now();
  let first = null;
  for (let i = 0; i < 40; i++) {
    await A.send({ t: 'f', n: i }, { fast: true });
    if (i % 4 === 0) await A.send({ t: 'r', n: i / 4 });
    await sleep(100);
    if (first === null && (await B.got()).some(g => g.startsWith('Аня:f'))) first = Date.now() - t0;
  }
  assert.ok(first !== null && first < 3000, 'the first fast message within 3 s: ' + first + ' ms');
  const fast = async () => (await B.got()).filter(g => g.startsWith('Аня:f')).map(g => +g.split(':')[2]);
  assert.ok(await until(async () => new Set((await fast()).filter(n => n >= 30)).size === 10, 3000),
    'the last 10 fast ones all came: ' + (await fast()).join(' '));
  const reliable = async () => (await B.got()).filter(g => g.startsWith('Аня:r')).map(g => +g.split(':')[2]);
  assert.ok(await until(async () => (await reliable()).length === 10, 8000), 'all reliable ones: ' + (await reliable()).join(' '));
  assert.deepEqual(await reliable(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 'in order');
  // (two at a time: the one Богдан names first, then Аня's fastest; at least one he hears)
  const end = S.seen.length;
  await sleep(200);
  const after = [...through(S, mb, deaf, end).values()], late = after.slice(-20);
  assert.ok(late.every(x => /eclipse|shiftr/.test(x)), 'later packets go through a broker Богдан hears: ' + after.join(' '));
});
