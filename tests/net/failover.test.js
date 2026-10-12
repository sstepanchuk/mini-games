// The room's host going away (library/net/internet.js), in worker tabs over fake brokers (tests/support), with the
// room's timing scaled down (window.__timeScale 0.3: HOST_WAIT 3 s, WEAK 0.45 s): only after HOST_WAIT does the
// first player still here take over, the others follow and every place is kept; the old host comes back as a
// guest. A host that leaves or closes its tab is followed at once. The known bugs are { todo } tests.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, states, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;

// (each test has its own network and tabs: they run side by side)
describe('the room\'s host going away', { concurrency: 3 }, () => {
  test('the host gone: after HOST_WAIT the first player still here takes over, places kept; back, it joins as a guest', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail1', ['Аня', 'Богдан', 'Сава']);
    const { HOST_WAIT } = (await A.info()).timing;
    const t0 = Date.now();
    await A.net({ up: false });
    const took = await until(async () => (await B.state()).role === 'host' && Date.now(), HOST_WAIT + 5000);
    assert.ok(took, 'Богдан (the first player still here) takes over: ' + await shows([B, C]));
    // (the wait counts from the last thing Аня sent, up to a pulse before she went)
    assert.ok(took - t0 > HOST_WAIT - 400 && took - t0 < HOST_WAIT + 2000, 'after HOST_WAIT (' + HOST_WAIT + ' ms), not sooner: ' + (took - t0) + ' ms');
    const s = await until(async () => { const x = await states([B, C]); return x.every(y => y.linked && y.host === 'Богдан') && x; }, 8000);
    assert.ok(s, 'Сава follows: ' + await shows([B, C]));
    for (const x of s) {
      assert.deepEqual(x.players, ['Аня', 'Богдан', 'Сава'], 'every place is kept: ' + show(x));
      assert.deepEqual(x.away, ['Аня'], show(x));
    }
    await A.net({ up: true });
    const back = await until(settled([A, B, C]), 15000);
    assert.ok(back, 'all three again: ' + await shows([A, B, C]));
    assert.deepEqual(back.map(x => x.role), ['guest', 'host', 'guest'], 'Аня plays on as a guest');
    assert.deepEqual(back[0].players, ['Аня', 'Богдан', 'Сава']);
  });

  test('the host leaves for good: the next player holds the room at once, without the old host\'s place', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail2', ['Аня', 'Богдан', 'Сава']);
    const t0 = Date.now();
    await A.leave();
    const s = await until(settled([B, C]), 3000);
    assert.ok(s, await shows([B, C]));
    assert.ok(Date.now() - t0 < 1500, 'at once: ' + (Date.now() - t0) + ' ms');
    assert.deepEqual(s.map(x => [x.role, x.players.join()]), [['host', 'Богдан,Сава'], ['guest', 'Богдан,Сава']]);
  });

  test('the host\'s tab closes: the next player holds the room at once; the host\'s new tab gets its place back', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail3', ['Аня', 'Богдан', 'Сава']);
    const t0 = Date.now();
    await A.close();                                         // pagehide: a bye that keeps the place (a reload, say)
    const s = await until(async () => { const x = await states([B, C]); return x.every(y => y.linked && y.host === 'Богдан' && y.away.join() === 'Аня') && x; }, 3000);
    assert.ok(s, await shows([B, C]));
    assert.ok(Date.now() - t0 < 2000, 'at once: ' + (Date.now() - t0) + ' ms');
    assert.deepEqual(s[0].players, ['Аня', 'Богдан', 'Сава'], 'Аня\'s place is kept');
    const A2 = await W.tab('p4tab');
    await A2.join('fail3', 'Аня');
    const all = await until(settled([A2, B, C]), 8000);
    assert.ok(all, await shows([A2, B, C]));
    assert.deepEqual(all.map(x => x.role), ['guest', 'host', 'guest']);
    assert.deepEqual(all[0].players, ['Аня', 'Богдан', 'Сава'], 'in her old place, first');
  });

  test('the host\'s tab frozen a moment (a locked phone): nobody takes over, and it holds the room on', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail5', ['Аня', 'Богдан', 'Сава']);
    const { HOST_WAIT } = (await A.info()).timing;
    const n = [(await B.events()).length, (await C.events()).length];
    await A.freeze(HOST_WAIT - 1000);
    assert.ok(await until(settled([A, B, C]), 8000), 'all three again: ' + await shows([A, B, C]));
    assert.equal((await A.state()).role, 'host');
    const ev = [...(await B.events()).slice(n[0]), ...(await C.events()).slice(n[1])].map(e => e.slice(1).join(' '));
    assert.ok(ev.includes('weak true'), 'the others paused: ' + ev);
    assert.ok(!ev.some(e => e.startsWith('role') || e.startsWith('leave')), 'and nothing else changed: ' + ev);
  });

  /* ---------- known bugs (phase 1) ---------- */
  // Found by these tests (README: "when the old host comes back, it joins as a guest"): a host whose tab was frozen,
  // awake, counts its silent links as here for GRACE (link.js: watch), so it wins the merge (internet.js: 'host', more
  // players here) and the others move over to it again.
  test('the host\'s tab frozen longer than HOST_WAIT: the next player takes over; awake, the old host joins as a guest', { ...T, todo: 'phase 1b: today, awake, it keeps the room and the others move back to it' }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail6', ['Аня', 'Богдан', 'Сава']);
    const { HOST_WAIT } = (await A.info()).timing;
    const awake = A.freeze(HOST_WAIT + 2500);
    assert.ok(await until(async () => (await B.state()).role === 'host', HOST_WAIT + 2000), 'Богдан takes over meanwhile');
    await awake;
    const s = await until(settled([A, B, C]), 10000, 100);
    assert.ok(s, 'all three again: ' + await shows([A, B, C]));
    assert.deepEqual(s.map(x => x.role), ['guest', 'host', 'guest'], 'Богдан holds the room; Аня plays on as a guest');
    assert.deepEqual(s[0].players, ['Аня', 'Богдан', 'Сава']);
  });

  test('a guest left with nobody to follow looks for the room again, keeping every place and saying no final bye', { ...T, todo: 'phase 1b (C5): today discover() resets the places to us alone and says a final bye' }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail4', ['Аня', 'Богдан', 'Сава']);
    const S = W.spy();
    await A.net({ up: false }); await B.net({ up: false });  // the host and the next player drop out at once
    // Сава waits HOST_WAIT for Аня, says hello to Богдан six times (1.2 s apart), then looks for the room again
    const s = await until(async () => { const x = await C.state(); return x.role === 'host' && x; }, 20000, 100);
    assert.ok(s, 'Сава holds a room: ' + show(await C.state()));
    const byes = S.seen.filter(x => x.m.f === C.session && x.m.t === 'bye' && x.m.menu === 1);
    assert.deepEqual(s.players, ['Аня', 'Богдан', 'Сава'], 'everyone keeps their place');
    assert.deepEqual(byes, [], 'no final bye: nobody left for good');
  });
});
