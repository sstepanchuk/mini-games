// What a copy of a game keeps of the messages it cannot hear yet (library/app/together.js channel receive): its page
// listens late (the game's code starts after the room), or its round is on and it waits for the round's snapshot
// (round.js: 'run' before any message). Every reliable message, in order, up to 8 × CAP bytes of them (past that the
// newest are dropped and the trace says so); of the fast ones, the newest 64 (each says what is now). In worker tabs
// (tests/support): Аня's game page runs its code late (gameLate, then glisten), Богдан already in the game sends.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names && x.linked) && g;
}, 8000);
// Аня and Богдан in a room; the room goes into the game, where Аня's copy is linked before her game listens
async function late(t, code) {
  const W = world(t);
  const [A, B] = await room(W, code, ['Аня', 'Богдан'], { lib: {} });
  await A.call('gameLate', { on: true });
  await B.open('g');
  assert.ok(await until(async () => (await B.game())?.linked && (await A.game())?.linked, 8000), 'Богдан plays with Аня');
  return [A, B];
}
// Аня's page has the game's message { t, i } (her room has it; it tells her copy of the game first, which keeps it)
async function reached(A, t, i) {
  let from = 0;
  return until(async () => {
    const { got } = await A.log(1e9, from);
    from += got.length;
    return got.some(([, m]) => m && m.t === 'lib-g' && m.m && m.m.t === t && m.m.i === i);
  }, 10000);
}
// what Аня's game heard once it listens: it listens once the last message sent ({ t, i }) has reached her page (the
// others were sent before it, on the same link), and has heard it all once the last it should hear (heard) came
async function listen(A, last, heard = last) {
  assert.ok(await reached(A, last.t, last.i), 'the last message reached Аня\'s page');
  await A.call('glisten');
  assert.ok(await until(async () => (await A.game()).got.some(([, m]) => m.t === heard.t && m.i === heard.i), 5000), 'her game heard ' + JSON.stringify(heard));
  await sleep(300);                                        // (nothing more comes)
  return (await A.game()).got.map(([, m]) => m);
}
// a round record as another library would write it (the room checks only its shape and writer)
const forged = (v, a = v.runner) => ({ t: 'lib-state', e: [['round:g', { v: { on: true, by: v.runner, reason: null, result: null, setup: null, saved: false, w: 1, ...v }, c: Date.now() + 1000, a }]] });

describe('messages a game\'s copy cannot hear yet', { concurrency: 3 }, () => {
  test('a game that listens late gets every reliable message, in order (100 of them)', T, async t => {
    const [A, B] = await late(t, 'inbox1');
    for (let i = 0; i < 100; i++) assert.equal(await B.gsend({ t: 'm', i }), true);
    const got = (await listen(A, { t: 'm', i: 99 })).map(m => m.i);
    assert.deepEqual(got, [...Array(100).keys()]);
  });

  test('of the fast ones it gets the newest 64 at most, the last one sent among them', T, async t => {
    const [A, B] = await late(t, 'inbox2');
    for (let i = 0; i < 200; i++) assert.equal(await B.gsend({ t: 'm', i }, { fast: true }), true);
    const got = (await listen(A, { t: 'm', i: 199 })).map(m => m.i);
    assert.ok(got.length > 0 && got.length <= 64, got.length + ' kept');
    assert.equal(got[got.length - 1], 199, 'the newest is kept');
    assert.deepEqual(got, [...got].sort((a, b) => a - b), 'in order');
  });

  test('reliable and fast together: every reliable one in its place, the newest 64 fast ones between', T, async t => {
    const [A, B] = await late(t, 'inbox3');
    assert.equal(await B.gsend({ t: 'r', i: 0 }), true);
    for (let i = 0; i < 100; i++) assert.equal(await B.gsend({ t: 'f', i }, { fast: true }), true);
    assert.equal(await B.gsend({ t: 'r', i: 1 }), true);
    const got = (await listen(A, { t: 'r', i: 1 })).map(m => m.t + m.i);
    assert.deepEqual(got, ['r0', ...Array.from({ length: 64 }, (_, k) => 'f' + (36 + k)), 'r1']);
  });

  // (a forged saved round makes Аня's copy wait for its snapshot: round.js holds the messages until 'run')
  test('a copy that waits for its round\'s snapshot: \'run\' first, then every reliable message, in order', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'inbox4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await B.send(forged({ id: 'waitwait', seats: ['Аня', 'Богдан'], runner: 'Аня', saved: true }));
    assert.ok(await until(async () => ((await A.state()).lib.rounds || {}).g?.id === 'waitwait', 3000));
    const g0 = await A.game(), n = g0.got.length, e = g0.heard.length;
    for (let i = 0; i < 100; i++) assert.equal(await B.gsend({ t: 'm', i }), true);
    await sleep(1000);
    await B.send({ t: 'lib-save', v: 'g', r: 'waitwait', s: { n: 5 }, c: Date.now() + 5000, a: 'Аня', w: 1 });
    assert.ok(await until(async () => (await A.game()).heard.includes('round:run'), 3000), 'the snapshot came: run');
    await sleep(500);
    const g = await A.game(), got = g.got.slice(n).map(([, m]) => m.i);
    const order = g.heard.slice(e).filter(x => x === 'round:run' || x.startsWith('message:'));
    assert.equal(order[0], 'round:run', 'run before any message');
    assert.deepEqual(got, [...Array(100).keys()]);
  });

  test('past 8 × CAP bytes of reliable messages waiting, the newest are dropped, and the trace says so', T, async t => {
    const [A, B] = await late(t, 'inbox5');
    const pad = 'x'.repeat(30000);
    for (let i = 0; i < 10; i++) assert.equal(await B.gsend({ t: 'big', i, pad }), true);
    const got = (await listen(A, { t: 'big', i: 9 }, { t: 'big', i: 7 })).map(m => m.i);
    assert.deepEqual(got, [0, 1, 2, 3, 4, 5, 6, 7]);
    const said = (await A.state()).lib.trace.filter(l => /refused: message: over 262144 bytes/.test(l));
    assert.ok(said.length >= 1, 'the trace: ' + (await A.state()).lib.trace.join('\n'));
    assert.deepEqual(await A.takeErrors(), [], 'not a mistake of the page (the dev console says it, on the dev server)');
  });
});
