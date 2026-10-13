// tags: @ci
// nearbybye: nearby, no internet. Ганна (who showed the code first) and Гліб are together; Гліб's page reloads. Its
// goodbye goes out as the page closes (sends are synchronous here, as on a real phone: support/fakenet.cjs) and says
// that his place is kept: Ганна's room goes on, Гліб is away. His new page pairs again («З’єднатися знову» on Ганна's
// phone) and he is back in his place. (Before phase 1b, C1, that goodbye ended the room on Ганна's phone.)
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState } = require('./support/pages.cjs');

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
  check(/зв’язок зник/.test(await H.p.textContent('#together')), 'Ганна’s chip: «Разом · зв’язок зник…»', await H.p.textContent('#together'));

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
}, { timeout: 120000 });
