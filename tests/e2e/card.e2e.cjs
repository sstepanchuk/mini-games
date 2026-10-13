// tags: @ci @webkit
// card: the library's one «Чекаємо на …» over a game, over the internet: the waiting message wherever it is (the card,
// library/app/invite.js, or the game's own <ihroteka-wait>, screens.js: never both). Аня and Богдан play a game
// (E2E_GAME: Two Dragons by default). Богдан drops out: Аня's message says whom she waits for, the time his place is
// kept and «Не чекати»; it is built once (each second only the time changes), a screen reader hears only who and why
// (the live region of the library page), and a focused «Не чекати» keeps its focus. Богдан back: no message. Богдан
// goes on in a new tab whose game is slow to open: «Чекаємо на Богдан — повертається в гру», with nothing to press
// (owner, decision 4), until it is open. Then he drops out again and Аня presses «Не чекати»: his place goes. The probe
// places no <ihroteka-wait>: the card as it always was. Needs the dev server with the plaintext games (npm run unlock),
// or with the probe (npm run dev -- --probe, E2E_GAME=probe).
'use strict';
const { U, w, launch, watch, scenario, check, step, until, GAME } = require('./support/scenario.cjs');
const { openPage, createLink, enterName, libState, short, waitShown: cardOf, waitBox, clickWait } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

scenario('card: whom the game waits for, and why', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = await openPage(ctx, 'aaaaaaaaaaaa', U, { label: 'Аня' });
  const link = await createLink(pa, 'Аня');
  const pb = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  check(await until(async () => (await libState(pa)).linked && (await libState(pb)).linked, 15000), 'together', [await short(pa), await short(pb)]);
  await pa.keyboard.press('Escape').catch(() => {});      // (the dialog)
  await until(async () => !(await pa.$('.backdrop')), 5000);
  await pa.click('a.game[href*="/' + GAME + '/"]');
  const playing = async () => { const s = [await libState(pa), await libState(pb)]; return s.every(x => x.game && x.game.linked); };
  if (!check(await until(playing, 20000), 'both in ' + GAME + ', playing together (needs it on the dev server)', [await short(pa), await short(pb)])) return;
  check(!(await cardOf(pa)).where && !(await cardOf(pb)).where, 'no message while nobody is away', [await cardOf(pa), await cardOf(pb)]);

  step('Богдан drops out');
  await pb.evaluate(() => window.__net(false));
  const away = async () => { const c = await cardOf(pa); return c.where && /Чекаємо на Богдан… \d+:\d\d/.test(c.text) && c; };
  let c = await until(away, 10000);
  check(c, 'Аня’s message: «Чекаємо на Богдан… m:ss»', await cardOf(pa));
  check(c && c.where !== 'both', 'in one place only (' + (c && c.where) + ')', c);
  if (GAME === 'probe') {                                 // (contract 4, no <ihroteka-wait>: the card as it always was)
    const s = await pa.evaluate(() => window.__ihroteka.screens());
    check(c && c.where === 'card' && c.copies === 0 && s.adopted === false, 'the probe places no waiting screen: the library\'s card', [c, s]);
  }
  check(c && c.buttons.includes('Не чекати') && !c.buttons.includes('З’єднатися знову'), '… with «Не чекати» (over the internet, no pairing again)', c && c.buttons);
  check(c && c.say === 'Чекаємо на Богдан…', 'the screen reader hears who (not the time)', c && c.say);
  // the row stays the same node, only its time changes; the live region does not change; the focus stays (in the
  // document of whatever holds the rows: the card in the page, or the game's screen in its frame)
  const box = await waitBox(pa);
  await box.evaluate(b => {
    window.__box = b;
    window.__row = b.querySelector('.wait-row');
    window.__stay = [...b.querySelectorAll('button')].find(x => x.textContent === 'Не чекати');
    window.__stay.focus();
    window.__times = [b.querySelector('.wait-time').textContent];
    window.__tick = setInterval(() => window.__times.push(b.querySelector('.wait-time')?.textContent), 500);
  });
  await pa.evaluate(() => {
    window.__said = 0;
    new MutationObserver(m => { window.__said += m.length; }).observe(document.querySelector('#stage .sr'), { childList: true, characterData: true, subtree: true });
  });
  await w(3200);
  const kept = { ...await box.evaluate(b => {
    clearInterval(window.__tick);
    return { same: b.isConnected && b.querySelector('.wait-row') === window.__row, focus: document.activeElement === window.__stay, inside: b.contains(window.__stay),
      times: [...new Set(window.__times)] };
  }), said: await pa.evaluate(() => window.__said), where: (await cardOf(pa)).where };
  check(kept.same && kept.inside && kept.where !== 'both', 'built once: the same row and button 3 s later', kept);
  check(kept.times.length >= 3, 'only the time changes, each second', kept.times);
  check(kept.focus, 'the focused «Не чекати» keeps its focus', kept);
  check(kept.said === 0, 'nothing new for the screen reader meanwhile', kept.said);

  step('Богдан back');
  await pb.evaluate(() => window.__net(true));
  check(await until(async () => !(await cardOf(pa)).where, 15000), 'no message', await cardOf(pa));

  step('Богдан goes on in a new tab, its game slow to open');
  const pc = watch(await ctx.newPage(), 'Богдан (new tab)');
  await pc.route('**/' + GAME + '/**', async r => { if (r.request().resourceType() === 'document') await w(5000); return r.continue().catch(() => {}); });
  await pc.addInitScript(fakeNet('bbbb2222bbbb'));
  await pc.goto(link);
  await enterName(pc, 'Богдан');
  const loading = async () => { const x = await cardOf(pa); return x.where && x.text === 'Чекаємо на Богдан — повертається в гру' && x; };
  c = await until(loading, 10000, 100);
  check(c, 'Аня’s message: «Чекаємо на Богдан — повертається в гру»', await cardOf(pa));
  check(c && c.where !== 'both', 'in one place only (' + (c && c.where) + ')', c);
  check(c && !c.buttons.length, '… with nothing to press (no «Не чекати»: he did not drop out)', c && c.buttons);
  check(c && c.say === 'Чекаємо на Богдан — повертається в гру', 'the screen reader hears why', c && c.say);
  check(await until(async () => !(await cardOf(pa)).where && (await libState(pc)).game?.linked, 15000), 'his game open there: no message, playing', [await cardOf(pa), await short(pc)]);

  step('Богдан drops out again; Аня does not wait');
  await pc.evaluate(() => window.__net(false));
  c = await until(away, 10000);
  check(c && c.where !== 'both', 'the message again, in one place', await cardOf(pa));
  await clickWait(pa, 'Не чекати');
  check(await until(async () => (await libState(pa)).players.join() === 'Аня' && !(await cardOf(pa)).where, 5000), 'his place goes, no message', [await short(pa), await cardOf(pa)]);
}, { timeout: 150000 });
