// version: friends whose copies of a game speak different wire numbers (owner, decision 9). Аня's page is told its
// Two Dragons is wire 2 (its shelf rewritten on the way), Богдан's is 1: Богдан's page, the older, reloads itself
// back into the room (no name asked), once only; both know it; in the game they are not seated together, and both
// see «Онови сторінку — у друга інша версія», with «Оновити» on the older page only. Needs the dev server with the
// plaintext games (npm run unlock).
'use strict';
const { U, w, launch, watch, scenario, check, until } = require('./support/scenario.cjs');
const { openPage, createLink, libState } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const UPDATE = /Онови сторінку — у друга інша версія/;

scenario('version: a friend\'s copy of the game is newer', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = watch(await ctx.newPage(), 'Аня');
  await pa.route('**/*', async route => {                // this page's shelf says dragons is wire 2
    if (route.request().resourceType() !== 'document') return route.continue();
    const r = await route.fetch();
    const html = (await r.text()).replace(/("id":"dragons"[^}]*"players":\{[^}]*\})(,"wire":\d+)?/, '$1,"wire":2');
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
  await pa.click('a.game[href*="dragons"]');            // the room goes into the game
  await until(async () => (await libState(pb)).game && (await libState(pa)).game, 15000);
  await w(1500);
  const note = p => p.evaluate(() => document.getElementById('waiting')?.innerText || '');
  check(UPDATE.test(await note(pa)) && UPDATE.test(await note(pb)), 'the note over the game, on both', [await note(pa), await note(pb)]);
  const offered = p => p.evaluate(() => [...document.querySelectorAll('#waiting button')].some(b => b.textContent === 'Оновити'));
  check(await offered(pb) && !await offered(pa), '«Оновити» on the older page only', { Аня: await offered(pa), Богдан: await offered(pb) });
  const [ga, gb] = [(await libState(pa)).game, (await libState(pb)).game];
  check(ga.players.join() === 'Аня' && gb.players.join() === 'Богдан' && !ga.linked && !gb.linked, 'not seated together', [ga, gb]);
});
