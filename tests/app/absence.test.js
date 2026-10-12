// Whom the open game waits for, and why (library/app/together.js with rules.absence), in worker tabs that run the
// real library over fake brokers (tests/support), with the room's timing scaled down (window.__timeScale 0.3: HOLD
// 54 s). One answer for the pause ('weak') and the library's card (waitingFor): a player who dropped out ('link', with
// the time their place is kept) or one who is back and opening the game ('loading'). A player whose place dropped
// («Не чекати», or HOLD over) and who comes back, from the same page or a new one, counts as loading until a here:
// they wrote after joining arrives: the game waits, then hears 'relinked', and what it sends from then on reaches them.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;
const evs = (g, from = 0) => g.events.slice(from).map(e => e.slice(1).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const waits = async X => ((await X.state()).lib.game || {}).waitingFor || [];
const plays = (...tabs) => until(async () => (await Promise.all(tabs.map(x => x.game()))).every(g => g && g.linked && !g.weak), 8000);
// in the game's events since `from`: a new round with Богдан ('linked'), paused until his game is open ('weak'
// true), then 'relinked Богдан' (and playing again: 'weak' false, just before it)
const waitedFor = (e, from) => {
  const l = e.indexOf('linked', from), w = e.indexOf('weak true', l), r = e.indexOf('relinked Богдан', w);
  return l >= 0 && w > l && r > w && e.lastIndexOf('weak false') > w;
};

// (each test has its own network and tabs: they run side by side)
describe('whom the game waits for, and why', { concurrency: 3 }, () => {
  test('a player who dropped out: link, with the time their place is kept; back, nobody', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'abs1', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays(A, B));
    assert.deepEqual(await waits(A), []);
    const { HOLD } = (await A.info()).timing;
    await B.net({ up: false });
    const w = await until(async () => { const x = await waits(A); return x.length && x; }, 5000);
    assert.ok(w, 'Аня waits for Богдан');
    assert.deepEqual(w.map(x => [x.name, x.why]), [['Богдан', 'link']]);
    assert.ok(w[0].left <= HOLD && w[0].left > HOLD - 5000, 'the time his place is kept: ' + w[0].left);
    assert.equal((await A.game()).weak, true, 'the game pauses');
    await B.net({ up: true });
    assert.ok(await until(async () => !(await waits(A)).length && !(await A.game()).weak, 15000), 'back: nobody to wait for');
  });

  test('a player whose place dropped («Не чекати») comes back on the same page: the game waits for their here:, then relinked', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'abs2', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays(A, B));
    await B.net({ up: false });
    assert.ok(await until(async () => (await waits(A)).length, 5000));
    const n = (await A.game()).events.length;
    await A.release('Богдан');                               // «Не чекати»: his place goes
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня' && evs(await A.game(), n).includes('peer-gone'), 5000), 'the round with him is over');
    await B.net({ up: true });                               // the same page, his game open all along: back as a new player
    const a = await until(async () => { const g = await A.game(); return g.linked && !g.weak && evs(g, n).includes('relinked Богдан') && g; }, 20000, 50);
    assert.ok(a, 'Аня plays with Богдан again, and her game heard relinked: ' + evs(await A.game(), n));
    const e = evs(a, n);
    assert.ok(waitedFor(e, e.indexOf('peer-gone')), 'a new round, paused until his here: arrives, then relinked: ' + e);
    assert.equal(await A.gsend({ t: 'full', n: 1 }), true);
    assert.ok(await until(async () => (await B.game()).got.some(([f, m]) => f === 'Аня' && m.t === 'full'), 5000), 'what her game sends then reaches his');
  });

  test('a player whose place dropped comes back in a new tab: loading until their game is open there; what is sent then reaches it', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'abs3', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays(A, B));
    await B.kill();                                          // his tab is gone (no goodbye)
    assert.ok(await until(async () => (await waits(A)).length, 5000));
    const n = (await A.game()).events.length;
    await A.release('Богдан');
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня', 5000));
    const B2 = await W.tab('p3tab');
    await B2.lib('abs3', 'Богдан');                          // a new tab: it follows the room into the game
    const a = await until(async () => { const g = await A.game(); return g.linked && !g.weak && evs(g, n).includes('relinked Богдан') && g; }, 15000, 50);
    assert.ok(a, 'Аня plays with Богдан\'s new tab, and her game heard relinked: ' + evs(await A.game(), n));
    const e = evs(a, n);
    assert.ok(waitedFor(e, 0), 'a new round, paused until his game is open, then relinked: ' + e);
    assert.equal(await A.gsend({ t: 'full', n: 2 }), true);
    assert.ok(await until(async () => ((await B2.game()) || { got: [] }).got.some(([f, m]) => f === 'Аня' && m.t === 'full'), 5000), 'what her game sends then reaches his new tab');
  });

  // (phase 1b, integration: cut off from the room's host, a guest sees everyone else away too, net/room.js presence; its
  // «Не чекати» for them did nothing. At full time scale: within HOST_WAIT, before it moves on to another host)
  test('a guest cut off from the room\'s host waits for everyone, but «Не чекати» works only for the host', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'abs5', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await until(async () => (await Promise.all([A, B, C].map(x => x.game()))).every(g => g && g.linked && !g.weak && g.players.length === 3), 8000), 'all three play');
    await C.net({ up: false });
    const flags = async (X, n) => { const x = await waits(X); return x.length === n && x.map(y => [y.name, y.why, y.release]); };
    assert.deepEqual(await until(() => flags(C, 2), 5000), [['Аня', 'link', true], ['Богдан', 'link', false]], 'Сава, cut off');
    assert.deepEqual(await until(() => flags(A, 1), 5000), [['Сава', 'link', true]], 'the host lets anyone go');
    assert.deepEqual(await until(() => flags(B, 1), 5000), [['Сава', 'link', true]], 'a guest that hears the host asks it');
  });

  // (phase 1b, integration: the here: a new tab holds before its game is open is an older tab's; its greeting after a
  // link of its started over used to carry it, and the game stopped waiting for a game not open yet)
  test('a new tab still opening the game, its link started over: the game still waits, until that tab\'s game is open', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'abs4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays(A, B));
    const B2 = await W.tab('p3tab');
    await B2.call('gameSlow', { on: true });                 // his new tab is slow to open the game
    await B2.lib('abs4', 'Богдан');
    const loading = async () => { const x = await waits(A); return x.length === 1 && x[0].name === 'Богдан' && x[0].why === 'loading'; };
    assert.ok(await until(loading, 8000), 'Аня waits for Богдан, opening the game: ' + JSON.stringify(await waits(A)));
    assert.ok(await until(async () => (await B2.state()).lib.keys.includes('here:Богдан'), 5000), 'his new tab holds the here: of his old one');
    const n = (await A.events()).length;
    const { topic } = await A.info('abs4', 'ihroteka');      // (the library's room: together.js LIB)
    W.spy().publish(topic, { t: 'bye', to: A.session }, B2.session);   // as if his new tab's link was lost: Аня lets it go
    const again = async () => { const s = await A.state(); return !s.away.length && (await A.events()).slice(n).some(e => e[1] === 'relinked' && e[2] === 'Богдан') && s; };
    assert.ok(await until(again, 10000), 'his link starts over in place: ' + JSON.stringify((await A.events()).slice(n)));
    await sleep(1500);                                       // (his greeting, with that old here:, has come by now)
    assert.ok(await loading(), 'the game still waits for his game to open: ' + JSON.stringify(await waits(A)));
    assert.equal((await A.game()).weak, true, 'paused');
    const e0 = (await A.game()).events.length;
    await B2.call('gameSlow', { on: false });                // his game is open now
    assert.ok(await until(async () => !(await waits(A)).length && !(await A.game()).weak, 8000), 'then nobody to wait for');
    assert.ok(await until(async () => evs(await A.game(), e0).includes('relinked Богдан'), 3000), 'and her game sends his new copy the full picture');
  });
});
