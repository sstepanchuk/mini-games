// Whose copy runs a round (library/app/together.js with rules.js), in worker tabs that run the real library over
// fake brokers (tests/support), with the room's timing scaled down (window.__timeScale 0.3: AUTH_WAIT and
// HOST_WAIT 3 s). The round moves only when its runner has been gone for AUTH_WAIT, and only with proof that it
// was the runner who dropped out: someone else here with us, or the brokers answering us all that time. The
// runner back plays on as a guest. The known bugs are { todo } tests of what should happen.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;
const evs = (g, from = 0) => g.events.slice(from).map(e => e.slice(1).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names) && g.filter(x => x.seated).every(x => x.linked) && g;
}, 6000);

// (each test has its own network and tabs: they run side by side)
describe('whose copy runs a round', { concurrency: 3 }, () => {
  test('the runner gone: after AUTH_WAIT the first seated player still here runs the round on from its last snapshot', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'run1', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'), 'Аня and Богдан play, Сава waits');
    await A.snapshot({ round: 1, n: 5 });
    await sleep(300);                                        // (the first snapshot goes at once)
    const { AUTH_WAIT } = (await A.info()).timing;
    const t0 = Date.now();
    await A.net({ up: false });
    const b = await until(async () => { const g = await B.game(); return g.role === 'host' && g.events.some(e => e[1] === 'resume') && g; }, AUTH_WAIT + 6000, 50);
    assert.ok(b, 'Богдан runs the round on: ' + evs(await B.game()));
    assert.ok(Date.now() - t0 > AUTH_WAIT - 400, 'not before AUTH_WAIT (' + AUTH_WAIT + ' ms): ' + (Date.now() - t0) + ' ms');
    const e = evs(b);
    assert.ok(e.includes('role host') && e.indexOf('role host') < e.indexOf('resume {"round":1,"n":5}'), 'role, then resume with the snapshot: ' + e);
    assert.equal(b.host, 'Богдан');
    const c = await until(async () => { const g = await C.game(); return g.host === 'Богдан' && g; }, 3000);
    assert.ok(c && !c.seated && c.players.join() === 'Аня,Богдан', 'Сава still waits; Аня keeps her seat');
  });

  test('two players, the runner gone: the other runs on (the brokers answer it all that time); back, the runner plays as a guest', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'run2', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 2 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    const b = await until(async () => { const g = await B.game(); return g.events.some(e => e[1] === 'resume') && g; }, AUTH_WAIT + 6000, 50);
    assert.ok(b, 'Богдан runs the round on: ' + evs(await B.game()));
    assert.ok(evs(b).includes('resume {"round":2}') && b.role === 'host');
    await A.net({ up: true });
    const a = await until(async () => { const g = await A.game(); return g.linked && g.role === 'guest' && g; }, 15000, 100);
    assert.ok(a, 'Аня plays on as a guest: ' + evs(await A.game()));
    assert.ok(evs(a).includes('role guest') && a.host === 'Богдан');
    assert.equal((await B.game()).role, 'host');
  });

  test('a player who dropped out themself does not take the round over', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'run3', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 3 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    const n = (await B.game()).events.length;
    await B.net({ up: false });                              // Богдан cannot tell it was not him: nobody vouches for him
    await sleep(AUTH_WAIT + 2500);
    const b = await B.game();
    assert.ok(b.weak, 'Богдан waits (paused)');
    assert.deepEqual(evs(b, n).filter(e => /^(role|resume)/.test(e)), [], 'no takeover: ' + evs(b, n));
    assert.equal(b.host, 'Аня');
    await B.net({ up: true });
    const g = await until(async () => { const x = await Promise.all([A.game(), B.game()]); return x.every(y => y.linked && !y.weak) && x; }, 15000, 100);
    assert.ok(g, 'together again');
    assert.deepEqual(g.map(x => x.role), ['host', 'guest'], 'Аня still runs the round');
  });

  /* ---------- known bugs (phase 1) ---------- */
  // Found by these tests: a player back from an outage on the same session, to a room's host that stayed linked with
  // others, is greeted by nobody (together.js greets on 'linked', 'join' and 'relinked'; this is only 'away' → false),
  // so it misses what changed meanwhile, auth:<game> among it: with three players, two copies run the round.
  test('the runner back after the round moved on, in a room of three, learns it and plays on as a guest', { ...T, todo: 'phase 1: today nobody greets it, and two copies run the round' }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'run5', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await A.snapshot({ round: 5 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.game()).events.some(e => e[1] === 'resume'), AUTH_WAIT + 6000, 50), 'Богдан runs the round on');
    await A.net({ up: true });
    const g = await until(async () => { const x = await Promise.all([A.game(), B.game()]); return x.every(y => y.linked && !y.weak) && x; }, 15000, 100);
    assert.ok(g, 'together again');
    await sleep(1500);
    const a = await A.game();
    assert.deepEqual([a.host, (await B.game()).host], ['Богдан', 'Богдан'], 'one runner, the same for both');
    assert.equal(a.role, 'guest', 'Аня plays on as a guest: ' + evs(a));
  });

  test('a round whose runner left for good does not come back (no resume after peer-gone)', { ...T, todo: 'phase 1a (B1): today the other player resumes the round that is over' }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'run4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 4 });
    await sleep(300);
    const n = (await B.game()).events.length;
    await A.leave();                                         // Аня leaves for good: her round is over
    await sleep(1500);
    const e = evs(await B.game(), n);
    assert.ok(e.includes('peer-gone'), 'the round is over: ' + e);
    assert.deepEqual(e.slice(e.indexOf('peer-gone')).filter(x => x.startsWith('resume')), [], 'and it does not come back: ' + e);
  });
});
