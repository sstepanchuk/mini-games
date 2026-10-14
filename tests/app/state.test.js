// The room's shared state (library/app/roomstate.js, sent around by together.js), in worker tabs that run the real
// library over fake brokers (tests/support): a newcomer is greeted with all of it, and one wild clock must not
// freeze it. (Greet goes in chunks of up to CAP bytes: rules.js.)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 30000 };
const inGame = async (...tabs) => until(async () => (await Promise.all(tabs.map(x => x.game()))).every(g => g && g.linked), 5000);

// (each test has its own network and tabs: they run side by side)
describe('the shared state', { concurrency: 3 }, () => {
  // A transport that refuses a packet over 64 KB. The real limits of the brokers and of WebKit's data channels are
  // still to be measured (docs/ROADMAP.md, decision 18); one game value may take 8 000 bytes (share), ten of them more.
  test('a newcomer gets every shared value, however many (10 × 8 000 bytes, under a 64 KB transport limit)', T, async t => {
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

  // (roomstate.js: a clock counts only if it is at most a year ahead of ours)
  test('a clock far in the future from one player does not freeze the shared state', T, async t => {
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

  // (roomstate.js: the clocks follow the room's highest, so with a device whose clock runs ahead, a player's older page
  // wrote on a clock ahead of their own: their next page writes below it until it has merged what the room knows, and
  // the old page's here: comes back with the greeting. The page then says its own again: together.js staleHere)
  test('a new page behind its old page\'s clock keeps its here:', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.lib('state5', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.clock(300000);                                   // Богдан's device runs 5 minutes ahead
    await B.lib('state5', 'Богдан');
    await A.open('g');
    assert.ok(await inGame(A, B));
    await A.open(null);                                      // here:Аня null, on Богдан's clock
    assert.ok(await until(async () => (await B.state()).lib.view === null, 5000));
    await A.call('gameSlow', { on: true });                  // her page follows into the next game, which does not open there
    await B.open('g');
    assert.ok(await until(async () => (await A.state()).lib.view === 'g', 5000));
    const A2 = await A.reload();                             // «Онови сторінку»: the page at /g/ again, her clock right
    await A2.lib('state5', 'Аня');                           // (the shell opens the address's game as the room starts)
    assert.ok(await until(async () => (await B.state()).lib.here['Аня'] === 'g' && (await B.game())?.linked, 6000),
      'Богдан sees her game open: ' + JSON.stringify((await B.state()).lib.here));
    assert.ok(await inGame(A2, B));
  });

  // (a round's snapshot carries a clock of the shared state as its version: the same bound)
  test('a snapshot with a clock far in the future does not freeze a round\'s snapshots', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'state3', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await inGame(A, B, C));
    // what another library (or a broken one) could send: a snapshot of the round with a clock of 2^52 - 1
    await B.send({ t: 'lib-snap', v: 'g', s: { junk: 1 }, c: 2 ** 52 - 1, a: 'Богдан' });
    await sleep(300);
    await A.snapshot({ n: 1 });                              // Аня's copy runs the round
    const snap = async X => ((await X.state()).lib.snaps || {}).g;
    assert.ok(await until(async () => (await snap(C))?.s?.n === 1, 3000), 'Сава has the round\'s latest: ' + JSON.stringify(await snap(C)));
  });

  // (review of phase 1a: the game was handed the room's own object, so a game that changed it changed the room's state
  // on that device alone, with the same version as everyone else's, and greet passed the change on)
  test('a shared value the game changes in place stays as it is for everyone, newcomers too', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'state4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await inGame(A, B));
    await B.share('score', { Аня: 1, Богдан: 2 });
    assert.ok(await until(async () => (await A.shared('score'))?.Богдан === 2, 3000));
    assert.equal(await A.call('gtouch', { ev: 'shared', k: 'score', set: { Аня: 50 } }), true, 'the value of the event');
    assert.equal(await A.call('gtouch', { ev: 'get', k: 'score', set: { Богдан: 70 } }), true, 'what room.shared returns');
    assert.deepEqual(await A.shared('score'), { Аня: 1, Богдан: 2 });
    const C = await W.tab('p3tab');
    await C.lib('state4', 'Сава');
    assert.ok(await until(async () => (await C.game()) && (await C.shared('score')), 5000));
    assert.deepEqual(await C.shared('score'), { Аня: 1, Богдан: 2 }, 'greeted with the room\'s value');
  });
});
