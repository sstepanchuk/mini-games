// tags: @ci @webkit
// screens: the library's waiting screens inside a game (owner, decision 6 (c): <ihroteka-wait>, library/app/screens.js),
// on the template (`cli new demo5`, a dev server of its own), three players at 360×640: never two messages (a sampler
// in every library page, every 100 ms: the card and a copy of the game's screen both showing rows, or two copies with
// rows). Віра, third in a game for two, waits for a seat: her screen says so and who plays now, her live region too.
// Богдан drops out: Аня's screen «Чекаємо на Богдан… m:ss» with «Не чекати», built once (only the time changes, the
// focus stays, the live region says nothing new); a button of a finger's size, nothing wider than the frame. The copy
// hidden: the card says the same at once (no new word for the screen reader); shown again: the screen within the
// second's tick; covered by a layer of the game's: the card, uncovered: the screen; a second copy: the first keeps the
// rows (no churn), gone: the second takes them. «Не чекати» pressed in the game's screen: his place goes, Віра plays,
// nothing said, the game heard `showing`. A round on, the room to the shelf and back while Віра's game is slow to open:
// after the grace (not at once) «Чекаємо на Віра — зараз не в грі», nothing to press; her game open: nothing, the same
// round. The game opened while Віра is away, its page slow to parse before its copy: nothing meanwhile (only the version
// would be said there), the card never shown; then her row in the screen, and the game hears `showing` once, with the
// rows in place. Runs on its own server: E2E_URL is only checked to be up, by run.cjs.
'use strict';
const { launch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { openPage, createLink, libState, short, waitShown, clickWait } = require('./support/pages.cjs');
const { newGame, SCREENS, sampled, templateFrame } = require('./support/newgame.cjs');   // (SCREENS: never two messages, sampled every 100 ms)

const frameOf = p => templateFrame(p, 'main');           // (main: #lobby is hidden mid-round)
// what the live region of the library page says, and how often it changed since watchSay
const watchSay = p => p.evaluate(() => {
  window.__said = 0;
  new MutationObserver(m => { window.__said += m.length; }).observe(document.querySelector('#stage .sr'), { childList: true, characterData: true, subtree: true });
});
const saidCount = p => p.evaluate(() => window.__said);
// back to the shelf, as the game asks it (ihroteka.home()): the room follows
const home = async p => (await frameOf(p)).evaluate(() => window.ihroteka.home());

scenario('screens: the waiting screens in a game (<ihroteka-wait>): one message, wherever the player looks', async () => {
  const G = await newGame('demo5', ['--title', 'Демо 5']), { url: U2 } = G;
  if (!check(G.made, 'cli new demo5', G.out)) return;
  if (!check(G.up, 'its dev server at ' + U2, G.log)) return;

  const ctx = await (await launch()).newContext({ viewport: { width: 360, height: 640 } });   // (one context: one fake network)
  await ctx.addInitScript(SCREENS);
  const pa = await openPage(ctx, 'aaaaaaaaaaaa', U2, { label: 'Аня' });
  const link = await createLink(pa, 'Аня');
  const pb = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  check(await until(async () => (await libState(pa)).linked && (await libState(pb)).linked, 15000), 'Аня and Богдан together', [await short(pa), await short(pb)]);
  await pa.keyboard.press('Escape').catch(() => {});
  await until(async () => !(await pa.$('.backdrop')), 5000);

  step('Аня opens the game; both play');
  await pa.click('a.game[href*="/demo5/"]');
  const playing = async () => (await Promise.all([pa, pb].map(libState))).every(s => s.game && s.game.linked);
  if (!check(await until(playing, 20000), 'both in demo5, playing together', [await short(pa), await short(pb)])) return;
  const fa = await frameOf(pa);
  await w(500);
  let a = await waitShown(pa), sa = await pa.evaluate(() => window.__ihroteka.screens());
  check(a.where === null && a.showing === null && (await waitShown(pb)).where === null, 'nothing to say, and the copy says so (no `showing`)', a);
  check(sa.adopted && sa.copies === 1 && sa.holder === -1, 'the game placed one copy (adopted), which holds nothing', sa);

  step('Віра opens the link: a third player in a game for two waits for a seat');
  const pv = await openPage(ctx, 'cccccccccccc', link, { name: 'Віра' });
  const seated = await until(async () => { const g = (await libState(pv)).game; return g && g.waiting.includes('Віра') && g.players; }, 20000);
  check(seated && seated.join() === 'Аня,Богдан', 'Аня and Богдан seated, Віра waits', await short(pv));
  const fv = await frameOf(pv);
  const SEAT = 'Ти чекаєш на місце Грають зараз: Аня і Богдан.';
  const v = await until(async () => { const x = await waitShown(pv); return x.where === 'screen' && x.text === SEAT && x; }, 8000);
  check(v, 'her screen: «Ти чекаєш на місце» / «Грають зараз: Аня і Богдан.»', await waitShown(pv));
  check(v && v.say === 'Ти чекаєш на місце. Грають зараз: Аня і Богдан' && v.showing === 'seat' && !v.buttons.length, 'her live region says it; `showing` seat; nothing to press', v);
  check(await fv.evaluate(() => document.getElementById('lobby-text').textContent) === '', 'the game\'s own lobby says nothing of it', await fv.evaluate(() => document.getElementById('lobby-text').textContent));
  check((await waitShown(pa)).where === null && (await waitShown(pb)).where === null, 'Аня and Богдан: nothing');

  step('Богдан drops out');
  await pb.evaluate(() => window.__net(false));
  const away = /^Чекаємо на Богдан… \d+:\d\d Не чекати$/;   // (the line, its time, its button)
  a = await until(async () => { const x = await waitShown(pa); return x.where === 'screen' && away.test(x.text) && x; }, 10000);
  check(a, 'Аня’s screen: «Чекаємо на Богдан… m:ss»', await waitShown(pa));
  check(a && a.buttons.join() === 'Не чекати' && a.showing === 'link' && a.say === 'Чекаємо на Богдан…', '«Не чекати»; `showing` link; the live region says who', a);
  check((await waitShown(pv)).text === SEAT, 'Віра’s: the same (his seat is still his)', await waitShown(pv));
  await watchSay(pa);
  await fa.evaluate(() => {
    const b = document.querySelector('ihroteka-wait');
    window.__row = b.querySelector('.wait-row');
    window.__stay = [...b.querySelectorAll('button')].find(x => x.textContent === 'Не чекати');
    window.focus();                                       // (the game's frame, then the button in it)
    window.__stay.focus();
    window.__times = [b.querySelector('.wait-time').textContent];
    window.__tick = setInterval(() => window.__times.push(document.querySelector('ihroteka-wait .wait-time')?.textContent), 500);
  });
  await w(3200);
  const kept = await fa.evaluate(() => {
    clearInterval(window.__tick);
    const b = document.querySelector('ihroteka-wait'), btn = window.__stay, r = btn.getBoundingClientRect();
    return { same: b.querySelector('.wait-row') === window.__row, focus: document.activeElement === btn, times: [...new Set(window.__times)], height: r.height,
      wide: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  check(kept.same && kept.focus, 'built once: the same row 3 s later, the focused «Не чекати» keeps its focus', kept);
  check(kept.times.length >= 3, 'only the time changes, each second', kept.times);
  check(await saidCount(pa) === 0, 'nothing new for the screen reader meanwhile', await saidCount(pa));
  check(kept.height >= 44 && kept.wide <= 0, 'at 360 px: «Не чекати» at least 44 px tall, nothing wider than the frame', kept);

  step('the copy hidden, shown, covered, uncovered; a second copy');
  await pa.evaluate(() => {
    window.__unhid = [];
    new MutationObserver(() => { if (!document.getElementById('waiting').hidden) window.__unhid.push(Date.now()); }).observe(document.getElementById('waiting'), { attributes: true, attributeFilter: ['hidden'] });
  });
  const at = await fa.evaluate(() => { const t = Date.now(); document.querySelector('ihroteka-wait').style.display = 'none'; return t; });
  a = await until(async () => { const x = await waitShown(pa); return x.where === 'card' && away.test(x.text) && x; }, 2000, 25);
  const late = (await pa.evaluate(() => window.__unhid))[0] - at;
  check(a && late <= 300, 'hidden: the card says the same, within 300 ms (' + late + ' ms)', [a || await waitShown(pa), late]);
  check(await saidCount(pa) === 0, '… and the screen reader hears nothing new', await saidCount(pa));
  await fa.evaluate(() => { document.querySelector('ihroteka-wait').style.display = ''; });
  check(await until(async () => (await waitShown(pa)).where === 'screen', 1500, 50), 'shown again: the screen (within the second\'s tick)', await waitShown(pa));
  await fa.evaluate(() => { const d = document.body.appendChild(document.createElement('div')); d.id = 'cover'; d.style.cssText = 'position:fixed;inset:0;z-index:99;background:#888'; });
  check(await until(async () => (await waitShown(pa)).where === 'card', 1500, 50), 'covered by the game\'s own layer: the card', await waitShown(pa));
  await fa.evaluate(() => document.getElementById('cover').remove());
  check(await until(async () => (await waitShown(pa)).where === 'screen', 1500, 50), 'uncovered: the screen', await waitShown(pa));
  await fa.evaluate(() => { window.__old = document.querySelector('ihroteka-wait'); document.body.prepend(document.createElement('ihroteka-wait')); });
  await w(400);
  let two = await fa.evaluate(() => { const all = [...document.querySelectorAll('ihroteka-wait')]; return { full: all.filter(x => x.firstElementChild).length, old: !!window.__old.firstElementChild }; });
  sa = await pa.evaluate(() => window.__ihroteka.screens());
  check(two.full === 1 && two.old && sa.copies === 2 && sa.holder === 1, 'a second copy, first in the page: the one that holds the rows keeps them', [two, sa]);
  await fa.evaluate(() => window.__old.remove());
  await until(async () => (await pa.evaluate(() => window.__ihroteka.screens())).holder === 0, 2000, 50);
  two = await fa.evaluate(() => [...document.querySelectorAll('ihroteka-wait')].map(x => !!x.firstElementChild));
  sa = await pa.evaluate(() => window.__ihroteka.screens());
  check(two.join() === 'true' && sa.copies === 1 && sa.holder === 0 && (await waitShown(pa)).where === 'screen', 'that one gone: the other holds them', [two, sa]);

  step('Аня does not wait: «Не чекати» in the game\'s screen');
  await fa.evaluate(() => { window.__heard = 0; document.querySelector('ihroteka-wait').addEventListener('showing', () => window.__heard++); });
  await clickWait(pa, 'Не чекати');
  const gone = async () => { const [x, y] = [await libState(pa), await libState(pv)]; return !x.players.includes('Богдан') && y.game && y.game.players.includes('Віра') && y.game.linked; };
  check(await until(gone, 10000), 'his place goes; Віра has the seat and plays', [await short(pa), await short(pv)]);
  const quiet = async () => { const x = [await waitShown(pa), await waitShown(pv)]; return x.every(y => y.where === null && y.showing === null) && x; };
  check(await until(quiet, 5000), 'nothing to say, on Аня’s page and Віра’s; no `showing`', [await waitShown(pa), await waitShown(pv)]);
  check(await fa.evaluate(() => window.__heard) >= 1, 'Аня’s game heard `showing`', await fa.evaluate(() => window.__heard));
  const sb = await sampled(pb);
  check(sb.n > 0 && !sb.both && !sb.many, 'Богдан’s page: never two messages', sb);
  await pb.close();

  step('a round on; the room to the shelf and back, Віра’s game slow to open');
  await fa.click('#start');
  const both = async () => (await Promise.all([fa, fv].map(f => f.evaluate(() => !document.getElementById('play').hidden).catch(() => false)))).every(Boolean);
  check(await until(both, 10000), 'the round runs, on both', await short(pa));
  const id = (await libState(pa)).game.round.id;
  await home(pa);
  check(await until(async () => !(await libState(pa)).game && !(await libState(pv)).game, 10000), 'both on the shelf', [await short(pa), await short(pv)]);
  await pv.route('**/demo5/**', async r => { if (r.request().resourceType() === 'document') await w(8000); return r.continue().catch(() => {}); });
  const t0 = Date.now();
  await pa.click('a.game[href*="/demo5/"]');
  let early = false;
  while (Date.now() - t0 < 1000) { if (/зараз не в грі/.test((await waitShown(pa)).text)) early = true; await w(100); }
  check(!early, 'not at once (following the room into a game takes a moment)');
  a = await until(async () => { const x = await waitShown(pa); return x.where === 'screen' && x.text === 'Чекаємо на Віра — зараз не в грі' && x; }, 4000, 100);
  check(a && !a.buttons.length && a.showing === 'closed', 'then Аня’s screen: «Чекаємо на Віра — зараз не в грі», nothing to press', a || await waitShown(pa));
  const back = async () => { const s = await libState(pa); return (await waitShown(pa)).where === null && s.game && s.game.linked && s.game.round.id === id; };
  check(await until(back, 15000), 'her game open: nothing to say, the same round goes on', [await waitShown(pa), (await libState(pa)).game?.round]);
  await pv.unroute('**/demo5/**');

  step('the game opened while Віра is away');
  await home(pa);
  check(await until(async () => !(await libState(pa)).game && !(await libState(pv)).game, 10000), 'both on the shelf');
  await pv.evaluate(() => window.__net(false));
  check(await until(async () => (await libState(pa)).away.includes('Віра'), 10000), 'Віра is away', await short(pa));
  await pa.evaluate(() => { window.__unhid = []; });
  // Аня's game page is slow to parse before its copy (a stylesheet that takes 2.5 s, then a script, which waits for it),
  // and hears `showing` from its copy as its scripts run
  const SLOW = '<link rel="stylesheet" href="/__slow.css"><script>window.__slow = true;</script>';
  const HEAR = '<script>window.__ev = []; document.querySelector(\'ihroteka-wait\').addEventListener(\'showing\', () => { const c = document.querySelector(\'ihroteka-wait\'); ' +
    'window.__ev.push({ rows: !!c.firstElementChild, showing: c.getAttribute(\'showing\') }); });</script>';
  await pa.route('**/__slow.css', async r => { await w(2500); return r.fulfill({ contentType: 'text/css', body: '' }).catch(() => {}); });
  await pa.route('**/demo5/**', async r => {
    if (r.request().resourceType() !== 'document') return r.continue().catch(() => {});
    const res = await r.fetch(), html = await res.text();
    return r.fulfill({ response: res, body: html.replace('<body>', '<body>' + SLOW).replace('<ihroteka-wait></ihroteka-wait>', '<ihroteka-wait></ihroteka-wait>' + HEAR) }).catch(() => {});
  });
  await pa.click('a.game[href*="/demo5/"]');
  const unparsed = await until(async () => { const s = await pa.evaluate(() => document.querySelector('iframe.frame') && window.__ihroteka.screens()); return s && !s.ready && s; }, 5000, 25);
  check(unparsed && !unparsed.adopted, 'the game attached, its page not parsed yet (no copy so far)', unparsed);
  check((await waitShown(pa)).where === null, 'meanwhile nothing: whom we wait for waits for the game\'s screen', await waitShown(pa));
  a = await until(async () => { const x = await waitShown(pa); return x.where === 'screen' && /^Чекаємо на Віра… \d+:\d\d Не чекати$/.test(x.text) && x; }, 8000, 100);
  check(a && a.buttons.join() === 'Не чекати', 'Аня’s screen: «Чекаємо на Віра… m:ss», «Не чекати»', a || await waitShown(pa));
  check((await pa.evaluate(() => window.__unhid)).length === 0, 'the card never showed meanwhile', await pa.evaluate(() => window.__unhid));
  const ev = await (await frameOf(pa)).evaluate(() => window.__ev);
  check(ev && ev.length === 1 && ev[0].rows && ev[0].showing === 'link', 'the game heard `showing` once its page had parsed, with the rows in place', ev);
  await pa.unroute('**/demo5/**');
  await pa.unroute('**/__slow.css');

  for (const [name, p] of [['Аня', pa], ['Віра', pv]]) {
    const s = await sampled(p);
    check(s.n > 0 && !s.both && !s.many, name + '’s page: never two messages (card and screen, or two copies), ' + s.n + ' samples', s);
  }
}, { timeout: 180000 });
