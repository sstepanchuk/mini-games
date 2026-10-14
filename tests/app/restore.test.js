// A page reloaded while every other player is away (owner, q29), in worker tabs that run the real library over fake
// brokers (tests/support), the room's timing scaled down and Хрестики-нулики's two policies: the room takes back the
// places the page before it kept in the tab (net 'restored'), and the library what it kept of the room's shared state
// and of the snapshots (together.js keepRoom, adopt). So the round is on as it was, its runner's copy goes on from its
// snapshot (never afresh, never a game on one device), the screens wait for whoever is away with «Не чекати», their 3
// minutes count from their drop, and they come back into the same round. Another room or name, blocked site data, or a
// room someone still holds (that one's list rules): nothing is taken back. (audit: small-games-11)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, sleep, until, world } from '../support/world.js';

const T = { timeout: 90000 }, SCALE = 0.3;
const POL = { p: { startNeedsEveryone: true, endWhenSeatGone: true } };   // (Хрестики-нулики's)
const rlines = g => g.events.filter(e => e[1].startsWith('round:')).map(([, n, a]) => n.slice(6) + ' ' + (n === 'round:start' ? a.by : n === 'round:run' ?
  (a.state === null ? 'fresh' : JSON.stringify(a.state)) : n === 'round:watch' ? a.runner : n === 'round:end' ? a.reason + ' ' + a.by : a));
const rec = async (X, game = 'g') => ((await X.state())?.lib?.rounds || {})[game];
const saveOf = async (X, game = 'g') => ((await X.state())?.lib?.saves || {})[game];
const said = async (X, ev) => (await X.events()).some(e => e[1] === ev);

// Аня (the room's host, her copy runs the round) and Богдан play a round with a snapshot ({ n: 1 }), and more players
// in the room if asked; Богдан's phone drops out, and Аня's page reloads `after` ms later (back at the game's address)
// → { W, A2: her new page, not in a room yet, B, id, drop: when Богдан dropped (Date.now()) }
async function reloaded(t, code, { more = [], after = 0, timing = null } = {}) {
  const W = world(t, { scale: SCALE, timing });
  const tabs = await room(W, code, ['Аня', 'Богдан', ...more], { lib: {} });
  const [A, B] = tabs;
  await A.open('g');
  assert.ok(await until(async () => (await Promise.all([A.game(), B.game()])).every(g => g && g.linked && g.players.join() === 'Аня,Богдан'), 8000), 'both play');
  for (const X of [A, B]) await X.call('rpolicy', POL);
  assert.equal(await A.call('rstart', {}), true);
  assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
  assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000), 'Богдан keeps the snapshot');
  const id = (await rec(A)).id, drop = Date.now();
  await B.net({ up: false });
  assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000), 'Аня sees Богдан away');
  await sleep(after);
  const A2 = await A.reload();
  return { W, A2, B, id, drop, others: tabs.slice(2) };
}
// her new page in the room as she left it: Богдан away, seated, the round on; its copy runs it from the snapshot
const restored = A2 => until(async () => {
  const s = await A2.state(), g = await A2.game();
  return s && s.players.join() === 'Аня,Богдан' && s.away.join() === 'Богдан' && g && g.round && g.round.active && g.linked && rlines(g).includes('run {"n":1}') && { s, g };
}, 8000);

describe('a page reloaded while every other player is away', { concurrency: 3 }, () => {
  test('the runner and host reloads while Богдан is away: he is in the room, away, his seat kept and waited for with «Не чекати»; the round goes on from its snapshot, never afresh, and he comes back into it', T, async t => {
    const { W, A2, B, id } = await reloaded(t, 'kept1');
    await A2.lib('kept1', 'Аня');
    const x = await restored(A2);
    assert.ok(x, 'as it was: ' + show(await A2.state()) + ' ' + JSON.stringify((await A2.game())?.round) + ' ' + rlines(await A2.game()));
    const { s, g } = x;
    assert.ok(await said(A2, 'restored'), 'the room says it took the places back');
    assert.deepEqual([g.round.id, g.round.mySeat, g.round.seats, g.seated, g.linked, g.weak], [id, 0, ['Аня', 'Богдан'], true, true, true], 'the round, ours to run, paused');
    const screen = s.lib.game.screen;
    assert.ok(screen.showing.split(' ').includes('link'), 'the screens wait for him: ' + JSON.stringify(screen));
    assert.ok(screen.rows.some(r => r.kind === 'link' && r.name === 'Богдан' && r.acts.some(a => a.act === 'release' && a.arg === 'Богдан')), 'with «Не чекати»: ' + JSON.stringify(screen.rows));
    assert.ok(!rlines(g).includes('run fresh'), 'never afresh: ' + rlines(g));
    const LOST_WAIT = 15000 * SCALE;                         // (round.js LOST_WAIT)
    await sleep(LOST_WAIT + 1500);                           // (a snapshot on no device would end the round 'lost' by now)
    const r = await rec(A2);
    assert.deepEqual([r.id, r.on, r.runner], [id, true, 'Аня'], 'still on: ' + JSON.stringify(r));
    assert.ok((await A2.game()).round.active && !rlines(await A2.game()).some(l => l.startsWith('end')), 'its game heard no end: ' + rlines(await A2.game()));
    // Богдан is back: the same round goes on
    await B.net({ up: true });
    assert.ok(await until(settled([A2, B]), 15000), 'one room again: ' + await shows([A2, B]));
    const both = await until(async () => { const gs = await Promise.all([A2.game(), B.game()]); return gs.every(y => y && y.linked && !y.weak && y.round && y.round.id === id) && gs; }, 8000);
    assert.ok(both, 'the same round on both: ' + JSON.stringify((await B.game())?.round));
    assert.deepEqual(both.map(y => y.round.mySeat), [0, 1]);
    assert.deepEqual([(await rec(A2)).on, (await rec(B)).on], [true, true]);
    assert.ok(!rlines(await A2.game()).includes('run fresh'), rlines(await A2.game()));
    void W;
  });

  test('Богдан away past HOLD counted from his drop (not from the reload): the round ends \'gone\', and Аня\'s game hears why', T, async t => {
    const HOLD = 9000;
    const { A2, drop } = await reloaded(t, 'kept2', { after: 2500, timing: { HOLD } });
    await A2.lib('kept2', 'Аня');
    assert.ok(await restored(A2), 'as it was: ' + show(await A2.state()));
    const g = await until(async () => { const y = await A2.game(); return y && rlines(y).includes('end gone Богдан') && y; }, HOLD + 5000, 100);
    const at = Date.now() - drop;
    assert.ok(g, 'over: ' + rlines(await A2.game()));
    assert.ok(at < HOLD + 2000, 'his 3 minutes count from his drop (' + at + ' ms after it; HOLD ' + HOLD + ', the page reloaded 2.5 s after it)');
    assert.ok(at > HOLD - 1500, 'not sooner: ' + at);
    assert.deepEqual((await A2.state()).players, ['Аня'], 'his place gone');
    const r = await rec(A2);
    assert.deepEqual([r.on, r.reason, r.by], [false, 'gone', 'Богдан']);
  });

  test('«Не чекати» from Аня\'s new page: his place goes, and the round ends \'gone\'', T, async t => {
    const { A2 } = await reloaded(t, 'kept3');
    await A2.lib('kept3', 'Аня');
    assert.ok(await restored(A2), 'as it was: ' + show(await A2.state()));
    await A2.release('Богдан');
    assert.ok(await until(async () => { const y = await A2.game(); return y && rlines(y).includes('end gone Богдан'); }, 5000), 'over: ' + rlines(await A2.game()));
    assert.deepEqual((await A2.state()).players, ['Аня'], 'his place gone');
    assert.equal((await A2.state()).lib.game.screen.showing, '', 'nobody to wait for');
  });

  test('another room, another name, or site data blocked: nothing is taken back', T, async t => {
    const { W, A2 } = await reloaded(t, 'kept4');
    const kept = await A2.call('sessionAll');                // (what the page before kept: kept4, as Аня)
    await A2.close();
    for (const [i, [code, me, blocked, why]] of [['kept4b', 'Аня', false, 'another room'], ['kept4', 'Аня Б', false, 'another name'],
      ['kept4', 'Аня', true, 'site data blocked']].entries()) {
      const X = await W.tab('p' + (7 + i) + 'tab', {}, { kept, initial: 'g' });   // (that tab's next page, at the game)
      if (blocked) await X.siteData(false);
      await X.lib(code, me);
      await sleep(2500);                                     // (alone: the room is its own after 1.1 s)
      const s = await X.state(), g = await X.game();
      assert.deepEqual([s.me, s.players, s.away], [me, [me], []], why + ': nobody else: ' + show(s));
      assert.ok(!await said(X, 'restored'), why + ': nothing restored');
      assert.deepEqual([Object.keys(s.lib.rounds), Object.keys(s.lib.saves)], [[], []], why + ': no round');
      assert.ok(!g || !g.round.active, why);
      if (blocked) assert.ok((await X.takeErrors()).every(e => /site data is blocked/.test(e)), 'only the browser saying no');
      await X.close();
    }
  });

  test('Віра is still there when Аня reloads: Віра\'s list rules, nothing is taken back', T, async t => {
    const { A2, others: [V] } = await reloaded(t, 'kept5', { more: ['Віра'] });
    await A2.lib('kept5', 'Аня');
    const s = await until(async () => { const x = await A2.state(); return x && x.linked && x.players.length === 3 && x; }, 10000);
    assert.ok(s, 'in Віра\'s room: ' + await shows([A2, V]));
    assert.equal(s.role, 'guest', show(s));
    assert.ok(s.away.includes('Богдан'), 'Богдан away, as Віра\'s list says: ' + show(s));
    await sleep(1500);
    assert.ok(!await said(A2, 'restored'), 'nothing restored');
    assert.equal(await saveOf(A2), undefined, 'not the snapshot the page before kept (Віра has none to give)');
    assert.ok(!rlines(await A2.game()).includes('run {"n":1}'), rlines(await A2.game()));
  });
});
