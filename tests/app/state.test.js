// The room's shared state (library/app/roomstate.js, sent around by together.js), in worker tabs that run the real
// library over fake brokers (tests/support): a newcomer is greeted with all of it, and one wild clock must not
// freeze it. Both are known bugs, as { todo } tests of what should happen; phase 1 turns them green.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 30000 };
const inGame = async (...tabs) => until(async () => (await Promise.all(tabs.map(x => x.game()))).every(g => g && g.linked), 5000);

// (each test has its own network and tabs: they run side by side)
describe('the shared state', { concurrency: 3 }, () => {
  // A transport that refuses a packet over 64 KB. The real limits of the brokers and of WebKit's data channels are
  // still to be measured (docs/ROADMAP.md, decision 18); one game value may take 8 000 bytes (share), ten of them more.
  test('a newcomer gets every shared value, however many (10 × 8 000 bytes, under a 64 KB transport limit)', { ...T, todo: 'phase 1a (A1): today greet sends everything in one message, which never arrives and stalls the link' }, async t => {
    const W = world(t), net = { maxBytes: 65536 };
    const [A, B] = await room(W, 'state1', ['Аня', 'Богдан'], { lib: {}, net });
    await A.open('g');
    assert.ok(await inGame(A, B));
    const value = i => 'x'.repeat(7997) + i;                 // 8 000 characters as JSON: the most share takes
    for (let i = 0; i < 10; i++) await A.share('k' + i, value(i));
    assert.ok(await until(async () => (await B.shared('k9')) === value(9), 5000), 'one at a time, they arrive');
    const C = await W.tab('p3tab', net);
    await C.lib('state1', 'Сава');
    const ok = await until(async () => (await C.game()) && (await C.shared('k9')) === value(9), 8000);
    const refused = (await A.call('netState')).big;
    assert.ok(ok, 'Сава follows into the game and has all ten (the transport refused ' + refused + ' packets of Аня\'s)');
  });

  test('a clock far in the future from one player does not freeze the shared state', { ...T, todo: 'phase 1a (A2): today a clock of 1e300 stops every later change from winning' }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'state2', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await inGame(A, B));
    // what another library (or a broken one) could send: an entry of the shared state with a clock of 1e300
    await B.send({ t: 'lib-state', e: [['g:g:junk', { v: 1, c: 1e300, a: 'Богдан' }]] });
    await sleep(300);
    await A.share('k', 1);
    assert.ok(await until(async () => (await B.shared('k')) === 1, 3000));
    await B.share('k', 2);
    assert.ok(await until(async () => (await A.shared('k')) === 2, 3000));
    await A.share('k', 3);                                   // the latest change: everyone should have it
    await until(async () => (await B.shared('k')) === 3, 3000);
    assert.deepEqual([await A.shared('k'), await B.shared('k')], [3, 3]);
  });
});
