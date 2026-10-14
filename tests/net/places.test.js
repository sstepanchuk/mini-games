// The places a page keeps in its tab (library/net/room.js, internet.js; owner, q29), in worker tabs over fake brokers
// (tests/support): an internet room's page keeps its list of players in sessionStorage ('ihroteka-places'), and a fresh
// page in the same room as the same player that holds the room only because nobody answered takes those places back,
// away since they dropped out (their 3 minutes count from the drop, not from the reload; one already past them is not
// taken), says 'restored', and from there each is held as any place. Another room or name, or a room someone still
// holds (that one's list rules): nothing.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, sleep, until, world } from '../support/world.js';

const T = { timeout: 60000 };
const said = async (tab, ev) => (await tab.events()).some(e => e[1] === ev);
// the tab's room: these players, these of them away
const holds = (tab, players, away) => async () => { const s = await tab.state(); return s && s.players.join() === players.join() && s.away.join() === away.join() && s; };

// (small-games-11: a page reloaded while every other player was away knew nobody: a game on one device, no waiting
// screen, and the absent player's 3 minutes were nobody's to count)
describe('a lone reloaded page remembers who was in the room', { concurrency: 3 }, () => {
  test('a lone host reloads while the other player is away: the new page has his place, away, says restored; his island and the room merge, he is back in his place (relinked, no join)', T, async t => {
    const W = world(t, { scale: 0.3 });
    const [A, B] = await room(W, 'keep1', ['Аня', 'Богдан']);
    const { HOST_WAIT } = (await A.info()).timing;
    await B.net({ up: false });                              // Богдан's phone drops out
    assert.ok(await until(holds(A, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A.state()));
    const A2 = await A.reload();                             // and Аня's page reloads meanwhile
    await A2.join('keep1', 'Аня');
    const s = await until(holds(A2, ['Аня', 'Богдан'], ['Богдан']), 5000);
    assert.ok(s, 'the new page knows him, away: ' + show(await A2.state()));
    assert.deepEqual([s.role, s.linked], ['host', false]);
    assert.ok(await said(A2, 'restored'), 'it says so (the library takes back what it kept of the room)');
    await sleep(HOST_WAIT + 500);
    assert.equal((await B.state()).role, 'host', 'his page holds an island of its own by now: ' + show(await B.state()));
    const n = (await A2.events()).length;
    await B.net({ up: true });
    const x = await until(settled([A2, B]), 10000);
    assert.ok(x, 'one room again: ' + await shows([A2, B]));
    assert.deepEqual(x.map(y => [y.role, y.players.join()]), [['host', 'Аня,Богдан'], ['guest', 'Аня,Богдан']]);
    const ev = (await A2.events()).slice(n).map(e => e.slice(1).join(' '));
    assert.ok(ev.includes('relinked Богдан false') && !ev.some(e => e.startsWith('join')), 'back in his place: ' + ev);
  });

  test('the kept places count their 3 minutes from the drop, not from the reload', T, async t => {
    const W = world(t, { scale: 0.3, timing: { HOLD: 9000 } });
    const [A, B] = await room(W, 'keep2', ['Аня', 'Богдан']);
    const t0 = Date.now();
    await B.net({ up: false });
    assert.ok(await until(holds(A, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A.state()));
    await sleep(4000 - (Date.now() - t0));
    const A2 = await A.reload();
    await A2.join('keep2', 'Аня');
    assert.ok(await until(holds(A2, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A2.state()));
    assert.ok(await until(holds(A2, ['Аня'], []), 12000, 100), 'his place goes: ' + show(await A2.state()));
    const at = Date.now() - t0;
    assert.ok(at > 8000 && at < 11500, 'HOLD after his drop (9 s; from the reload it would be 13 s): ' + at + ' ms');
  });

  test('a place already past HOLD, counted from the drop, is not taken back', T, async t => {
    const W = world(t, { scale: 0.3, timing: { HOLD: 6000 } });
    const [A, B] = await room(W, 'keep3', ['Аня', 'Богдан']);
    await B.net({ up: false });
    assert.ok(await until(holds(A, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A.state()));
    await sleep(1000);
    const A2 = await A.reload();
    const kept = await A2.stored('ihroteka-places');
    assert.ok(kept && JSON.stringify(kept.m).includes('Богдан'), 'the tab kept his place: ' + JSON.stringify(kept));
    await sleep(6000);                                       // the new page comes into the room only now (past his 6 s)
    await A2.join('keep3', 'Аня');
    assert.ok(await until(async () => (await A2.state()).role === 'host', 5000));
    await sleep(500);
    const s = await A2.state();
    assert.deepEqual([s.players, s.away], [['Аня'], []], show(s));
    assert.ok(!await said(A2, 'restored'));
  });

  for (const [what, code, name] of [['another room', 'keep4b', 'Аня'], ['another name', 'keep4', 'Ася']]) {
    test('the same tab in ' + what + ': nothing is taken back', T, async t => {
      const W = world(t, { scale: 0.3 });
      const [A, B] = await room(W, 'keep4', ['Аня', 'Богдан']);
      await B.net({ up: false });
      assert.ok(await until(holds(A, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A.state()));
      const A2 = await A.reload();
      await A2.join(code, name);
      assert.ok(await until(async () => (await A2.state()).role === 'host', 5000));
      await sleep(500);
      const s = await A2.state();
      assert.deepEqual([s.players, s.away], [[name], []], show(s));
      assert.ok(!await said(A2, 'restored'));
    });
  }

  test('someone still holds the room when Аня reloads: nothing is taken back, that player\'s list rules', T, async t => {
    const W = world(t, { scale: 0.3 });
    const [A, B, C] = await room(W, 'keep5', ['Аня', 'Богдан', 'Віра']);
    await B.net({ up: false });
    assert.ok(await until(holds(A, ['Аня', 'Богдан', 'Віра'], ['Богдан']), 5000), show(await A.state()));
    const A2 = await A.reload();                             // (her pagehide's bye: Віра takes the room over, every place kept)
    await A2.join('keep5', 'Аня');
    const s = await until(async () => { const x = await A2.state(); return x.linked && x.players.length === 3 && x; }, 5000);   // (Віра's list follows her hi)
    assert.ok(s, 'in Віра\'s room: ' + await shows([A2, C]));
    assert.deepEqual([s.role, s.host, s.players, s.away], ['guest', 'Віра', ['Аня', 'Богдан', 'Віра'], ['Богдан']], show(s));
    assert.ok(!await said(A2, 'restored'), 'nothing of her own taken back');
  });

  test('Богдан held an island of his own meanwhile and the reloaded page gives way to it: one host, both places', T, async t => {
    const W = world(t, { scale: 0.3 });
    const A = await W.tab('p9tab'), B = await W.tab('p1tab');   // (his session sorts first: two rooms of one merge into his)
    await A.join('keep6', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.join('keep6', 'Богдан');
    assert.ok(await until(settled([A, B]), 5000), await shows([A, B]));
    const { HOST_WAIT } = (await A.info()).timing;
    await B.net({ send: false });                            // he hears the room, nobody hears him
    assert.ok(await until(holds(A, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A.state()));
    const A2 = await A.reload();
    await A2.join('keep6', 'Аня');
    assert.ok(await until(holds(A2, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A2.state()));
    await sleep(HOST_WAIT + 500);
    assert.equal((await B.state()).role, 'host', 'his own island: ' + show(await B.state()));
    await B.net({ send: true });
    const x = await until(settled([A2, B]), 10000);
    assert.ok(x, 'one room: ' + await shows([A2, B]));
    assert.deepEqual(x.map(y => [y.role, y.players.join()]), [['guest', 'Аня,Богдан'], ['host', 'Аня,Богдан']]);
  });

  // (the page that gives way is fresh: it has never linked, yet it brings the places it took back, as any room does)
  test('…and a place only the reloaded page knew (Віра came after Богдан dropped out) comes along into his room, away; she is back in it', T, async t => {
    const W = world(t, { scale: 0.3 });
    const A = await W.tab('p9tab'), B = await W.tab('p1tab'), C = await W.tab('p5tab');
    await A.join('keep7', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.join('keep7', 'Богдан');
    assert.ok(await until(settled([A, B]), 5000), await shows([A, B]));
    const { HOST_WAIT } = (await A.info()).timing;
    await B.net({ up: false });                              // Богдан's phone drops out…
    assert.ok(await until(holds(A, ['Аня', 'Богдан'], ['Богдан']), 5000), show(await A.state()));
    await C.join('keep7', 'Віра');                           // …Віра comes in (his page never hears of her)…
    assert.ok(await until(holds(A, ['Аня', 'Богдан', 'Віра'], ['Богдан']), 5000), show(await A.state()));
    await C.net({ up: false });                              // …and drops out too
    assert.ok(await until(holds(A, ['Аня', 'Богдан', 'Віра'], ['Богдан', 'Віра']), 5000), show(await A.state()));
    const A2 = await A.reload();
    await A2.join('keep7', 'Аня');
    assert.ok(await until(holds(A2, ['Аня', 'Богдан', 'Віра'], ['Богдан', 'Віра']), 5000), show(await A2.state()));
    await sleep(HOST_WAIT + 500);
    const b = await B.state();
    assert.deepEqual([b.role, b.players], ['host', ['Аня', 'Богдан']], 'his own island, without her: ' + show(b));
    await B.net({ up: true });
    const one = async () => { const s = await Promise.all([A2, B].map(X => X.state())); return s.every(z => z.linked && !z.weak && z.players.length === 3) && s[0].role !== s[1].role && s; };
    const x = await until(one, 10000);
    assert.ok(x, 'one room, her place in it: ' + await shows([A2, B]));
    assert.deepEqual(x.map(y => [y.role, y.players.join(), y.away.join()]), [['guest', 'Аня,Богдан,Віра', 'Віра'], ['host', 'Аня,Богдан,Віра', 'Віра']],
      'her place came along, away');
    await C.net({ up: true });
    const y = await until(settled([A2, B, C]), 15000);
    assert.ok(y, 'Віра back: ' + await shows([A2, B, C]));
    assert.deepEqual(y.map(z => [z.players.join(), z.away.join()]), Array(3).fill(['Аня,Богдан,Віра', '']), 'in her place');
  });
});
