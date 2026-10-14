// tags: @ci @webkit
// gamegap: a game one shelf has and the other not (a deploy added it, or took it off), opened in the room (owner,
// decision 36: another version; which page is the older the site says, the shell's newer()). Богдан's page is told its
// shelf lacks the game (E2E_GAME: Two Dragons by default; the dev server's page rewritten on the way), Аня's has it.
// Аня opens it: Богдан stays on the shelf and is told so once, in a note: «У кімнаті відкрили гру, якої тут немає»;
// over Аня's game: «Богдан не може відкрити цю гру: там інша версія Ігротеки». The dev server has no service worker, so
// neither page is the older (newer() false): only the words, no «Оновити», and no page reloads. Needs the dev server with
// the plaintext games (npm run unlock), or with the probe (npm run dev -- --probe, E2E_GAME=probe).
'use strict';
const { U, w, launch, watch, scenario, check, until, GAME } = require('./support/scenario.cjs');
const { createLink, enterName, frameOf, libState, short, waitShown } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const MISSING = 'У кімнаті відкрили гру, якої тут немає', THEIRS = 'Богдан не може відкрити цю гру: там інша версія Ігротеки';

scenario('gamegap: a game only one shelf has, opened in the room', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = watch(await ctx.newPage(), 'Аня');
  await pa.addInitScript(fakeNet('aaaaaaaaaaaa'));
  let loadsA = 0;
  pa.on('load', () => loadsA++);
  await pa.goto(U);
  await pa.waitForSelector('#shelf:not([hidden])');
  const link = await createLink(pa, 'Аня');
  const pb = watch(await ctx.newPage(), 'Богдан');
  let cut = 0;
  await pb.route('**/*', async route => {                // Богдан's shelf has no such game (the dev server's page says its games)
    if (route.request().resourceType() !== 'document') return route.continue();
    const r = await route.fetch();
    const html = (await r.text()).replace(/boot\((\{.*\})\);/, (_, j) => { const o = JSON.parse(j); if (o.dev) { cut++; o.dev.games = o.dev.games.filter(g => g.id !== GAME); } return 'boot(' + JSON.stringify(o) + ');'; });
    await route.fulfill({ response: r, body: html });
  });
  // every note at the bottom Богдан's page shows, each as it appears
  await pb.addInitScript(() => {
    window.__notes = [];
    const seen = new WeakSet();
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) if (!seen.has(t)) { seen.add(t); window.__notes.push(t.textContent); } })
      .observe(document, { subtree: true, childList: true });
  });
  await pb.addInitScript(fakeNet('bbbbbbbbbbbb'));
  let loadsB = 0;
  pb.on('load', () => loadsB++);
  await pb.goto(link);
  await pb.waitForSelector('#shelf:not([hidden])');
  await enterName(pb, 'Богдан');
  check(await until(async () => (await libState(pa)).linked && (await libState(pb)).linked, 20000), 'together', [await short(pa), await short(pb)]);
  const shelfB = await pb.evaluate(() => [...document.querySelectorAll('#games a.game')].map(a => a.getAttribute('href')));
  check(cut > 0 && !shelfB.some(h => h.includes('/' + GAME + '/')), 'Богдан\'s shelf lacks ' + GAME, shelfB);
  check(!(await libState(pa)).version.gap && !(await libState(pb)).version.gap, 'nobody has it open: nothing to say', [(await libState(pa)).version, (await libState(pb)).version]);
  await pa.keyboard.press('Escape').catch(() => {});      // (the dialog)
  await until(async () => !(await pa.$('.backdrop')), 5000);

  await pa.click('a.game[href*="/' + GAME + '/"]');     // Аня opens it
  await frameOf(pa);
  const row = async () => { const x = await waitShown(pa); return x.where && x.where !== 'both' && x.text === THEIRS && x; };
  const a = await until(row, 10000);
  check(a, 'over Аня\'s game: «' + THEIRS + '» (in one place)', await waitShown(pa));
  check(a && !a.buttons.length, '… nothing to press (the dev server has nothing newer: newer() false)', a && a.buttons);
  const ga = (await libState(pa)).game;
  check(ga && ga.players.join() === 'Аня' && !ga.linked, 'Аня plays alone (Богдан cannot open it)', ga);
  check(await until(async () => (await pb.evaluate(() => window.__notes)).includes(MISSING), 10000), 'Богдан\'s shelf says «' + MISSING + '»', await pb.evaluate(() => window.__notes));
  const sb = await libState(pb);
  check(sb.myHere === null && sb.view === GAME && await pb.isHidden('#stage'), 'Богдан stays on the shelf', [sb.view, sb.myHere]);
  check(sb.version.gap && sb.version.gap.why === 'game' && sb.version.gap.missing === 'ours' && !sb.version.reloading, 'his page knows why: a game it lacks; no reload', sb.version);
  await w(3000);                                         // (the library checks the versions every second)
  const notes = (await pb.evaluate(() => window.__notes)).filter(t => t === MISSING);
  check(notes.length === 1, 'said once', notes);
  check(loadsA === 1 && loadsB === 1, 'no page reloads (no newer version to reload into)', { Аня: loadsA, Богдан: loadsB });
  check(!(await libState(pa)).version.reloading && !(await libState(pb)).version.reloading, 'nor is about to', [(await libState(pa)).version, (await libState(pb)).version]);
});
