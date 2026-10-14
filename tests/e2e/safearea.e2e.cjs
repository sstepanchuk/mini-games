// tags: @ci
// safearea: a phone with a home bar (iPhone: env(safe-area-inset-bottom) 34 px, 21 px in landscape; Chromium
// emulates it through the DevTools protocol). The open game's stage already keeps out of the unsafe edges, so the card
// «Чекаємо, поки повернеться …» over a game (invite.js, inside the stage) is 16 px above the game's bottom edge as on any phone (owner,
// decision 40: before, the inset counted twice: 34 px above the stage, 68 above the screen), and the notes at the
// bottom of the screen (dom.js toast: on the page itself) keep 22 px above the bar. Chromium only.
'use strict';
const { U, launch, scenario, check, step, skip, CHROMIUM } = require('./support/scenario.cjs');
const { openPage } = require('./support/pages.cjs');

if (!CHROMIUM) skip('the safe area is emulated through Chromium’s DevTools protocol');

// where the stage, a card in it and a note at the bottom are, px from the screen's bottom edge
const measure = p => p.evaluate(() => {
  const st = document.getElementById('stage');
  st.hidden = false; document.getElementById('shelf').hidden = true;
  const c = Object.assign(document.createElement('div'), { className: 'waiting card', id: 'xcard' });
  c.innerHTML = '<div class="wait-row"><p>Чекаємо, поки повернеться <bdi>Богдан</bdi>… <span class="wait-time">2:45</span></p><button type="button" class="btn ghost">Не чекати</button></div>';
  st.append(c);
  const t = Object.assign(document.createElement('div'), { className: 'toast', textContent: 'Ви разом!' });
  (document.querySelector('#layer > .toasts') || document.getElementById('layer')).append(t);
  const s = st.getBoundingClientRect(), r = c.getBoundingClientRect(), q = t.getBoundingClientRect();
  return { stage: Math.round(innerHeight - s.bottom), card: Math.round(s.bottom - r.bottom), toast: Math.round(innerHeight - q.bottom) };
});

scenario('safearea: the card over a game on a phone with a home bar', async () => {
  const b = await launch();
  for (const [what, viewport, insets, stage] of [
    ['portrait, a 34 px home bar', { width: 390, height: 844 }, { top: 47, bottom: 34, left: 0, right: 0 }, 34],
    ['landscape: 21 px below, 47 px at the sides', { width: 844, height: 390 }, { top: 0, bottom: 21, left: 47, right: 47 }, 21]
  ]) {
    step(what);
    const ctx = await b.newContext({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    const p = await openPage(ctx, 'aaaaaaaaaaaa', U);
    await (await ctx.newCDPSession(p)).send('Emulation.setSafeAreaInsetsOverride', { insets });
    const m = await measure(p);
    check(m.stage === stage, 'the stage ends ' + stage + ' px above the screen (out of the unsafe edge)', m);
    check(m.card === 16, 'the card: 16 px above the game, as on any phone', m);
    check(m.toast === stage + 22, 'a note at the bottom: 22 px above the bar', m);
    await ctx.close();
  }
}, { timeout: 60000 });
