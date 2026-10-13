// A quit that outlives a reload (library/app/round.js invariant 5; owner: «Пам'ятати вихід»), in worker tabs that run
// the real library over fake brokers (tests/support). A player of a round who quits it while its runner is away asks
// the runner, and the quit holds until that round is over; it is kept in the tab (sessionStorage 'ihroteka-quits',
// with the room it was said in and the player's name), so the page reloaded before the runner is back says it again:
// the round ends 'quit' by that player for everyone, and the reopened page shows it as quit (no 'run' or 'watch' of
// it). The same holds for a page that leaves the room and comes back into it as the same player (nearby, a reloaded
// page whose first pairing was given up: that room is left, the next pairing makes a new one). Another room or name
// never takes it back, a round that is over or another round drops it, and a browser that keeps no site data (or a
// broken entry) costs only the reload.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, QUITS = 'ihroteka-quits';
const where = (code, name) => JSON.stringify(['internet', code, name]);   // (round.js: the room a quit was said in)
// the round events the game heard: 'start Аня', 'run fresh' or 'run {state}', 'watch Аня', 'end quit Богдан'
const rlines = g => g.events.filter(e => e[1].startsWith('round:')).map(([, n, a]) => n.slice(6) + ' ' + (n === 'round:start' ? a.by : n === 'round:run' ?
  (a.state === null ? 'fresh' : JSON.stringify(a.state)) : n === 'round:watch' ? a.runner : n === 'round:end' ? a.reason + ' ' + a.by : a));
const rec = async (X, game = 'g') => ((await X.state()).lib.rounds || {})[game];
const saveOf = async (X, game = 'g') => ((await X.state()).lib.saves || {})[game];
const heardR = (X, l, ms = 5000) => until(async () => { const g = await X.game(); return g && rlines(g).includes(l) && g; }, ms, 50);
const over = (X, ms) => until(async () => { const x = await rec(X); return x && !x.on && x; }, ms, 100);
const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names && x.linked) && g;
}, 8000);
// Аня's round (saved once, Богдан has its snapshot), then Аня cut off and Богдан quits it meanwhile → its id
async function quitWhileAway(A, B) {
  await A.open('g');
  assert.ok(await plays([A, B], 'Аня,Богдан'));
  assert.equal(await A.call('rstart', {}), true);
  assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
  assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
  const { id } = await rec(A);
  await A.net({ up: false });
  assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000), 'Богдан sees Аня away');
  assert.equal(await B.call('rquit'), true);
  assert.deepEqual(rlines(await B.game()).at(-1), 'end quit Богдан', 'at once for him');
  return id;
}

// (each test has its own network and tabs: they run side by side)
describe('a quit outlives a reload', { concurrency: 3 }, () => {
  test('said while the runner is away, then the page reloads: the runner back hears it, the round ends quit for everyone', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rq1', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    assert.deepEqual(await B.stored(QUITS), { room: where('rq1', 'Богдан'), q: { g: id } }, 'kept in the tab, with its room and name');
    const B2 = await B.reload();                             // Богдан's page reloads before Аня is back
    await B2.lib('rq1', 'Богдан');
    assert.deepEqual(await B2.stored(QUITS), { room: where('rq1', 'Богдан'), q: { g: id } }, 'the new page takes it back');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B2)));
    assert.deepEqual([r.id, r.reason, r.by, r.runner], [id, 'quit', 'Богдан', 'Аня'], 'Аня\'s copy ended it: the quit reached it');
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    const b = await over(B2, 5000);
    assert.deepEqual(b && [b.id, b.reason, b.by], [id, 'quit', 'Богдан'], 'and Богдан\'s page knows it');
    assert.equal(await B2.stored(QUITS), null, 'its round over, the tab keeps it no more');
    const g = await B2.game();
    assert.ok(!g || !rlines(g).length, 'his new page never heard that round (it was told its end before the reload): ' + (g && rlines(g)));
  });

  test('the page reopened before the runner is back shows the round as quit; when the round moves to its copy, it ends it', T, async t => {
    const W = world(t, { scale: 0.5 });                     // (AUTH_WAIT 5 s: Богдан reloads well within it)
    const [S, A, B] = await room(W, 'rq2', ['Сава', 'Аня', 'Богдан'], { lib: {} });
    await S.call('gameSlow', { on: true });                  // Сава holds the room; her game never opens (no seat, no proof)
    const id = await quitWhileAway(A, B);
    const before = (await B.game()).round;
    const B2 = await B.reload();
    await B2.lib('rq2', 'Богдан');
    // Сава greets the new page with the round, still on, its runner away: the game opens and shows it as quit
    const g = await until(async () => { const x = await B2.game(); return x && (await rec(B2))?.id === id && x.seated && x; }, 8000, 50);
    assert.ok(g, 'Богдан\'s new page in the game, with the round: ' + JSON.stringify(await rec(B2)));
    assert.equal((await rec(B2)).on, true);
    await sleep(500);
    const g2 = await B2.game();
    assert.deepEqual(g2.round, before, 'what the game sees is what it saw before the reload');
    assert.deepEqual([g2.round.active, g2.round.id, g2.round.mySeat], [false, null, -1]);
    assert.deepEqual(rlines(g2), [], 'no run, no watch of it');
    // Аня stays away: the round moves to Богдан's new copy, which ends it (the quit), never running it on first
    const { AUTH_WAIT } = (await B2.info()).timing;
    const r = await over(S, AUTH_WAIT + 10000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(S)));
    assert.deepEqual([r.id, r.reason, r.by, r.runner], [id, 'quit', 'Богдан', 'Богдан']);
    assert.ok(!(await B2.state()).lib.trace.some(l => /runs on here/.test(l)), 'ended, not run on first');
    assert.deepEqual(rlines(await B2.game()), [], 'his game hears nothing more of it');
    assert.equal(await B2.stored(QUITS), null);
    await A.net({ up: true });
    assert.ok(await heardR(A, 'end quit Богдан', 20000), 'back, Аня hears it: ' + rlines(await A.game()));
  });

  test('another room or another name never takes it back: back in its own room after that, the round goes on for him', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rq3', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    const kept = await B.call('sessionAll');
    // the tab's next page could as well go to another room: it drops it (a copy of the tab, its own world)
    const X = await W.tab('p9tab', {}, { kept });
    await X.lib('rq3x', 'Богдан');
    assert.equal(await X.stored(QUITS), null, 'another room: not its quit');
    await X.leave();
    const B2 = await B.reload();
    await B2.lib('rq3', 'Борис');                            // the same room, as someone else
    assert.equal(await B2.stored(QUITS), null, 'another name: not theirs');
    await B2.lib('rq3', 'Богдан');                           // and as himself again, in the same page: nothing to take back
    assert.equal(await B2.stored(QUITS), null);
    await A.net({ up: true });
    const g = await heardR(B2, 'watch Аня', 20000);
    assert.ok(g, 'the round is on for him again: ' + JSON.stringify(await rec(B2)) + ' ' + ((await B2.game()) && rlines(await B2.game())));
    assert.deepEqual([g.round.active, g.round.id, g.round.mySeat], [true, id, 1]);
    await sleep(1000);
    assert.equal((await rec(A)).on, true, 'and it goes on');
  });

  test('the page leaves the room and comes back into it as the same player (a pairing given up, then one that works): the quit still holds', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rq6', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    await B.leave();                                         // (as invite.js does with a nearby room whose pairing was given up)
    assert.deepEqual(await B.stored(QUITS), { room: where('rq6', 'Богдан'), q: { g: id } }, 'the room left keeps it for that room');
    await B.lib('rq6', 'Богдан');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B)));
    assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'it reached the round\'s runner: over for everyone');
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    const b = await over(B, 5000);
    assert.deepEqual(b && [b.id, b.reason, b.by], [id, 'quit', 'Богдан'], 'and Богдан\'s page knows it');
    assert.equal(await B.stored(QUITS), null, 'its round over, the tab keeps it no more');
    const g = await B.game();
    assert.deepEqual([rlines(g).filter(l => l.startsWith('end')), g.round.active], [['end quit Богдан'], false], 'his game heard its end once, at the quit');
  });

  // (review: the quit moved to his copy, which ended the round with nobody to hear it; the reload lost that end and
  // the round came back on with its runner, his new page watching it)
  for (const reload of [true, false]) {
    test('the round moves to his copy, which ends it with nobody to hear: ' + (reload ? 'a reload before the runner is back keeps the quit' : 'the runner back gets the end, the tab lets it go'), T, async t => {
      const W = world(t, { scale: 0.5 });                   // (AUTH_WAIT 5 s)
      const code = reload ? 'rq7' : 'rq8';
      const [A, B] = await room(W, code, ['Аня', 'Богдан'], { lib: {} });
      const id = await quitWhileAway(A, B);
      const b = await over(B, 15000);
      assert.deepEqual(b && [b.id, b.reason, b.by, b.runner], [id, 'quit', 'Богдан', 'Богдан'], 'it moved to his copy, which ended it: ' + JSON.stringify(await rec(B)));
      assert.deepEqual(await B.stored(QUITS), { room: where(code, 'Богдан'), q: { g: id } }, 'nobody heard that end yet: the quit stays');
      let X = B;
      if (reload) {
        X = await B.reload();
        await X.lib(code, 'Богдан');
        await sleep(500);
      }
      await A.net({ up: true });
      const r = await over(A, 20000);
      assert.ok(r, 'over for Аня too: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(X)));
      assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', 'Богдан']);
      assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
      assert.ok(await until(async () => (await X.stored(QUITS)) === null, 5000), 'Аня has the end: the tab keeps the quit no more');
      await sleep(500);
      const g = await X.game(), lines = g ? rlines(g) : [];
      if (reload) assert.deepEqual(lines, [], 'his new page heard nothing of that round');
      else assert.deepEqual([lines.filter(l => l.startsWith('end')), lines.at(-1)], [['end quit Богдан'], 'end quit Богдан'], 'his game heard its end once, at the quit: ' + lines);
      assert.equal((await rec(X)).on, false);
    });
  }

  // (review: nearby too, where a room has no code: the phone's name and the round's id say whose quit it is)
  test('nearby: the guest quits while the host (its runner) is cut off, the page reloads and pairs again: the host ends it', T, async t => {
    const W = world(t, { rtc: true });
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    const pairUp = async (H, G) => { const offer = await H.pair('offer'); await H.pair('finish', await G.pair('answer', offer)); };
    await A.libNear('Аня');
    await B.libNear('Богдан');
    await pairUp(A, B);
    assert.ok(await until(settled([A, B]), 8000));
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await A.call('rstart', {}), true);
    assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    const { id } = await rec(A);
    await A.killDc();                                        // (the host's phone dropped its direct links)
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 8000), 'Богдан sees Аня away');
    assert.equal(await B.call('rquit'), true);
    assert.deepEqual(await B.stored(QUITS), { room: JSON.stringify(['nearby', '', 'Богдан']), q: { g: id } });
    const B2 = await B.reload();
    await B2.libNear('Богдан');
    await A.libNear('Аня');                                  // (the host's own room: it shows its code again)
    await pairUp(A, B2);
    assert.ok(await until(settled([A, B2]), 8000), 'paired again');
    const r = await over(A, 10000);
    assert.deepEqual(r && [r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'the host ends it: ' + JSON.stringify(await rec(A)));
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    assert.ok(await until(async () => (await B2.stored(QUITS)) === null, 5000), 'over: the tab keeps it no more');
    const g = await B2.game();
    assert.deepEqual(g ? rlines(g) : [], [], 'his new page heard nothing of that round');
  });

  test('a quit whose round ended meanwhile is dropped; the next round is not touched by it', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rq4', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    const B2 = await B.reload();                             // a page slow to come back: meanwhile Аня is back and ends it
    await A.net({ up: true });
    assert.ok(await until(async () => (await A.state()).online, 10000));
    assert.equal(await A.call('rover', { result: { w: 0 } }), true);
    assert.ok(await heardR(A, 'end over Аня', 3000));
    await B2.lib('rq4', 'Богдан');
    const b = await over(B2, 15000);
    assert.deepEqual(b && [b.id, b.reason], [id, 'over'], 'Богдан\'s page learns how it ended: ' + JSON.stringify(await rec(B2)));
    assert.equal(await B2.stored(QUITS), null, 'its round is over: dropped');
    assert.ok(await plays([A, B2], 'Аня,Богдан'));
    assert.equal(await A.call('rstart', {}), true);
    const g = await heardR(B2, 'watch Аня', 5000);
    assert.ok(g, 'the next round: ' + ((await B2.game()) && rlines(await B2.game())));
    assert.deepEqual(rlines(g), ['start Аня', 'watch Аня'], 'nothing of the old one');
    assert.equal(g.round.active, true);
    assert.notEqual(g.round.id, id);
  });

  test('kept as the browser lets it: blocked site data or a broken entry throws nothing, and the quit still holds in the page', T, async t => {
    const W = world(t);
    // entries the page cannot take: not JSON; another shape; ids that are not a game's or a round's (only the good one is)
    const X = await W.tab('p8tab', {}, { kept: [[QUITS, '{"room":']] });
    await X.lib('rq5x', 'Аня');
    assert.equal(await X.stored(QUITS), null);
    const Y = await W.tab('p9tab', {}, { kept: [[QUITS, JSON.stringify({ room: where('rq5y', 'Аня'), q: { g: 'NOT-AN-ID', 'Не гра': 'abcdefgh', h: 'abcdefgh', k: 7 } })]] });
    await Y.lib('rq5y', 'Аня');
    assert.deepEqual(await Y.stored(QUITS), { room: where('rq5y', 'Аня'), q: { h: 'abcdefgh' } });
    await Promise.all([X.leave(), Y.leave()]);
    assert.deepEqual([await X.stored(QUITS), await Y.stored(QUITS)], [null, { room: where('rq5y', 'Аня'), q: { h: 'abcdefgh' } }],
      'a room left keeps it for that room (and nothing it had not)');
    // a browser that blocks site data: sessionStorage throws; the quit holds as long as the page lives
    const [A, B] = await room(W, 'rq5', ['Аня', 'Богдан'], { lib: {} });
    await B.siteData(false);
    await quitWhileAway(A, B);
    assert.equal(await B.stored(QUITS), null, 'nothing kept');
    await A.net({ up: true });
    assert.ok(await heardR(A, 'end quit Богдан', 20000), 'back, Аня hears it: ' + rlines(await A.game()));
  });
});
