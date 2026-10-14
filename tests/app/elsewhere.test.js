// Two people, one name (owner, q18), in worker tabs that run the real library over fake brokers (tests/support): a name
// typed on another device whose place a device still on the line holds is asked about first (the room's status 'taken':
// «Це ти?», invite.js); «Так, грати тут» (takePlace) takes the place over (the old device hears 'replaced': «Ти граєш
// деінде»), «Інше ім’я» (rejoinAs) comes in as a new player, on the new device or on the old one, while the round goes on.
// A tab of the same browser, or a place whose device is away, is not asked about. (audit: names-and-3plus-02)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, show, sleep, until, world } from '../support/world.js';

const T = { timeout: 60000 };
const rlines = g => g.events.filter(e => e[1].startsWith('round:')).map(([, n, a]) => n.slice(6) + ' ' + (n === 'round:start' ? a.by : n === 'round:run' ?
  (a.state === null ? 'fresh' : JSON.stringify(a.state)) : n === 'round:watch' ? a.runner : n === 'round:end' ? a.reason + ' ' + a.by : a));
const rec = async (X, game = 'g') => ((await X.state())?.lib?.rounds || {})[game];
const saveOf = async (X, game = 'g') => ((await X.state())?.lib?.saves || {})[game];
const statuses = async X => (await X.events()).filter(e => e[1] === 'status').map(e => e[2]);
const ASK = { ask: true };                                   // (a name typed in the dialog)

// Аня and Богдан play a round (Аня's copy runs it, Богдан keeps its snapshot) → { W, A, B, id }
async function playing(t, code, o = {}) {
  const W = world(t, { scale: 0.3 });
  const [A, B] = await room(W, code, ['Аня', 'Богдан'], { lib: {} });
  await A.open('g');
  assert.ok(await until(async () => (await Promise.all([A.game(), B.game()])).every(g => g && g.linked), 8000), 'both play');
  assert.equal(await A.call('rstart', {}), true);
  assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
  assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000), 'Богдан keeps the snapshot');
  return { W, A, B, id: (await rec(A)).id, ...o };
}
// the round as it was: on, its seats and runner, the same id, on every tab given
const untouched = async (tabs, id) => {
  for (const X of tabs) {
    const r = await rec(X);
    assert.deepEqual(r && [r.id, r.on, r.seats, r.runner], [id, true, ['Аня', 'Богдан'], 'Аня'], 'the round as it was: ' + JSON.stringify(r));
  }
};
// a device typed «Богдан» while his first one plays: asked
async function asked(W, code) {
  const D = await W.tab('p3tab');
  await D.lib(code, 'Богдан', {}, undefined, ASK);
  assert.ok(await until(async () => (await D.state())?.status === 'taken', 5000), 'the new device is asked: ' + show(await D.state()));
  return D;
}

describe('two people, one name: the room asks first', { concurrency: 3 }, () => {
  test('a second device «Богдан» joins while the first plays: asked (taken), nobody moved, the round untouched; «Так, грати тут»: the first one is replaced, the second in his seat, the runner hears one rejoin', T, async t => {
    const { W, A, B, id } = await playing(t, 'else1');
    const n = (await A.game()).events.length;
    const D = await asked(W, 'else1');
    await sleep(1500);                                         // (its hellos would have taken the place by now)
    const [a, b, d] = await Promise.all([A, B, D].map(X => X.state()));
    assert.deepEqual([d.status, d.linked], ['taken', false], 'it waits for its player: ' + show(d));
    assert.deepEqual([b.linked, b.players, a.players, a.away], [true, ['Аня', 'Богдан'], ['Аня', 'Богдан'], []], 'nobody moved: ' + show(a) + ' | ' + show(b));
    await untouched([A, B], id);
    assert.deepEqual((await A.game()).events.slice(n).map(e => e[1]), [], 'the runner\'s game heard nothing');
    assert.equal((await B.game()).round.mySeat, 1, 'the first device still in his seat');
    // «Так, грати тут»
    await D.call('takePlace');
    assert.ok(await until(async () => (await B.events()).some(e => e[1] === 'replaced'), 5000), 'the first device is told');
    assert.ok(await until(async () => { const g = await B.game(); return g && rlines(g).includes('end closed null'); }, 3000), 'its game hears the round closed: ' + rlines(await B.game()));
    assert.ok(await until(async () => (await B.call('elsewhere'))?.name === 'Богдан', 3000), '«Ти граєш деінде»');
    const g = await until(async () => { const x = await D.game(); return x && x.round && x.round.mySeat === 1 && x.round.id === id && x; }, 8000);
    assert.ok(g, 'the second device in his seat, in the same round: ' + JSON.stringify(await D.game()));
    await untouched([A, D], id);
    await sleep(1000);
    assert.deepEqual(rlines(await A.game()).filter(l => l.startsWith('rejoin')), ['rejoin Богдан'], 'the runner hears one rejoin');
    assert.deepEqual((await A.state()).players, ['Аня', 'Богдан'], 'one Богдан');
  });

  test('asked on the new device, «Інше ім’я» («Богдан Б»): a third player waiting for a seat; the round goes on with the first', T, async t => {
    const { W, A, B, id } = await playing(t, 'else2', {});
    const D = await asked(W, 'else2');
    assert.equal(await D.call('rejoinAs', { name: 'Богдан Б' }), true);
    await D.open('g');
    const d = await until(async () => { const s = await D.state(), g = await D.game(); return s && s.linked && s.players.length === 3 && g && g.waiting.includes('Богдан Б') && [s, g]; }, 8000);
    assert.ok(d, 'in the room, waiting for a seat: ' + show(await D.state()) + ' ' + JSON.stringify(await D.game()));
    assert.deepEqual([d[0].me, d[0].players, d[1].seated, d[1].round && d[1].round.active], ['Богдан Б', ['Аня', 'Богдан', 'Богдан Б'], false, true]);
    await untouched([A, B, D], id);
    const b = await B.game();
    assert.deepEqual([b.seated, b.round.mySeat, b.linked], [true, 1, true], 'the first one plays on');
    assert.ok(!(await B.events()).some(e => e[1] === 'replaced'), 'never replaced');
    assert.deepEqual(rlines(await A.game()).filter(l => l.startsWith('rejoin')), [], 'nobody new in the round');
  });

  // (a blip while the question waits: the room says 'no-signal' for a moment, yet it is still asked)
  test('asked, and the network drops for a moment: «Інше ім’я» still comes in as a new player', T, async t => {
    const { W, A, B, id } = await playing(t, 'else6', {});
    const D = await asked(W, 'else6');
    await D.net({ up: false });
    assert.ok(await until(async () => (await D.state())?.status === 'no-signal', 5000), 'the blip: ' + show(await D.state()));
    assert.equal(await D.call('rejoinAs', { name: 'Богдан Б' }), true, 'still the question\'s answer');
    await D.net({ up: true });
    const d = await until(async () => { const s = await D.state(); return s && s.linked && s.players.length === 3 && s; }, 10000);
    assert.ok(d, 'in the room: ' + show(await D.state()));
    assert.deepEqual([d.me, d.players], ['Богдан Б', ['Аня', 'Богдан', 'Богдан Б']]);
    await untouched([A, B, D], id);
  });

  test('the old device, replaced, «Інше ім’я» («Богдан Б»): a third player waiting for a seat; the round goes on with the new one', T, async t => {
    const { W, A, B, id } = await playing(t, 'else3');
    const D = await asked(W, 'else3');
    await D.call('takePlace');
    assert.ok(await until(async () => (await B.call('elsewhere'))?.name === 'Богдан', 5000), 'the old device is replaced');
    assert.ok(await until(async () => (await D.game())?.round?.mySeat === 1, 8000), 'the new one in his seat');
    assert.equal(await B.call('rejoinAs', { name: 'Богдан Б' }), true);
    await B.open('g');
    const b = await until(async () => { const s = await B.state(), g = await B.game(); return s && s.linked && s.players.length === 3 && g && g.waiting.includes('Богдан Б') && [s, g]; }, 8000);
    assert.ok(b, 'in the room as a new player, waiting for a seat: ' + show(await B.state()) + ' ' + JSON.stringify(await B.game()));
    assert.deepEqual([b[0].me, b[0].players, b[1].seated], ['Богдан Б', ['Аня', 'Богдан', 'Богдан Б'], false]);
    assert.equal(await B.call('elsewhere'), null, 'not «elsewhere» any more');
    await untouched([A, D, B], id);
    assert.deepEqual([(await D.game()).round.mySeat, (await D.state()).linked], [1, true], 'the new device plays on');
    assert.ok(!(await D.events()).some(e => e[1] === 'replaced'), 'never replaced in turn');
  });

  test('a tab of the same browser: no question, the place moves at once', T, async t => {
    const { W, A, B, id } = await playing(t, 'else4');
    const B2 = await W.tab('p3tab', {}, { local: B.browser });   // (the player opens the room's link in a new tab)
    await B2.lib('else4', 'Богдан', {}, undefined, ASK);
    assert.ok(await until(async () => (await B.events()).some(e => e[1] === 'replaced'), 5000), 'the old tab steps aside: ' + await statuses(B2));
    assert.ok(await until(async () => (await B2.game())?.round?.mySeat === 1, 8000), 'the new tab in his seat');
    assert.ok(!(await statuses(B2)).includes('taken'), 'never asked: ' + await statuses(B2));
    await untouched([A, B2], id);
  });

  // (the mark used to wait for the next once-a-second tick: a new tab opened in that second was asked)
  test('a page that comes to hold the room marks the place held for its browser at once: a new tab right then is not asked', T, async t => {
    const W = world(t, { scale: 0.3 });
    const A = await W.tab('p1tab');
    await A.lib('else7', 'Аня');
    const key = JSON.stringify(['internet', 'else7', 'Аня']);
    const marked = async () => { const v = (await A.local()).find(([k]) => k === 'ihroteka-held'); return !!v && key in JSON.parse(v[1]); };
    assert.ok(await until(async () => (await A.state())?.status === 'waiting', 5000, 5), 'it holds the room');
    assert.ok(await marked(), 'held, as it says waiting: ' + JSON.stringify(await A.local()));
    const A2 = await W.tab('p3tab', {}, { local: A.browser });
    await A2.lib('else7', 'Аня', {}, undefined, ASK);
    assert.ok(await until(async () => (await A.events()).some(e => e[1] === 'replaced'), 5000), 'the place moves: ' + await statuses(A2));
    assert.ok(!(await statuses(A2)).includes('taken'), 'never asked: ' + await statuses(A2));
  });

  test('the first device away (offline): no question, the new one takes the place', T, async t => {
    const { W, A, B, id } = await playing(t, 'else5');
    await B.net({ up: false });
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000), 'away: ' + show(await A.state()));
    const D = await W.tab('p3tab');
    await D.lib('else5', 'Богдан', {}, undefined, ASK);
    assert.ok(await until(async () => (await D.game())?.round?.mySeat === 1, 8000), 'in his seat: ' + show(await D.state()));
    assert.ok(!(await statuses(D)).includes('taken'), 'never asked: ' + await statuses(D));
    await untouched([A, D], id);
  });
});
