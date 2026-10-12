// Delivery on a room's links (library/net/link.js), in worker tabs over fake brokers (tests/support): reliable
// messages arrive exactly once and in order across an outage, the host's outage and a lossy network; a 'latest'
// stream sends only its newest. The known bugs are { todo } tests of what should happen; phase 1 turns them green.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const seq = (from, n) => Array.from({ length: n }, (_, i) => from + i + 1);
// the numbers a tab got from one player, in the order they came
const numbers = async (tab, from) => (await tab.got()).filter(g => g.startsWith(from + ':')).map(g => +g.split(':')[2]);

// (each test has its own network and tabs: they run side by side)
describe('delivery on a link: reliable, lossy, latest', { concurrency: 3 }, () => {
  // Аня sends 1…20 and Сава 101…120, one by one, while `who` is offline for 3 s; then everyone must have everything
  // from everyone else, in order, once.
  async function outage(A, B, C, who) {
    await who.net({ up: false });
    for (let i = 1; i <= 20; i++) {
      await A.send({ t: 'x', n: i });
      await C.send({ t: 'x', n: 100 + i });
      await sleep(150);
    }
    await who.net({ up: true });
    const want = [[A, 'Сава', seq(100, 20)], [B, 'Аня', seq(0, 20)], [B, 'Сава', seq(100, 20)], [C, 'Аня', seq(0, 20)]];
    const all = async () => { for (const [tab, from, w] of want) if ((await numbers(tab, from)).join() !== w.join()) return false; return true; };
    await until(all, 15000, 100);
    await sleep(1000);                                       // (anything twice would come by now)
    for (const [tab, from, w] of want) assert.deepEqual(await numbers(tab, from), w, (await tab.state()).me + ' from ' + from);
    assert.ok(await until(settled([A, B, C]), 10000), 'still three, linked, nobody away: ' + await shows([A, B, C]));
  }

  test('reliable messages arrive once and in order across a guest\'s outage', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rel1', ['Аня', 'Богдан', 'Сава']);
    await outage(A, B, C, B);
  });

  test('reliable messages arrive once and in order across the host\'s outage (shorter than HOST_WAIT)', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rel2', ['Аня', 'Богдан', 'Сава']);
    await outage(A, B, C, A);
    assert.equal((await A.state()).role, 'host', 'Аня still holds the room');
  });

  test('reliable messages survive a network that loses a third of everything', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel3', ['Аня', 'Богдан']);
    await A.net({ loss: 0.33 }); await B.net({ loss: 0.33 });
    await A.sendAll(seq(0, 30).map(n => ({ t: 'x', n })));
    await B.sendAll(seq(100, 30).map(n => ({ t: 'x', n })));
    await until(async () => (await numbers(B, 'Аня')).length >= 30 && (await numbers(A, 'Богдан')).length >= 30, 15000, 100);
    await sleep(500);
    assert.deepEqual(await numbers(B, 'Аня'), seq(0, 30));
    assert.deepEqual(await numbers(A, 'Богдан'), seq(100, 30));
  });

  test('a "latest" stream through the brokers: only the newest goes, the first at once', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel4', ['Аня', 'Богдан']);
    await A.sendAll(seq(0, 40).map(n => ({ t: 's', n })), { fast: true, latest: 's' });
    await until(async () => (await numbers(B, 'Аня')).includes(40), 3000);
    await sleep(200);
    assert.deepEqual(await numbers(B, 'Аня'), [1, 40]);
  });

  // (phase 1a, A1: it used to take a number and stall every later reliable message, for good)
  test('a reliable message that cannot become JSON is refused at the call, and later ones still arrive', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel5', ['Аня', 'Богдан']);
    const cyclic = { t: 'bad' };
    cyclic.self = cyclic;
    await A.send({ t: 'one' });
    const threw = await A.send(cyclic);
    assert.match(await A.send({ t: 'big', n: 10n }) || '', /^TypeError: .*BigInt/, 'a BigInt too');
    await A.send({ t: 'two' });
    await until(async () => (await B.got()).length >= 2, 3000);
    assert.match(threw || '', /^TypeError: .*(circular|cycl)/i, 'the call throws a TypeError');
    assert.deepEqual(await B.got(), ['Аня:one', 'Аня:two']);
    assert.deepEqual(await A.errors(), [], 'and nothing throws later, out of the watchdog');
  });

  // (phase 1a, A1: the outbox used to keep the caller's own object, so a resend carried whatever it had become)
  test('what goes again is the message as it was sent, whatever the caller does to it afterwards', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel8', ['Аня', 'Богдан']);
    await A.net({ send: false });                            // what Аня sends now is lost: it goes again later
    await A.send({ t: 'x', n: 1, deep: { k: 'before' } }, {}, { n: 99, deep: { k: 'after' } });
    await A.net({ send: true });
    assert.ok(await until(async () => (await B.got()).length, 3000));
    await sleep(300);
    const got = (await B.log()).got.map(([from, m]) => [from, m]);
    assert.deepEqual(got, [['Аня', { t: 'x', n: 1, deep: { k: 'before' } }]]);
  });

  test('alone (nobody linked), a message that cannot become JSON or has one of the room\'s own types still throws', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('rel9', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const cyclic = { t: 'bad' };
    cyclic.self = cyclic;
    assert.match(await A.send(cyclic) || '', /^TypeError: .*(circular|cycl)/i);
    for (const t of ['p', 'q', 'ak', 'bye', '_r', '_x', '_h', '_any']) {
      assert.match(await A.send({ t }) || '', /^TypeError: room: a message needs a string t/, t);
      assert.match(await A.send({ t }, { fast: true }) || '', /^TypeError: room: a message needs a string t/, t + ', fast');
    }
    assert.equal(await A.send(cyclic, { fast: true }), null, 'a fast one is not looked at (may be lost anyway)');
  });

  // (what goes out is the message's JSON: a toJSON that turns it into one of the room's own is refused too)
  test('a reliable message whose JSON is one of the room\'s own types is refused at the call, and acknowledges nothing', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel10', ['Аня', 'Богдан']);
    await A.net({ send: false });                            // what Аня sends now is lost on the way
    await A.send({ t: 'r1' });
    for (const t of ['ak', 'bye', 'p', '_r']) assert.match(await B.sendAs({ t: 'fine' }, { t, a: 99, menu: 1 }) || '', /^TypeError: room: a message needs a string t/, t);
    await A.net({ send: true });
    assert.ok(await until(async () => (await B.got()).length, 3000));
    await sleep(300);
    assert.deepEqual(await B.got(), ['Аня:r1'], 'r1 arrives (no forged acknowledgement)');
    assert.ok((await states([A, B])).every(s => s.linked && s.players.length === 2), 'nobody said bye: ' + await shows([A, B]));
    assert.equal(await B.sendAs({ t: 'fine' }, { t: 'ok', n: 1 }), null);
    assert.ok(await until(async () => (await A.got()).join() === 'Богдан:ok:1', 3000), 'a toJSON of the game\'s own goes as its JSON');
  });

  // (phase 1a, A2: a fast 'ak' of the game's used to acknowledge reliable messages that were lost)
  test('a game\'s fast message named "ak" is refused, and acknowledges nothing', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel6', ['Аня', 'Богдан']);
    await A.net({ send: false });                            // what Аня sends now is lost on the way
    await A.send({ t: 'r1' }); await A.send({ t: 'r2' });
    const threw = await B.send({ t: 'ak', a: 99 }, { fast: true });
    await sleep(150);
    await A.net({ send: true });                             // r1 and r2 go again, until acknowledged
    await until(async () => (await B.got()).length >= 2, 3000);
    assert.deepEqual(await B.got(), ['Аня:r1', 'Аня:r2'], 'r1 and r2 arrive');
    assert.ok(threw, '"ak" is the link\'s own: refused at the call');
  });

  /* ---------- known bugs (phase 1) ---------- */
  test('a guest whose outbox overflows does not take the room over at once', { ...T, todo: 'phase 1b (C5): today the overflow fails the host over, without HOST_WAIT' }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rel7', ['Аня', 'Богдан']);
    await B.net({ send: false });                            // Богдан still hears Аня; what he sends is lost
    await B.sendAll(seq(0, 5001).map(n => ({ t: 'x', n })));   // more than the outbox keeps (OUTBOX_MAX)
    await sleep(300);
    const s = await B.state();
    assert.equal(s.role, 'guest', 'Богдан still a guest: ' + await shows([A, B]));
    assert.equal(s.host, 'Аня');
  });
});
