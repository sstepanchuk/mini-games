// tags: @ci
// The "Грати разом" dialog: it checks for internet by itself. Without internet it goes straight to nearby (show or
// scan a code); with internet it offers two ways. Both ways link two players up: a link (the friend opens it and
// gives a name), and nearby (show / scan a code, then the other way round). A new room's code has 8 characters; the
// code of the last room is used again only if it is that long (a shorter one is from before the seal, phase 5).
// «Ви граєте разом» stays as it is while the room changes (a third player joins, drops out, comes back): only what it
// says changes, and the focused «Від’єднатися» keeps its focus.
'use strict';
const { scenario, check, step, until, launch } = require('./support/scenario.cjs');
const { openPage, createLink, phone, pair, allLinked, libState, dialogText } = require('./support/pages.cjs');

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
  check(/\?room=[a-z0-9]{8}$/.test(link), 'the QR code is the room link, its code 8 characters long', link);
  // the friend opens it in the same browser: the fake brokers live in one browser
  const B = await openPage(A.p.context(), 'zzzzzzzzzzzz', link, { name: 'Зоя' });
  check(await allLinked([A.p, B], 15000), 'both linked');
  const sa = await libState(A.p), sb = await libState(B);
  check(sa.kind === 'internet' && sb.kind === 'internet', 'over the internet', [sa.kind, sb.kind]);
  check(sa.players.join() === 'Аня,Зоя' && sb.players.join() === 'Аня,Зоя', 'both see Аня and Зоя', [sa.players, sb.players]);
  check(await until(async () => !(await A.p.$('.backdrop')), 5000), 'the dialog closes by itself', await dialogText(A.p));
  await A.b.close();

  step('1b: the last room\'s code again, if it is 8 characters long; a shorter one (from before the seal) is not');
  for (const [last, again] of [['abcdef', false], ['k2m4p6r8', true]]) {
    const P = await phone('pppppppppppp', 'Поля', { internet: true });
    await P.p.evaluate(c => localStorage.setItem('ihroteka-room', c), last);   // (together.js LAST)
    await P.together();
    await P.p.click('text=Через посилання');
    const code = (await P.code()).split('?room=')[1];
    check(again ? code === last : /^[a-z0-9]{8}$/.test(code) && code !== last, last + (again ? ': used again' : ': a new room\'s code instead'), code);
    await P.b.close();
  }

  step('2: nearby, with internet');
  const C = await phone('cccccccccccc', 'Сава', { internet: true }), D = await phone('dddddddddddd', 'Дана', { internet: true });
  await pair(C, D);
  check(await allLinked([C, D], 15000), 'both linked', [await libState(C.p), await libState(D.p)]);
  const sc = await libState(C.p), sd = await libState(D.p);
  check(sc.kind === 'nearby' && sd.kind === 'nearby', 'nearby', [sc.kind, sd.kind]);
  check(sc.role === 'host' && sd.role === 'guest', 'who showed the code first hosts', [sc.role, sd.role]);
  check(sc.players.join() === 'Сава,Дана' && sd.players.join() === 'Сава,Дана', 'both see Сава and Дана', [sc.players, sd.players]);
  await C.b.close(); await D.b.close();

  step('3: «Ви граєте разом» while the room changes: the focus stays where it is');
  const ctx = await (await launch()).newContext({ viewport: { width: 420, height: 860 } });   // (one context: one fake network)
  const P = await openPage(ctx, 'ffffffffffff', undefined, { label: 'Аня' });
  const room = await createLink(P, 'Аня');
  const Q = await openPage(ctx, 'gggggggggggg', room, { name: 'Богдан' });
  check(await allLinked([P, Q], 15000), 'Аня and Богдан linked');
  await until(async () => !(await P.$('.backdrop')), 5000);
  await P.click('#together');
  await P.focus('.dialog button:has-text("Від’єднатися")');
  await P.evaluate(() => { window.__f = document.activeElement; });
  const seen = () => P.evaluate(() => ({ same: !!window.__f && document.activeElement === window.__f, focus: (a => a === document.body ? 'BODY' : a.tagName + ':' + a.textContent.slice(0, 20))(document.activeElement), h2: document.querySelector('.dialog h2')?.textContent,
    players: [...document.querySelectorAll('.dialog ul.players li')].map(li => li.textContent) }));
  const V = await openPage(ctx, 'hhhhhhhhhhhh', room, { name: 'Віра' });
  check(await allLinked([P, Q, V], 15000), 'Віра joins');
  let x = await until(async () => { const y = await seen(); return y.h2 === 'Вас 3' && y; }, 5000);
  check(x && x.same, 'the heading says «Вас 3», and «Від’єднатися» keeps the focus (the same node)', await seen());
  await V.evaluate(() => window.__net(false));
  x = await until(async () => { const y = await seen(); return y.players.includes('Віра — відпав, місце чекає') && y; }, 30000);
  check(x && x.same, '«Віра — відпав, місце чекає», and the focus stays', await seen());
  await V.evaluate(() => window.__net(true));
  x = await until(async () => { const y = await seen(); return y.players.includes('Віра') && y; }, 30000);
  check(x && x.same, 'Віра back, and the focus stays', await seen());
}, { timeout: 180000 });
