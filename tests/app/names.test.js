// Player names that are also the names of what every object has (__proto__, constructor, toString), in worker tabs that
// run the real library over fake brokers (tests/support): the room, its shared state, rounds and seats keep them as
// names, never as an object's own parts. (audit: names-and-3plus-14)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, until, world } from '../support/world.js';

const NAMES = ['__proto__', 'constructor', 'toString'];
// the round events the game heard: 'start constructor', 'run fresh', 'watch __proto__', 'end quit toString'
const rlines = g => g.events.filter(e => e[1].startsWith('round:')).map(([, n, a]) => n.slice(6) + ' ' + (n === 'round:start' ? a.by : n === 'round:run' ?
  (a.state === null ? 'fresh' : JSON.stringify(a.state)) : n === 'round:watch' ? a.runner : n === 'round:end' ? a.reason + ' ' + a.by : a));
const rec = async (X, game = 'g') => ((await X.state()).lib.rounds || {})[game];
const heardR = (X, l, ms = 5000) => until(async () => { const g = await X.game(); return g && rlines(g).includes(l) && g; }, ms, 50);

describe('players named as an object\'s own parts', () => {
  test('__proto__, constructor and toString play: a round starts and ends, shares go round, seats and release work, the report names them', { timeout: 40000 }, async t => {
    const W = world(t, { scale: 0.3 });
    const [A, B, C] = await room(W, 'nm1', NAMES, { lib: { g: 3 } });
    await A.open('g');
    const g = await until(async () => { const x = await Promise.all([A, B, C].map(X => X.game())); return x.every(y => y && y.linked && y.players.length === 3) && x; }, 8000);
    assert.ok(g, 'all three play');
    assert.deepEqual(g.map(x => [x.me, x.players]), NAMES.map(n => [n, NAMES]));
    for (const X of [A, B, C]) await X.call('rpolicy', { p: { endWhenSeatGone: true } });
    // a round, asked of the copy that starts them (__proto__'s)
    assert.equal(await B.call('rstart', { setup: 1 }), true, 'asked');
    assert.ok(await heardR(A, 'run fresh', 5000) && await heardR(B, 'watch __proto__', 3000) && await heardR(C, 'watch __proto__', 3000),
      'it begins: ' + rlines(await A.game()) + ' / ' + rlines(await C.game()));
    const { id, seats, runner, by } = await rec(C);
    assert.deepEqual([seats, runner, by], [NAMES, '__proto__', 'constructor']);
    assert.deepEqual(await Promise.all(NAMES.map(name => C.call('rseatOf', { name }))), [0, 1, 2], 'the seat of each');
    assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
    // a shared value with those keys, round trip
    const v = JSON.parse('{"__proto__":1,"constructor":2,"toString":{"__proto__":[3]}}');
    assert.equal(await B.share('series', v), true);
    const got = await until(async () => { const x = await C.shared('series'); return x && x; }, 3000);
    assert.equal(JSON.stringify(got), JSON.stringify(v), 'as it was shared');
    assert.deepEqual([Object.keys(got), Object.getPrototypeOf(got) === Object.prototype], [['__proto__', 'constructor', 'toString'], true], 'its own keys, nothing else');
    // the round ends: toString quits it
    assert.equal(await C.call('rquit'), true);
    assert.ok(await heardR(A, 'end quit toString', 3000), 'over: ' + rlines(await A.game()));
    assert.ok(await heardR(B, 'end quit toString', 3000));
    assert.deepEqual(await Promise.all([A, B, C].map(async X => { const r = await rec(X); return [r.id, r.on, r.reason, r.by]; })), Array(3).fill([id, false, 'quit', 'toString']));
    // __proto__ cut off (it held the room): constructor lets its place go («Не чекати»: room.release) and holds the room
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.state()).away.includes('__proto__'), 5000), 'away');
    const gone = await until(async () => { await B.release('__proto__'); const s = await B.state(); return !s.players.includes('__proto__') && s; }, 10000, 200);
    assert.ok(gone, 'released: ' + JSON.stringify((await B.state()).players));
    assert.deepEqual([gone.players, gone.role], [['constructor', 'toString'], 'host']);
    // the report says who plays (names-and-3plus-12: it holds the players' names)
    const head = (await B.diag()).split('\n').slice(0, 2);
    assert.match(head[0], /^Ігротека /);
    assert.match(head[1], /^room: internet, role: host, players: constructor, toString( \(away\))? \(at most 8\)$/, head[1]);   // (toString may still look for __proto__'s room)
  });
});
