// tags: @ci @webkit
// card: the library's one «Чекаємо, поки повернеться …» over a game, over the internet: the waiting message wherever it is (the card,
// library/app/invite.js, or the game's own <ihroteka-wait>, screens.js: never both). Аня and Богдан play a game
// (E2E_GAME: Two Dragons by default). Богдан drops out: Аня's message says whom she waits for, the time his place is
// kept and «Не чекати»; it is built once (each second only the time changes), a screen reader hears only who and why
// (the live region of the library page), and a focused «Не чекати» keeps its focus. Богдан back: no message. Богдан
// goes on in a new tab whose game is slow to open: «Богдан повертається в гру», with nothing to press (owner,
// decisions 4 and 42: the name in the nominative), until it is open. Then he drops out again and Аня presses «Не чекати»: his place goes. The probe
// places no <ihroteka-wait>: the card as it always was. «Не чекати» is named «Не чекати, поки повернеться Богдан» for a screen reader,
// and the game comes before the card in Tab and reading order. A library dialog open over the game: the live region is
// still heard (it is on the library page, under nothing inert). At 320 px, a 24-letter name stays inside the dialog
// and the card. Needs the dev server with the plaintext games (npm run unlock), or with the probe (npm run dev --
// --probe, E2E_GAME=probe).
'use strict';
const { U, w, launch, watch, scenario, check, step, until, GAME, CHROMIUM } = require('./support/scenario.cjs');
const { openPage, createLink, enterName, frameOf, libState, short, waitShown: cardOf, waitBox, clickWait } = require('./support/pages.cjs');
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
  const away = async () => { const c = await cardOf(pa); return c.where && /Чекаємо, поки повернеться Богдан… \d+:\d\d/.test(c.text) && c; };
  let c = await until(away, 10000);
  check(c, 'Аня’s message: «Чекаємо, поки повернеться Богдан… m:ss»', await cardOf(pa));
  check(c && c.where !== 'both', 'in one place only (' + (c && c.where) + ')', c);
  if (GAME === 'probe') {                                 // (contract 4, no <ihroteka-wait>: the card as it always was)
    const s = await pa.evaluate(() => window.__ihroteka.screens());
    check(c && c.where === 'card' && c.copies === 0 && s.adopted === false, 'the probe places no waiting screen: the library\'s card', [c, s]);
  }
  check(c && c.buttons.includes('Не чекати') && !c.buttons.includes('З’єднатися знову'), '… with «Не чекати» (over the internet, no pairing again)', c && c.buttons);
  check(c && c.say === 'Чекаємо, поки повернеться Богдан…', 'the screen reader hears who (not the time)', c && c.say);
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
  const named = await box.evaluate(() => window.__stay.getAttribute('aria-label'));
  check(named === 'Не чекати, поки повернеться Богдан', 'a screen reader hears «Не чекати, поки повернеться Богдан» (the button\'s text stays «Не чекати»)', named);
  const order = await pa.evaluate(() => !!(document.querySelector('#stage iframe').compareDocumentPosition(document.getElementById('waiting')) & Node.DOCUMENT_POSITION_FOLLOWING));
  check(order, 'the game comes before the card (Tab and reading order)', order);
  await pa.evaluate(() => {
    window.__said = 0;
    new MutationObserver(m => { window.__said += m.length; }).observe(document.querySelector('#layer .sr[role=status]'), { childList: true, characterData: true, subtree: true });
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

  step('a library dialog over the game; Богдан drops out meanwhile');
  const region = () => pa.evaluate(() => { const s = document.querySelector('.sr[role=status]'); return s && { text: s.textContent, under: s.closest('[inert],[hidden]')?.id ?? null }; });
  await (await frameOf(pa)).evaluate(() => window.ihroteka.invite());
  await pa.waitForSelector('.dialog');
  await pb.evaluate(() => window.__net(false));
  check(await until(async () => (await region())?.text === 'Чекаємо, поки повернеться Богдан…', 10000), 'the live region says whom Аня waits for', await region());
  check((await region())?.under === null, '… under nothing inert or hidden (the dialog makes the stage inert)', await region());
  if (CHROMIUM) {                                         // (what a screen reader is given: the accessibility tree)
    const cdp = await pa.context().newCDPSession(pa);
    await cdp.send('DOM.enable'); await cdp.send('Accessibility.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: 0 });
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: '.sr[role=status]' });
    const n = (await cdp.send('Accessibility.getPartialAXTree', { nodeId, fetchRelatives: false })).nodes[0];
    const ax = { ignored: n.ignored, role: n.role && n.role.value, why: (n.ignoredReasons || []).map(r => r.name) };
    check(!ax.ignored && ax.role === 'status', '… and in the accessibility tree, a status', ax);
    await cdp.detach();
  }
  await pa.click('.backdrop', { position: { x: 4, y: 4 } });
  check(await until(async () => !(await pa.$('.backdrop')), 3000), 'a tap outside the dialog closes it');
  await pb.evaluate(() => window.__net(true));
  check(await until(async () => (await region())?.text === '' && !(await cardOf(pa)).where, 15000), 'Богдан back: the live region says nothing, no message', [await region(), await cardOf(pa)]);

  step('Богдан goes on in a new tab, its game slow to open');
  const pc = watch(await ctx.newPage(), 'Богдан (new tab)');
  await pc.route('**/' + GAME + '/**', async r => { if (r.request().resourceType() === 'document') await w(5000); return r.continue().catch(() => {}); });
  await pc.addInitScript(fakeNet('bbbb2222bbbb'));
  await pc.goto(link);
  await enterName(pc, 'Богдан');
  const loading = async () => { const x = await cardOf(pa); return x.where && x.text === 'Богдан повертається в гру' && x; };
  c = await until(loading, 10000, 100);
  check(c, 'Аня’s message: «Богдан повертається в гру»', await cardOf(pa));
  check(c && c.where !== 'both', 'in one place only (' + (c && c.where) + ')', c);
  check(c && !c.buttons.length, '… with nothing to press (no «Не чекати»: he did not drop out)', c && c.buttons);
  check(c && c.say === 'Богдан повертається в гру', 'the screen reader hears why', c && c.say);
  check(await until(async () => !(await cardOf(pa)).where && (await libState(pc)).game?.linked, 15000), 'his game open there: no message, playing', [await cardOf(pa), await short(pc)]);

  step('Богдан drops out again; Аня does not wait');
  await pc.evaluate(() => window.__net(false));
  c = await until(away, 10000);
  check(c && c.where !== 'both', 'the message again, in one place', await cardOf(pa));
  await clickWait(pa, 'Не чекати');
  check(await until(async () => (await libState(pa)).players.join() === 'Аня' && !(await cardOf(pa)).where, 5000), 'his place goes, no message', [await short(pa), await cardOf(pa)]);
  await ctx.close();

  step('at 320×568, a guest with a 24-letter name');
  const LONG = 'Ш'.repeat(24);
  const narrow = await (await launch()).newContext({ viewport: { width: 320, height: 568 } });
  const pn = await openPage(narrow, 'nnnnnnnnnnnn', U, { label: 'Аня (320)' });
  const ln = await createLink(pn, 'Аня');
  const pl = await openPage(narrow, 'llllllllllll', ln, { name: LONG, label: 'Ш×24' });
  check(await until(async () => (await libState(pn)).linked && (await libState(pl)).linked, 15000), 'together', [await short(pn), await short(pl)]);
  await until(async () => !(await pn.$('.backdrop')), 5000);
  await pn.click('#together');
  await pn.waitForSelector('.dialog ul.players');
  // (the text of each node, as laid out: its range's rect)
  const dlg = await pn.evaluate(() => {
    const d = document.querySelector('.dialog'), r = d.getBoundingClientRect(), text = n => { const g = document.createRange(); g.selectNodeContents(n); return g.getBoundingClientRect(); };
    return { sw: d.scrollWidth, cw: d.clientWidth, names: [...d.querySelectorAll('ul.players li')].map(li => { const t = text(li); return t.left >= r.left && t.right <= r.right; }) };
  });
  check(dlg.sw === dlg.cw && dlg.names.length === 2 && dlg.names.every(Boolean), '«Ви граєте разом»: nothing runs off the dialog, each name inside it', dlg);
  await pn.keyboard.press('Escape');
  await until(async () => !(await pn.$('.backdrop')), 3000);
  await pn.click('a.game[href*="/' + GAME + '/"]');
  if (!check(await until(async () => [await libState(pn), await libState(pl)].every(x => x.game && x.game.linked), 20000), 'both in ' + GAME, [await short(pn), await short(pl)])) return;
  await (await frameOf(pn)).addStyleTag({ content: 'ihroteka-wait{display:none!important}' });   // (the card, whatever the game shows)
  await pl.evaluate(() => window.__net(false));
  check(await until(async () => (await cardOf(pn)).where === 'card', 10000), 'the card over the game says whom Аня waits for', await cardOf(pn));
  const card = () => pn.evaluate(() => {
    const c = document.getElementById('waiting'), text = n => { const g = document.createRange(); g.selectNodeContents(n); return g.getBoundingClientRect(); };
    return { sw: c.scrollWidth, cw: c.clientWidth, width: Math.round(c.getBoundingClientRect().width), lines: [...c.querySelectorAll('p')].map(p => { const t = text(p); return t.left >= 0 && t.right <= innerWidth; }),
      page: document.documentElement.scrollWidth, vw: innerWidth };
  });
  const cn = await card();
  check(cn.sw === cn.cw && cn.lines.length > 0 && cn.lines.every(Boolean) && cn.page === cn.vw, 'the card: nothing runs off it or off the screen', cn);
  // a name of every day: the card as wide as it was before a name could break anywhere (its line for a moment with
  // another name, measured with the rule and as without it, in one task: nothing repaints it meanwhile; the name is
  // where the line isolates it, its <bdi>, or in its text)
  const widths = await pn.evaluate(() => {
    const c = document.getElementById('waiting'), p = c.querySelector('.wait-row p'), line = p.querySelector('bdi') || p.firstChild, was = line.textContent, out = [];
    line.textContent = was.replace(/Ш+/, 'Богдан');
    out.push(c.getBoundingClientRect().width);
    const old = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: '.waiting,.waiting *{overflow-wrap:normal!important}' }));
    out.push(c.getBoundingClientRect().width);
    old.remove();
    line.textContent = was;
    return out;
  });
  check(widths[0] === widths[1], 'a name of every day: the card as wide as before', widths);
  await pl.evaluate(() => window.__net(true));
  await until(async () => !(await cardOf(pn)).where, 15000);
  await narrow.close();
}, { timeout: 180000 });
