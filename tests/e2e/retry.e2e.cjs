// tags: @ci @webkit
// retry: a game that did not open on one device of a room (here Богдан's: the dev server's loader made to fail the way
// lock.js does with no network, error.say = the offline message, while window.__failOpen is set; his bundle rewritten
// on the way, as proto.e2e.cjs does) says why over the game, with «Спробувати ще» (focused) and «До бібліотеки».
// «Спробувати ще» opens the same game again on his device only: pressed while it still fails, the note comes back;
// once it works, the game opens. Meanwhile the room stays in the game: Аня, who opened it, never sees the shelf
// (sampled every 100 ms). E2E_GAME: any game (the probe on CI).
'use strict';
const { U, launch, watch, forgive, scenario, check, step, until, GAME } = require('./support/scenario.cjs');
const { fakeNet } = require('./support/fakenet.cjs');
const { createLink, enterName, frameOf, libState, short } = require('./support/pages.cjs');

const OFFLINE = 'Не вдалося завантажити. Перевір інтернет і спробуй ще.';
// the dev server's loader (index.js boot, as esbuild writes it): its parameter and the site root's name
const LOADER = /loader: async \((\w+)\) => \(\{ src: new URL\(\1\.id \+ "\/\?frame", (\w+)\)\.href \}\)/;
// what the note shows: its text, its buttons on the screen, where the focus is; the stage, the shelf, the frame
const noteOf = p => p.evaluate(() => ({
  text: document.getElementById('stage-text').textContent,
  buttons: [...document.querySelectorAll('#stage-note button')].filter(b => !b.hidden && b.getClientRects().length).map(b => b.textContent),
  focus: document.activeElement?.id || '', note: !document.getElementById('stage-note').hidden,
  stage: !document.getElementById('stage').hidden, shelf: !document.getElementById('shelf').hidden, frame: !!document.querySelector('iframe.frame')
}));

scenario('retry: a game that did not open, tried again here only', async () => {
  const ctx = await (await launch()).newContext();
  const A = watch(await ctx.newPage(), 'Аня');
  await A.addInitScript(fakeNet('aaaaaaaaaaaa'));
  await A.goto(U);
  await A.waitForSelector('#shelf:not([hidden])');
  const link = await createLink(A, 'Аня');

  const B = watch(await ctx.newPage(), 'Богдан');
  await B.addInitScript(fakeNet('bbbbbbbbbbbb'));
  await B.addInitScript(() => { window.__failOpen = true; });
  let rewritten = false;
  await B.route('**/lib/ihroteka.js', async route => {
    const r = await route.fetch(), body = await r.text();
    rewritten = LOADER.test(body);
    await route.fulfill({ response: r, body: body.replace(LOADER, (_, g, root) => 'loader: async (' + g + ') => { window.__opens = (window.__opens || 0) + 1; if (window.__failOpen) { const e = new TypeError("Failed to fetch"); ' +
      'e.say = ' + JSON.stringify(OFFLINE) + '; throw e; } return { src: new URL(' + g + '.id + "/?frame", ' + root + ').href }; }') });
  });
  await B.goto(link);
  await enterName(B, 'Богдан');
  if (!check(rewritten, 'Богдан\'s library: its loader fails while __failOpen is set')) return;
  check(await until(async () => (await libState(A)).linked && (await libState(B)).linked, 20000), 'Аня and Богдан together', [await short(A), await short(B)]);
  await A.keyboard.press('Escape').catch(() => {});
  await until(async () => !(await A.$('.backdrop')), 5000);
  await B.keyboard.press('Escape').catch(() => {});
  await until(async () => !(await B.$('.backdrop')), 5000);

  step('Аня opens ' + GAME + '; Богдан follows, and the game does not open for him');
  await A.click('a.game[href*="/' + GAME + '/"]');
  await frameOf(A);
  await A.evaluate(() => { window.__sawShelf = false; setInterval(() => { if (!document.getElementById('shelf').hidden) window.__sawShelf = true; }, 100); });
  let n = await until(async () => { const x = await noteOf(B); return x.text === OFFLINE && x; }, 15000);
  check(n && n.stage && !n.shelf && !n.frame, 'Богдан: over the game, it says ' + OFFLINE, await noteOf(B));
  check(n && n.buttons.join() === 'Спробувати ще,До бібліотеки', '… with «Спробувати ще» and «До бібліотеки»', n && n.buttons);
  check(n && n.focus === 'stage-retry', '… the focus on «Спробувати ще»', n && n.focus);
  check((await libState(A)).view === GAME && !!(await A.$('iframe.frame')), 'Аня stays in the game', await short(A));

  step('«Спробувати ще» while it still fails');
  const opens = await B.evaluate(() => window.__opens);
  await B.click('#stage-retry');
  check(await until(() => B.evaluate(k => window.__opens === k + 1, opens), 5000), 'it tries to open the game once more', await B.evaluate(() => window.__opens));
  n = await until(async () => { const x = await noteOf(B); return x.text === OFFLINE && x.buttons.length === 2 && x; }, 10000);
  check(n && n.buttons.join() === 'Спробувати ще,До бібліотеки' && n.focus === 'stage-retry', 'the note again, the focus on «Спробувати ще»', await noteOf(B));
  check((await libState(A)).view === GAME && (await libState(B)).view === GAME, 'the room stays in the game', [await short(A), await short(B)]);

  step('it works again: «Спробувати ще» opens the game');
  await B.evaluate(() => { window.__failOpen = false; });
  await B.click('#stage-retry');
  const f = await frameOf(B).catch(() => null);
  check(!!f, 'Богдан: the game opens', await noteOf(B));
  check(await until(async () => !(await noteOf(B)).note, 10000), '… and the note goes', await noteOf(B));
  check(await until(async () => (await libState(A)).view === GAME && (await libState(B)).view === GAME, 5000), 'both in ' + GAME, [await short(A), await short(B)]);
  check(!!(await A.$('iframe.frame')) && !(await A.evaluate(() => window.__sawShelf)), 'Аня never saw the shelf');
  forgive(0, /^Богдан: console\.error TypeError: Failed to fetch /);   // (the failure made here, which the shell logs)
}, { timeout: 120000 });
