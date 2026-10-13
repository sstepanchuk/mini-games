// What the open game's waiting screens say (owner, decision 6 (c): library/app/together.js waitFacts, waiting.js
// screen), in worker tabs that run the real library over fake brokers (tests/support), with the room's timing scaled
// down (window.__timeScale 0.3: HOLD 54 s, CLOSED_GRACE 0.6 s, RESTORE_SHOW 0.3 s, LOST_WAIT 4.5 s). A player of our
// round whose game is closed: «— зараз не в грі», only after the grace; dropped out meanwhile, the link row (their place
// is running out); quitting that round (the game's own way out): what was said of it goes at once; a seat to wait for
// and who plays now; our reloaded copy waiting for its round's snapshot; another version. What is said changes
// ('waiting') only with who, why, the buttons or the players: never with the time.
// (A player's game is "closed" with gameSlow: the room's view is shared, so one player alone cannot go to the shelf.)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, shows, sleep, until, world } from '../support/world.js';

const T = { timeout: 40000 }, SCALE = 0.3;
const scr = async X => ((await X.state()).lib.game || {}).screen;
const rows = async X => ((await scr(X)) || { rows: [] }).rows;
const kinds = rs => rs.map(r => r.kind + (r.name ? ' ' + r.name : ''));
const evs = (g, from = 0) => g.events.slice(from).map(e => e.slice(1).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const heard = (X, what, ms = 5000) => until(async () => { const g = await X.game(); return g && evs(g).some(e => e.startsWith(what)); }, ms);
const plays = (...tabs) => until(async () => (await Promise.all(tabs.map(x => x.game()))).every(g => g && g.linked && !g.weak), 8000);
const said = async X => (await X.events()).filter(e => e[1] === 'lib:waiting').length;

// Аня and Богдан in a round of 'g' (Аня's copy runs it, saved), each with endWhenSeatGone; then the room goes to the
// shelf and back into the game, where Богдан's game never opens (gameSlow) → [A, B]
async function closedRound(W, code) {
  const [A, B] = await room(W, code, ['Аня', 'Богдан'], { lib: {} });
  await A.open('g');
  assert.ok(await plays(A, B), await shows([A, B]));
  for (const X of [A, B]) await X.call('rpolicy', { p: { endWhenSeatGone: true } });
  assert.equal(await A.call('rstart', {}), true);
  assert.ok(await heard(A, 'round:run'), 'Аня\'s copy runs the round');
  assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
  assert.ok(await until(async () => (await B.state()).lib.saves.g, 5000), 'Богдан keeps its snapshot');
  await A.open(null);                                      // the room to the shelf …
  assert.ok(await until(async () => !(await B.game()), 5000));
  await B.call('gameSlow', { on: true });                  // … and back into the game, where Богдан's never opens
  await A.open('g');
  return [A, B];
}

describe('what the waiting screens say', { concurrency: 3 }, () => {
  test('a player of our round whose game is closed: «— зараз не в грі», after the grace; their game open: nothing', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await closedRound(W, 'wt1');
    const first = await until(async () => { const s = (await A.state()).lib.game; return s && s.screen; }, 3000, 25);
    assert.ok(first, 'Аня\'s game is open');
    assert.ok(!kinds(first.rows).includes('closed Богдан'), 'not at once (following the room into a game takes a moment): ' + JSON.stringify(first.rows));
    const s = await until(async () => { const x = await scr(A); return x && x.rows.length && x; }, 3000, 25);
    assert.ok(s, 'then the screen says it');
    assert.deepEqual(s.rows.map(r => [r.kind, r.name, r.text, r.time, r.acts]), [['closed', 'Богдан', 'Чекаємо на Богдан — зараз не в грі', null, []]]);
    assert.equal(s.showing, 'closed');
    assert.equal(s.say, 'Чекаємо на Богдан — зараз не в грі');
    assert.equal((await A.game()).weak, false, 'her game is not paused by it (it plays with nobody: the round stands still)');
    assert.deepEqual((await A.state()).lib.game.waitingFor, [], 'the card as it was says nothing of it (waitingFor)');
    await B.call('gameSlow', { on: false });                 // his game opens
    assert.ok(await until(async () => !(await rows(A)).length && (await B.game())?.linked, 8000), 'nothing to say; Богдан plays: ' + JSON.stringify(await rows(A)));
    assert.ok(await heard(A, 'round:rejoin Богдан', 3000), 'Аня\'s copy sends him the round');
  });

  test('closed, then dropped out: the link row (the time left, «Не чекати»); back: closed; let go: the round ends (gone), nothing to say', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await closedRound(W, 'wt2');
    assert.ok(await until(async () => kinds(await rows(A)).join() === 'closed Богдан', 4000), 'closed: ' + JSON.stringify(await rows(A)));
    const { HOLD } = (await A.info()).timing;
    await B.net({ up: false });
    const r = await until(async () => { const x = await rows(A); return x.length === 1 && x[0].kind === 'link' && x[0]; }, 8000);
    assert.ok(r, 'the link row: ' + JSON.stringify(await rows(A)));
    assert.ok(r.time <= HOLD && r.time > HOLD - 10000, 'the time his place is kept: ' + r.time);
    assert.deepEqual(r.acts, [{ act: 'release', arg: 'Богдан' }], '«Не чекати» (Аня holds the room)');
    assert.equal(r.classic, false, 'not on the card as it was (a game that never placed the element draws its own)');
    assert.equal(r.say, 'Чекаємо на Богдан…', 'what a screen reader hears, as the card always said it');
    await B.net({ up: true });
    assert.ok(await until(async () => kinds(await rows(A)).join() === 'closed Богдан', 10000), 'back, his game still closed: ' + JSON.stringify(await rows(A)));
    await B.net({ up: false });
    assert.ok(await until(async () => (await rows(A))[0]?.kind === 'link', 8000));
    await A.release('Богдан');
    assert.ok(await until(async () => evs(await A.game()).some(e => /^round:end .*"by":"Богдан","reason":"gone"/.test(e)), 5000), 'the round ends, gone: ' + evs(await A.game()));
    assert.ok(await until(async () => !(await rows(A)).length, 3000), 'nothing to say: ' + JSON.stringify(await rows(A)));
  });

  test('a seat to wait for: «Ти чекаєш на місце», who plays now (the round\'s seats, one away too); seated, nothing', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, V] = await room(W, 'wt3', ['Аня', 'Богдан', 'Віра'], { lib: {} });
    await A.open('g');
    const seat = await until(async () => { const x = await rows(V); return x.length && x; }, 8000);
    assert.ok(seat, 'Віра\'s screen');
    assert.deepEqual(seat.map(r => [r.kind, r.text, r.fine, r.acts]), [['seat', 'Ти чекаєш на місце', 'Грають зараз: Аня і Богдан.', []]]);
    assert.equal((await scr(V)).say, 'Ти чекаєш на місце. Грають зараз: Аня і Богдан');
    assert.deepEqual([await rows(A), await rows(B)], [[], []], 'the two who play: nothing');
    assert.ok(await plays(A, B));
    assert.equal(await A.call('rstart', {}), true);
    assert.ok(await heard(A, 'round:run'));
    await A.call('rsave', { s: { n: 1 } });
    await sleep(500);
    assert.deepEqual(await rows(V), seat, 'a round on: the same');
    await B.net({ up: false });
    assert.ok(await until(async () => (await V.state()).away.includes('Богдан'), 8000));
    await sleep(500);
    assert.equal((await rows(V))[0]?.fine, 'Грають зараз: Аня і Богдан.', 'a seat of one who dropped out is still theirs');
    await B.net({ up: true });
    assert.ok(await until(async () => !(await V.state()).away.length, 10000));
    assert.equal(await A.call('rover', {}), true);
    await B.leave();
    assert.ok(await until(async () => { const g = await V.game(); return g && g.seated && g.linked && !(await rows(V)).length; }, 10000),
      'Богдан gone: Віра has his seat, plays, and nothing to say: ' + JSON.stringify(await rows(V)));
  });

  // The way out of a wait for a closed game is the game's own quit (README "Waiting screens"): what the screens said of
  // that round goes as the game hears its end, not a tick later. Богдан runs the round and holds the room; his game is
  // closed, then he drops out: Аня, who watches, quits (only her copy knows: the runner hears it when he is back).
  test('a player who quits the round as it waits: what was said of it goes at once (\'waiting\' with the end)', T, async t => {
    const W = world(t, { scale: SCALE });
    const [B, A] = await room(W, 'wt7', ['Богдан', 'Аня'], { lib: {} });
    await A.open('g');
    assert.ok(await plays(A, B), await shows([A, B]));
    assert.equal(await B.call('rstart', {}), true);
    assert.ok(await heard(B, 'round:run'), 'Богдан\'s copy runs the round');
    assert.equal(await B.call('rsave', { s: { n: 1 } }), true);
    assert.ok(await until(async () => (await A.state()).lib.saves.g, 5000), 'Аня keeps its snapshot');
    await A.open(null);
    assert.ok(await until(async () => !(await B.game()), 5000));
    await B.call('gameSlow', { on: true });
    await A.open('g');
    assert.ok(await until(async () => kinds(await rows(A)).join() === 'closed Богдан', 5000), 'closed: ' + JSON.stringify(await rows(A)));
    await B.net({ up: false });
    assert.ok(await until(async () => kinds(await rows(A)).join() === 'link Богдан', 8000), 'then dropped out: ' + JSON.stringify(await rows(A)));
    const n = await said(A);
    assert.equal(await A.call('rquit'), true);
    const now = [await said(A), evs(await A.game()).filter(e => e.startsWith('round:end')).length, kinds(await rows(A))];
    assert.deepEqual(now, [n + 1, 1, []], 'at once: said, the game heard its end, nothing to say');
  });

  // Віра holds the room and has the round's record, but never its snapshot (her game never opens: saves go only to the
  // round's players); Аня's page reloads while Богдан, who has it, is away: her copy runs the round and waits for it.
  async function restoring(W, code) {
    const [V, A, B] = await room(W, code, ['Віра', 'Аня', 'Богдан'], { lib: {} });
    await V.call('gameSlow', { on: true });
    await A.open('g');
    assert.ok(await plays(A, B), await shows([V, A, B]));
    assert.equal(await A.call('rstart', {}), true);
    assert.ok(await heard(A, 'round:run'));
    await A.call('rsave', { s: { n: 7 } });
    assert.ok(await until(async () => (await B.state()).lib.saves.g, 5000), 'Богдан keeps its snapshot');
    await B.net({ up: false });
    assert.ok(await until(async () => (await V.state()).away.includes('Богдан'), 8000));
    const A2 = await A.reload();
    await A2.lib(code, 'Аня');
    const first = await until(async () => { const s = (await A2.state())?.lib?.game; return s && s.round.active && s.screen; }, 10000, 25);
    assert.ok(first, 'Аня\'s new page in the game, the round on: ' + JSON.stringify((await A2.state())?.lib?.game));
    assert.ok(!kinds(first.rows).includes('restoring'), 'not at once (no flash on every reload): ' + JSON.stringify(first.rows));
    return [V, A2, B];
  }

  test('our reloaded copy waits for its round\'s snapshot: «Повертаю гру…» after a moment; it comes: the round goes on, nothing to say', T, async t => {
    const W = world(t, { scale: SCALE });
    const [, A2, B] = await restoring(W, 'wt4');
    const r = await until(async () => { const x = kinds(await rows(A2)); return x.includes('restoring') && x; }, 2000, 25);
    assert.deepEqual(r, ['link Богдан', 'restoring'], 'whom we wait for, then that the round comes back');
    assert.equal((await rows(A2))[1].text, 'Повертаю гру з того місця, де ви зупинилися…');
    assert.ok(!evs(await A2.game()).some(e => /^round:(run|watch)/.test(e)), 'the game hears nothing meanwhile');
    await B.net({ up: true });
    assert.ok(await until(async () => evs(await A2.game()).some(e => /^round:run .*"state":\{"n":7\}/.test(e)), 15000), 'Богдан back: her copy runs the round on, from its snapshot: ' + evs(await A2.game()));
    assert.ok(await until(async () => !(await rows(A2)).length, 5000), 'nothing to say: ' + JSON.stringify(await rows(A2)));
  });

  test('our reloaded copy waits for a snapshot that is on no device: «Повертаю гру…», then the round ends (lost), nothing to say', T, async t => {
    const W = world(t, { scale: SCALE });
    const [V, A2] = await restoring(W, 'wt4b');
    assert.ok(await until(async () => kinds(await rows(A2)).includes('restoring'), 2000, 25));
    await V.release('Богдан');                               // the room's host lets his place go (no endWhenSeatGone)
    assert.ok(await until(async () => kinds(await rows(A2)).join() === 'restoring', 5000), 'only that the round comes back: ' + JSON.stringify(await rows(A2)));
    assert.ok(await until(async () => evs(await A2.game()).some(e => /^round:end .*"reason":"lost"/.test(e)), 12000), 'lost: ' + evs(await A2.game()));
    assert.ok(await until(async () => !(await rows(A2)).length, 3000), 'nothing to say: ' + JSON.stringify(await rows(A2)));
  });

  test('another version of the game: the version row on both, «Оновити» on the older page only', T, async t => {
    const W = world(t, { scale: SCALE });
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.lib('wt5', 'Аня', {}, { g: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('wt5', 'Богдан', {}, { g: 2 });
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    await A.open('g');
    const both = await until(async () => { const r = [await rows(A), await rows(B)]; return r.every(x => x.length) && r; }, 8000);
    assert.ok(both, 'both say it');
    assert.deepEqual(both.map(x => x.map(r => [r.kind, r.text, r.acts.map(a => a.act)])),
      [[['version', 'Онови сторінку — у друга інша версія', ['update']]], [['version', 'Онови сторінку — у друга інша версія', []]]]);
    assert.equal((await scr(A)).showing, 'version');
  });

  test('what is said changes with who and why, never with the time; a new tab still opening the game: «— повертається в гру»', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'wt6', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays(A, B));
    await B.net({ up: false });
    assert.ok(await until(async () => (await rows(A))[0]?.kind === 'link', 8000));
    await sleep(300);
    const n = await said(A), t0 = (await rows(A))[0].time;
    await sleep(2500);
    assert.equal(await said(A), n, 'the time ran on (' + t0 + ' → ' + (await rows(A))[0].time + '), nothing new said');
    await B.net({ up: true });
    assert.ok(await until(async () => !(await rows(A)).length, 10000));
    await sleep(500);
    assert.equal(await said(A), n + 1, 'back: said once');
    const B2 = await W.tab('p3tab');
    await B2.call('gameSlow', { on: true });                 // Богдан goes on in a new tab, slow to open the game
    await B2.lib('wt6', 'Богдан');
    const r = await until(async () => { const x = await rows(A); return x.length === 1 && x[0].kind === 'loading' && x[0]; }, 8000);
    assert.ok(r, 'loading: ' + JSON.stringify(await rows(A)));
    assert.deepEqual([r.text, r.say, r.time, r.acts, r.classic], ['Чекаємо на Богдан — повертається в гру', 'Чекаємо на Богдан — повертається в гру', null, [], true]);
    await B2.call('gameSlow', { on: false });
    assert.ok(await until(async () => !(await rows(A)).length, 8000), 'his game open there: nothing to say');
  });
});
