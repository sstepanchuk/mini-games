// tags: @ci @webkit
// newgame3: the template (tools/template) for three, `cli new demo3 --players 2-3`, in three devnet tabs with no
// internet, as newgame does for two, on ihroteka.round. The others show only what the copy that runs the round sends:
// a state from anyone else (an old runner's, sent before the round moved on) changes nothing. A player of the round who
// leaves the room mid-round: the round cannot go on without them (no seat of theirs moves again), so the template's
// rule (round.policy.endWhenSeatGone) ends it for everyone ('gone', and the lobby says why); the two left start a new
// one. The one who left comes back meanwhile: the seats of a round are frozen, so they wait for a seat, get one when
// that round is over, and start a round of three. That they wait, and who plays now, the library's waiting screen
// under the game's title says («Ти чекаєш на місце», «Грають зараз: …» in the round's seat order; <ihroteka-wait>,
// README "Waiting screens"), and the game's own lobby nothing; whom a game waits for shows in that screen throughout,
// never in the library's card (sampled every 100 ms on every page). Runs on its own server: E2E_URL is only checked to
// be up, by run.cjs.
'use strict';
const { launch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { openPage, createLink, libState, short, waitShown } = require('./support/pages.cjs');
const { newGame, SCREENS, sampled, templateFrame: frame, templateView: view } = require('./support/newgame.cjs');

scenario('newgame3: the template for three, in devnet tabs: only the runner\'s state counts; a player who leaves mid-round ends it; frozen seats', async () => {
  const G = await newGame('demo3', ['--players', '2-3', '--title', 'Демо три'], { devnet: true }), { port, url: U2 } = G;
  if (!check(G.made, 'cli new demo3 --players 2-3', G.out)) return;
  if (!check(G.up, 'its dev server, with --devnet, at ' + U2, G.log)) return;

  const ctx = await (await launch()).newContext({ viewport: { width: 800, height: 640 } });
  await ctx.addInitScript(SCREENS);
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
  const quiet = async names => { const x = await Promise.all(names.map(n => waitShown(P[n]))); return x.every(y => y.where === null && y.showing === null) && x; };
  const calm = await until(() => quiet(order), 5000), sa = await A.evaluate(() => window.__ihroteka.screens());
  check(calm && sa.adopted && sa.copies === 1 && sa.holder === -1, 'nothing to wait for: the game\'s waiting screen (one, placed: adopted) is empty, no `showing`', [sa, await quiet(order)]);
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
  check(over && [R, O].every(n => over[n].say === 'Раунд перервано: ' + X + ' уже не в кімнаті.'), 'and it says why', over);
  const rec = await until(async () => { const r = (await libState(P[R])).rounds.demo3; return r && !r.on && r; }, 5000);
  check(rec && rec.reason === 'gone' && rec.by === X, 'the round\'s record: over, gone (' + X + ')', rec);

  step('the two of them play a new round; ' + X + ' comes back meanwhile and waits for a seat');
  await F[O].click('#start');
  const fresh = await until(async () => { const x = await views([R, O]); return Object.values(x).every(y => y && y.play && y.total === 0 && y.seats.length === 2) && x; }, 10000);
  check(fresh && fresh[R].say === 'Твій хід' && fresh[O].say === 'Хід: ' + R, 'a round of two, ' + R + ' first', fresh || await views([R, O]));
  const gone = await sampled(P[X]);
  await P[X].close();
  P[X] = await openPage(ctx, 'x2', link, { name: X, net: false });
  F[X] = await frame(P[X]);
  const SEAT = 'Ти чекаєш на місце Грають зараз: ' + R + ' і ' + O + '.';
  const waits = await until(async () => { const x = await waitShown(P[X]); return x.where === 'screen' && x.text === SEAT && x; }, 20000);
  check(waits, X + ' back in the room, the game open: the library\'s screen in it, «Ти чекаєш на місце» / «Грають зараз: ' + R + ' і ' + O + '.» (the round\'s seats are frozen)',
    waits || await waitShown(P[X]));
  check(waits && waits.say === 'Ти чекаєш на місце. Грають зараз: ' + R + ' і ' + O && waits.showing === 'seat' && !waits.buttons.length, 'a screen reader hears it; `showing` seat; nothing to press', waits);
  const lobbyX = await view(F[X]);
  check(lobbyX && lobbyX.lobby && lobbyX.text === '', 'the game\'s own lobby says nothing of it', lobbyX);
  check(await quiet([R, O]), R + ' and ' + O + ': nothing to wait for', [await waitShown(P[R]), await waitShown(P[O])]);
  let total = 0;
  const turn = async (who, next) => {                       // who +2; both see it, then it is next's turn (none: the end)
    await F[who].click('#steps button[data-n="2"]');
    total += 2;
    return until(async () => { const x = await views([R, O]); return [R, O].every(n => x[n] && x[n].total === total && (next ? true : x[n].again)) && (!next || x[next].say === 'Твій хід') && x; }, 10000);
  };
  for (const [who, next] of [[R, O], [O, R], [R, O], [O, R]]) check(await turn(who, next), who + ' +2', await views([R, O]));
  v = await turn(R, null);
  check(v && v[R].say === 'Ти виграв!' && v[O].say === 'Виграв: ' + R + '!' && v[R].total === 10, R + ' +2 = 10: ' + R + ' wins', v || await views([R, O]));
  const seated = await until(async () => { const x = await view(F[X]), g = (await libState(P[X])).game; return x && x.again && x.say === 'Виграв: ' + R + '!' && g.players.length === 3 && x; }, 10000);
  check(seated, 'the round over: ' + X + ' sees how it ended, and has a seat (three play now), «Ще раз»', [seated || await view(F[X]), await short(P[X])]);
  check(await until(() => quiet([X]), 5000), X + '\'s screen: nothing to say any more', await waitShown(P[X]));
  await F[X].click('#again');
  const three = await until(async () => { const x = await views(); return Object.values(x).every(y => y && y.play && y.total === 0 && y.seats.length === 3) && x; }, 10000);
  check(three, X + ' presses «Ще раз»: a round of the three of them', three || await views());
  for (const [page, s] of [[X + '\'s first page', gone], ...await Promise.all(Object.keys(P).map(async n => [n + '\'s page', await sampled(P[n])]))]) {
    check(s && s.n > 0 && !s.card && !s.both && !s.many, page + ': any wait only ever in the game\'s screen (never the card, never both, never two copies), ' + (s && s.n) + ' samples', s);
  }
}, { timeout: 180000 });
