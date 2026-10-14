// Browsers without what Safari 15.4 brought (Safari 15.0–15.3 on older iPhones, which owner decision 25 cares about): no
// Array.prototype.at, findLast, findLastIndex, String.prototype.at, structuredClone, Object.hasOwn. Two library tabs
// without them (tests/support: strip) play a round together; nothing goes wrong inside either.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { settled, shows, until, world } from '../support/world.js';

const STRIP = ['Array.prototype.at', 'Array.prototype.findLast', 'Array.prototype.findLastIndex', 'String.prototype.at', 'structuredClone', 'Object.hasOwn'];

test('two players on a browser without .at(), findLast, structuredClone and Object.hasOwn play a round together', { timeout: 40000 }, async t => {
  const W = world(t, { scale: 0.3 });
  const A = await W.tab('p1tab', {}, { strip: STRIP }), B = await W.tab('p2tab', {}, { strip: STRIP });
  assert.deepEqual(await A.call('typeOf', { names: STRIP }), STRIP.map(() => 'undefined'), 'the tab has none of them');
  await A.lib('compat01', 'Аня');
  assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
  await B.lib('compat01', 'Богдан');
  assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
  await A.open('g');
  assert.ok(await until(async () => { const g = await Promise.all([A.game(), B.game()]); return g.every(x => x && x.linked && x.players.join() === 'Аня,Богдан'); }, 6000), 'both play');
  assert.equal(await A.call('rstart', { setup: { n: 1 } }), true, 'Аня\'s copy starts a round');
  assert.ok(await until(async () => (await B.game()).round.active, 4000), 'Богдан is in it');
  assert.equal(await A.call('rsave', { s: { n: 2 } }), true);
  await A.call('rover', { result: { w: 'Аня' } });
  assert.ok(await until(async () => (await B.game()).heard.includes('round:end'), 4000), 'it is over for Богдан too');
  assert.deepEqual(await W.errors(), [], 'nothing went wrong inside the tabs');
});
