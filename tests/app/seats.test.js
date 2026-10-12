// What a game sees of the library's room (library/app/together.js: ihroteka.room), in worker tabs that run the real
// library over fake brokers (tests/support): everyone follows into the game one opens; a game for two seats the
// first two players and the third waits; a game's messages reach only who plays; a seat that comes free goes to who
// waits; a player's new tab is waited for; shared values are the same for everyone.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, until, world } from '../support/world.js';

const T = { timeout: 30000 };
const games = tabs => Promise.all(tabs.map(x => x.game()));
const heard = (g, ...ev) => g.events.some(e => ev.every((x, i) => JSON.stringify(e[i + 1]) === JSON.stringify(x)));
const seats = g => g && [g.me, g.role, g.players.join(), g.waiting.join(), g.linked];

// (each test has its own network and tabs: they run side by side)
describe('a game\'s room: following, seats, messages, a new tab, shared values', { concurrency: 3 }, () => {
  test('a game for two: everyone follows into it; the first two play, the third waits; messages reach who plays', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'seat1', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    const g = await until(async () => { const x = await games([A, B, C]); return x.every(y => y && y.view === 'g') && x[0].linked && x[1].linked && !x[2].linked && x; }, 5000);
    assert.ok(g, JSON.stringify((await games([A, B, C])).map(seats)));
    assert.deepEqual(g.map(seats), [['Аня', 'host', 'Аня,Богдан', 'Сава', true], ['Богдан', 'guest', 'Аня,Богдан', 'Сава', true], ['Сава', null, 'Аня,Богдан', 'Сава', false]]);
    assert.deepEqual(g.map(x => x.follows), [[], ['g'], ['g']], 'Богдан and Сава followed Аня');
    assert.ok(g.every(x => x.host === 'Аня' && x.seats === 2) && !g[2].seated);
    await A.gsend({ t: 'mv', n: 1 });
    await B.gsend({ t: 'hi' }, { to: 'Аня' });
    await C.gsend({ t: 'no' });                              // waiting: plays with nobody, sends nothing
    assert.ok(await until(async () => (await A.game()).got.length && (await B.game()).got.length, 3000));
    await new Promise(r => setTimeout(r, 300));
    const [a, b, c] = await games([A, B, C]);
    assert.deepEqual([a.got, b.got, c.got], [[['Богдан', { t: 'hi' }]], [['Аня', { t: 'mv', n: 1 }]], []]);
  });

  test('a seat that comes free goes to who waits; the round with the one who left is over', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'seat2', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => { const x = await games([A, B, C]); return x.every(y => y && y.players.join() === 'Аня,Богдан') && x[1].linked; }, 5000));
    const n = (await A.game()).events.length;
    await B.leave();                                         // Богдан leaves the room for good
    const g = await until(async () => { const x = await games([A, C]); return x.every(y => y.linked && y.players.join() === 'Аня,Сава') && x; }, 5000);
    assert.ok(g, JSON.stringify((await games([A, C])).map(seats)));
    assert.deepEqual(g.map(seats), [['Аня', 'host', 'Аня,Сава', '', true], ['Сава', 'guest', 'Аня,Сава', '', true]]);
    assert.deepEqual(g[0].events.slice(n).map(e => e[1]), ['players', 'peer-gone', 'linked'], 'Аня\'s game: the round is over, then she plays with Сава');
    assert.ok(heard(g[1], 'linked'));
  });

  test('a player\'s new tab: the game waits for it (weak) until the game is open there, then sends it everything', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'seat3', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await B.game() || {}).linked, 5000));
    const B2 = await W.tab('p3tab');
    await B2.lib('seat3', 'Богдан');                         // Богдан goes on in another tab: it follows into the game
    const a = await until(async () => { const x = await A.game(); return heard(x, 'relinked', 'Богдан') && x; }, 8000);
    assert.ok(a, 'Аня\'s game hears relinked Богдан: ' + JSON.stringify((await A.game()).events));
    const ev = a.events.map(e => e.slice(1).join(' '));
    assert.ok(ev.indexOf('weak true') >= 0 && ev.indexOf('weak true') < ev.indexOf('relinked Богдан'), 'paused while his new tab opens the game: ' + ev);
    assert.ok(await until(async () => !(await A.game()).weak && (await B2.game() || {}).linked, 3000), 'then playing again');
    assert.ok(!heard(a, 'peer-gone'), 'the round goes on');
    assert.ok((await B.events()).some(e => e[1] === 'replaced'), 'the old tab steps aside');
  });

  test('shared values: the same for everyone, and a newcomer gets them', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'seat4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await B.game() || {}).linked, 5000));
    await A.share('mode', 'race');
    await B.share('series', { Аня: 1, Богдан: 2 });
    assert.ok(await until(async () => (await B.shared('mode')) === 'race' && (await A.shared('series'))?.Богдан === 2, 3000));
    assert.ok(heard(await B.game(), 'shared', 'mode', 'race') && heard(await A.game(), 'shared', 'series', { Аня: 1, Богдан: 2 }));
    const C = await W.tab('p3tab');
    await C.lib('seat4', 'Сава');
    assert.ok(await until(async () => (await C.game()) && (await C.shared('mode')) === 'race' && (await C.shared('series'))?.Аня === 1, 5000),
      'Сава follows into the game and sees what the players share');
  });
});
