// A page's life in the browser and the room (library/net/link.js watch, room.js pagehide and pageshow; internet.js back),
// in worker tabs over fake brokers only (tests/support): a host whose hidden tab the browser wakes only now and then
// (Chrome holds back a hidden tab's timers: a tick a minute, its sockets live) still judges silence, since what it hears
// meanwhile says the page itself ran; and a page back from the back-forward cache (Safari closes its sockets, freezes it
// and brings it back: pagehide and pageshow, persisted), whose pagehide said bye, is in its room again at once — a guest
// says hello again, a host whose bye was lost says no stale one later, and a host whose guests moved on joins them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, show, shows, sleep, states, until, world } from '../support/world.js';

const evs = async (T, from) => (await T.events()).slice(from).map(([, ...e]) => e.join(' '));
const STAY = 8000;                                         // (in the cache: longer than SLEEP and GRACE, shorter than HOST_WAIT)

describe('a hidden tab whose timers are held back', () => {
  // (after the audit, phase 2: each late tick counted as a sleep of its own, which resets every link's silence: such a host
  // never noticed a guest whose tab died, kept its place for good, and asked the room who holds it at every wake)
  test('a host whose hidden tab wakes only now and then (brokers only) still sees a guest whose tab died: away at its next wake, the place gone after HOLD, and it asks nobody who', { timeout: 90000 }, async t => {
    // (WEAK 0.45 s, HOST_WAIT 3 s, HOLD 20 s; SLEEP as in a browser, 1.3 s: scaled, a worker that stalls 0.4 s under load
    // would look asleep, and a wake that is no sleep is what this test is about)
    const W = world(t, { scale: 0.3, timing: { HOLD: 20000, SLEEP: 1300 } }), S = W.spy();
    const [A, B, C] = await room(W, 'life01', ['Аня', 'Богдан', 'Віра']);
    const { timing } = await A.info('life01');
    const a0 = (await A.events()).length, b0 = (await B.events()).length;
    await A.hide(true);
    await A.throttle({ every: 5000 });                       // its watchdog wakes every 5 s now; the brokers still deliver
    await sleep(6000);                                       // (a wake or two of it: nothing changes)
    const asked = () => S.seen.filter(x => x.m && x.m.t === 'who' && x.m.f === A.session).length;
    const who0 = asked();
    await C.kill();                                          // (a crash: no goodbye)
    const t0 = Date.now();
    assert.ok(await until(async () => (await B.state()).away.includes('Віра'), 8000, 100), 'away at the host\'s next wake: ' + show(await B.state()));
    const away = Date.now() - t0;
    assert.ok(await until(async () => !(await B.state()).players.includes('Віра'), timing.HOLD + 15000, 250), 'her place goes: ' + show(await B.state()));
    const gone = Date.now() - t0;
    assert.ok(gone > timing.HOLD - 1000, 'after HOLD (' + timing.HOLD + ' ms): ' + gone);
    assert.equal(asked() - who0, 0, 'it asked nobody who holds the room');
    const ea = await evs(A, a0), eb = await evs(B, b0);
    assert.ok(!ea.some(e => /^(away|leave) Богдан/.test(e)), 'nobody else judged: ' + ea.join(', '));
    assert.ok(!eb.some(e => /^(away Аня|peer-gone)/.test(e)), 'nor the host, by Богдан: ' + eb.join(', '));
    assert.deepEqual((await states([A, B])).map(s => [s.role, s.linked, s.players.join()]), [['host', true, 'Аня,Богдан'], ['guest', true, 'Аня,Богдан']],
      await shows([A, B]));
    console.log('    (Віра away for Богдан after ' + away + ' ms, her place gone after ' + gone + ' ms)');
  });
});

describe('back from the back-forward cache', { concurrency: 3 }, () => {
  // (after the audit, phase 2: a guest back from the cache showed a frozen field for 5 s, then named its host in a row with
  // «Не чекати», and its stale bye went again and moved it out)
  test('a guest that goes into the cache and comes back after 8 s is linked again at once, and never waits for its host', { timeout: 60000 }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'life02', ['Аня', 'Богдан']);
    const a0 = (await A.events()).length, b0 = (await B.events()).length;
    await B.pagehide({ persisted: true });                   // its goodbye goes: the host lets the link go (the place stays)
    assert.ok(await until(async () => !(await A.state()).linked, 3000), 'the host heard the bye: ' + show(await A.state()));
    await sleep(400);
    await B.pageshow({ after: STAY });
    const t0 = Date.now();
    const back = await until(async () => {
      const [a, b] = await states([A, B]);
      return a.linked && !a.away.length && b.linked && !b.weak && (await evs(B, b0)).includes('relinked Аня false');
    }, 5000);
    const took = Date.now() - t0;
    assert.ok(back && took < 2500, 'linked again in ' + took + ' ms: ' + await shows([A, B]));
    const eb = await evs(B, b0);
    assert.ok(!eb.includes('weak true') && !eb.includes('away Аня true'), 'the guest never waits for its host: ' + eb.join(', '));
    assert.ok((await evs(A, a0)).includes('relinked Богдан false'), 'the host: the same tab, a new link: ' + (await evs(A, a0)).join(', '));
    await sleep(1500);
    assert.deepEqual((await states([A, B])).map(s => [s.role, s.linked]), [['host', true], ['guest', true]], 'and it stays: ' + await shows([A, B]));
  });

  test('a host of three whose bye was lost comes back: it says no bye later, nobody moves', { timeout: 60000 }, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'life03', ['Аня', 'Богдан', 'Віра']);
    const b0 = (await B.events()).length, c0 = (await C.events()).length;
    await A.pagehide({ persisted: true, lost: true });       // (its sockets died before the bye got out)
    await sleep(400);
    await A.pageshow({ after: STAY });
    await sleep(3000);                                       // (what was not acknowledged has gone again by now)
    const s = await states([A, B, C]);
    assert.deepEqual(s.map(x => x.role), ['host', 'guest', 'guest'], s.map(show).join(' | '));
    assert.ok(s.every(x => x.linked && !x.weak && !x.away.length), s.map(show).join(' | '));
    for (const [T, n] of [[B, b0], [C, c0]]) {
      const e = await evs(T, n);
      assert.ok(!e.includes('peer-gone') && !e.some(x => /^leave|^relinked Аня true/.test(x)), 'no stale bye: ' + e.join(', '));
    }
  });

  test('a host of three whose guests moved on while it was in the cache joins whoever took over, at once', { timeout: 60000 }, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'life04', ['Аня', 'Богдан', 'Віра']);
    await A.pagehide({ persisted: true });                   // its bye goes: the first of its guests takes over
    assert.ok(await until(async () => (await B.state()).role === 'host', 3000), show(await B.state()));
    await sleep(400);
    await A.pageshow({ after: STAY });
    const t0 = Date.now();
    const ok = await until(async () => (await states([A, B, C])).every(x => x.linked && !x.away.length && x.host === 'Богдан' && x.players.length === 3), 5000);
    const took = Date.now() - t0;
    assert.ok(ok && took < 1500, 'together under Богдан in ' + took + ' ms: ' + await shows([A, B, C]));
  });
});
