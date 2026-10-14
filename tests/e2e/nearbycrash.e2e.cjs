// tags: @ci
// nearbycrash: nearby, no internet. Ганна (who showed the code first: the phone that holds the room) and Гліб are
// together; Ганна's page crashes (no goodbye, as a phone that drops a tab in the background). Гліб's browser keeps the
// dead link's channels open until it gives up on them (~15 s in Chromium), but Ганна is away at once, and her new page
// pairs with him again: on his phone «З’єднатися знову» takes her new code the first time (no «Це не той код»), and
// the room goes on with both in their places. (Before the audit, net-edge-03, a guest paired again only once those
// channels closed: net/nearby.js begin.) Chromium only: the crash is the DevTools protocol's.
'use strict';
const { scenario, check, step, until, w, U, CHROMIUM, skip } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState, dialogText, openPage, enterName } = require('./support/pages.cjs');

if (!CHROMIUM) skip('the page crash is Chromium\'s (DevTools protocol: Page.crash)');

scenario('nearbycrash: the host\'s page crashes; its new page pairs again at once', async () => {
  const H = await phone('hhhhhhhhhhhh', 'Ганна'), G = await phone('gggggggggggg', 'Гліб');

  step('Ганна pairs with Гліб');
  await pair(H, G);
  check(await allLinked([H, G], 15000), 'linked', [await libState(H.p), await libState(G.p)]);
  await until(async () => !(await H.p.$('.backdrop')) && !(await G.p.$('.backdrop')), 5000);   // (the dialogs close by themselves)

  step('Ганна’s page crashes (no goodbye)');
  const ctx = H.p.context(), cdp = await ctx.newCDPSession(H.p);
  cdp.send('Page.crash').catch(() => {});
  const away = await until(async () => { const s = await libState(G.p); return s.kind === 'nearby' && s.away.join() === 'Ганна' && s; }, 15000);
  check(away, 'Гліб keeps the room; Ганна is away', await libState(G.p));

  step('Ганна’s new page shows a code');
  const p2 = await openPage(ctx, 'hhhhhhhhhhhh', U, { label: 'Ганна (a new page)', net: { brokers: false } });
  await p2.click('#together'); await w(200);
  await enterName(p2, 'Ганна');
  await p2.waitForFunction(() => /Показати код/.test(document.querySelector('.dialog')?.innerText || ''));
  await p2.click('text=Показати код');
  const offer = await p2.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code, null, { timeout: 20000 }).then(h => h.jsonValue());

  step('Гліб presses «З’єднатися знову» and scans it');
  await G.together();
  await G.p.click('text=З’єднатися знову');
  await G.p.waitForSelector('video.scan');
  await G.paste(offer);
  const said = await until(async () => { const t = await dialogText(G.p); return /Крок 2 з 2|Це не той код/.test(t) && t; }, 10000);
  check(said && !/Це не той код/.test(said), 'the first try is not told «Це не той код»', said);
  check(/Крок 2 з 2/.test(said || ''), 'his answer shows: «Крок 2 з 2»', said);
  if (!/Крок 2 з 2/.test(said || '')) return;

  step('Ганна’s new page scans his answer');
  const answer = await G.code();
  await p2.click('text=Далі: сканувати код друга');
  if (await p2.isVisible('text=Ввести код вручну')) await p2.click('text=Ввести код вручну');
  await p2.fill('.dialog input.link', answer);
  await p2.press('.dialog input.link', 'Enter');
  const back = async () => (await Promise.all([p2, G.p].map(libState))).every(s => s.linked && s.players.join() === 'Ганна,Гліб' && !s.away.length);
  check(await until(back, 20000), 'together again, nobody away', await Promise.all([p2, G.p].map(libState)));
  const [h, g] = await Promise.all([p2, G.p].map(libState));
  check(h.role === 'host' && g.role === 'guest', 'Ганна’s new page holds the room', [h.role, g.role]);
}, { timeout: 150000 });
