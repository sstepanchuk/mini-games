// tags: @ci @webkit
// newgame3: the template (tools/template) for three, `cli new demo3 --players 2-3`, in three devnet tabs with no
// internet, as newgame does for two. The others show only what the copy that runs the round sends: a state from
// anyone else (an old runner's, sent before the round moved on) changes nothing. A player of the round who leaves the
// room mid-round: the round cannot go on without them (no seat of theirs moves again), so it is over for everyone
// (with two seats, the library says so itself: peer-gone); the two left start a new one. Runs on its own server:
// E2E_URL is only checked to be up, by run.cjs.
'use strict';
const { launch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { openPage, createLink, libState, short } = require('./support/pages.cjs');
const { newGame } = require('./support/newgame.cjs');

// what a player sees in the game's frame
const view = f => f.evaluate(() => {
  const $ = id => document.getElementById(id);
  return { lobby: !$('lobby').hidden, text: $('lobby-text').textContent, play: !$('play').hidden, total: +$('total').textContent, say: $('say').textContent,
    seats: [...$('seats').children].map(li => li.textContent), steps: [...$('steps').children].map(b => !b.disabled) };
}).catch(() => null);
const frame = async p => { const e = await p.waitForSelector('iframe.frame', { timeout: 15000 }); const f = await e.contentFrame(); await f.waitForSelector('#lobby', { timeout: 15000 }); return f; };

scenario('newgame3: the template for three, in devnet tabs: only the runner\'s state counts; a player who leaves mid-round ends it', async () => {
  const G = await newGame('demo3', ['--players', '2-3', '--title', 'Демо три'], { devnet: true }), { port, url: U2 } = G;
  if (!check(G.made, 'cli new demo3 --players 2-3', G.out)) return;
  if (!check(G.up, 'its dev server, with --devnet, at ' + U2)) return;

  const ctx = await (await launch()).newContext({ viewport: { width: 800, height: 640 } });
  await ctx.route(u => new URL(u).host !== '127.0.0.1:' + port, r => r.abort());   // no internet
  const A = await openPage(ctx, 'a', U2, { label: 'Аня', net: false });
  const link = await createLink(A, 'Аня');
  const B = await openPage(ctx, 'b', link, { name: 'Богдан', net: false });
  const C = await openPage(ctx, 'c', link, { name: 'Сава', net: false });
  const P = { Аня: A, Богдан: B, Сава: C };
  const all = async () => (await Promise.all([A, B, C].map(libState))).every(s => s.linked && s.players.length === 3);
  check(await until(all, 25000), 'the three of them linked through devnet', [await short(A), await short(B), await short(C)]);
  for (const p of [A, B, C]) await p.keyboard.press('Escape').catch(() => {});

  step('Аня opens the game; the others follow; a round of three');
  await A.waitForSelector('.backdrop', { state: 'detached', timeout: 5000 }).catch(() => {});
  await A.click('a.game[href*="demo3"]');
  const F = {};
  for (const n of Object.keys(P)) F[n] = await frame(P[n]);
  const views = async (names = Object.keys(F)) => Object.fromEntries(await Promise.all(names.map(async n => [n, await view(F[n])])));
  const inLobby = (names, who) => async () => { const v = await views(names); return names.every(n => v[n] && v[n].lobby && v[n].text === 'Грають: ' + who.join(', ') + '.') && v; };
  // the seats: the room's order (the sessions decide it, not who came first); the first runs the round and moves first
  const order = await until(async () => { const g = (await libState(A)).game; return g && g.players.length === 3 && g.players; }, 10000);
  const [R, X, O] = order || [];
  check(order && (await libState(A)).game.host === R, 'three seats, the first one\'s copy runs the round', [order, await short(A)]);
  if (!order) return;
  check(await until(inLobby(order, order), 15000), 'all three in its lobby', await views());
  await F[O].click('#start');
  const started = await until(async () => { const v = await views(); return Object.values(v).every(x => x && x.play && x.total === 0 && x.seats.length === 3) && v; }, 10000);
  check(started && started[R].say === 'Твій хід' && started[O].say === 'Хід: ' + R, 'a round of three on every screen, ' + R + ' first', started || await views());

  step('a state from a copy that does not run the round changes nothing');
  await F[X].evaluate(seats => window.ihroteka.room.send({ t: 'state', round: { id: 'old', seats, total: 9, turn: 2, winner: -1, moves: 6 } }), order);
  await w(1500);
  let v = await views();
  check(Object.values(v).every(x => x.total === 0 && x.play), 'still 0 on every screen (no «9» from ' + X + '\'s copy)', v);

  step(R + ' +1; on ' + X + '\'s turn he leaves the room');
  await F[R].click('#steps button[data-n="1"]');
  v = await until(async () => { const x = await views(); return Object.values(x).every(y => y && y.total === 1) && x[X].say === 'Твій хід' && x; }, 10000);
  check(v, '1 on every screen; ' + X + '\'s turn', v || await views());
  await F[X].evaluate(() => window.ihroteka.invite());
  await P[X].click('text=Від’єднатися');
  check(await until(async () => (await libState(P[R])).players.join() === R + ',' + O, 10000), R + '\'s room: ' + R + ' and ' + O, await short(P[R]));
  const over = await until(inLobby([R, O], [R, O]), 10000);
  check(over, 'the round is over for ' + R + ' and ' + O + ': both in the lobby (nobody would ever move for ' + X + ')', over || await views([R, O]));
  check(await until(async () => { const s = (await libState(P[R])).snaps.demo3; return s && s.s === null; }, 5000), 'and over for good: a tombstone, so no copy brings it back',
    (await libState(P[R])).snaps);

  step('a copy that shows a round the runner no longer has asks for the state, and is told: none');
  // (as a runner back after the round went on elsewhere without it: role → 'guest', 'sync'; here the runner's own
  // old state makes the other copy show a round, then it asks)
  await F[R].evaluate(([to, seats]) => window.ihroteka.room.send({ t: 'state', round: { id: 'gone', seats, total: 3, turn: 1, winner: -1, moves: 2 } }, { to }), [O, [R, O]]);
  check(await until(async () => { const x = await view(F[O]); return x.play && x.total === 3; }, 5000), O + ' shows that round', await view(F[O]));
  await F[O].evaluate(() => window.ihroteka.room.send({ t: 'sync' }));
  check(await until(inLobby([R, O], [R, O]), 5000), 'the runner answers «no round» (state null): ' + O + ' is back in the lobby', await views([R, O]));

  step('the two of them play a new round');
  await F[O].click('#start');
  const fresh = await until(async () => { const x = await views([R, O]); return Object.values(x).every(y => y && y.play && y.total === 0 && y.seats.length === 2) && x; }, 10000);
  check(fresh && fresh[R].say === 'Твій хід' && fresh[O].say === 'Хід: ' + R, 'a round of two', fresh || await views([R, O]));
  await F[R].click('#steps button[data-n="2"]');
  v = await until(async () => { const x = await views([R, O]); return x[R].total === 2 && x[O].total === 2 && x[O].say === 'Твій хід' && x; }, 10000);
  check(v, R + ' +2: 2 on both, ' + O + '\'s turn', v || await views([R, O]));
}, { timeout: 180000 });
