// tags: @ci
// together-motion: «Грати разом» with motion on (the UX spec; owner, UX Q1, Q3, Q4; library/app/invite.js). On a
// phone (390×844, 320×568) the shelf never shifts while the chip goes «Грати разом» → «Чекаю…» → «Разом» (a
// layout-shift observer of the shelf hears nothing), the chip says each with its dot, and a screen reader hears one of
// its words at a time (the old ones fade unheard). The dialog stands by its top edge: the name, the menu, «Через
// посилання» and «Ви граєте разом» all start where the first did, each at its own top (its heading in sight, however
// far the one before was scrolled on a small phone). «Ви граєте разом» stays 2.4 s with a bar that
// drains, then goes by itself, and that page shows no «Ви разом!» meanwhile (the friend's, with no dialog, does); a
// touch in it keeps it open. Under «менше руху» nothing of it moves or scales (fades only).
'use strict';
const { scenario, check, step, until, launch, w } = require('./support/scenario.cjs');
const { openPage, enterName } = require('./support/pages.cjs');

// (in the page, once the shelf shows) every layout shift of something on the shelf; the chip's words heard at once
// (not aria-hidden) whenever that is not one; and «Ви разом!» shown while a dialog is open
function OBSERVE() {
  const shelf = document.getElementById('shelf'), o = window.__seen = { shifts: [], heard: [], toastOverDialog: [] };
  new PerformanceObserver(l => {
    for (const e of l.getEntries()) {
      const on = (e.sources || []).filter(s => s.node && shelf.contains(s.node));
      if (on.length) o.shifts.push({ value: e.value, nodes: on.map(s => s.node.nodeName + '.' + (s.node.className || '')) });
    }
  }).observe({ type: 'layout-shift' });
  const look = () => {
    const n = [...document.querySelectorAll('#together .lbl > span')].filter(x => !x.hasAttribute('aria-hidden')).length;
    if (n !== 1) o.heard.push(n);
    if (document.querySelector('#layer > .backdrop')) for (const t of document.querySelectorAll('#layer .toast')) if (t.textContent === 'Ви разом!') o.toastOverDialog.push(t.textContent);
    requestAnimationFrame(look);
  };
  look();
}
// (in every page of the context from now on, as it starts) every note shown at the bottom
function NOTES() {
  window.__notes = [];
  addEventListener('DOMContentLoaded', () => new MutationObserver(() => {
    for (const t of document.querySelectorAll('#layer .toast')) if (!window.__notes.includes(t.textContent)) window.__notes.push(t.textContent);
  }).observe(document.body, { subtree: true, childList: true, characterData: true }));
}
// (in the page) every running animation that moves or scales something, at each frame
function MOVES() {
  const o = window.__moves = new Set();
  const look = () => {
    for (const a of document.getAnimations()) {
      if (a.playState !== 'running' || !a.effect || !a.effect.getKeyframes) continue;
      if (a.effect.getKeyframes().some(k => (k.transform && k.transform !== 'none') || k.translate || k.scale)) o.add((a.animationName || 'waapi') + ' on ' + (a.effect.target && a.effect.target.className));
    }
    requestAnimationFrame(look);
  };
  look();
}
const chip = p => p.evaluate(() => ({ text: document.getElementById('together').textContent.trim(), dot: document.querySelector('#together .dot')?.className || null }));
const dialogTop = p => p.evaluate(() => { const d = document.querySelector('#layer > .backdrop .dialog'); return d ? Math.round(d.getBoundingClientRect().top) : null; });
const h2 = p => p.evaluate(() => document.querySelector('#layer > .backdrop .dialog h2')?.textContent || null);
const open = p => p.evaluate(() => !!document.querySelector('#layer > .backdrop'));
// the dialog's top edge once its entry is over
const settledTop = async p => { await w(400); return dialogTop(p); };

scenario('together-motion: the chip, the dialog\'s top edge, «Ви граєте разом» for 2.4 s', async () => {
  const b = await launch();
  for (const [width, height] of [[390, 844], [320, 568]]) {
    step(width + '×' + height + ': the chip and the dialog, motion on');
    const ctx = await b.newContext({ motion: true, viewport: { width, height } });   // (one context: one fake network)
    const A = await openPage(ctx, 'aaaaaaaa' + width, undefined, { label: 'Аня' });
    check(await A.evaluate(() => document.documentElement.dataset.motion !== 'off'), 'motion is on');
    await A.evaluate(OBSERVE);
    const c0 = await chip(A);
    check(c0.text === 'Грати разом' && c0.dot === 'dot', 'the chip: «Грати разом», no state', c0);
    await A.click('#together');
    await A.waitForSelector('.dialog input.link');
    const tops = { name: await settledTop(A) };
    await enterName(A, 'Аня');
    await A.waitForSelector('#layer > .backdrop >> text=Через посилання');
    tops.menu = await settledTop(A);
    // (a small phone: the player scrolls the menu down to its end, then taps «Через посилання» where it is)
    await A.evaluate(() => { const d = document.querySelector('#layer > .backdrop .dialog'); d.scrollTop = d.scrollHeight; });
    await A.evaluate(() => [...document.querySelectorAll('#layer > .backdrop .option')].find(o => /Через посилання/.test(o.textContent)).click());
    const link = await (await A.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code)).jsonValue();
    tops.link = await settledTop(A);
    const head = await A.evaluate(() => { const d = document.querySelector('#layer > .backdrop .dialog'), h = d.querySelector('h2'); return { scroll: d.scrollTop, h2: h.textContent, seen: h.getBoundingClientRect().top >= d.getBoundingClientRect().top }; });
    check(head.scroll === 0 && head.seen, 'the new screen starts at its top: «' + head.h2 + '» in sight, however far the menu was scrolled', head);
    const c1 = await until(async () => { const c = await chip(A); return c.text === 'Чекаю…' && c; }, 10000, 50);
    check(c1 && c1.dot === 'dot wait', 'the chip: «Чекаю…» with its dot', c1 || await chip(A));

    step(width + '×' + height + ': the friend comes: «Ви граєте разом» for 2.4 s, then the dialog goes by itself');
    await ctx.addInitScript(NOTES);
    const B = await openPage(ctx, 'bbbbbbbb' + width, link, { name: 'Богдан' });
    check(await until(async () => await h2(A) === 'Ви граєте разом', 15000, 20), '«Ви граєте разом»', await h2(A));
    const t0 = Date.now();
    tops.together = await dialogTop(A);
    check(new Set(Object.values(tops)).size === 1, 'the dialog\'s top edge stays where it was: the name, the menu, the link, «Ви граєте разом»', tops);
    check(await A.evaluate(() => { const d = document.querySelector('#layer > .backdrop .drain'); return !!d && !d.hidden && d.getClientRects().length > 0; }), 'a bar shows how long it stays');
    await w(1500 - (Date.now() - t0));
    check(await open(A), 'still open 1.5 s later');
    const gone = await until(async () => !(await open(A)), 5000, 20);
    const after = Date.now() - t0;
    check(gone && after >= 2200 && after < 3600, 'it goes by itself after 2.4 s', after);
    const c2 = await until(async () => { const c = await chip(A); return c.text === 'Разом' && c; }, 5000, 50);
    check(c2 && c2.dot === 'dot on', 'the chip: «Разом» with its dot', c2 || await chip(A));
    await w(400);                                        // (the last cross-fade over)
    const seen = await A.evaluate(() => window.__seen);
    check(!seen.shifts.length, 'nothing on the shelf shifted (layout-shift)', seen.shifts);
    check(!seen.heard.length, 'the chip\'s words: one heard at a time', seen.heard);
    check(!seen.toastOverDialog.length, 'no «Ви разом!» while «Ви граєте разом» says it', seen.toastOverDialog);
    check(await until(() => B.evaluate(() => window.__notes.includes('Ви разом!')), 5000, 50), 'the friend, with no dialog open: «Ви разом!»', await B.evaluate(() => window.__notes));
    await ctx.close();
  }

  step('«менше руху»: the same way, nothing moves or scales');
  {
    const ctx = await b.newContext({ motion: true, reducedMotion: 'reduce', viewport: { width: 390, height: 844 } });
    const A = await openPage(ctx, 'eeeeeeeeeeee', undefined, { label: 'Аня' });
    await A.evaluate(MOVES);
    await A.click('#together');
    await enterName(A, 'Аня');
    await A.click('text=Через посилання');
    const link = await (await A.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code)).jsonValue();
    await openPage(ctx, 'ffffffffffff', link, { name: 'Богдан' });
    check(await until(async () => await h2(A) === 'Ви граєте разом', 15000, 20), '«Ви граєте разом»', await h2(A));
    await until(async () => !(await open(A)), 5000, 20);
    await w(400);
    const moved = await A.evaluate(() => [...window.__moves]);
    check(!moved.length, 'no animation moved or scaled anything', moved);
    await ctx.close();
  }

  step('a touch keeps «Ви граєте разом» open');
  const ctx = await b.newContext({ motion: true, viewport: { width: 390, height: 844 } });
  const A = await openPage(ctx, 'cccccccccccc', undefined, { label: 'Аня' });
  await A.click('#together');
  await enterName(A, 'Аня');
  await A.click('text=Через посилання');
  const link = await (await A.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code)).jsonValue();
  await openPage(ctx, 'dddddddddddd', link, { name: 'Богдан' });
  check(await until(async () => await h2(A) === 'Ви граєте разом', 15000, 20), '«Ви граєте разом»', await h2(A));
  await A.click('#layer > .backdrop .dialog h2');
  await w(3500);
  check(await open(A) && await h2(A) === 'Ви граєте разом', 'touched: still open 3.5 s later', await h2(A));
  check(await A.evaluate(() => document.querySelector('#layer > .backdrop .drain')?.hidden), '… and its bar is gone');
  await A.keyboard.press('Escape');
  check(await until(async () => !(await open(A)), 3000, 20), 'Escape closes it');
}, { timeout: 180000 });
