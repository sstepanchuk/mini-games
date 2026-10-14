// tags: @ci @webkit
// wireframe: a page open since before a deploy runs the new game code (owner, decision 9: copies are seated by the
// code that runs). Аня's shelf is as it is (it was read when her page loaded), but the game her frame loads now speaks
// one wire more (its page rewritten on the way: what an open page gets once the game changed on the site); Богдан's
// page is as it is. Her copy says the wire of its own code (ihroteka.game.wire), and the library seats it by that:
// not with Богдан's. Both see «Онови сторінку — у друга інша версія», «Оновити» on Богдан's page only (his copy is
// the older), and his page does not reload by itself while the game is open (a round may run in it). Needs the dev
// server with the plaintext games (npm run unlock), or with the probe (npm run dev -- --probe, E2E_GAME=probe).
'use strict';
const { U, w, launch, watch, scenario, check, until, GAME } = require('./support/scenario.cjs');
const { openPage, createLink, frameOf, libState, waitShown } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const UPDATE = /Онови сторінку — у друга інша версія/;

scenario('wireframe: the game code that runs is a newer wire than the shelf says', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = watch(await ctx.newPage(), 'Аня');
  let code = null;                                       // the wire Аня's frame's code speaks
  await pa.route(u => u.pathname.endsWith('/' + GAME + '/') && u.searchParams.has('frame'), async route => {
    const r = await route.fetch();
    const html = (await r.text()).replace(new RegExp('("id":"' + GAME + '","title":"(?:[^"\\\\]|\\\\.)*","players":\\{[^}]*\\},"wire":)(\\d+)'), (_, a, n) => a + (code = +n + 1));
    await route.fulfill({ response: r, body: html });
  });
  await pa.addInitScript(fakeNet('aaaaaaaaaaaa'));
  await pa.goto(U);
  await pa.waitForSelector('#shelf:not([hidden])');
  const link = await createLink(pa, 'Аня');
  const pb = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  check(await until(async () => (await libState(pb)).linked && (await libState(pa)).linked, 15000), 'linked');
  check(!(await libState(pb)).version.gap, 'one version on the shelves: nothing to say yet', (await libState(pb)).version);
  await pa.click('a.game[href*="/' + GAME + '/"]');     // the room goes into the game: Богдан follows
  const [fa] = await Promise.all([frameOf(pa), frameOf(pb)]);
  let loads = 0;
  pb.on('load', () => loads++);                          // (from here on, with his game open)
  const said = await fa.evaluate(() => window.ihroteka.game.wire);
  check(code !== null && said === code, 'Аня\'s ihroteka.game.wire is the wire of the code that runs (' + code + ')', said);
  await until(async () => (await libState(pa)).game && (await libState(pb)).game, 15000);
  await w(1500);
  const [ga, gb] = [(await libState(pa)).game, (await libState(pb)).game];
  check(ga.players.join() === 'Аня' && gb.players.join() === 'Богдан' && !ga.linked && !gb.linked, 'not seated together', [ga, gb]);
  const note = async p => { const x = await waitShown(p); return x.where === 'both' ? '' : x.text; };   // (two messages: none to count)
  check(await until(async () => UPDATE.test(await note(pa)) && UPDATE.test(await note(pb)), 5000), 'both see «Онови сторінку — у друга інша версія»', [await waitShown(pa), await waitShown(pb)]);
  const offered = async p => (await waitShown(p)).buttons.includes('Оновити');
  check(await offered(pb) && !await offered(pa), '«Оновити» on Богдан\'s page only (the older copy)', { Аня: await offered(pa), Богдан: await offered(pb) });
  await w(3000);                                         // (the library checks the versions every second)
  const vb = (await libState(pb)).version;
  check(loads === 0 && !vb.reloading, 'Богдан\'s page does not reload by itself while the game is open', { loads, version: vb });
});
