// tags: @ci
// fullscreen: a game on the whole screen (its frame in the browser's top layer: Two Dragons' corner button; here a
// button the scenario adds to the game, pressed for the user activation fullscreen needs) covers everything the library
// page shows, and while it is fullscreen the browser keeps the rest of the page inert. So a library dialog leaves
// fullscreen as it opens (owner, decision 51; dom.js modal): «Грати разом» from the game (ihroteka.invite()) is on top
// and its name field has the focus; Escape closes it and the focus is back in the game. The same for a dialog the
// library opens by itself («Ти граєш деінде»: the same player came in from another tab). And the card «Чекаємо на …»
// over a game that shows none of its waiting screens (invite.js) leaves fullscreen too; a game whose own screen says it
// stays fullscreen. Chromium (WebKit's element fullscreen is not checked here). E2E_GAME: any game (the probe on CI).
'use strict';
const { U, launch, scenario, check, step, until, GAME } = require('./support/scenario.cjs');
const { openPage, createLink, frameOf, libState, short, waitShown } = require('./support/pages.cjs');

// what the page shows now: the fullscreen element (page and game), the dialog, what is at the dialog's centre, the focus
const seen = (p, f) => Promise.all([p.evaluate(() => {
  const d = document.querySelector('.dialog'), fe = document.fullscreenElement, a = document.activeElement;
  let hit = null;
  if (d) { const r = d.getBoundingClientRect(), e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); hit = e && (d.contains(e) ? 'dialog' : e.tagName + '.' + e.className); }
  return { fs: fe ? fe.tagName + '.' + fe.className : null, dialog: !!d, hit, inert: document.getElementById('stage').inert,
    focus: !a ? null : d && d.contains(a) ? 'dialog ' + a.tagName + (a.matches('input.link') ? ' name' : '') : a.tagName + '.' + a.className };
}), f.evaluate(() => !!document.fullscreenElement)]).then(([page, frameFs]) => ({ ...page, frameFs }));
// the game asks for fullscreen (a button of its own, pressed: user activation)
async function enterFs(p, f) {
  await f.evaluate(() => {
    if (document.getElementById('__fs')) return;
    const b = Object.assign(document.createElement('button'), { id: '__fs', type: 'button', textContent: '⛶' });
    b.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647';
    b.onclick = () => document.documentElement.requestFullscreen();
    document.body.append(b);
  });
  await f.click('#__fs');
  return until(() => p.evaluate(() => document.fullscreenElement?.tagName === 'IFRAME'), 5000, 50);
}

scenario('fullscreen: a library dialog over a game on the whole screen', async () => {
  const ctx = await (await launch()).newContext({ viewport: { width: 900, height: 650 } });
  const A = await openPage(ctx, 'aaaaaaaaaaaa', U, { label: 'Аня' });
  await A.click('a.game[href*="/' + GAME + '/"]');
  let f = await frameOf(A);

  step('«Грати разом» from a game on the whole screen');
  check(await enterFs(A, f), 'the game is on the whole screen', await seen(A, f));
  await f.evaluate(() => window.ihroteka.invite());
  await A.waitForSelector('.dialog', { state: 'attached' });
  let s = await until(async () => { const x = await seen(A, f); return !x.fs && x.focus === 'dialog INPUT name' && x; }, 5000, 50);
  check(s && !s.fs && !s.frameFs, 'out of fullscreen (the page and the game)', await seen(A, f));
  check(s && s.hit === 'dialog', 'the dialog is on top (what is at its centre is the dialog)', await seen(A, f));
  check(s && s.focus === 'dialog INPUT name', 'the name field has the focus', await seen(A, f));
  await A.keyboard.press('Escape');
  s = await until(async () => { const x = await seen(A, f); return !x.dialog && x; }, 3000, 50);
  check(s && !s.inert, 'Escape closes it; the game is live again', await seen(A, f));
  check(s && s.focus === 'IFRAME.frame', 'the focus is back in the game', await seen(A, f));

  step('«Ти граєш деінде», a dialog the library opens by itself');
  await A.goto(U);                                        // (back on the shelf, to come into a room)
  await A.waitForSelector('#shelf:not([hidden])');
  const link = await createLink(A, 'Аня');
  await until(async () => (await libState(A)).role === 'host', 10000);   // (holding the room: a new tab here takes it at once)
  await A.keyboard.press('Escape');
  await A.click('a.game[href*="/' + GAME + '/"]');
  f = await frameOf(A);
  check(await enterFs(A, f), 'the game is on the whole screen again', await seen(A, f));
  const A2 = await openPage(ctx, 'aaaa2222aaaa', link, { name: 'Аня', label: 'Аня (new tab)' });
  s = await until(async () => { const x = await seen(A, f); return x.dialog && !x.fs && /^dialog/.test(x.focus) && x; }, 15000, 100);
  check(s && /Ти граєш деінде/.test(await A.textContent('.dialog')), 'the old tab says «Ти граєш деінде»', [await short(A), await short(A2)]);
  check(s && !s.fs && !s.frameFs && s.hit === 'dialog', '… out of fullscreen, on top', await seen(A, f));
  check(s && /^dialog/.test(s.focus), '… with the focus', await seen(A, f));
  await A.keyboard.press('Escape');
  s = await until(async () => { const x = await seen(A, f); return !x.dialog && x; }, 3000, 50);
  check(s && !s.inert, 'Escape closes it', await seen(A, f));
  await A2.close(); await A.close();

  step('the card over a game on the whole screen');
  const P = await openPage(ctx, 'pppppppppppp', U, { label: 'Поля' });
  const room = await createLink(P, 'Поля');
  const Q = await openPage(ctx, 'qqqqqqqqqqqq', room, { name: 'Кіра', label: 'Кіра' });
  check(await until(async () => (await libState(P)).linked && (await libState(Q)).linked, 15000), 'Поля and Кіра together', [await short(P), await short(Q)]);
  await P.keyboard.press('Escape').catch(() => {});
  await until(async () => !(await P.$('.backdrop')), 5000);
  await P.click('a.game[href*="/' + GAME + '/"]');
  const playing = async () => (await Promise.all([P, Q].map(libState))).every(x => x.game && x.game.linked);
  check(await until(playing, 20000), 'both in ' + GAME, [await short(P), await short(Q)]);
  const g = await frameOf(P);
  check(await enterFs(P, g), 'Поля’s game is on the whole screen', await seen(P, g));
  await Q.evaluate(() => window.__net(false));
  const w = await until(async () => { const x = await waitShown(P); return x.where && x; }, 15000);
  check(w && /Чекаємо.*Кіра/.test(w.text), 'Поля waits for Кіра', w);
  if (w && w.where === 'card') check(await until(() => P.evaluate(() => !document.fullscreenElement), 3000, 50), 'the card: out of fullscreen (the game says nothing itself)', await seen(P, g));
  else check(await P.evaluate(() => !!document.fullscreenElement), 'the game’s own screen says it: still on the whole screen', await seen(P, g));
}, { timeout: 150000 });
