// tags: @ci
// nearbybye: nearby, no internet. Ганна (who showed the code first) and Гліб are together; Гліб's page reloads. Its
// goodbye goes out as the page closes (sends are synchronous here, as on a real phone: support/fakenet.cjs) and says
// that his place is kept: Ганна's room goes on, Гліб is away. His new page pairs again («З’єднатися знову» on Ганна's
// phone) and he is back in his place. (Before phase 1b, C1, that goodbye ended the room on Ганна's phone.) Then a
// pairing the other phone gives up: Ірина reads Олег's code and cancels at once, before the phones said hello; his
// phone says so at once (owner, decision 33): «Не вдалося з’єднатися», «Друг скасував з’єднання або закрив сторінку.
// Спробуйте ще раз.», «Спробувати ще» (before: «Чекаю на з’єднання…» for good).
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState, chipText } = require('./support/pages.cjs');

scenario('nearbybye: a page that reloads in a nearby room keeps its place', async () => {
  const H = await phone('hhhhhhhhhhhh', 'Ганна'), G = await phone('gggggggggggg', 'Гліб');

  step('Ганна pairs with Гліб');
  await pair(H, G);
  check(await allLinked([H, G], 15000), 'linked', [await libState(H.p), await libState(G.p)]);
  await until(async () => !(await H.p.$('.backdrop')), 5000);   // (the dialog closes by itself)

  step('Гліб’s page reloads');
  await G.p.reload();
  await G.p.waitForSelector('#shelf:not([hidden])');
  const kept = await until(async () => { const s = await libState(H.p); return s.kind === 'nearby' && s.away.join() === 'Гліб' && s; }, 10000);
  check(kept, 'Ганна’s room goes on; Гліб is away, his place kept', await libState(H.p));
  check(kept && kept.players.join() === 'Ганна,Гліб', 'the same two places', kept && kept.players);
  check(await chipText(H.p) === 'Зв’язок зник', 'Ганна’s chip: «Зв’язок зник» (owner, decision 65)', await chipText(H.p));

  step('his new page pairs again');
  await H.together();
  await H.p.click('text=З’єднатися знову');
  const offer = await H.code();
  await G.together(); await G.nearby();
  await G.p.click('text=Сканувати код');
  await G.p.waitForSelector('video.scan');
  await G.paste(offer);
  const answer = await G.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(answer);
  const back = async () => (await Promise.all([H, G].map(x => libState(x.p)))).every(s => s.linked && s.players.join() === 'Ганна,Гліб' && !s.away.length);
  check(await until(back, 20000), 'together again, Гліб in his place', await Promise.all([H, G].map(x => libState(x.p))));

  step('Ірина reads Олег’s code, then cancels at once');
  const I = await phone('iiiiiiiiiiii', 'Ірина'), O = await phone('oooooooooooo', 'Олег');
  await I.together(); await I.nearby();
  await I.p.click('text=Показати код');
  const code = await I.code();
  await O.together(); await O.nearby();
  await O.p.click('text=Сканувати код');
  await O.p.waitForSelector('video.scan');
  await O.paste(code);
  const reply = await O.code();
  await I.p.click('text=Далі: сканувати код друга');
  // (her «Скасувати» the moment the code is read, before the phones say hello: in the page, as the dialog changes)
  await I.p.evaluate(() => new MutationObserver((l, mo) => {
    const d = document.querySelector('.dialog');
    if (!d || !/З’єднуюсь…/.test(d.textContent)) return;
    mo.disconnect();
    [...d.querySelectorAll('button')].find(b => b.textContent === 'Скасувати').click();
  }).observe(document.getElementById('layer'), { subtree: true, childList: true, characterData: true }));
  await I.paste(reply);
  const t0 = Date.now();
  check(await until(async () => !(await I.p.$('.backdrop')) && !(await libState(I.p)).kind, 5000), 'Ірина’s dialog is gone, and her room', await libState(I.p));
  const told = await until(async () => /Не вдалося з’єднатися/.test(await O.text()), 45000, 300);
  console.log('    (Олег told after ' + (Date.now() - t0) + ' ms: as soon as his browser gives the link up)');
  const t = await O.text();
  check(told && /Друг скасував з’єднання або закрив сторінку\. Спробуйте ще раз\./.test(t), 'Олег: «Не вдалося з’єднатися», «Друг скасував з’єднання або закрив сторінку. Спробуйте ще раз.»', t);
  check(/Спробувати ще/.test(t) && !/Чекаю на з’єднання…/.test(t), '… «Спробувати ще», no more «Чекаю на з’єднання…»', t);
  check(!(await libState(O.p)).linked, 'not linked', await libState(O.p));
}, { timeout: 180000 });
