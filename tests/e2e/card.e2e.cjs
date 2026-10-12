// card: the library's one «Чекаємо на …» over a game (library/app/invite.js), over the internet. Аня and Богдан play
// Two Dragons. Богдан drops out: Аня's card says whom she waits for, the time his place is kept and «Не чекати»; it is
// built once (each second only the time changes), a screen reader hears only who and why (the live region beside it),
// and a focused «Не чекати» keeps its focus. Богдан back: no card. Богдан goes on in a new tab whose game is slow to
// open: «Чекаємо на Богдан — повертається в гру», with nothing to press (owner, decision 4), until it is open. Then he
// drops out again and Аня presses «Не чекати»: his place goes. Needs the dev server with the plaintext games (npm run
// unlock).
'use strict';
const { U, w, launch, watch, scenario, check, step, until } = require('./support/scenario.cjs');
const { openPage, createLink, enterName, libState, short, waitCard: cardOf } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

scenario('card: whom the game waits for, and why', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = await openPage(ctx, 'aaaaaaaaaaaa', U, { label: 'Аня' });
  const link = await createLink(pa, 'Аня');
  const pb = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  check(await until(async () => (await libState(pa)).linked && (await libState(pb)).linked, 15000), 'together', [await short(pa), await short(pb)]);
  await pa.keyboard.press('Escape').catch(() => {});      // (the dialog)
  await until(async () => !(await pa.$('.backdrop')), 5000);
  await pa.click('a.game[href*="dragons"]');
  const playing = async () => { const s = [await libState(pa), await libState(pb)]; return s.every(x => x.game && x.game.linked); };
  if (!check(await until(playing, 20000), 'both in Two Dragons, playing together (needs the plaintext games)', [await short(pa), await short(pb)])) return;
  check(!(await cardOf(pa)).shown && !(await cardOf(pb)).shown, 'no card while nobody is away');

  step('Богдан drops out');
  await pb.evaluate(() => window.__net(false));
  const away = async () => { const c = await cardOf(pa); return c.shown && /Чекаємо на Богдан… \d+:\d\d/.test(c.text) && c; };
  let c = await until(away, 10000);
  check(c, 'Аня’s card: «Чекаємо на Богдан… m:ss»', await cardOf(pa));
  check(c && c.buttons.includes('Не чекати') && !c.buttons.includes('З’єднатися знову'), '… with «Не чекати» (over the internet, no pairing again)', c && c.buttons);
  check(c && c.say === 'Чекаємо на Богдан…', 'the screen reader hears who (not the time)', c && c.say);
  // the card stays the same node, only its time changes; the live region does not change; the focus stays
  await pa.evaluate(() => {
    window.__card = document.getElementById('waiting');
    window.__stay = [...window.__card.querySelectorAll('button')].find(b => b.textContent === 'Не чекати');
    window.__stay.focus();
    window.__said = 0;
    new MutationObserver(m => { window.__said += m.length; }).observe(document.querySelector('#stage .sr'), { childList: true, characterData: true, subtree: true });
    window.__times = [window.__card.querySelector('.left').textContent];
    window.__tick = setInterval(() => window.__times.push(window.__card.querySelector('.left')?.textContent), 500);
  });
  await w(3200);
  const kept = await pa.evaluate(() => {
    clearInterval(window.__tick);
    return { same: document.getElementById('waiting') === window.__card, focus: document.activeElement === window.__stay, inside: window.__card.contains(window.__stay),
      said: window.__said, times: [...new Set(window.__times)] };
  });
  check(kept.same && kept.inside, 'built once: the same card and button 3 s later', kept);
  check(kept.times.length >= 3, 'only the time changes, each second', kept.times);
  check(kept.focus, 'the focused «Не чекати» keeps its focus', kept);
  check(kept.said === 0, 'nothing new for the screen reader meanwhile', kept.said);

  step('Богдан back');
  await pb.evaluate(() => window.__net(true));
  check(await until(async () => !(await cardOf(pa)).shown, 15000), 'no card', await cardOf(pa));

  step('Богдан goes on in a new tab, its game slow to open');
  const pc = watch(await ctx.newPage(), 'Богдан (new tab)');
  await pc.route('**/dragons/**', async r => { if (r.request().resourceType() === 'document') await w(5000); return r.continue().catch(() => {}); });
  await pc.addInitScript(fakeNet('bbbb2222bbbb'));
  await pc.goto(link);
  await enterName(pc, 'Богдан');
  const loading = async () => { const x = await cardOf(pa); return x.shown && x.text === 'Чекаємо на Богдан — повертається в гру' && x; };
  c = await until(loading, 10000, 100);
  check(c, 'Аня’s card: «Чекаємо на Богдан — повертається в гру»', await cardOf(pa));
  check(c && !c.buttons.length, '… with nothing to press (no «Не чекати»: he did not drop out)', c && c.buttons);
  check(c && c.say === 'Чекаємо на Богдан — повертається в гру', 'the screen reader hears why', c && c.say);
  check(await until(async () => !(await cardOf(pa)).shown && (await libState(pc)).game?.linked, 15000), 'his game open there: no card, playing', [await cardOf(pa), await short(pc)]);

  step('Богдан drops out again; Аня does not wait');
  await pc.evaluate(() => window.__net(false));
  check(await until(away, 10000), 'the card again', await cardOf(pa));
  await pa.click('#waiting >> text=Не чекати');
  check(await until(async () => (await libState(pa)).players.join() === 'Аня' && !(await cardOf(pa)).shown, 5000), 'his place goes, no card', [await short(pa), await cardOf(pa)]);
}, { timeout: 150000 });
