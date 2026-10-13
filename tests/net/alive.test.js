// The room keeps a direct link alive by itself (library/net/link.js tendAlive; phase 2, H1), in worker tabs with fake
// direct links besides the fake brokers (tests/support): a timer of ALIVE_EVERY (50 ms) asks about a quiet direct link,
// only while the library's open game has someone to play with, the page is visible, the brokers work and a direct
// link is open. No such timer on the shelf, in an idle room, on a hidden page, or once the direct link closed; and
// a game that never calls room.frame still sees a silent direct link replaced by the brokers; one that does, on its
// frame's own clock, disturbs nothing. (The game's room.kick() does nothing now: the room checks its network by itself.)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, shows, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const fast = async tab => (await tab.timers())[50] || 0;      // the 50 ms interval (link.js ALIVE_EVERY)
const direct = (...tabs) => until(async () => (await Promise.all(tabs.map(x => x.state()))).every(s => s.direct), 15000, 50);

describe('the room keeps its direct link alive while a game is played (phase 2, H1)', { concurrency: 2 }, () => {
  test('only while a game is played, visible, over a live direct link: not on the shelf, hidden, or once it closed', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'alive1', ['Аня', 'Богдан'], { lib: {} });
    assert.ok(await direct(A, B), await shows([A, B]));
    assert.deepEqual([await fast(A), await fast(B)], [0, 0], 'a room on the shelf: no timer');
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'both play');
    assert.ok(await until(async () => await fast(A) === 1 && await fast(B) === 1, 1000), 'playing: one each');
    await A.hide(true);
    assert.equal(await fast(A), 0, 'hidden: none at once');
    assert.equal(await fast(B), 1, '(the other page still has its own)');
    await A.hide(false);
    assert.ok(await until(async () => await fast(A) === 1, 1000), 'shown again: back');
    await B.killDc();                                        // the phone's OS dropped the direct links: the brokers carry it
    assert.ok(await until(async () => await fast(A) === 0 && await fast(B) === 0, 1000), 'no direct link: none');
    assert.ok(await direct(A, B), 'a new direct link: ' + await shows([A, B]));
    assert.ok(await until(async () => await fast(A) === 1 && await fast(B) === 1, 1000), 'and the timer with it');
    await A.open(null);                                      // back to the shelf (Богдан follows)
    assert.ok(await until(async () => !(await B.game()) && await fast(A) === 0 && await fast(B) === 0, 2000), 'the shelf: none');
  });

  test('a room of library/net with no game (nobody says it plays): never', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'alive2', ['Аня', 'Богдан']);
    assert.ok(await direct(A, B));
    await A.sendAll(Array.from({ length: 20 }, (_, i) => ({ t: 'x', n: i })));
    assert.deepEqual([await fast(A), await fast(B)], [0, 0]);
  });

  test('a game that never calls room.frame: its silent direct link moves to the brokers, and nothing is lost', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'alive3', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000));
    assert.ok(await direct(A, B));
    await B.net({ direct: false });                          // silent both ways (a network switch, before the link fails)
    for (let i = 1; i <= 10; i++) assert.ok(await A.gsend({ t: 'mv', n: i }));
    assert.ok(await until(async () => !(await A.state()).direct, 3000, 50), 'Аня goes through the brokers: ' + await shows([A, B]));
    const got = async () => (await B.game()).got.filter(([, m]) => m.t === 'mv').map(([, m]) => m.n);
    assert.ok(await until(async () => (await got()).length === 10, 5000), 'Богдан has them all: ' + await got());
    assert.deepEqual(await got(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  // (found measuring H1: Two Dragons passes its frame's clock, not the library page's. A nudge used to take that time
  // for the regular pulse's: a clock far ahead held the pulse back, and only the nudges went, every 400 ms.)
  test('room.frame(now) reads no clock of the game\'s: one far ahead of the page\'s holds no pulse back', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'alive4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000));
    assert.ok(await direct(A, B));
    await A.call('gpulse'); await B.call('gpulse');
    await A.call('gframes', { ahead: 1e9 });
    await B.net({ direct: false });                          // silent both ways: the frames ask about it
    assert.ok(await until(async () => !(await A.state()).direct && !(await B.state()).direct, 5000, 50), 'both on the brokers: ' + await shows([A, B]));
    const n0 = await B.call('gpulses');
    await new Promise(r => setTimeout(r, 2000));
    const n = await B.call('gpulses') - n0;                  // (5 a second, and the nudges: ≈ 15; held back: ≈ 5)
    assert.ok(n >= 8, 'Богдан\'s game hears Аня\'s pulses, 5 a second at least: ' + n + ' in 2 s');
    await A.call('gframes', { ahead: null });
  });
});
