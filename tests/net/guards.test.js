// What a room believes only from whom it should (library/net/link.js, internet.js), in worker tabs over fake brokers
// (tests/support), with a spy who knows the room's code and publishes on its topic and mailboxes as anyone (a tab with a
// bug, an old one: a stranger without the code gets nothing opened at all, tests/net/seal.test.js): an acknowledgement
// above what was ever numbered, 'moved' from anyone but our host, data of another link attempt (k) and a hello older
// than the one that set the link's attempt are not acted on; data from a library without k still is.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, shows, sleep, until, world } from '../support/world.js';

globalThis.window ??= globalThis;                        // (config.js reads window: a session, the timing scale)
const { PROTO } = await import('../../library/net/config.js');

const T = { timeout: 30000 };
const mailbox = (topic, from, to) => topic + '/d/' + from + '/' + to;   // (brokers.js mailbox)

// (each test has its own network and tabs: they run side by side)
describe('the link\'s guards (phase 1a, A2)', { concurrency: 3 }, () => {
  test('an acknowledgement of more than was ever sent is ignored: the lost messages still go again', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'grd1', ['Аня', 'Богдан']);
    const { topic } = await A.info('grd1');
    const S = W.spy();
    await A.net({ send: false });                            // what Аня sends now is lost on the way
    await A.send({ t: 'r1' }); await A.send({ t: 'r2' });
    // "Богдан has everything up to a million", in a 'd' without k (as a library from before k would send it)
    S.publish(mailbox(topic, B.session, A.session), { t: 'd', to: A.session, d: [{ t: 'ak', a: 1e6 }] }, B.session);
    await sleep(300);
    await A.net({ send: true });
    assert.ok(await until(async () => (await B.got()).length >= 2, 3000), 'r1 and r2 arrive: ' + await B.got());
    assert.deepEqual(await B.got(), ['Аня:r1', 'Аня:r2']);
  });

  test('«moved» from a session that is not our host is ignored (a guest\'s session to the host, say)', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'grd2', ['Аня', 'Богдан', 'Сава']);
    const { topic } = await A.info('grd2');
    const S = W.spy();
    S.publish(topic, { t: 'moved', to: A.session }, B.session);   // as if the host were told by its guest to step aside
    S.publish(topic, { t: 'moved', to: C.session }, B.session);   // a guest, by another guest
    await sleep(800);
    assert.ok(await until(settled([A, B, C]), 2000), 'the room goes on as it was: ' + await shows([A, B, C]));
    assert.equal((await A.state()).role, 'host');
    S.publish(topic, { t: 'moved', to: C.session }, A.session);   // from the host itself it counts
    assert.ok(await until(async () => (await C.state()).role === 'out', 3000), await shows([A, B, C]));
  });

  test('data of another link attempt (k) is dropped; data without k (an older library) is taken; ours carries k', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'grd3', ['Аня', 'Богдан']);
    const { topic } = await A.info('grd3');
    const S = W.spy(), box = mailbox(topic, B.session, A.session);
    await sleep(500);                                        // (pulses: what Богдан's own data looks like)
    const ds = S.seen.filter(x => x.m.t === 'd' && x.m.f === B.session);
    assert.ok(ds.length && ds.every(x => Number.isInteger(x.m.k)), 'every \'d\' of Богдан\'s says its attempt');
    assert.equal(new Set(ds.map(x => x.m.k)).size, 1, 'one link, one attempt');
    // reliable messages numbered as if they were Богдан's next ones, and a fast one, from an attempt that is not this link's
    const stale = Array.from({ length: 300 }, (_, i) => ({ t: 'stale', _x: i + 1 }));
    S.publish(box, { t: 'd', to: A.session, k: 12345, d: [...stale, { t: 'stale', n: 0 }] }, B.session);
    await B.send({ t: 'ok', n: 1 });
    assert.ok(await until(async () => (await A.got()).length, 3000));
    await sleep(500);
    assert.deepEqual(await A.got(), ['Богдан:ok:1'], 'none of the other attempt\'s data');
    S.publish(box, { t: 'd', to: A.session, d: [{ t: 'old', n: 2 }] }, B.session);   // no k: as an older library sends it
    assert.ok(await until(async () => (await A.got()).includes('Богдан:old:2'), 3000), 'taken: ' + await A.got());
  });

  // (net-core-08: the host took a late hello of an older attempt for a new one: it started the link over on the old k,
  // both sides dropped each other's data, and the guest moved on after HOST_WAIT)
  test('a hello of an older attempt that the host opens late changes nothing (a slow broker, or a stranger sends it again)', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'grd4', ['Аня', 'Богдан']);
    const { topic } = await A.info('grd4');
    const S = W.spy(), X = W.spy({ stranger: true }), from = S.seen.length, xfrom = X.seen.length;
    const hellos = () => S.seen.slice(from).filter(x => x.m.t === 'hello' && x.m.f === B.session);
    await A.net({ hear: false });                            // Аня hears nothing for a while
    S.publish(topic, { t: 'host', to: B.session, c: 1, pv: PROTO, u: 1 }, A.session);   // (as Аня's restart says it) Богдан starts over: k1
    const h1 = await until(() => hellos()[0], 3000);
    assert.ok(h1, 'Богдан says hello on a new attempt');
    await sleep(300);                                        // (past the brokers: Аня never opens it)
    await A.net({ hear: true });
    S.publish(topic, { t: 'host', to: B.session, c: 1, pv: PROTO, u: 1 }, A.session);   // and over again: k2, heard
    assert.ok(await until(() => hellos().some(x => x.m.k !== h1.m.k), 3000), 'a hello on another attempt');
    await sleep(1500);
    assert.ok(await until(settled([A, B]), 5000), 'linked on k2: ' + await shows([A, B]));
    const n = [(await A.events()).length, (await B.events()).length];
    const rec = X.seen.slice(xfrom).find(x => x.raw === h1.raw);   // what a stranger recorded of k1's hello (it cannot read it)
    assert.ok(rec, 'the stranger has it');
    X.send(rec.topic, rec.raw);                              // Аня opens it only now
    await sleep(3000);                                       // (past WEAK twice: the link would have gone quiet both ways)
    assert.ok(await settled([A, B])(), 'the link goes on: ' + await shows([A, B]));
    assert.deepEqual([(await A.events()).slice(n[0]), (await B.events()).slice(n[1])], [[], []], 'nothing happens at all');
  });
});
