// The previous release's library and this one in one game (phase 1a, J1: what an old library does with each change
// is in the headers of together.js, net/internet.js and net/nearby.js), in worker tabs over fake brokers
// (tests/support), the room's timing scaled down (AUTH_WAIT 3 s). The previous release is the newest tag whose
// library/ differs from this checkout's (tests/support/release.js; skipped where there is none, such as CI's shallow
// clone). Either one holding the room: they are seated together, the game's messages and shared values go both ways,
// a round moves from one's copy to the other's from its snapshot (old snapshots say nothing of their seats; new ones
// say more than an old library reads), and a round that is over stays over for both.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { previousRelease } from '../support/release.js';
import { settled, shows, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;
let dir, prev;
before(() => { dir = mkdtempSync(join(tmpdir(), 'ihroteka-release-')); prev = previousRelease(dir); });
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

const evs = (g, from = 0) => g.events.slice(from).map(e => e.slice(1).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names && x.linked) && g;
}, 6000);
// Аня holds the room, Богдан joins; old: whose tab runs the previous release's library
async function pair(t, code, old) {
  const W = world(t, { scale: SCALE });
  const A = await W.tab('p1tab', {}, old === 'Аня' ? { library: prev.library } : {});
  await A.lib(code, 'Аня', {});
  assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
  const B = await W.tab('p2tab', {}, old === 'Богдан' ? { library: prev.library } : {});
  await B.lib(code, 'Богдан', {});
  assert.ok(await until(settled([A, B]), 8000), prev.tag + ': ' + await shows([A, B]));
  return [A, B];
}

describe('the previous release and this one in one game', { concurrency: 2 }, () => {
  for (const old of ['Аня', 'Богдан']) {
    test('seated together; messages and shared values both ways; the round moves either way (' + old + '\'s library is the previous release)', T, async t => {
      if (!prev) { t.skip('no earlier release tag in this checkout'); return; }
      const [A, B] = await pair(t, 'rel' + (old === 'Аня' ? 1 : 2), old);
      await A.open('g');                                     // Богдан follows into the game
      assert.ok(await plays([A, B], 'Аня,Богдан'), 'they play together: ' + JSON.stringify(await Promise.all([A.game(), B.game()])));
      await A.gsend({ t: 'move', n: 1 }); await B.gsend({ t: 'move', n: 2 });
      await A.share('mode', 'race'); await B.share('score', { Аня: 1 });
      const got = async (X, n) => (await X.game()).got.some(([, m]) => m.t === 'move' && m.n === n);
      assert.ok(await until(async () => await got(B, 1) && await got(A, 2), 3000), 'the game\'s messages both ways');
      assert.ok(await until(async () => (await B.shared('mode')) === 'race' && (await A.shared('score'))?.Аня === 1, 3000), 'shared values both ways');

      // Аня's copy runs the round; she drops out: after AUTH_WAIT Богдан's copy runs it on from her snapshot
      assert.equal((await A.game()).role, 'host');
      await A.snapshot({ round: 1, n: 5 });
      await sleep(300);
      const { AUTH_WAIT } = (await B.info()).timing;
      await A.net({ up: false });
      const b = await until(async () => { const g = await B.game(); return g.role === 'host' && g.events.some(e => e[1] === 'resume') && g; }, AUTH_WAIT + 6000, 50);
      assert.ok(b, 'Богдан runs the round on: ' + evs(await B.game()));
      assert.ok(evs(b).includes('resume {"round":1,"n":5}'), evs(b).join(' | '));
      await A.net({ up: true });
      assert.ok(await until(async () => { const g = await A.game(); return g.linked && g.role === 'guest'; }, 15000, 100), 'Аня back, a guest: ' + evs(await A.game()));

      // Богдан's copy now runs it; then the round is over (snapshot null): Аня's copy never takes it on
      await B.snapshot({ round: 1, n: 9 });
      await sleep(300);
      await B.snapshot(null);
      await sleep(300);
      const n = (await A.game()).events.length;
      await B.net({ up: false });
      await sleep(AUTH_WAIT + 2500);
      const a = evs(await A.game(), n);
      assert.deepEqual(a.filter(x => x.startsWith('resume')), [], 'a round that is over does not come back: ' + a);
    });
  }

  // (phase 1b, D1: a player back after their place dropped counts as loading until a here: of theirs comes after it;
  // a library from before that never writes one again on the same page, it only greets with the one it had: without
  // counting that, the game waited as long as a place is kept, «— повертається в гру» with nothing to press)
  test('a previous-release player whose place dropped comes back on the same page: the game waits only for their greeting', T, async t => {
    if (!prev) { t.skip('no earlier release tag in this checkout'); return; }
    const [A, B] = await pair(t, 'rel3', 'Богдан');
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    const { HOLD } = (await A.info()).timing;
    await B.net({ up: false });
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000));
    await A.release('Богдан');                               // «Не чекати»: his place goes
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня', 5000));
    await B.net({ up: true });                               // his game open all along: back as a new player
    const a = await until(async () => { const g = await A.game(); return g.linked && !g.weak && g.players.join() === 'Аня,Богдан' && g; }, HOLD / 4, 50);
    assert.ok(a, 'Аня plays with Богдан again: ' + JSON.stringify((await A.state()).lib.game));
    assert.equal(await A.gsend({ t: 'move', n: 3 }), true);
    assert.ok(await until(async () => (await B.game()).got.some(([, m]) => m.t === 'move' && m.n === 3), 5000), 'what her game sends reaches his');
  });
});
