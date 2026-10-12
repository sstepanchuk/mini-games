// The direct link (library/net/rtc.js, link.js), in worker tabs with fake WebRTC data channels besides the fake
// brokers (tests/support/fakertc.js): it opens and carries the room; gone silent or dropped, the room goes on
// through the brokers and loses nothing, and a new direct link follows. The known bugs are { todo } tests.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, shows, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const seq = (from, n) => Array.from({ length: n }, (_, i) => from + i + 1);
const numbers = async (tab, from) => (await tab.got()).filter(g => g.startsWith(from + ':')).map(g => +g.split(':')[2]);
const direct = (...tabs) => until(async () => (await Promise.all(tabs.map(x => x.state()))).every(s => s.direct), 15000, 50);

// (each test has its own network and tabs: they run side by side)
describe('the direct link', { concurrency: 3 }, () => {
  test('it opens and carries the room; gone silent, the brokers carry it, nothing is lost; then it is direct again', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'dir1', ['Аня', 'Богдан']);
    assert.ok(await direct(A, B), 'direct: ' + await shows([A, B]));
    const dc0 = (await A.call('netState')).dc.sent;
    await A.sendAll(seq(0, 10).map(n => ({ t: 'x', n })));
    assert.ok(await until(async () => (await numbers(B, 'Аня')).length === 10, 3000));
    assert.ok((await A.call('netState')).dc.sent - dc0 >= 10, 'through the direct link');
    await A.net({ direct: false });                        // silent both ways (a network switch, before the link fails)
    for (let i = 11; i <= 30; i++) { await A.send({ t: 'x', n: i }); await sleep(100); }
    await until(async () => (await numbers(B, 'Аня')).length >= 30, 10000, 100);
    await sleep(500);
    assert.deepEqual(await numbers(B, 'Аня'), seq(0, 30), 'all of them, in order, once');
    assert.equal((await A.state()).direct, false, 'through the brokers');
    await A.net({ direct: true });
    assert.ok(await direct(A, B), 'direct again: ' + await shows([A, B]));
  });

  test('dropped by the phone\'s OS: the brokers at once, then a new direct link', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B, C] = await room(W, 'dir2', ['Аня', 'Богдан', 'Сава']);
    assert.ok(await direct(A, B, C), await shows([A, B, C]));
    await B.killDc();
    await C.send({ t: 'x', n: 1 }, { to: 'Богдан' });     // through the host, which reaches Богдан by the brokers now
    assert.ok(await until(async () => (await B.got()).join() === 'Сава:x:1', 2000), 'it arrives at once: ' + await B.got());
    assert.equal((await B.state()).direct, false);
    assert.ok(await direct(A, B, C), 'direct again: ' + await shows([A, B, C]));
  });

  // (phase 1a, A1: the direct link used to drop it without a word, and every later one stalled)
  test('on the direct link too, a reliable message that cannot become JSON is refused at the call', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'dir3', ['Аня', 'Богдан']);
    assert.ok(await direct(A, B));
    const cyclic = { t: 'bad' };
    cyclic.self = cyclic;
    await A.send({ t: 'one' });
    const threw = await A.send(cyclic);
    await A.send({ t: 'two' });
    await until(async () => (await B.got()).length >= 2, 3000);
    assert.deepEqual(await B.got(), ['Аня:one', 'Аня:two']);
    assert.match(threw || '', /^TypeError: .*(circular|cycl)/i, 'the call throws');
  });

  // (phase 1a, A2: r: 1 in any fast message used to make the link doubt the direct path)
  test('a game\'s fast message with r: 1 does not make the link doubt the direct path (only a pulse says so)', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'dir4', ['Аня', 'Богдан']);
    assert.ok(await direct(A, B));
    for (let i = 0; i < 20; i++) {
      await B.send({ t: 'x', n: i, r: 1, w: [3, 2] }, { fast: true });
      await sleep(50);
      assert.equal((await A.state()).direct, true, 'still direct after ' + (i + 1));
    }
  });
});
