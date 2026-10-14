// The room's host going away (library/net/internet.js), in worker tabs over fake brokers (tests/support), with the
// room's timing scaled down (window.__timeScale 0.3: HOST_WAIT 3 s, WEAK 0.45 s): only after HOST_WAIT does the
// first player still here take over, the others follow and every place is kept; the old host comes back as a
// guest, also from a frozen tab. A host that leaves or closes its tab is followed at once; a guest left with nobody
// to follow keeps every place. In a room of two, the side that was cut off (its brokers silent longer than HOST_WAIT:
// brokers.js deafBack) comes back as a guest, whatever the sessions; both cut off, one host at once. The network back,
// the room hears again at once ('online' checks the brokers, whatever the silence checked just before).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;
// a room of two whose sessions start with these pids (sessions decide a tie), the first holds it → its tabs, settled
async function two(W, code, pids, names = ['Аня', 'Богдан']) {
  const tabs = [];
  for (const [i, pid] of pids.entries()) {
    const X = await W.tab(pid);
    await X.join(code, names[i]);
    assert.ok(await until(async () => { const s = await X.state(); return i ? s.linked : s.role === 'host'; }, 5000), names[i] + ' is in: ' + await shows([...tabs, X]));
    tabs.push(X);
  }
  assert.ok(await until(settled(tabs), 10000), await shows(tabs));
  return tabs;
}
// the events since n (each tab's count), without those of a link's mood (stats, weak, away)
const since = async (tabs, n) => Promise.all(tabs.map(async (X, i) => (await X.events()).slice(n[i]).map(e => e.slice(1).join(' ')).filter(e => !/^(stats|weak|away)/.test(e))));
const counts = tabs => Promise.all(tabs.map(async X => (await X.events()).length));
// (deafBack: a gap longer than HOST_WAIT and than two echo tests, 5 s apart and not scaled)
const DEAF = 10000;

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

  // (phase 1b, C4: a guest used to take the others' presence from the host's last word, so a third player who
  // dropped out with the host still looked here: enough for a guest to take a round over, splitting it)
  test('a guest cut off from the host cannot vouch for anyone: every other player is away until a host is back', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'fail7', ['Аня', 'Богдан', 'Сава']);
    const { WEAK, HOST_WAIT } = (await A.info()).timing;
    const t0 = Date.now();
    await A.net({ up: false });
    const s = await until(async () => { const x = await states([B, C]); return x.every(y => y.away.length === 2) && x; }, HOST_WAIT - 500);
    assert.ok(s, 'cut off, each sees everyone else away: ' + await shows([B, C]));
    assert.ok(Date.now() - t0 < WEAK + 1500 && Date.now() - t0 < HOST_WAIT, 'as soon as the host is: ' + (Date.now() - t0) + ' ms');
    assert.deepEqual(s.map(x => x.away), [['Аня', 'Сава'], ['Аня', 'Богдан']]);
    assert.deepEqual(s.map(x => x.players.join()), ['Аня,Богдан,Сава', 'Аня,Богдан,Сава'], 'every place kept');
    const ev = (await B.events()).map(e => e.slice(1).join(' '));
    assert.ok(ev.includes('away Сава true'), 'the game hears it: ' + ev);
    // the first player here, as the host last said, still takes over; the other follows it
    const back = await until(async () => { const x = await states([B, C]); return x.every(y => y.linked && y.host === 'Богдан' && y.away.join() === 'Аня') && x; }, HOST_WAIT + 6000);
    assert.ok(back, 'Богдан holds the room, Сава is here again: ' + await shows([B, C]));
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
    assert.deepEqual([(await A.state()).role, (await B.state()).role, (await C.state()).role], ['host', 'guest', 'guest']);
    const ev = [...(await B.events()).slice(n[0]), ...(await C.events()).slice(n[1])].map(e => e.slice(1).join(' '));
    assert.ok(ev.includes('weak true'), 'the others paused: ' + ev);
    // (a guest that moves on says so in its status: joining another host, or holding the room)
    assert.ok(!ev.some(e => e.startsWith('status') || e.startsWith('leave')), 'and nothing else changed: ' + ev);
  });

  // (phase 1b: a host whose tab was frozen, awake, used to count its silent links as here for GRACE (link.js: watch),
  // so it won the merge (internet.js: 'host', more players here) and the others moved over to it again)
  test('the host\'s tab frozen longer than HOST_WAIT: the next player takes over; awake, the old host joins as a guest', T, async t => {
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

  // (phase 1b review: a host awake from such a sleep used to start over (discover) whether or not anyone had taken the
  // room over: with its guests asleep too (two phones locked on a table), its room fell apart and came back, 'peer-gone',
  // role null and 'host' again, 'waiting' meanwhile, and both games paused and heard 'relinked')
  test('the host and its guest both asleep longer than HOST_WAIT: nobody took over, so nothing starts over', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'fail8', ['Аня', 'Богдан']);
    const { HOST_WAIT } = (await A.info()).timing;
    const n = [(await A.events()).length, (await B.events()).length];
    await Promise.all([A.freeze(HOST_WAIT * 1.5), B.freeze(HOST_WAIT * 1.5)]);
    const s = await until(settled([A, B]), 10000, 100);
    assert.ok(s, await shows([A, B]));
    await sleep(HOST_WAIT);                                  // (time for anything that would start over)
    assert.deepEqual((await states([A, B])).map(x => x.role), ['host', 'guest']);
    const ev = [...(await A.events()).slice(n[0]), ...(await B.events()).slice(n[1])].map(e => e.slice(1).join(' '));
    assert.ok(!ev.some(e => /^(peer-gone|role|linked|relinked|leave|status)/.test(e)), 'the same room, as it was: ' + ev);
  });

  // (phase 1b, C5: discover() used to reset the places to us alone and say a final bye)
  test('a guest left with nobody to follow looks for the room again, keeping every place and saying no final bye', T, async t => {
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

  // (lifecycle-slow-webkit-03: awake, the host's announcement could run before the watchdog saw the sleep: alone by its
  // count, it said so to the new host, which gave way to it, while it gave way to that one: both said hello as guests
  // for ~7 s. Its brokers started over at that wake hid it; they no longer do.) The freeze is timed by what the spy
  // sees of Аня's ticks: her announcement (every 2.5 s) falls due in it before her watchdog's next tick (every 200 ms).
  test('a host frozen longer than HOST_WAIT with healthy connections, its announcement due before the watchdog: awake, it joins the new host within ~1 s, and Богдан never says joining', T, async t => {
    const W = world(t, { scale: SCALE }), S = W.spy(), at = [];
    const push = S.seen.push.bind(S.seen);
    S.seen.push = x => { at.push(performance.timeOrigin + performance.now()); return push(x); };
    const [A, B] = await room(W, 'fail13', ['Аня', 'Богдан']);
    const { HOST_WAIT } = (await A.info()).timing;
    const last = f => { for (let i = S.seen.length - 1; i >= 0; i--) if (f(S.seen[i].m, S.seen[i])) return at[i]; return null; };
    await sleep(1000);
    const ann = last(m => m.f === A.session && m.t === 'host' && m.to === undefined);   // her announcements: 2.5 s apart
    const tick = last((m, x) => m.f === A.session && m.t === 'd' && x.topic.includes('/d/') && m.d.some(y => y.t === 'p'));   // her pulses: each tick
    assert.ok(ann && tick, 'the spy sees her ticks');
    const now = performance.timeOrigin + performance.now();
    let due = ann + 2500 * Math.ceil((now + 400 - ann) / 2500), go;
    for (;;) {                                               // frozen 30 ms before the announcement, well after a tick
      go = due - 30;
      const d = ((go - tick) % 200 + 200) % 200;             // (since her watchdog's last tick)
      if (d > 15 && d < 155) break;
      due += 2500;
    }
    const n = await Promise.all([A, B].map(async X => (await X.events()).length));
    await sleep(go - (performance.timeOrigin + performance.now()));
    await A.freeze(HOST_WAIT + 2500);
    const t0 = Date.now();
    const s = await until(async () => { const x = await settled([A, B])(); return x && x[1].role === 'host' && x; }, 8000, 50);
    assert.ok(s, 'together again, under Богдан: ' + await shows([A, B]));
    assert.ok(Date.now() - t0 < 1500, 'within ~1 s: ' + (Date.now() - t0) + ' ms');
    const eb = (await B.events()).slice(n[1]).map(e => e.slice(1).join(' '));
    assert.ok(!eb.some(e => /^status (joining|connecting)/.test(e)), 'Богдан held the room all along: ' + eb);
    await sleep(1000);
    assert.deepEqual((await states([A, B])).map(x => x.role), ['guest', 'host'], 'and it stays so');
  });

  // (net-core-05: the silence's own check of the brokers (link.js setWeak → kick) took the 3 s limit, and the one of
  // 'online' a moment later did nothing: the room waited for a broker's retry, 1.5–2 s)
  test('a 2 s outage: the room hears again within 1 s of the network coming back (the silence\'s check does not swallow the one of online)', T, async t => {
    const W = world(t);                                      // (scale 1: the 3 s limit is not scaled, WEAK would be)
    const [A, B] = await room(W, 'fail9', ['Аня', 'Богдан']);
    for (let i = 0; i < 2; i++) {
      await B.net({ up: false });
      await sleep(2000);
      assert.ok((await B.state()).weak, 'silent 2 s: Богдан hears nobody (weak: link.js checked the brokers then)');
      await B.net({ up: true });                             // 'online' (fakenet.js): the room checks its brokers at once
      const t0 = Date.now();
      const back = await until(async () => { const [a, b] = await states([A, B]); return a.linked && b.linked && !a.weak && !b.weak && b.online; }, 6000, 20);
      const ms = Date.now() - t0;
      assert.ok(back && ms < 1000, 'back within 1 s, not when a broker\'s retry comes round: ' + (back ? ms + ' ms' : 'not back') + ' ' + await shows([A, B]));
    }
  });

  // (net-core-10: a room of two that split was a tie of one player each, which went to the smaller session: the old host
  // took the room back about half the time, and the one who held it meanwhile became a guest)
  test('the host offline longer than HOST_WAIT in a room of two: back, it joins as a guest', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await two(W, 'fail10', ['p1tab', 'p2tab']);   // (the old host's session is the smaller: the tie was hers)
    const { HOST_WAIT } = (await A.info()).timing;
    const t0 = Date.now();
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.state()).role === 'host', HOST_WAIT + 5000), 'Богдан takes over: ' + await shows([A, B]));
    await sleep(t0 + DEAF + 1000 - Date.now());
    const n = await counts([A, B]);
    await A.net({ up: true });
    const s = await until(settled([A, B]), 8000, 50);
    assert.ok(s, 'together again: ' + await shows([A, B]));
    assert.deepEqual(s.map(x => x.role), ['guest', 'host'], 'Аня, cut off, plays on as a guest');
    assert.deepEqual(s[0].players, ['Аня', 'Богдан'], 'in her place');
    await sleep(2000);
    assert.deepEqual((await states([A, B])).map(x => x.role), ['guest', 'host'], 'and it stays so');
    const [ea, eb] = await since([A, B], n);
    assert.ok(!eb.some(e => /^status (joining|connecting)/.test(e)), 'Богдан never looks for another host: ' + eb);
    assert.ok(ea.includes('status ready'), ea);
  });

  test('a guest offline longer than HOST_WAIT in a room of two holds the room alone meanwhile; back, it joins its host again', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await two(W, 'fail11', ['p2tab', 'p1tab']);   // (the guest's session is the smaller: the tie was his)
    const { HOST_WAIT } = (await A.info()).timing;
    const t0 = Date.now();
    await B.net({ up: false });
    assert.ok(await until(async () => (await B.state()).role === 'host', HOST_WAIT + 5000), 'Богдан, alone, holds the room meanwhile: ' + await shows([A, B]));
    await sleep(t0 + DEAF + 1000 - Date.now());
    const n = await counts([A, B]);
    await B.net({ up: true });
    const s = await until(settled([A, B]), 8000, 50);
    assert.ok(s, 'together again: ' + await shows([A, B]));
    assert.deepEqual(s.map(x => x.role), ['host', 'guest'], 'Аня, who was here all along, still holds the room');
    await sleep(2000);
    assert.deepEqual((await states([A, B])).map(x => x.role), ['host', 'guest'], 'and it stays so');
    const [ea] = await since([A, B], n);
    assert.ok(!ea.some(e => /^status (joining|connecting)/.test(e)), 'Аня never looks for another host: ' + ea);
  });

  for (const pids of [['p1tab', 'p2tab'], ['p9tab', 'p2tab']]) {
    test('both offline in a room of two: back, one host at once (sessions ' + pids.join(', ') + ')', T, async t => {
      const W = world(t, { scale: SCALE });
      const [A, B] = await two(W, 'fail12' + pids[0][1], pids);
      const { HOST_WAIT } = (await A.info()).timing;
      const t0 = Date.now();
      await Promise.all([A.net({ up: false }), B.net({ up: false })]);
      assert.ok(await until(async () => (await B.state()).role === 'host', HOST_WAIT + 5000), 'Богдан, alone, holds a room meanwhile');
      await sleep(t0 + DEAF + 1000 - Date.now());
      await Promise.all([A.net({ up: true }), B.net({ up: true })]);
      const t1 = Date.now(), s = await until(settled([A, B]), 8000, 50);
      assert.ok(s, 'together again: ' + await shows([A, B]));
      assert.ok(Date.now() - t1 < 3000, 'at once: ' + (Date.now() - t1) + ' ms');
      await sleep(2000);
      const s2 = await states([A, B]);
      assert.deepEqual(s2.map(x => x.role), s.map(x => x.role), 'and it stays so');
      assert.ok(await settled([A, B])(), await shows([A, B]));
    });
  }

  // (phase 2 review: a host whose brokers alone went silent while its direct links carried the room was never cut off
  // from it; giving way then handed the room in play to a newcomer who held one alone meanwhile, and every player heard
  // the others leave, which ends a round)
  test('a host whose brokers fall silent longer than HOST_WAIT while its direct links carry the room: back, a newcomer who held a room alone meanwhile joins it, nobody leaves', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE, rtc: true });
    const [A, B, C] = await room(W, 'fail14', ['Аня', 'Богдан', 'Сава']);
    assert.ok(await until(async () => (await states([A, B, C])).every(s => s.direct), 15000, 50), 'direct: ' + await shows([A, B, C]));
    const t0 = Date.now();
    await A.net({ brokers: false });                         // (the direct links still carry the room)
    const D = await W.tab('p4tab');
    await D.join('fail14', 'Дана');
    assert.ok(await until(async () => (await D.state()).role === 'host', 5000), 'Дана, who finds nobody, holds a room alone: ' + show(await D.state()));
    await sleep(t0 + DEAF + 1000 - Date.now());
    assert.deepEqual((await states([A, B, C])).map(x => x.role), ['host', 'guest', 'guest'], 'the room in play stays: ' + await shows([A, B, C]));
    const n = await counts([A, B, C]);
    await A.net({ brokers: true });
    const s = await until(settled([A, B, C, D]), 10000, 50);
    assert.ok(s, 'one room: ' + await shows([A, B, C, D]));
    assert.deepEqual(s.map(x => x.role), ['host', 'guest', 'guest', 'guest'], 'Дана joins Аня\'s room');
    const ev = await since([A, B, C], n);
    assert.ok(ev.every(e => !e.some(x => /^(leave|peer-gone|relinked|status joining)/.test(x))), 'nobody in play leaves or starts over: ' + JSON.stringify(ev));
  });
});
