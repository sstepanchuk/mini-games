// The brokers (library/net/brokers.js) one by one, in worker tabs (tests/support: fakenet.js impairs each broker on its
// own, lat and hear). Game data for a player goes through two brokers: those that deliver it to them first, by what they
// tell us, else the fastest to answer us; and every 24th packet through all four, so they can keep comparing. A
// connection is started over only when it brought nothing back since two echo tests ago (a zombie socket), never just
// because our own timers were held back (a hidden tab) or stopped (a frozen one): the room keeps its four connections.
import { describe, test } from 'node:test';
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

// (lifecycle-slow-webkit-03: tendBrokers started over every connection that had brought nothing for 12 s by the clock, so
// a hidden tab whose timers wake once a minute tore down four healthy ones at each wake, and said 'no-signal' meanwhile)
const opened = async X => (await X.call('netState')).opened;
const statuses = async (X, n) => (await X.events()).slice(n).filter(e => e[1] === 'status').map(e => e[2]);

describe('a connection starts over only when it brings nothing', { concurrency: 3 }, () => {
  // (wakes 20 s apart rather than Chrome's minute: longer than either rule, 12 s by the clock before and two echo tests 5 s
  // apart now, and 90 s less of npm test)
  test('a waiting host hidden, its timers waking only every 20 s (Chrome: once a minute): it keeps its four connections and never says no-signal', { timeout: 90000 }, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('brokers2', 'Аня');
    assert.ok(await until(async () => (await A.state()).status === 'waiting', 5000));
    await sleep(6000);                                       // (past the first echo tests)
    const o = await opened(A), n = (await A.events()).length;
    await A.hide(true);
    await A.throttle({ every: 20000 });                      // (as Chrome's intensive throttling of a hidden tab)
    await sleep(45000);                                      // (two wakes)
    assert.deepEqual(await opened(A), o, 'no connection started over while hidden');
    assert.deepEqual(await statuses(A, n), [], 'nothing said while hidden');
    await A.throttle({ every: 0 });
    await A.hide(false);
    await sleep(3000);
    assert.deepEqual(await opened(A), o, 'nor when shown again');
    assert.deepEqual(await statuses(A, n), [], 'and nothing said');
    const B = await W.tab('p2tab');
    await B.join('brokers2', 'Богдан');
    assert.ok(await until(async () => (await A.state()).linked && (await B.state()).linked, 5000), 'a friend finds the room');
  });

  test('a connection that brings nothing (a zombie socket): started over within 16 s, and only that one', { timeout: 40000 }, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('brokers3', 'Аня');
    assert.ok(await until(async () => (await A.state()).status === 'waiting', 5000));
    await sleep(7000);
    const o = await opened(A), n = (await A.events()).length;
    await A.net({ mute: [1] });                              // HiveMQ's connection stays up and brings nothing
    const t0 = Date.now();
    assert.ok(await until(async () => (await opened(A))[1] > o[1], 16000, 100), 'HiveMQ\'s started over: ' + (await opened(A)).join());
    assert.ok(Date.now() - t0 > 5000, 'not at the first echo test (' + (Date.now() - t0) + ' ms): one may be on its way');
    await sleep(1000);
    assert.deepEqual((await opened(A)).map((x, i) => x - o[i]), [0, 1, 0, 0], 'only that one');
    assert.deepEqual(await statuses(A, n), [], 'nothing said: the others work');
  });

  test('a waiting host frozen 15 s (a locked phone): awake, it keeps its four connections', { timeout: 40000 }, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('brokers4', 'Аня');
    assert.ok(await until(async () => (await A.state()).status === 'waiting', 5000));
    await sleep(6000);
    const o = await opened(A), n = (await A.events()).length;
    await A.freeze(15000);
    await sleep(4000);                                       // (the check after a sleep: kickBrokers' echo, 2.5 s)
    assert.deepEqual(await opened(A), o, 'none started over: they answer');
    assert.deepEqual(await statuses(A, n), [], 'nothing said');
  });
});
