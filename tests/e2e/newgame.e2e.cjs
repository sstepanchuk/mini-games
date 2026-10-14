// tags: @ci @webkit
// newgame: from nothing to two players, with no internet at all. `cli new demo2` makes a game from tools/template in a
// scratch copy of the repository; a dev server of its own serves it with devnet (`--devnet`: the fake network between
// the tabs of one browser, tools/devnet.js); every request that would leave this computer is refused. Аня makes a room
// link, Богдан opens it in another tab, Аня opens the game and both follow; they play the template's round (on
// ihroteka.round) to its end (turns, the other's buttons off, the same number on both screens, one winner). Midway the
// tab of the copy that does not run the round reloads and gets it back; then the runner's: the round goes on from its
// snapshot ('run' with it). Meanwhile the other one sees whom the round waits for in the library's waiting screen under
// the game's title (<ihroteka-wait>, README "Waiting screens": «Чекаємо на …»), and never in the library's card over
// the game (sampled every 100 ms on both pages). Runs on its own server: E2E_URL is only checked to be up, by run.cjs.
'use strict';
const { launch, scenario, check, step, until } = require('./support/scenario.cjs');
const { openPage, createLink, enterName, libState, short, waitShown } = require('./support/pages.cjs');
const { newGame, SCREENS, sampled, templateFrame: frame, templateView: view } = require('./support/newgame.cjs');

scenario('newgame: cli new, then two devnet tabs play it without internet', async () => {
  const G = await newGame('demo2', ['--title', 'Демо два'], { devnet: true }), { port, url: U2 } = G;
  if (!check(G.made, 'cli new demo2', G.out)) return;
  if (!check(G.up, 'its dev server, with --devnet, at ' + U2, G.log)) return;

  const ctx = await (await launch()).newContext({ viewport: { width: 900, height: 700 } });
  const away = [];
  await ctx.addInitScript(SCREENS);
  await ctx.route(u => new URL(u).host !== '127.0.0.1:' + port, r => { away.push(r.request().url()); return r.abort(); });   // no internet
  const A = await openPage(ctx, 'a', U2, { label: 'Аня', net: false });
  check(await A.evaluate(() => window.__devnet === true && !!document.getElementById('ihroteka-devnet')), 'devnet on the page, and its tag');
  const link = await createLink(A, 'Аня');
  const B = await openPage(ctx, 'b', link, { name: 'Богдан', net: false });
  const both = async () => (await libState(A)).linked && (await libState(B)).linked;
  check(await until(both, 20000), 'linked through devnet', [await short(A), await short(B)]);
  await A.keyboard.press('Escape').catch(() => {});
  await until(async () => !(await A.$('.backdrop')), 5000);

  step('Аня opens the game; Богдан follows');
  await A.click('a.game[href*="demo2"]');
  const fa = await frame(A), fb = await frame(B);
  const lobby = async () => { const v = [await view(fa), await view(fb)]; return v.every(x => x && x.lobby && /Грають: (Аня, Богдан|Богдан, Аня)\./.test(x.text)) && v; };
  check(await until(lobby, 15000), 'both in its lobby: «Грають: …» the two of them', [await view(fa), await view(fb)]);
  const nothing = async () => { const x = [await waitShown(A), await waitShown(B)]; return x.every(y => y.where === null && y.showing === null) && x; };
  const calm = await until(nothing, 5000), sa = await A.evaluate(() => window.__ihroteka.screens());
  check(calm && sa.adopted && sa.copies === 1 && sa.holder === -1, 'nothing to wait for: the game\'s waiting screen (one, placed: adopted) is empty, no `showing`', [sa, await nothing()]);

  step('a round, turn by turn');
  const F = { Аня: fa, Богдан: fb }, P = { Аня: A, Богдан: B }, NAMES = Object.keys(F);
  const views = async () => Object.fromEntries(await Promise.all(NAMES.map(async n => [n, await view(F[n])])));
  await F.Богдан.click('#start');                          // (whoever presses: the copy that runs the round starts it)
  const turns = async () => {                               // → whose turn it is, when both screens agree
    const v = await views(), on = NAMES.filter(n => v[n] && v[n].play && v[n].say === 'Твій хід');
    return on.length === 1 && NAMES.every(n => n === on[0] || v[n].say === 'Хід: ' + on[0]) && on[0];
  };
  let who = await until(turns, 10000);
  check(who, 'a round on both; one says «Твій хід», the other «Хід: <that player>»', await views());
  let v = await views();
  check(who && v[who].steps.every(Boolean) && NAMES.every(n => n === who || !v[n].steps.some(Boolean)), 'only that player\'s buttons work', v);
  let total = 0;
  const turn = async k => {                                 // whoever's turn it is presses +k (1 with the keyboard), both see it
    who = await until(turns, 10000);
    if (!who) return false;
    const f = F[who];
    if (k === 2) await f.click('#steps button[data-n="2"]'); else await f.press('#steps button[data-n="1"]', '1');   // (the focus in the game)
    total += k;
    const next = await until(async () => { const x = await views(); return NAMES.every(n => x[n] && x[n].total === total) && x; }, 10000);
    return check(next && (total === 10 || (await until(turns, 5000)) !== who), who + ' +' + k + (k === 1 ? ' (a key)' : '') + ': ' + total + ' on both, and the turn passes', next || await views());
  };
  await turn(1); await turn(2); await turn(2);

  const runner = (await libState(A)).game.round.runner, guest = NAMES.find(n => n !== runner);
  // what each player's pages sampled (support/newgame.cjs SCREENS), added up over a reload
  const tally = Object.fromEntries(NAMES.map(n => [n, {}]));
  const count = async n => { const s = await sampled(P[n]); for (const [k, x] of Object.entries(s || {})) tally[n][k] = (tally[n][k] || 0) + x; };
  for (const [name, what] of [[guest, 'the other copy'], [runner, 'the copy that runs the round']]) {
    step(name + '\'s tab (' + what + ') reloads mid-round');
    const other = NAMES.find(n => n !== name), says = new RegExp('^Чекаємо на ' + name + '(… \\d+:\\d\\d( Не чекати)?| — повертається в гру)$');
    await count(name);
    await P[name].reload();
    const waits = await until(async () => { const x = await waitShown(P[other]); return x.where === 'screen' && says.test(x.text) && x; }, 10000);
    check(waits && waits.say === waits.text.replace(/ \d+:\d\d( Не чекати)?$/, ''), other + '\'s game, meanwhile: «Чекаємо на ' + name + '…» in its waiting screen (a screen reader hears it, not the time)',
      waits || await waitShown(P[other]));
    await enterName(P[name], name);                         // (the room's link asks for the name again)
    F[name] = await frame(P[name]);
    const back = async () => { const x = await views(); return NAMES.every(n => x[n] && x[n].play && x[n].total === total) && await turns() && await nothing() && x; };
    check(await until(back, 30000), 'the round goes on' + (name === runner ? ' from its snapshot' : '') + ': ' + total + ' on both, a turn to play, nothing to wait for',
      [await views(), await short(A), await short(B), await waitShown(P[other])]);
    await turn(1);
  }
  await turn(2);
  if (total < 10) await turn(10 - total === 1 ? 1 : 2);
  v = await until(async () => { const x = await views(); return NAMES.every(n => x[n] && x[n].again) && x; }, 5000);
  const won = v && NAMES.find(n => v[n].say === 'Ти виграв!');
  check(won && NAMES.every(n => n === won || v[n].say === 'Виграв: ' + won + '!'), 'one winner at 10: «Ти виграв!» / «Виграв: ' + won + '!»', v);
  check(v && NAMES.every(n => !v[n].steps.some(Boolean)), 'no more moves; «Ще раз» on both', v);
  check(away.every(u => /^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(u)), 'nothing but web fonts tried the internet (and got nothing)', away);
  for (const n of NAMES) {
    await count(n);
    const s = tally[n];
    check(s.n > 0 && s.screen > 0 && !s.card && !s.both && !s.many, n + '\'s pages: whom the round waited for, only ever in the game\'s screen (never the card, never both, never two copies), ' + s.n + ' samples', s);
  }
}, { timeout: 180000 });
