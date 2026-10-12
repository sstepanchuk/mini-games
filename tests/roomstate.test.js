// What the players of a room share (library/app/roomstate.js): everyone ends up with the same, whatever order
// the changes arrive in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { roomState } from '../library/app/roomstate.js';

test('a change reaches the others as it was made', () => {
  const a = roomState('Аня'), b = roomState('Богдан');
  assert.deepEqual(b.merge([a.set('view', 'dragons')]), ['view']);
  assert.equal(b.get('view'), 'dragons');
  assert.deepEqual(b.merge([['view', a.entries()[0][1]]]), []);       // the same again: nothing changes
});

test('the later change wins, in any order of arrival', () => {
  const a = roomState('Аня'), b = roomState('Богдан');
  const first = a.set('view', 'dragons');
  b.merge([first]);
  const second = b.set('view', null);                                 // made after seeing the first
  const c = roomState('Сава'), d = roomState('Дана');
  c.merge([first]); c.merge([second]);
  d.merge([second]); d.merge([first]);
  assert.equal(c.get('view'), null);
  assert.equal(d.get('view'), null);
});

test('changes made at once by two players: everyone picks the same one', () => {
  const a = roomState('Аня'), b = roomState('Богдан');
  const x = a.set('view', 'dragons'), y = b.set('view', 'other');
  x[1].c = y[1].c;                                                    // the same clock: the name decides
  a.merge([y]); b.merge([x]);
  assert.equal(a.get('view'), b.get('view'));
  assert.equal(a.get('view'), 'other');                               // 'Богдан' > 'Аня'
});

test('a new tab writes after its old one (the clock starts from the wall clock and follows what it sees)', () => {
  const old = roomState('Аня');
  for (let i = 0; i < 1000; i++) old.set('here:Аня', 'dragons');
  const fresh = roomState('Аня'), other = roomState('Богдан');
  other.merge(old.entries());
  fresh.merge(other.entries());
  other.merge([fresh.set('here:Аня', null)]);
  assert.equal(other.get('here:Аня'), null);
  assert.ok(fresh.next() > old.next() - 2);
});

test('broken entries are ignored', () => {
  const s = roomState('Аня');
  assert.deepEqual(s.merge([[1, { v: 1, c: 1, a: 'x' }], ['k', null], ['k', { v: 1, c: 'x', a: 'x' }], ['k', { v: 1, c: 1 }]]), []);
  assert.equal(s.get('k'), undefined);
});

test('seen moves the clock past a version from elsewhere', () => {
  const s = roomState('Аня'), far = Date.now() + 1e9;
  s.seen(far);
  assert.ok(s.next() > far);
  s.seen(NaN);
  assert.ok(s.set('view', null)[1].c > far);
});

// A clock from elsewhere counts only as a safe integer at most a year ahead of ours: one wild value must not carry
// every clock to where no later change can win (1e300; 2^52 - 1, a safe integer still far beyond any real clock).
test('a wild clock is ignored: later changes still win', () => {
  for (const wild of [1e300, 2 ** 52 - 1, Date.now() + 400 * 24 * 3600 * 1000, 1.5, Infinity]) {
    const a = roomState('Аня'), b = roomState('Богдан');
    assert.deepEqual(b.merge([['view', { v: 'junk', c: wild, a: 'Яків' }]]), [], 'refused: ' + wild);
    assert.equal(b.get('view'), undefined);
    b.seen(wild);                                                       // (a snapshot's version: the same rule)
    assert.ok(b.next() < Date.now() + 1000, 'the clock did not move: ' + wild);
    b.merge([a.set('view', 'dragons')]);
    const later = b.set('view', null);                                  // a later change, as usual
    assert.deepEqual(a.merge([later]), ['view'], 'it wins: ' + wild);
    assert.equal(a.get('view'), null);
  }
});

test('a device whose clock runs a month fast still counts, and the others write after it', () => {
  const fast = Date.now() + 30 * 24 * 3600 * 1000;
  const a = roomState('Аня'), b = roomState('Богдан');
  assert.deepEqual(a.merge([['view', { v: 'dragons', c: fast, a: 'Богдан' }]]), ['view']);
  assert.equal(a.get('view'), 'dragons');
  const after = a.set('view', null);                                  // made after seeing it: later
  assert.ok(after[1].c > fast);
  b.merge([['view', { v: 'dragons', c: fast, a: 'Богдан' }]]);
  assert.deepEqual(b.merge([after]), ['view']);
  assert.equal(b.get('view'), null);
  const s = roomState('Сава');
  s.seen(fast);
  assert.ok(s.next() > fast, 'seen takes it too');
});
