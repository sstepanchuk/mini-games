// The relay budget (library/net/link.js; phase 2, H2; after the audit, phase 2: by bytes), in worker tabs over fake
// brokers only (tests/support): through the brokers, fast messages that are not 'latest' start a publish to a player at
// most every 33 ms (about 30 a second); what comes meanwhile waits and goes in that one publish, all of it (nothing is
// dropped for the budget). 'latest' streams keep their own pace. Reliable messages go together at the end of the task
// that sent them, in as few publishes as RELAY_BYTES allows (16 000 bytes of UTF-8 JSON each; one bigger message goes
// alone), and take whatever waits along; so does anything else that goes, in order. What waits for an acknowledgement
// goes again together, at most 32 KB a tick, and to a player we no longer hear only one now and then; heard again, they
// get everything they missed at once. The room says 'budget' once; on the dev server the library's console says it once too.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 30000 };
const mailbox = (topic, from, to) => topic + '/d/' + from + '/' + to;   // (brokers.js mailbox)
// The publishes (each to one to four brokers: one number q) from a to b that carry messages of type t, in order; only:
// those that carry nothing else (the ones these messages started: the others, a pulse or a ping's answer, went anyway
// and took them along).
const publishes = (S, topic, a, b, t, only = false) => {
  const seen = new Map();
  for (const x of S.seen) if (x.topic === mailbox(topic, a.session, b.session) && x.m.d.some(m => m.t === t) && (!only || x.m.d.every(m => m.t === t))) seen.set(x.m.q, x.m.d);
  return [...seen.values()];
};
const numbers = async (tab, t) => (await tab.call('log')).got.filter(([, m]) => m.t === t).map(([, m]) => m.n);
// the numbers q of those publishes (since index i of what the spy saw), in order
const numbersOf = (S, topic, a, b, t, i = 0) => [...new Set(S.seen.slice(i).filter(x => x.topic === mailbox(topic, a.session, b.session) && x.m.d.some(m => m.t === t)).map(x => x.m.q))].sort((x, y) => x - y);
const upTo = n => Array.from({ length: n }, (_, k) => k + 1);

describe('the relay budget (phase 2, H2)', { concurrency: 3 }, () => {
  test('fast messages: about 30 publishes a second at most; the rest go together, none lost', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud1', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud1');
    await A.sendAll(Array.from({ length: 200 }, (_, n) => ({ t: 'x', n })), { fast: true });   // 200 at once
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 200, 3000), 'all 200 arrive: ' + (await numbers(B, 'x')).length);
    const burst = publishes(S, topic, A, B, 'x');
    assert.equal(burst.length, 2, 'the first at once, the other 199 in the next publish');
    assert.equal(burst[1].filter(m => m.t === 'x').length, 199);
    // as fast as the test can send, for a second
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 1000) await A.send({ t: 'y', n: n++ }, { fast: true });
    assert.ok(await until(async () => (await numbers(B, 'y')).length === n, 3000), 'all ' + n + ' arrive: ' + (await numbers(B, 'y')).length);
    const p = publishes(S, topic, A, B, 'y', true).length, along = publishes(S, topic, A, B, 'y').length - p;
    assert.ok(n > 100, 'many sent: ' + n);
    assert.ok(p <= 32, n + ' messages in ' + p + ' publishes of their own (≤ 32 in a second), ' + along + ' more along with the link\'s own');
    assert.deepEqual((await A.events()).filter(e => e[1] === 'budget').length, 1, 'the room said budget, once');
  });

  test('\'latest\' streams keep their own pace; a reliable message goes at the end of the call that sent it and takes what waits along', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud2', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud2');
    const t0 = Date.now();
    let n = 0;
    while (Date.now() - t0 < 1000) await A.send({ t: 's', n: n++ }, { fast: true, latest: 's' });
    assert.ok(await until(async () => (await numbers(B, 's')).at(-1) === n - 1, 3000), 'the newest arrives');
    const p = publishes(S, topic, A, B, 's', true).length;
    assert.ok(p <= 32, n + ' states in ' + p + ' publishes of their own');
    assert.equal((await A.events()).filter(e => e[1] === 'budget').length, 0, '(the budget is for the other fast messages)');
    await A.sendAll([{ t: 'f', n: 1 }, { t: 'f', n: 2 }], { fast: true });   // the second waits…
    await A.send({ t: 'r', n: 1 });                                        // …and goes with this one, at once
    assert.ok(await until(async () => (await numbers(B, 'r')).length === 1, 2000));
    const withR = publishes(S, topic, A, B, 'r');
    assert.deepEqual(withR[0].map(m => m.t + m.n), ['f2', 'r1'], 'in the reliable one\'s publish: ' + JSON.stringify(withR));
    assert.deepEqual(await numbers(B, 'f'), [1, 2]);
  });

  test('on the dev server, the library\'s console says it once', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab', {}, { dev: true });
    await A.lib('bud3', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.lib('bud3', 'Богдан');
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 8000), 'both in the game');
    for (let k = 0; k < 2; k++) {
      for (let i = 0; i < 40; i++) assert.ok(await A.gsend({ t: 'x', n: k * 40 + i }, { fast: true }));
      await new Promise(r => setTimeout(r, 300));
    }
    assert.ok(await until(async () => (await B.game()).got.filter(([, m]) => m.t === 'x').length === 80, 3000), 'all 80 arrive');
    const said = (await A.takeErrors()).filter(e => /ihroteka\.room: through the brokers/.test(e));
    assert.equal(said.length, 1, 'once: ' + said);
    assert.ok((await A.state()).lib.trace.some(l => /room budget$/.test(l)), 'and the trace has it');
  });
});

// (after the audit, phase 2: each reliable message through the brokers used to be a publish of its own, sealed one by one
// in the room's one chain: a burst of thousands flooded the brokers and kept everything after it waiting; and what
// waited for the budget went in one publish of any size, which a broker over its packet limit drops whole)
describe('reliable messages through the brokers: together, by bytes', { concurrency: 3 }, () => {
  test('2000 small reliable messages in one call go in a few publishes, and arrive once and in order', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud6', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud6');
    await A.sendAll(upTo(2000).map(n => ({ t: 'x', n })));
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 2000, 10000), 'all arrive: ' + (await numbers(B, 'x')).length);
    await sleep(300);
    assert.deepEqual(await numbers(B, 'x'), upTo(2000), 'once each, in order');
    const p = numbersOf(S, topic, A, B, 'x').length;
    assert.ok(p <= 10, 'in ' + p + ' publishes (≤ 10)');
  });

  test('a fast message right after 300 reliable ones goes at once: the burst takes a publish or two before it', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud7', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud7');
    await A.sendAll(upTo(300).map(n => ({ t: 'x', n })));
    await A.send({ t: 'mark' }, { fast: true });
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 300 && (await B.got()).includes('Аня:mark'), 5000), 'all arrive');
    const burst = numbersOf(S, topic, A, B, 'x'), mark = numbersOf(S, topic, A, B, 'mark');
    assert.ok(burst.length <= 2, 'the burst in ' + burst.length + ' publishes (≤ 2)');
    assert.ok(mark.length === 1 && mark[0] - burst[0] <= 3, 'the marker\'s number ' + (mark[0] - burst[0]) + ' after the burst\'s first (≤ 3)');
  });

  // (bytes, not characters: a Cyrillic letter is 2 bytes of UTF-8; a budget counted in characters made publishes too big for
  // the broker, refused every time, and the link stalled for good)
  test('60 messages of 3000 Cyrillic letters under a 40 000-byte broker limit: together, none refused, all arrive', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud8', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud8');
    await A.net({ maxBytes: 40000 });
    const body = 'я'.repeat(3000);
    await A.sendAll(upTo(60).map(n => ({ t: 'x', n, body })));
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 60, 8000), 'all arrive: ' + (await numbers(B, 'x')).length);
    assert.deepEqual(await numbers(B, 'x'), upTo(60));
    assert.equal((await A.call('netState')).big, 0, 'no publish refused for its size');
    const p = numbersOf(S, topic, A, B, 'x').length;
    assert.ok(p <= 45, 'together: ' + p + ' publishes for 60 messages (≤ 45)');
  });

  test('40 messages of 2000 dashes (3 bytes each) under a 65 536-byte limit: together, none refused, all arrive', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud9', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud9');
    await A.net({ maxBytes: 65536 });
    const body = '—'.repeat(2000);
    await A.sendAll(upTo(40).map(n => ({ t: 'x', n, body })));
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 40, 8000), 'all arrive: ' + (await numbers(B, 'x')).length);
    assert.equal((await A.call('netState')).big, 0, 'no publish refused for its size');
    const p = numbersOf(S, topic, A, B, 'x').length;
    assert.ok(p <= 30, 'together: ' + p + ' publishes for 40 messages (≤ 30)');
  });

  test('400 fast messages waiting for the budget, then a reliable one: several publishes under a 64 000-byte limit, none refused', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud10', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud10');
    await A.net({ maxBytes: 64000 });
    const pad = 'ж'.repeat(110);
    await A.sendAll(Array.from({ length: 400 }, (_, n) => ({ t: 'f', n, pad })), { fast: true });   // the first at once, the rest wait…
    await A.send({ t: 'r', n: 1 });                                                                 // …and go with this one
    assert.ok(await until(async () => (await numbers(B, 'f')).length === 400 && (await numbers(B, 'r')).length === 1, 3000),
      'all arrive within 3 s: ' + (await numbers(B, 'f')).length + ' fast, ' + (await numbers(B, 'r')).length + ' reliable');
    assert.equal((await A.call('netState')).big, 0, 'no publish refused for its size');
    const p = numbersOf(S, topic, A, B, 'f').length;
    assert.ok(p > 2, 'the fast ones in ' + p + ' publishes (more than 2)');
  });

  test('a big \'latest\' state waiting for its turn and a big reliable message: each its own publish, both arrive', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'bud11', ['Аня', 'Богдан']);
    await A.net({ maxBytes: 64000 });
    const big = 'y'.repeat(20000);
    await A.sendAll([{ t: 's', n: 1, big }, { t: 's', n: 2, big }], { fast: true, latest: 's' });   // the second waits…
    await A.send({ t: 'r', n: 1, rel: 'z'.repeat(30000) });                                         // …and goes with this one
    assert.ok(await until(async () => (await numbers(B, 's')).includes(2) && (await numbers(B, 'r')).length === 1, 3000),
      'the reliable one and the newest state arrive: ' + (await B.got()).map(g => g.slice(0, 12)));
    assert.equal((await A.call('netState')).big, 0, 'no publish refused for its size');
  });

  test('a fast message behind 2000 reliable ones arrives within 300 ms', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'bud12', ['Аня', 'Богдан']);
    await A.sendAll(upTo(2000).map(n => ({ t: 'x', n })));
    const t0 = Date.now();
    await A.send({ t: 'mark' }, { fast: true });
    assert.ok(await until(async () => (await B.got()).includes('Аня:mark'), 3000, 5), 'it arrives');
    const ms = Date.now() - t0;
    assert.ok(ms <= 300, 'in ' + ms + ' ms (≤ 300)');
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 2000, 10000), 'and the reliable ones all');
  });
});

describe('the relay budget: what goes again', { concurrency: 2 }, () => {
  test('reliable messages waiting for an acknowledgement: sent again together, a few publishes a second', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud13', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud13');
    await B.net({ hear: false });                            // Богдан hears nothing (his pulses still come: not quiet)
    await A.sendAll(Array.from({ length: 300 }, (_, n) => ({ t: 'x', n })));
    await sleep(1000);
    const i = S.seen.length;
    await sleep(3000);
    const p = numbersOf(S, topic, A, B, 'x', i).length;
    assert.ok(p <= 30, 'sent again in 3 s: ' + p + ' publishes (≤ 30)');
    await B.net({ hear: true });
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 300, 5000), 'all arrive: ' + (await numbers(B, 'x')).length);
    await sleep(300);
    assert.deepEqual(await numbers(B, 'x'), Array.from({ length: 300 }, (_, n) => n), 'once each, in order');
  });

  test('a quiet player gets a probe now and then; back, everything they missed at once', T, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud14', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud14');
    await B.net({ up: false });                              // Богдан's network is gone: quiet to Аня after WEAK
    await A.sendAll(Array.from({ length: 300 }, (_, n) => ({ t: 'x', n, pad: 'я'.repeat(200) })));
    assert.ok(await until(async () => (await A.state()).weak, 3000), 'quiet');
    const i = S.seen.length;
    await sleep(3000);
    const p = numbersOf(S, topic, A, B, 'x', i).length;
    const again = new Set(S.seen.slice(i).filter(x => x.topic === mailbox(topic, A.session, B.session)).flatMap(x => x.m.d.filter(m => m.t === 'x').map(m => x.m.q + ':' + m.n))).size;
    assert.ok(p <= 4 && again <= 4, 'to a quiet player in 3 s: ' + p + ' publishes, ' + again + ' messages again (≤ 4 each)');
    await B.net({ up: true });
    assert.ok(await until(async () => (await numbers(B, 'x')).length === 300, 5000), 'all arrive within 5 s: ' + (await numbers(B, 'x')).length);
    await sleep(300);
    assert.deepEqual(await numbers(B, 'x'), Array.from({ length: 300 }, (_, n) => n), 'once each, in order');
  });

  // (the host's link starts over: the guest says hello again once it hears; meanwhile nothing is kept or sent again)
  test('a host whose outbox overflows for a guest that cannot hear: nothing goes again, nothing new is kept; heard again, the link starts over', { timeout: 60000 }, async t => {
    const W = world(t), S = W.spy();
    const [A, B] = await room(W, 'bud15', ['Аня', 'Богдан']);
    const { topic } = await A.info('bud15');
    const n = [(await A.events()).length, (await B.events()).length];
    await B.net({ hear: false });                            // (his pulses still come: Аня hears him, he hears nothing)
    await A.sendAll(Array.from({ length: 5001 }, (_, n) => ({ t: 'x', n })));
    await sleep(4000);                                       // (more than STALL with nothing acknowledged: the link starts over)
    await A.sendAll(Array.from({ length: 200 }, (_, n) => ({ t: 'y', n })));   // (kept for nobody)
    const i = S.seen.length;
    await sleep(2000);
    const again = S.seen.slice(i).filter(x => x.topic === mailbox(topic, A.session, B.session)).reduce((k, x) => k + x.m.d.filter(m => m.t === 'x' || m.t === 'y').length, 0);
    assert.equal(again, 0, 'reliable messages to him in 2 s');
    await B.net({ hear: true });
    const relinked = async (T, k, who) => (await T.events()).slice(k).some(e => e[1] === 'relinked' && e[2] === who);
    assert.ok(await until(async () => await relinked(A, n[0], 'Богдан') && await relinked(B, n[1], 'Аня'), 10000), 'both hear relinked: ' +
      JSON.stringify([(await A.events()).slice(n[0]), (await B.events()).slice(n[1])]));
    await sleep(300);
    await A.send({ t: 'z', n: 1 });
    assert.ok(await until(async () => (await B.got()).includes('Аня:z:1'), 5000), 'what goes after arrives');
    assert.equal((await numbers(B, 'y')).length, 0, 'nothing kept meanwhile');
  });
});
