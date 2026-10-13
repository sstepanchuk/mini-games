// tags: @ci
// The "Грати разом" dialog: it checks for internet by itself. Without internet it goes straight to nearby (show or
// scan a code); with internet it offers two ways. Both ways link two players up: a link (the friend opens it and
// gives a name), and nearby (show / scan a code, then the other way round).
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { openPage, phone, pair, allLinked, libState, dialogText } = require('./support/pages.cjs');

scenario('ui: the play-together dialog, without and with internet; a link and nearby link up', async () => {
  step('no internet');
  const X = await phone('xxxxxxxxxxxx', 'Ікс');
  await X.together();
  await X.p.waitForSelector('text=Показати код');
  let t = await X.text();
  check(/Інтернету немає/.test(t), 'it says there is no internet', t);
  check(/Показати код/.test(t) && /Сканувати код/.test(t), 'only nearby: show a code, or scan one', t);
  check(!/Через посилання/.test(t), 'no link', t);
  await X.b.close();

  step('internet: two ways');
  const A = await phone('aaaaaaaaaaaa', 'Аня', { internet: true });
  await A.together();
  await A.p.waitForSelector('text=Через посилання');
  t = await A.text();
  check(/Через посилання/.test(t) && /Поруч, без інтернету/.test(t), 'a link, or nearby', t);

  step('1: a link');
  await A.p.click('text=Через посилання');
  const link = await A.code();
  check(/\?room=[a-z0-9]{6,12}$/.test(link), 'the QR code is the room link', link);
  // the friend opens it in the same browser: the fake brokers live in one browser
  const B = await openPage(A.p.context(), 'zzzzzzzzzzzz', link, { name: 'Зоя' });
  check(await allLinked([A.p, B], 15000), 'both linked');
  const sa = await libState(A.p), sb = await libState(B);
  check(sa.kind === 'internet' && sb.kind === 'internet', 'over the internet', [sa.kind, sb.kind]);
  check(sa.players.join() === 'Аня,Зоя' && sb.players.join() === 'Аня,Зоя', 'both see Аня and Зоя', [sa.players, sb.players]);
  check(await until(async () => !(await A.p.$('.backdrop')), 5000), 'the dialog closes by itself', await dialogText(A.p));
  await A.b.close();

  step('2: nearby, with internet');
  const C = await phone('cccccccccccc', 'Сава', { internet: true }), D = await phone('dddddddddddd', 'Дана', { internet: true });
  await pair(C, D);
  check(await allLinked([C, D], 15000), 'both linked', [await libState(C.p), await libState(D.p)]);
  const sc = await libState(C.p), sd = await libState(D.p);
  check(sc.kind === 'nearby' && sd.kind === 'nearby', 'nearby', [sc.kind, sd.kind]);
  check(sc.role === 'host' && sd.role === 'guest', 'who showed the code first hosts', [sc.role, sd.role]);
  check(sc.players.join() === 'Сава,Дана' && sd.players.join() === 'Сава,Дана', 'both see Сава and Дана', [sc.players, sd.players]);
}, { timeout: 120000 });
