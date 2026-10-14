// tags: @ci
// nearby3cut: nearby, four phones (no internet, real WebRTC), a game for three (`cli new demo3 --players 2-3`, a dev
// server of its own) mid-round: Ганна holds the room (the hub: every guest's only link goes to her phone), Гліб and
// Кіра play with her, Дана waits for a seat. «З’єднатися знову» shows only where pairing again works (owner, decision
// 31): Кіра's phone loses its link to the hub, so she hears nobody: her screen names the hub only («Чекаємо, поки
// повернеться Ганна… m:ss», why she hears nobody else, «З’єднатися знову», «Не чекати»); Гліб, whose link works, sees
// Кіра's row with «Не чекати» only and who has to pair («Кіра і Ганна мають з’єднатися ще раз кодами.»), and his «Грати
// разом» has no «З’єднатися знову»; the hub's row for Кіра has it. Кіра pairs again from her row (the hub from its own):
// back in her place. Then Дана, who waits for a seat, loses her link to the hub: her screen names the hub above her seat
// (decision 32), and she pairs again from it (the hub from «Грати разом»). Nobody away afterwards. Runs on its own
// server: E2E_URL is only checked to be up, by run.cjs. Chromium (its fake camera).
'use strict';
const { scenario, check, step, until, skip, CHROMIUM } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState, waitShown, clickWait } = require('./support/pages.cjs');
const { newGame, templateFrame, templateView } = require('./support/newgame.cjs');

if (!CHROMIUM) skip('nearby needs Chromium\'s fake camera');

// the waiting message's rows, wherever it is (the card, or the game's <ihroteka-wait>): each one's text (its buttons'
// words at the end) and buttons
const rows = X => X.p.evaluate(() => {
  const norm = t => t.replace(/\s+/g, ' ').trim();
  let doc = null;
  try { doc = document.querySelector('iframe.frame')?.contentDocument || null; } catch (e) {}
  const held = doc && [...doc.querySelectorAll('ihroteka-wait')].find(x => x.firstElementChild && x.getClientRects().length > 0);
  const c = document.getElementById('waiting'), box = held || (c && !c.hidden ? c : null);
  return box ? [...box.children].map(r => ({ text: norm(r.innerText), buttons: [...r.querySelectorAll('button')].map(b => b.textContent) })) : [];
});
const buttons = X => X.p.$$eval('.dialog button:not([hidden])', b => b.map(x => x.textContent));
const noBackdrop = X => until(async () => !(await X.p.$('.backdrop')), 5000);

scenario('nearby3cut: four phones, a game for three, «З’єднатися знову» only where it works', async () => {
  const G = await newGame('demo3', ['--players', '2-3', '--title', 'Демо три']), url = G.url;
  if (!check(G.made, 'cli new demo3 --players 2-3', G.out)) return;
  if (!check(G.up, 'its dev server at ' + url, G.log)) return;
  const H = await phone('hhhhhhhhhhhh', 'Ганна', { url }), G1 = await phone('gggggggggggg', 'Гліб', { url });
  const K = await phone('kkkkkkkkkkkk', 'Кіра', { url }), D = await phone('dddddddddddd', 'Дана', { url });
  const ALL = [H, G1, K, D];

  step('Ганна pairs with Гліб, then adds Кіра and Дана');
  await pair(H, G1);
  check(await allLinked([H, G1]), 'Ганна and Гліб linked');
  for (const X of [K, D]) {
    await noBackdrop(H);
    const n = (await libState(H.p)).players.length;
    await pair(H, X, { adding: true });
    check(await until(async () => (await libState(H.p)).players.length === n + 1 && (await libState(X.p)).linked, 20000), X.name + ' in', await libState(X.p));
  }
  const four = async () => (await Promise.all(ALL.map(x => libState(x.p)))).every(s => s.linked && s.players.length === 4 && !s.away.length);
  check(await until(four, 20000), 'four phones, one room, nobody away', await Promise.all(ALL.map(x => libState(x.p))));
  for (const X of ALL) await noBackdrop(X);

  step('Гліб opens the game for three; a round of three; Дана waits for a seat');
  await G1.p.click('a.game[href*="demo3"]');
  const F = {};
  for (const X of ALL) F[X.name] = await templateFrame(X.p, 'main');
  const seats = await until(async () => { const g = (await libState(H.p)).game; return g && g.players.length === 3 && g.waiting.join() === 'Дана' && g; }, 15000);
  check(seats, 'Ганна, Гліб and Кіра seated; Дана waits', seats);
  if (!seats) return;
  await F['Гліб'].click('#start');
  check(await until(async () => (await Promise.all(['Ганна', 'Гліб', 'Кіра'].map(n => templateView(F[n])))).every(v => v && v.play), 10000), 'a round of three is on');
  check(await until(async () => /^Ти чекаєш на місце/.test((await waitShown(D.p)).text), 10000), 'Дана: «Ти чекаєш на місце»', await waitShown(D.p));

  step('Кіра’s phone loses its link to the hub');
  await K.p.evaluate(() => window.__killDc());
  const cut = /^Чекаємо, поки повернеться Ганна… \d+:\d\d Кімнату поруч тримає телефон, на якому грає Ганна: без нього не чути й інших\. /;
  const k = await until(async () => { const r = await rows(K); return r.length === 1 && cut.test(r[0].text) && r; }, 25000);
  check(k, 'Кіра: one row, the hub, and why she hears nobody else', await rows(K));
  check(k && k[0].buttons.join() === 'З’єднатися знову,Не чекати', '… «З’єднатися знову» and «Не чекати»', k && k[0].buttons);
  const g = await until(async () => { const r = await rows(G1); return r.length === 1 && /^Чекаємо, поки повернеться Кіра… \d+:\d\d Кіра і Ганна мають з’єднатися ще раз кодами\. /.test(r[0].text) && r; }, 20000);
  check(g, 'Гліб (his link works): Кіра’s row says who has to pair', await rows(G1));
  check(g && g[0].buttons.join() === 'Не чекати', '… with «Не чекати» only', g && g[0].buttons);
  const h = await until(async () => { const r = await rows(H); return r.length === 1 && /^Чекаємо, поки повернеться Кіра… \d+:\d\d/.test(r[0].text) && r; }, 20000);
  check(h && h[0].buttons.join() === 'З’єднатися знову,Не чекати', 'the hub: Кіра’s row with «З’єднатися знову» and «Не чекати»', await rows(H));
  await F['Гліб'].evaluate(() => window.ihroteka.invite());   // Гліб’s «Грати разом», from the game
  await G1.p.waitForSelector('.dialog >> text=Від’єднатися');
  check(!(await buttons(G1)).includes('З’єднатися знову'), 'Гліб’s «Грати разом»: no «З’єднатися знову»', await buttons(G1));
  await G1.p.keyboard.press('Escape');

  step('Кіра pairs again from her row (the hub from its own)');
  await clickWait(H.p, 'З’єднатися знову');
  const offer = await H.code();
  await clickWait(K.p, 'З’єднатися знову');
  await K.p.waitForSelector('video.scan', { timeout: 10000 }).catch(() => {});
  await K.paste(offer);
  const answer = await K.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(answer);
  check(await until(four, 20000), 'Кіра back in her place: nobody away on any phone', await Promise.all(ALL.map(x => libState(x.p))));
  check(await until(async () => (await Promise.all([H, G1, K].map(rows))).every(r => !r.length), 10000), 'nothing to wait for in the game', await Promise.all([H, G1, K].map(rows)));
  for (const X of ALL) await noBackdrop(X);

  step('Дана, who waits for a seat, loses her link to the hub');
  await D.p.evaluate(() => window.__killDc());
  const d = await until(async () => { const r = await rows(D); return r.length === 2 && cut.test(r[0].text) && /^Ти чекаєш на місце/.test(r[1].text) && r; }, 25000);
  check(d, 'Дана: the hub, above her seat', await rows(D));
  check(d && d[0].buttons.join() === 'З’єднатися знову,Не чекати', '… «З’єднатися знову» and «Не чекати»', d && d[0].buttons);
  await F['Ганна'].evaluate(() => window.ihroteka.invite());   // the hub pairs her again from «Грати разом»
  await H.p.waitForSelector('.dialog >> text=З’єднатися знову');
  await H.p.click('.dialog >> text=З’єднатися знову');
  const offer2 = await H.code();
  await clickWait(D.p, 'З’єднатися знову');
  await D.p.waitForSelector('video.scan', { timeout: 10000 }).catch(() => {});
  await D.paste(offer2);
  const answer2 = await D.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(answer2);
  check(await until(four, 20000), 'Дана back: nobody away on any phone', await Promise.all(ALL.map(x => libState(x.p))));
  check(await until(async () => { const r = await rows(D); return r.length === 1 && /^Ти чекаєш на місце/.test(r[0].text); }, 10000), 'Дана waits for her seat again, nothing else', await rows(D));
}, { timeout: 240000 });
