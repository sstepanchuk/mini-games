// A quit that outlives a reload and follows the player (library/app/round.js invariant 5; owner: «Пам'ятати вихід»,
// and decision 50), in worker tabs that run the real library over fake brokers (tests/support). A player of a round
// who quits it while its runner is away asks the runner, and the quit holds until that round is over. It is kept in
// the browser (localStorage 'ihroteka-quits': one entry per room it was said in and player's name, so every tab of the
// browser sees it; a tab of the release before kept it in sessionStorage, and hands it over), so the page reloaded
// before the runner is back says it again: the round ends 'quit' by that player for everyone, and the reopened page
// shows it as quit (no 'run' or 'watch' of it). The same holds for a page that leaves the room and comes back into it
// as the same player (nearby, a reloaded page whose first pairing was given up: that room is left, the next pairing
// makes a new one). Another room or name never takes it back (it stays for its own), a round that is over or another
// round drops it, and a browser that keeps no site data (or a broken entry) costs only the reload. So with every end a
// copy writes (quit, over…): the browser keeps it until another copy shows it back, so a page reloaded before then ends
// that round again when it sees it on. A quit is said again every 2 s while its runner is here (what the room's host
// was passing on is lost as a link starts over). And it is the player's own key in the room's shared state (quit:<name>):
// whoever holds the room keeps it for them, the runner back ends that round, and the player's other device takes it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, QUITS = 'ihroteka-quits';
const where = (code, name) => JSON.stringify(['internet', code, name]);   // (round.js: the room a quit was said in)
// what the browser keeps of the quits said in room w (where) under its name: its entry in localStorage QUITS (round.js:
// one per room and name), without when it was written → { q?, e? } | null; kept(X, code, name): an internet room's
const keptAt = async (X, w) => {
  const v = (await X.local()).find(([k]) => k === QUITS), all = v && JSON.parse(v[1]);
  if (!all || !all[w]) return null;
  const e = { ...all[w] };
  delete e.at;
  return e;
};
const kept = (X, code, name) => keptAt(X, where(code, name));
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
    assert.deepEqual(await kept(B, 'rq1', 'Богдан'), { q: { g: id } }, 'kept in the browser, for its room and name');
    const B2 = await B.reload();                             // Богдан's page reloads before Аня is back
    await B2.lib('rq1', 'Богдан');
    assert.deepEqual(await kept(B2, 'rq1', 'Богдан'), { q: { g: id } }, 'the new page takes it back');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B2)));
    assert.deepEqual([r.id, r.reason, r.by, r.runner], [id, 'quit', 'Богдан', 'Аня'], 'Аня\'s copy ended it: the quit reached it');
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    const b = await over(B2, 5000);
    assert.deepEqual(b && [b.id, b.reason, b.by], [id, 'quit', 'Богдан'], 'and Богдан\'s page knows it');
    assert.equal(await kept(B2, 'rq1', 'Богдан'), null, 'its round over, the browser keeps it no more');
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
    assert.ok(await until(async () => (await kept(B2, 'rq2', 'Богдан')) === null, 5000), 'Сава has the end: the browser keeps it no more');
    await A.net({ up: true });
    assert.ok(await heardR(A, 'end quit Богдан', 20000), 'back, Аня hears it: ' + rlines(await A.game()));
  });

  test('another room or another name never takes it back, and leaves it for its own room: back in it as himself, the quit holds', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rq3', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    const taken = async X => (await X.state()).lib.trace.some(l => /quit, kept from the page before/.test(l));
    // another tab of his browser goes to another room as him: not its quit, which stays for its own room
    const X = await W.tab('p9tab', {}, { local: B.browser });
    await X.lib('rq3x', 'Богдан');
    await sleep(300);
    assert.ok(!await taken(X), 'another room: not its quit');
    assert.deepEqual([await kept(X, 'rq3x', 'Богдан'), await kept(X, 'rq3', 'Богдан')], [null, { q: { g: id } }], 'it stays for its own room');
    await X.leave();
    const B2 = await B.reload();
    await B2.lib('rq3', 'Борис');                            // the same room, as someone else
    await sleep(300);
    assert.ok(!await taken(B2), 'another name: not theirs');
    assert.deepEqual(await kept(B2, 'rq3', 'Богдан'), { q: { g: id } }, 'it stays for him');
    await B2.lib('rq3', 'Богдан');                           // and as himself again, in the same page: his quit holds
    assert.ok(await taken(B2), 'taken back');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.deepEqual(r && [r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'over for everyone: ' + JSON.stringify(await rec(A)));
    assert.ok(await until(async () => (await kept(B2, 'rq3', 'Богдан')) === null, 5000), 'over: the browser keeps it no more');
  });

  test('the page leaves the room and comes back into it as the same player (a pairing given up, then one that works): the quit still holds', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rq6', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    await B.leave();                                         // (as invite.js does with a nearby room whose pairing was given up)
    assert.deepEqual(await kept(B, 'rq6', 'Богдан'), { q: { g: id } }, 'the room left keeps it for that room');
    await B.lib('rq6', 'Богдан');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B)));
    assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'it reached the round\'s runner: over for everyone');
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    const b = await over(B, 5000);
    assert.deepEqual(b && [b.id, b.reason, b.by], [id, 'quit', 'Богдан'], 'and Богдан\'s page knows it');
    assert.equal(await kept(B, 'rq6', 'Богдан'), null, 'its round over, the browser keeps it no more');
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
      const k = await kept(B, code, 'Богдан');
      assert.deepEqual(k && [k.q, k.e.g.id, k.e.g.reason, k.e.g.by], [undefined, id, 'quit', 'Богдан'], 'nobody has that end yet: the browser keeps it (the end, not the quit): ' + JSON.stringify(k));
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
      assert.ok(await until(async () => (await kept(X, code, 'Богдан')) === null, 5000), 'Аня has the end: the browser keeps it no more');
      await sleep(500);
      const g = await X.game(), lines = g ? rlines(g) : [];
      if (reload) assert.deepEqual(lines, [], 'his new page heard nothing of that round');
      else assert.deepEqual([lines.filter(l => l.startsWith('end')), lines.at(-1)], [['end quit Богдан'], 'end quit Богдан'], 'his game heard its end once, at the quit: ' + lines);
      assert.equal((await rec(X)).on, false);
    });
  }

  // (audit: an end our copy wrote with nobody to have it, lost with the page; the other copy, back, brought the round
  // back on, and our new page ran it on or watched it: a quit undone, a round over going on, against decision 24)
  for (const how of ['quit', 'over']) {
    test('the runner ' + (how === 'quit' ? 'quits' : 'ends') + ' its round while the other is away, then its page reloads: over for both, with its reason and result (' + how + ')', T, async t => {
      const W = world(t, { scale: 0.5 });
      const code = how === 'quit' ? 'rq9' : 'rq10', result = how === 'over' ? { w: 'Аня' } : null;
      const [A, B] = await room(W, code, ['Аня', 'Богдан'], { lib: {} });
      await A.open('g');
      assert.ok(await plays([A, B], 'Аня,Богдан'));
      assert.equal(await A.call('rstart', {}), true);
      assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
      assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
      const { id } = await rec(A);
      await B.net({ up: false });
      assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000), 'Аня sees Богдан away');
      assert.equal(await A.call(how === 'quit' ? 'rquit' : 'rover', { result }), true);
      const k = await kept(A, code, 'Аня');
      assert.deepEqual(k && [k.q, k.e.g.id, k.e.g.reason, k.e.g.by, k.e.g.result], [undefined, id, how, 'Аня', result],
        'nobody has that end yet: the browser keeps it: ' + JSON.stringify(k));
      const A2 = await A.reload();                           // her page reloads before Богдан is back
      await A2.lib(code, 'Аня');
      await A2.open('g');
      await sleep(500);
      await B.net({ up: true });
      const b = await heardR(B, 'end ' + how + ' Аня', 20000);
      assert.ok(b, 'back, Богдан hears its end: ' + ((await B.game()) && rlines(await B.game())) + ' ' + JSON.stringify(await rec(B)));
      assert.deepEqual(b.events.find(e => e[1] === 'round:end')[2], { id, by: 'Аня', reason: how, result }, 'with its reason and result');
      const [rb, ra] = [await rec(B), await rec(A2)];
      assert.deepEqual([rb.id, rb.on, ra.id, ra.on], [id, false, id, false], 'over for both: ' + JSON.stringify([rb, ra]));
      assert.ok(await until(async () => (await kept(A2, code, 'Аня')) === null, 5000), 'Богдан has the end: the browser keeps it no more');
      await sleep(500);
      const g = await A2.game();
      assert.deepEqual(g ? rlines(g) : [], [], 'her new page heard nothing of that round');
      assert.deepEqual([(await rec(B)).on, (await rec(A2)).on], [false, false]);
    });
  }

  // (audit: the end reached her only after his page saw her here; the page reloaded in between lost it)
  test('the round moves to his copy, which ends it; Аня back over a slow link, his page reloads about 1 s after she is here: over for Аня', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });                     // (AUTH_WAIT 5 s)
    const [A, B] = await room(W, 'rq11', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    const b = await over(B, 15000);
    assert.deepEqual(b && [b.id, b.reason, b.by, b.runner], [id, 'quit', 'Богдан', 'Богдан'], 'it moved to his copy, which ended it: ' + JSON.stringify(await rec(B)));
    await B.net({ lat: 1500 });                              // what Богдан's page sends takes 1.5 s to arrive
    await A.net({ up: true });
    assert.ok(await until(async () => { const s = await B.state(); return s.linked && !s.away.length; }, 30000, 5), 'Аня here for him');
    await sleep(1000);
    const X = await B.reload();
    await X.lib('rq11', 'Богдан');
    await X.open('g');
    const r = await over(A, 15000);
    assert.ok(r, 'the round he quit is over for Аня too: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(X)));
    assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', 'Богдан']);
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    assert.ok(await over(X, 5000), 'and his new page knows it');
    await sleep(500);
    const g = await X.game();
    assert.ok(!g || !rlines(g).some(l => /^(watch|run)/.test(l)), 'his new page is never in it: ' + (g && rlines(g)));
    assert.ok(await until(async () => (await kept(X, 'rq11', 'Богдан')) === null, 5000), 'Аня has the end: the browser keeps it no more');
  });

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
    const near = JSON.stringify(['nearby', '', 'Богдан']);
    assert.deepEqual(await keptAt(B, near), { q: { g: id } });
    const B2 = await B.reload();
    await B2.libNear('Богдан');
    await A.libNear('Аня');                                  // (the host's own room: it shows its code again)
    await pairUp(A, B2);
    assert.ok(await until(settled([A, B2]), 8000), 'paired again');
    const r = await over(A, 10000);
    assert.deepEqual(r && [r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'the host ends it: ' + JSON.stringify(await rec(A)));
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    assert.ok(await until(async () => (await keptAt(B2, near)) === null, 5000), 'over: the browser keeps it no more');
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
    assert.equal(await kept(B2, 'rq4', 'Богдан'), null, 'its round is over: dropped');
    assert.ok(await plays([A, B2], 'Аня,Богдан'));
    assert.equal(await A.call('rstart', {}), true);
    const g = await heardR(B2, 'watch Аня', 5000);
    assert.ok(g, 'the next round: ' + ((await B2.game()) && rlines(await B2.game())));
    assert.deepEqual(rlines(g), ['start Аня', 'watch Аня'], 'nothing of the old one');
    assert.equal(g.round.active, true);
    assert.notEqual(g.round.id, id);
  });

  test('kept as the browser lets it: blocked site data or a broken entry throws nothing, and the quit still holds in the page; one a tab of the release before kept moves into the browser\'s store', T, async t => {
    const W = world(t);
    // entries the page cannot take: not JSON; another shape; ids that are not a game's or a round's (only the good one is)
    const X = await W.tab('p8tab', {}, { local: { [QUITS]: '{"room":' } });
    await X.lib('rq5x', 'Аня');
    assert.ok(!(await X.local()).some(([k]) => k === QUITS), 'nothing to keep: the broken entry goes');
    const Y = await W.tab('p9tab', {}, { local: { [QUITS]: JSON.stringify({ [where('rq5y', 'Аня')]: { q: { g: 'NOT-AN-ID', 'Не гра': 'abcdefgh', h: 'abcdefgh', k: 7 }, at: 1 }, x: 7 }) } });
    await Y.lib('rq5y', 'Аня');
    assert.deepEqual(await kept(Y, 'rq5y', 'Аня'), { q: { h: 'abcdefgh' } });
    // (the release before kept one entry in the tab: sessionStorage { room, q })
    const Z = await W.tab('p7tab', {}, { kept: [[QUITS, JSON.stringify({ room: where('rq5z', 'Аня'), q: { h: 'abcdefgh' } })]] });
    await Z.lib('rq5z', 'Аня');
    assert.deepEqual([await kept(Z, 'rq5z', 'Аня'), await Z.stored(QUITS)], [{ q: { h: 'abcdefgh' } }, null], 'into the browser\'s store, out of the tab\'s');
    await Promise.all([X.leave(), Y.leave()]);
    assert.deepEqual([await kept(X, 'rq5x', 'Аня'), await kept(Y, 'rq5y', 'Аня')], [null, { q: { h: 'abcdefgh' } }],
      'a room left keeps it for that room (and nothing it had not)');
    // a browser that blocks site data: its storage throws; the quit holds as long as the page lives
    const [A, B] = await room(W, 'rq5', ['Аня', 'Богдан'], { lib: {} });
    await B.siteData(false);
    await quitWhileAway(A, B);
    assert.equal(await kept(B, 'rq5', 'Богдан'), null, 'nothing kept');
    await A.net({ up: true });
    assert.ok(await heardR(A, 'end quit Богдан', 20000), 'back, Аня hears it: ' + rlines(await A.game()));
  });
});

// A quit goes to the round's runner through whoever holds the room; what the host keeps for a player whose links start
// over (her page gave the room up for lost and comes back as a guest) is gone with them, and nobody hears of that: the
// quit is said again every 2 s while its runner is here, until that round is over (round.js QUIT_AGAIN, invariant 5).
// (audit: else the runner, back, ran the round on, and the one who quit waited until something relinked)
describe('a quit is said again while its runner is here', { concurrency: 2 }, () => {
  // Сава holds the room, her game closed (no seat); Аня runs the round, Богдан plays it; his quit while she is out
  async function cutOff(t, code, how) {
    const W = world(t, { scale: 0.5 });
    const [S, A, B] = await room(W, code, ['Сава', 'Аня', 'Богдан'], { lib: {} });
    await S.call('gameSlow', { on: true });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await A.call('rstart', {}), true);
    assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    const { id } = await rec(A);
    await A.net(how);
    if (how.up === false) assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000), 'Богдан sees Аня away');
    assert.equal(await B.call('rquit'), true);
    return { A, B, id };
  }
  async function back(A, how) {
    assert.ok(await until(async () => (await A.state()).role === 'host', 15000, 100), 'Аня gives the room up for lost (HOST_WAIT) and holds her own');
    await A.net(how);
    assert.ok(await until(async () => { const s = await A.state(); return s.role === 'guest' && s.linked && !s.away.length; }, 15000, 100), 'Аня back with Сава, as a guest');
  }

  test('the runner hears nothing for longer than HOST_WAIT while a player quits, then hears again: the quit reaches her, the round is over', { timeout: 60000 }, async t => {
    const { A, B, id } = await cutOff(t, 'rq12', { hear: false });
    await back(A, { hear: true });
    const r = await over(A, 10000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B)));
    assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', 'Богдан']);
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
  });

  test('the runner cut off for longer than HOST_WAIT while a player quits and goes to the shelf, then back: the quit reaches her, the round is over', { timeout: 60000 }, async t => {
    const { A, B, id } = await cutOff(t, 'rq13', { up: false });
    const before = rlines(await A.game());                    // (['start Аня', 'run fresh']: the tab keeps what its games heard)
    await B.open(null);                                      // Богдан goes to the shelf (everyone here follows)
    await back(A, { up: true });
    const r = await over(A, 10000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B)));
    assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', 'Богдан']);
    assert.ok(await until(async () => (await A.game()) === null, 3000), 'Аня followed him to the shelf');
    await B.open('g');                                       // the game again, together: that round is not in it
    const g = await until(async () => { const x = await A.game(); return x && x.linked && x; }, 8000);
    assert.ok(g, 'Аня in the game again');
    await sleep(500);
    const a = await A.game();
    // (her game was closed when it ended, after it heard its part: opened again, it hears that end once, decision 49)
    assert.deepEqual([a.round.active, rlines(a)], [false, [...before, 'end quit Богдан']], 'no round; of it, only its end');
  });

  // (audit round-02: what the host was passing on to the runner is lost as their link starts over; said again, and
  // the room keeps the player's own key too)
  test('the runner\'s link with the room\'s host starts over while the quit waits in the host\'s outbox: the quit reaches her, the round is over', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [S, A, B] = await room(W, 'rq16', ['Сава', 'Аня', 'Богдан'], { lib: {} });
    await S.call('gameSlow', { on: true });                  // Сава holds the room; her game never opens
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await A.call('rstart', {}), true);
    assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    const { id } = await rec(A);
    await A.net({ hear: false });                            // Аня hears nothing for a moment: what Сава passes on waits in her outbox
    assert.equal(await B.call('rquit'), true);
    await sleep(300);                                        // (it reached Сава, who passes it on: in her outbox for Аня)
    const { topic } = await S.info('rq16', 'ihroteka');
    W.spy().publish(topic, { t: 'bye', to: S.session }, A.session);   // Сава lets Аня's link go: it starts over (her outbox is gone)
    await sleep(300);
    await A.net({ hear: true });
    const r = await over(A, 15000);
    assert.deepEqual(r && [r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'the round he quit ends: ' + JSON.stringify(await rec(A)));
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
  });
});

// A quit follows the player (owner, decision 50): it is the player's own key in the room's shared state (quit:<name>
// = { game: round id }, round.js invariant 5; only they write it), so whoever holds the room keeps it for them and
// the runner, back, ends that round; and the browser keeps it for every one of its tabs (localStorage, one entry per
// room and name). The honest limit: two players, the other device, the runner away: nobody else holds it.
describe('a quit follows the player', { concurrency: 2 }, () => {
  const replaced = X => until(async () => (await X.events()).some(e => e[1] === 'replaced'), 25000);

  test('3 players: a quit said while the runner is away, then the player goes on on another device: the room keeps the quit, the runner back ends it, the new device shows it over', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [S, A, B] = await room(W, 'rq17', ['Сава', 'Аня', 'Богдан'], { lib: {} });
    await S.call('gameSlow', { on: true });                  // Сава holds the room; her game never opens (no seat, no proof)
    const id = await quitWhileAway(A, B);
    assert.ok(await until(async () => (await S.state()).lib.keys.includes('quit:Богдан'), 3000), 'Сава\'s room keeps his quit');
    const B2 = await W.tab('p7tab');                         // his other device (a browser of its own)
    await B2.lib('rq17', 'Богдан');
    assert.ok(await replaced(B), 'the old device stepped aside');
    const g = await until(async () => { const x = await B2.game(); return x && (await rec(B2))?.id === id && x.seated && x; }, 8000, 50);
    assert.ok(g, 'in the game, with the round: ' + JSON.stringify(await rec(B2)));
    await sleep(500);
    const g2 = await B2.game();
    assert.deepEqual([g2.round.active, g2.round.mySeat, rlines(g2)], [false, -1, []], 'the new device shows it quit: never in it');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A)));
    assert.deepEqual([r.id, r.reason, r.by, r.runner], [id, 'quit', 'Богдан', 'Аня'], 'her copy ended it: the room kept the quit for him');
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    assert.ok(await over(B2, 5000), 'the new device knows it is over');
    assert.deepEqual(rlines(await B2.game()), [], 'and heard nothing of that round');
  });

  test('2 players: a quit said while the runner is away, then the player goes on in a new tab of the same browser: it takes the quit back, the runner back ends it', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [A, B] = await room(W, 'rq18', ['Аня', 'Богдан'], { lib: {} });
    const id = await quitWhileAway(A, B);
    const B2 = await W.tab('p7tab', {}, { local: B.browser });   // a new tab of his browser
    await B2.lib('rq18', 'Богдан');
    assert.ok(await replaced(B), 'the old tab stepped aside');
    assert.deepEqual(await kept(B2, 'rq18', 'Богдан'), { q: { g: id } }, 'the browser keeps it for every tab');
    await A.net({ up: true });
    const r = await over(A, 20000);
    assert.deepEqual(r && [r.id, r.reason, r.by], [id, 'quit', 'Богдан'], 'over: ' + JSON.stringify(await rec(A)) + ' ' + JSON.stringify(await rec(B2)));
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    const g = await B2.game();
    assert.ok(!g || !rlines(g).some(l => /^(run|watch)/.test(l)), 'his new tab is never in it: ' + (g && rlines(g)));
    assert.ok(await until(async () => (await kept(B2, 'rq18', 'Богдан')) === null, 5000), 'over: the browser keeps it no more');
  });
});
