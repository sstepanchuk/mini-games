// A round of contract 4 (room.snapshot, 'resume') in a game for three, when one of its seated players leaves the room
// for good: the round goes on with the others (in a game for 3+ seats that is the game's own rule, owner decision 1),
// and its latest snapshot still names the player who left until the runner takes the next one. If the runner drops out
// before that, the next seated player runs the round on from it (rules.snapFits: a player gone from the room does not
// count); a newcomer in the gone player's seat is someone else's round, and nothing resumes. In worker tabs
// (tests/support), the room's timing scaled down (AUTH_WAIT 3 s).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;
// what the game heard, as 'event args' lines (who plays and the shared values left out)
const evs = g => g.events.map(e => e.slice(1).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')).filter(e => !/^(shared|players)\b/.test(e));
const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names) && g.filter(x => x.seated).every(x => x.linked) && g;
}, 8000);

describe('a round of contract 4 after a seated player left for good', { concurrency: 2 }, () => {
  test('a game for three: a seated player leaves for good and the runner drops out before its next snapshot: the next seated player runs the round on from it', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'resume1', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'));
    assert.equal(await A.snapshot({ n: 1 }), true);
    assert.ok(await until(async () => (await B.state()).lib.snaps.g?.s?.n === 1, 3000), 'Богдан keeps the snapshot');
    await C.leave();                                         // Сава leaves the room for good
    assert.ok(await until(async () => (await B.game()).players.join() === 'Аня,Богдан', 5000), 'the round goes on with the two');
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });                              // Аня's copy runs it; her network goes before her next snapshot
    const b = await until(async () => { const g = await B.game(); return evs(g).includes('role host') && g; }, AUTH_WAIT + 6000, 50);
    assert.ok(b, 'Богдан takes the round over: ' + evs(await B.game()));
    await sleep(300);
    const e = evs(await B.game()), i = e.indexOf('role host');
    assert.equal(e[i + 1], 'resume {"n":1}', 'and runs it on from the snapshot: ' + e.join(' | '));
  });

  test('…and the converse: a newcomer took the gone player\'s seat: someone else\'s round, nothing resumes', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C, D] = await room(W, 'resume2', ['Аня', 'Богдан', 'Сава', 'Дана'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C, D], 'Аня,Богдан,Сава'), 'Дана waits for a seat');
    assert.equal(await A.snapshot({ n: 1 }), true);
    assert.ok(await until(async () => (await B.state()).lib.snaps.g?.s?.n === 1, 3000));
    await C.leave();
    assert.ok(await until(async () => (await B.game()).players.join() === 'Аня,Богдан,Дана', 5000), 'Дана takes Сава\'s seat');
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    const b = await until(async () => { const g = await B.game(); return evs(g).includes('role host') && g; }, AUTH_WAIT + 6000, 50);
    assert.ok(b, 'Богдан takes the round over: ' + evs(await B.game()));
    await sleep(1000);
    assert.ok(!evs(await B.game()).some(e => e.startsWith('resume')), 'no resume: ' + evs(await B.game()).join(' | '));
  });
});
