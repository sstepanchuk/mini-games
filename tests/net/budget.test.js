// The relay budget (library/net/link.js; phase 2, H2), in worker tabs over fake brokers only (tests/support): through
// the brokers, fast messages that are not 'latest' start a publish to a player at most every 33 ms (about 30 a second);
// what comes meanwhile waits and goes in that one publish, all of it (nothing is dropped for the budget). 'latest'
// streams keep their own pace, reliable messages go at once and take whatever waits along. The room says 'budget'
// once; on the dev server the library's console says it once too.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, until, world } from '../support/world.js';

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

  test('\'latest\' streams keep their own pace; reliable messages go at once and take what waits along', T, async t => {
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
