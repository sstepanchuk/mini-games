// Тести правил гри (node:test, без браузера): npm run test:games. Збірка запускає їх перед тим, як запечатати гру,
// і не запечатує її, якщо котрийсь падає. Файли *.test.js у цій теці — лише такі тести.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRound, move, newer, valid, TARGET, STEPS } from '../rules.js';

test('a round starts at zero with the first seat to move; the seats are a copy', () => {
  const seats = ['Аня', 'Богдан'], r = newRound(seats, 'r1');
  assert.deepEqual(r, { id: 'r1', seats: ['Аня', 'Богдан'], total: 0, turn: 0, winner: -1, moves: 0 });
  seats.push('Сава');
  assert.equal(r.seats.length, 2);
  assert.ok(valid(r));
});

test('turns go round the seats; only the seat whose turn it is moves, by an allowed step', () => {
  let r = newRound(['a', 'b', 'c']);
  assert.equal(move(r, 1, 1), null, 'not b\'s turn');
  assert.equal(move(r, 0, 3), null, 'no such step');
  for (const [seat, n] of [[0, 1], [1, 2], [2, 1], [0, 2]]) r = move(r, seat, n);
  assert.deepEqual([r.total, r.turn, r.moves, r.winner], [6, 1, 4, -1]);
});

test('whoever reaches TARGET exactly wins; no step past it, no move after it', () => {
  let r = { ...newRound(['a', 'b']), total: TARGET - 1, turn: 1 };
  assert.equal(move(r, 1, 2), null, 'past TARGET');
  const before = JSON.stringify(r);
  r = move(r, 1, 1);
  assert.equal(before, JSON.stringify({ ...newRound(['a', 'b']), total: TARGET - 1, turn: 1 }), 'the old round unchanged');
  assert.deepEqual([r.total, r.winner, r.turn], [TARGET, 1, 1]);
  for (const n of STEPS) assert.equal(move(r, 1, n), null);
});

// (усі можливі партії, а не випадкові: тест щоразу той самий, і коли падає, то на тій самій партії)
test('every round played out ends with one winner, whatever the moves', () => {
  const ends = r => r.winner >= 0 ? [r] : STEPS.flatMap(n => { const next = move(r, r.turn, n); return next ? ends(next) : []; });
  for (const seats of [['a', 'b'], ['a', 'b', 'c'], ['a', 'b', 'c', 'd']]) {
    const all = ends(newRound(seats));
    assert.ok(all.length > 1, 'more than one way to play it');
    for (const r of all) {
      assert.ok(valid(r) && r.total === TARGET && r.winner === r.turn, JSON.stringify(r));
      assert.deepEqual(JSON.parse(JSON.stringify(r)), r, 'a round survives JSON (it is a message and a snapshot)');
    }
  }
});

test('of two states of one round the newer wins; states of different rounds are not compared', () => {
  const a = move(newRound(['a', 'b'], 'r1'), 0, 1), b = move(a, 1, 2);
  assert.equal(newer(a, b), b);
  assert.equal(newer(b, a), b);
  assert.equal(newer(b, newRound(['a', 'b'], 'r2')), null, 'another round (a new one has fewer moves, yet it is not older)');
  assert.equal(newer(b, { ...b, seats: ['b', 'a'] }), null, 'other seats');
  assert.equal(newer(b, null), null);
});

test('what comes from the network is checked', () => {
  for (const bad of [null, {}, { ...newRound(['a']), id: 7 }, { ...newRound(['a']), turn: 1 }, { ...newRound(['a', 'b']), total: TARGET + 1 }, { ...newRound([1, 2]) }, { ...newRound(['a', 'b']), winner: 2 }]) assert.equal(valid(bad), false, JSON.stringify(bad));
});
