// tags: @ci
// The "Грати разом" dialog: it checks for internet by itself. Without internet it goes straight to nearby (show or
// scan a code); with internet it offers two ways. Both ways link two players up: a link (the friend opens it and
// gives a name), and nearby (show / scan a code, then the other way round). A new room's code has 8 characters; the
// code of the last room is used again only if it is that long (a shorter one is from before the seal, phase 5).
// «Ви граєте разом» stays as it is while the room changes (a third player joins, drops out, comes back): only what it
// says changes, and the focused «Від’єднатися» keeps its focus. The notes at the bottom of the screen stack in a column
// and never cover each other, also over a dialog, and the same one twice shows once (owner, decision 40); none says
// what the open «Грати разом» says already (decision 66: so the link's dialog is closed first). The last friend gone
// for good: the link screen says so (decision 28). A name left empty: «Напиши своє ім’я» (decision 40).
'use strict';
const { scenario, check, step, until, launch } = require('./support/scenario.cjs');
const { openPage, createLink, enterName, phone, pair, allLinked, libState, dialogText } = require('./support/pages.cjs');

// (in the page) every change of the notes at the bottom, as the player sees them: [[{ text, rect, top, dialog }]]
// (fading ones out; top: nothing covers its centre, a dialog open meanwhile (dialog) neither)
function noteToasts() {
  window.__toasts = [];
  const look = () => {
    const c = document.querySelector('#layer > .toasts');
    if (c) c.style.pointerEvents = 'auto';               // (the column lets taps through: hit-testable only for this look)
    const now = [...document.querySelectorAll('#layer > .toasts > .toast')].map(t => {
      const r = t.getBoundingClientRect(), hit = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
      return { text: t.textContent, rect: [r.left, r.top, r.right, r.bottom], top: !!hit && t.contains(hit), dialog: !!document.querySelector('#layer > .backdrop') };
    });
    if (c) c.style.pointerEvents = '';
    const last = window.__toasts[window.__toasts.length - 1];
    if (JSON.stringify(now) !== JSON.stringify(last)) window.__toasts.push(now);
  };
  const mo = new MutationObserver(() => { look(); mo.takeRecords(); });   // (not again for the look's own style change)
  mo.observe(document.getElementById('layer'), { subtree: true, childList: true, attributes: true, characterData: true });
}
const meet = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

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
  x = await until(async () => { const y = await seen(); return y.players.includes('Віра — зв’язок зник, місце чекає') && y; }, 30000);
  check(x && x.same, '«Віра — зв’язок зник, місце чекає», and the focus stays', await seen());
  await V.evaluate(() => window.__net(true));
  x = await until(async () => { const y = await seen(); return y.players.includes('Віра') && y; }, 30000);
  check(x && x.same, 'Віра back, and the focus stays', await seen());

  step('4: the notes at the bottom: one above the other, the same one once');
  const T = await (await launch()).newContext({ viewport: { width: 420, height: 860 } });
  const An = await openPage(T, 'aaaaaaaaaaaa', undefined, { label: 'Аня' });
  await An.evaluate(noteToasts);
  const code = await createLink(An, 'Аня');
  await An.keyboard.press('Escape');                     // (open, its «Ви граєте разом» would say it: no note then)
  await An.waitForSelector('#layer > .backdrop', { state: 'detached' });
  const Bo = await openPage(T, 'bbbbbbbbbbbb', code, { name: 'Богдан' });
  const Vi = await openPage(T, 'cccccccccccc', code, { label: 'Віра' });   // (its name asked: given as soon as Богдан is in)
  check(await allLinked([An, Bo], 15000), 'Аня and Богдан linked');
  await enterName(Vi, 'Віра');
  check(await allLinked([An, Bo, Vi], 15000), 'Віра joins at once');
  const log = () => An.evaluate(() => window.__toasts);
  const both = await until(async () => (await log()).some(l => l.some(t => t.text === 'Ви разом!') && l.some(t => t.text === 'Тепер вас 3')), 5000, 100);
  check(both, '«Ви разом!» and «Тепер вас 3» both on the screen', await log());
  await An.click('#together');                           // (a dialog opened while they show: they stay on top of it)
  await An.waitForSelector('#layer > .backdrop');
  const overlap = l => l.some((t, i) => l.some((u, j) => i < j && meet(t.rect, u.rect)));
  check(!(await log()).some(overlap), 'never one over another', (await log()).filter(overlap));
  const region = await An.evaluate(() => { const c = document.querySelector('#layer > .toasts'); return c && [c.getAttribute('role'), c.getAttribute('aria-live'), c.getAttribute('aria-atomic')].join(); });
  check(region === 'status,polite,false', 'one live region that reads each new note by itself (not the ones still showing again)', region);
  const under = l => l.some(t => !t.top);
  check((await log()).some(l => l.some(t => t.dialog)) && !(await log()).some(under), 'each on top, of a dialog open over them too', (await log()).filter(under));
  await An.keyboard.press('Escape');
  const Sa = await openPage(T, 'dddddddddddd', code, { name: 'Сава' });
  check(await allLinked([An, Bo, Vi, Sa], 15000), 'Сава joins: four');
  await until(async () => !(await An.$('.backdrop')), 5000);
  for (const Y of [Vi, Sa]) { await until(async () => !(await Y.$('.backdrop')), 5000); await Y.click('#together'); await Y.waitForSelector('.dialog >> text=Від’єднатися'); }
  await An.evaluate(() => { window.__toasts = []; });
  await Promise.all([Vi, Sa].map(Y => Y.click('.dialog >> text=Від’єднатися')));
  check(await until(async () => { const s = await libState(An); return s.players.join() === 'Аня,Богдан' && s.linked; }, 10000), 'Віра and Сава leave together; Аня and Богдан stay', await libState(An));
  const left = await until(async () => (await log()).some(l => l.some(t => t.text === 'Одне місце звільнилося')), 5000, 100);
  check(left, '«Одне місце звільнилося»', await log());
  const twice = l => new Set(l.map(t => t.text)).size < l.length;
  check(left && !(await log()).some(twice), '… once, though two places went (never the same note twice)', await log());

  step('5: the last friend gone for good: the link screen says so');
  await until(async () => !(await Bo.$('.backdrop')), 5000);
  await Bo.click('#together');
  await Bo.click('.dialog >> text=Від’єднатися');
  check(await until(async () => { const s = await libState(An); return s.players.join() === 'Аня' && !s.linked; }, 10000), 'Аня alone', await libState(An));
  await until(async () => !(await An.$('.backdrop')), 5000);
  await An.click('#together');
  const gone = await until(async () => /Друг вийшов\. Посилання діє далі — чекаю…/.test(await dialogText(An)), 5000);
  check(gone && !/Ви разом/.test(await dialogText(An)), 'Аня’s link screen: «Друг вийшов. Посилання діє далі — чекаю…», not «Ви разом.»', await dialogText(An));

  step('6: a name left empty');
  const Em = await openPage(T, 'eeeeeeeeeeee', undefined, { label: 'Ема' });
  await Em.click('#together');
  for (const empty of ['', '   ']) {
    await Em.fill('.dialog input.link', empty);
    await Em.click('.dialog >> text=Далі');
    const said = await until(() => Em.evaluate(() => document.querySelector('.dialog [role=alert]')?.textContent), 3000, 50);
    check(said === 'Напиши своє ім’я', '«' + empty + '» and «Далі»: «Напиши своє ім’я»', said);
    check(await Em.evaluate(() => document.activeElement && document.activeElement.matches('.dialog input.link')), '… and the focus on the field');
  }
  await Em.type('.dialog input.link', 'Е');
  check(await Em.evaluate(() => !document.querySelector('.dialog [role=alert]')?.textContent), 'typing: the line goes');
  const Fa = await openPage(T, 'ffff2222ffff', code, { label: 'Фаїна' });   // (a room link: the name asked first)
  await Fa.waitForSelector('.dialog input.link');
  await Fa.fill('.dialog input.link', '');
  await Fa.click('.dialog >> text=Увійти');
  const asked = await until(() => Fa.evaluate(() => document.querySelector('.dialog [role=alert]')?.textContent), 3000, 50);
  check(asked === 'Напиши своє ім’я', 'the name a room link asks for, empty: «Напиши своє ім’я»', asked);
  check(await Fa.evaluate(() => document.activeElement && document.activeElement.matches('.dialog input.link')), '… and the focus on the field');
}, { timeout: 240000 });
