// tags: @ci @webkit
// version: friends whose copies of a game speak different wire numbers (owner, decisions 9 and 37). Аня's page is told
// its copy of the game (E2E_GAME: Two Dragons by default) is one wire newer than it is (her shelf and the game's own
// page rewritten on the way: a copy speaks the wire of the code that runs, wireframe.e2e.cjs), Богдан's is as it is:
// Богдан's page, the older, reloads itself back into the room (no name asked), once only; both know it. On the shelf,
// «Грати разом» says each page its own part, with «Оновити» on the older page (the shelf has no game's note to press
// it in), which reloads it back into the room, again without asking the name. In the game they are not seated
// together, and each page sees its own part (the waiting message wherever it is: the card, or the game's
// <ihroteka-wait>): «У друга новіша версія — онови сторінку» with «Оновити» on the older, «У друга старіша версія — хай
// оновить сторінку» on the newer. Needs the dev server with the plaintext games (npm run unlock), or with the probe
// (npm run dev -- --probe, E2E_GAME=probe).
'use strict';
const { U, w, launch, watch, scenario, check, until, GAME } = require('./support/scenario.cjs');
const { openPage, createLink, dialogText, libState, waitShown } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const OLDER = 'У друга новіша версія — онови сторінку', NEWER = 'У друга старіша версія — хай оновить сторінку';

scenario('version: a friend\'s copy of the game is newer', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = watch(await ctx.newPage(), 'Аня');
  await pa.route('**/*', async route => {                // this page's shelf and its game's page say the game is one wire newer
    if (route.request().resourceType() !== 'document') return route.continue();
    const r = await route.fetch();
    // (one more than the game's own wire: no "wire" is 1)
    const html = (await r.text()).replace(new RegExp('("id":"' + GAME + '"[^}]*"players":\\{[^}]*\\})(?:,"wire":(\\d+))?'), (_, a, n) => a + ',"wire":' + ((+n || 1) + 1));
    await route.fulfill({ response: r, body: html });
  });
  await pa.addInitScript(fakeNet('aaaaaaaaaaaa'));
  await pa.goto(U);
  await pa.waitForSelector('#shelf:not([hidden])');
  const link = await createLink(pa, 'Аня');
  const pb = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  let loads = 0;
  pb.on('load', () => loads++);
  const back = await until(async () => loads >= 1 && await pb.evaluate(() => !!window.__ihroteka) && (await libState(pb)).linked, 20000);
  check(back, 'Богдан\'s page (the older) reloads itself, back in the room', { loads });
  check(!await pb.isVisible('.dialog input.link'), 'without being asked the name again');
  await w(3000);
  check(loads === 1, 'once: not again for the same version', loads);
  const [sa, sb] = [await libState(pa), await libState(pb)];
  check(sb.version.gap?.older && sa.version.gap && !sa.version.gap.older, 'both know: Богдан older, Аня newer', [sa.version, sb.version]);

  // «Грати разом» on the shelf: «Ви граєте разом» (a wire gap still links them) says each its part
  const together = async p => {
    if (await p.$('.backdrop')) { await p.keyboard.press('Escape'); await until(async () => !(await p.$('.backdrop')), 3000); }
    await p.click('#together');
    await p.waitForSelector('.dialog >> text=Від’єднатися', { timeout: 5000 });
    return { text: await dialogText(p), buttons: await p.$$eval('.dialog button:not([hidden])', b => b.map(x => x.textContent)) };
  };
  const [da, db] = [await together(pa), await together(pb)];
  check(db.text.includes(OLDER + '.') && db.buttons.includes('Оновити'), 'Богдан\'s «Грати разом»: «' + OLDER + '», and «Оновити»', db);
  check(da.text.includes(NEWER + '.') && !da.buttons.includes('Оновити') && !/онови сторінку/.test(da.text), 'Аня\'s: «' + NEWER + '», nothing to press', da);
  await pa.keyboard.press('Escape');
  await pb.click('.dialog >> text=Оновити');
  const again = await until(async () => loads >= 2 && await pb.evaluate(() => !!window.__ihroteka) && (await libState(pb)).linked, 20000);
  check(again, '«Оновити»: Богдан\'s page reloads, back in the room', { loads });
  check(!await pb.isVisible('.dialog input.link'), 'without being asked the name again');
  await w(2000);
  check(loads === 2, 'and then no more', loads);

  await until(async () => !(await pa.$('.backdrop')), 3000);
  await pa.click('a.game[href*="/' + GAME + '/"]');     // the room goes into the game
  await until(async () => (await libState(pb)).game && (await libState(pa)).game, 15000);
  await w(1500);
  const note = async p => { const x = await waitShown(p); return x.where === 'both' ? '' : x.text; };   // (two messages: none to count)
  check(await until(async () => (await note(pa)).startsWith(NEWER) && (await note(pb)).startsWith(OLDER), 5000), 'the note over the game, each page its part (in one place)', [await waitShown(pa), await waitShown(pb)]);
  const offered = async p => (await waitShown(p)).buttons.includes('Оновити');
  check(await offered(pb) && !await offered(pa), '«Оновити» on the older page only', { Аня: await offered(pa), Богдан: await offered(pb) });
  const [ga, gb] = [(await libState(pa)).game, (await libState(pb)).game];
  check(ga.players.join() === 'Аня' && gb.players.join() === 'Богдан' && !ga.linked && !gb.linked, 'not seated together', [ga, gb]);
});
