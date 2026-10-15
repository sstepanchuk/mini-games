// tags: @ci
// stage-motion: the shelf and the open game with motion on (library/app/shell.js; the UX spec's L-T05, L-T06, L-T12,
// L-T13, its rules 1, 2 and 8, and its proofs (c), (d), (e), (j)), at 390×844 and 320×568. Opening a game: in the task
// of the tap the shelf is inert and unheard, the stage shows the opening card (the game's cover and title) over the
// frame, flying from the tapped card, which is hidden meanwhile; sampled every frame until the game shows, the stage is
// never blank (the note, or the game revealed) and the frame never shows through the layer while it fades in; at the
// reveal the note goes at once (its ghost fades: aria-hidden, inert, no id, role or pointer events) and the game has
// the focus; within 600 ms nothing moves any more. The game's window has the motion vocabulary before its own styles
// (<style data-ihroteka-motion>, html[data-ihroteka]) and the library's switch (data-motion=off when the tests turn
// motion off). A slow game: «Відкриваю гру…» and «До бібліотеки» in the card only after 300 ms (its status line
// rendered from the start, empty: a live region there before it speaks), and that button goes back. Back to the
// shelf: at once, with its scroll, under a page-coloured veil that fades off, while a copy of the card flies back into
// the tapped card, which lands and takes the focus (kept every frame: the card is unseen while the copy flies, never
// unfocusable); within 600 ms nothing moves. A game that breaks as it starts: under a veil, «Гра зламалася», «Можна
// відкрити її ще раз або повернутися до бібліотеки.», «Відкрити ще раз» (focused, it opens the game again), «Скопіювати
// звіт», «До бібліотеки». «Менше руху»: the same, and nothing moves or scales. Following a friend (L-T25, L-T26; motion on and off): the follower's opening card says
// «Аня відкриває «…»…», and back on the shelf a note «Аня повертає всіх до бібліотеки». E2E_GAME: any game (the probe on
// CI).
'use strict';
const { U, GAME, launch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { openPage, frameOf, createLink, allLinked } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const CARD = 'a.game[href*="/' + GAME + '/"]';
const FRAME = '**/' + GAME + '/?frame';                  // the game's page, as its frame asks for it (the dev server)
const BROKEN = ['Гра зламалася', 'Можна відкрити її ще раз або повернутися до бібліотеки.'];

// In the library's page (not its frames): a sampler of every animation frame, and what the tap on a card left in its
// own task (a listener on the window, bubbling: after the card's handler)
function helpers() {
  if (window.top !== window) return;
  const safe = g => g.getAttribute('aria-hidden') === 'true' && g.hasAttribute('inert') && getComputedStyle(g).pointerEvents === 'none'
    && !g.id && !g.hasAttribute('role') && !g.querySelector('[id],[role],[aria-live],[aria-modal]');
  const moves = a => { try { return a.effect.getKeyframes().some(k => (k.transform && k.transform !== 'none') || k.translate || k.scale); } catch (e) { return false; } };
  const running = () => document.getAnimations().filter(a => a.playState === 'running' || a.playState === 'pending');
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  // a card not seen while its copy flies (hidden by its opacity: it keeps the focus)
  const unseen = el => { const s = getComputedStyle(el); return s.visibility === 'hidden' || +s.opacity === 0; };
  window.SM = {
    safe, running, frame, unseen,
    start() {
      const R = this.run = { t0: performance.now(), frames: 0, blank: [], through: [], unsafe: [], moved: [], fx: 0, revealed: null, stop: false };
      const tick = () => {
        if (R.stop) return;
        const t = Math.round(performance.now() - R.t0);
        R.frames++;
        const st = document.getElementById('stage'), note = document.getElementById('stage-note'), f = document.querySelector('iframe.frame');
        if (!st.hidden) {
          const noteOn = !note.hidden && note.getClientRects().length > 0, frameOn = !!f && getComputedStyle(f).visibility === 'visible';
          if (!noteOn && !frameOn) R.blank.push(t);
          if (noteOn && frameOn && !note.classList.contains('over')) {
            // (the layer over the frame: the note's own background, or its .note-bg while it fades in)
            const bg = note.querySelector(':scope > .note-bg'), layered = getComputedStyle(note).backgroundColor === 'rgba(0, 0, 0, 0)';
            const o = layered ? (bg ? +getComputedStyle(bg).opacity : 0) : 1;
            if (o < 0.99) R.through.push(t + ': ' + o);
          }
          if (R.revealed === null && f && note.hidden) {
            const fx = [...document.querySelectorAll('.ihk-fx > *')];
            R.revealed = t;
            R.atReveal = { ghost: fx.filter(g => g.classList.contains('stage-note')).length, safe: fx.every(safe) };
          }
        }
        for (const g of document.querySelectorAll('.ihk-fx > *')) { R.fx++; if (!safe(g)) R.unsafe.push(g.className); }
        for (const a of running()) if (moves(a)) R.moved.push((a.animationName || 'script') + ' on ' + (a.effect.target ? a.effect.target.className : ''));
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() { const R = this.run; R.stop = true; return { ...R, moved: [...new Set(R.moved)], unsafe: [...new Set(R.unsafe)], blank: R.blank.slice(0, 8), through: R.through.slice(0, 8) }; },
    // how long until nothing runs in this page any more (ms from now; null: still something after ms)
    async quiet(ms = 1500) {
      const t0 = performance.now();
      while (performance.now() - t0 < ms) { if (!running().length) return Math.round(performance.now() - t0); await frame(); }
      return running().map(a => (a.animationName || 'script') + ' on ' + (a.effect && a.effect.target ? a.effect.target.className || a.effect.target.tagName : ''));
    }
  };
  addEventListener('click', e => {
    const a = e.target && e.target.closest && e.target.closest('a.game');
    if (!a) return;
    const sh = document.getElementById('shelf'), st = document.getElementById('stage'), note = document.getElementById('stage-note'), c = note.querySelector('.open-card');
    window.SM.tap = { scroll: Math.round(scrollY), inert: sh.inert, unheard: sh.getAttribute('aria-hidden') === 'true', shelfHidden: sh.hidden, stage: !st.hidden, note: !note.hidden,
      card: !!c && !c.hidden, cover: !!(c && c.querySelector('img, canvas')), title: c && c.querySelector('b') ? c.querySelector('b').textContent : null,
      lifted: window.SM.unseen(a), anims: c ? c.getAnimations().map(x => x.animationName || 'script') : [],
      bg: [...note.querySelectorAll(':scope > .note-bg')].map(b => b.getAnimations().map(x => x.animationName).join()) };
  });
}
// once the room is back on the shelf (popstate: shell.js shows it there; this listener comes after the shell's), what
// that task left
const backWatch = id => {
  window.SM.back = null;
  addEventListener('popstate', () => {
    const sh = document.getElementById('shelf'), card = document.querySelector('a.game[href*="/' + id + '/"]'), fx = [...document.querySelectorAll('.ihk-fx > *')];
    const fly = fx.find(n => n.classList.contains('open-card'));
    window.SM.back = { shelf: !sh.hidden, inert: sh.inert, unheard: sh.hasAttribute('aria-hidden'), stage: !document.getElementById('stage').hidden,
      frame: !!document.querySelector('iframe.frame'), scroll: Math.round(scrollY), veil: fx.some(n => n.classList.contains('page-veil')),
      flying: !!fly && fly.getAnimations().length > 0, safe: fx.length > 0 && fx.every(window.SM.safe), lifted: window.SM.unseen(card),
      came: card.classList.contains('came'), focus: document.activeElement === card };
  }, { once: true });
};

// open the game from its card and come back, with motion on; checked as the spec's proofs say
async function openAndBack(b, viewport, { reduced = false } = {}) {
  const at = ' (' + viewport.width + '×' + viewport.height + (reduced ? ', «менше руху»' : '') + ')';
  const ctx = await b.newContext({ viewport, motion: true, ...(reduced && { reducedMotion: 'reduce' }) });
  await ctx.addInitScript(helpers);
  const p = await openPage(ctx, 'aaaaaaaaaaaa');
  await p.evaluate(() => { document.getElementById('shelf').style.paddingBottom = '150vh'; scrollTo(0, 120); });   // (a shelf scrolled a little)

  step('the shelf → ' + GAME + at);
  await p.evaluate(() => window.SM.start());
  await p.click(CARD);
  const tap = await p.evaluate(() => window.SM.tap);
  check(tap && tap.inert && tap.unheard && !tap.shelfHidden, 'in the task of the tap: the shelf inert and unheard (hidden once the layer is opaque)', tap);
  check(tap && tap.stage && tap.note && tap.card && tap.cover && !!tap.title, '… the stage shows the opening card: the game\'s cover and title', tap);
  if (reduced) check(tap && !tap.anims.includes('script') && tap.anims.includes('ihk-fade'), '… no flight: the card fades in', tap && tap.anims);
  else check(tap && tap.anims.includes('script') && tap.lifted, '… flying from the tapped card, which is hidden meanwhile', tap);
  check(tap && tap.bg.length === 1 && tap.bg[0].includes('ihk-fade'), '… on a page-coloured layer that fades in over the shelf', tap && tap.bg);
  const f = await frameOf(p);
  check(await until(() => p.evaluate(() => window.SM.run.revealed !== null), 10000, 50), 'the game shows (its frame revealed, the note gone)');
  const shown = await p.evaluate(async () => {
    const out = { ...window.SM.run.atReveal };
    out.quiet = await window.SM.quiet(1500);
    const R = window.SM.stop();
    return { ...out, R, focus: document.activeElement === document.querySelector('iframe.frame'), shelfHidden: document.getElementById('shelf').hidden };
  });
  check(shown.R.blank.length === 0, '(e) every frame from the tap on: the opening card, or the game revealed; never a blank stage', shown.R);
  check(shown.R.through.length === 0, 'the frame never shows through the layer while it fades in', shown.R.through);
  check(shown.ghost === 1 && shown.safe, '(c) at the reveal the note\'s ghost fades over the game: aria-hidden, inert, no id, role or pointer events', shown);
  check(shown.R.unsafe.length === 0 && shown.R.fx > 0, '… so does every ghost seen meanwhile', shown.R.unsafe);
  check(typeof shown.quiet === 'number' && shown.quiet <= 600, '(d) within 600 ms of the reveal nothing runs', shown.quiet);
  check(shown.focus && shown.shelfHidden, 'the game has the focus; the shelf is hidden', shown);
  if (reduced) check(shown.R.moved.length === 0, '(j) «менше руху»: nothing moved or scaled', shown.R.moved);

  if (!reduced) {
    const own = await f.evaluate(() => {
      const head = [...document.head.children], m = head.findIndex(n => n.matches('style[data-ihroteka-motion]'));
      const first = head.findIndex(n => !n.matches('style[data-ihroteka-motion], style[data-ihroteka-wait]') && n.matches('style, link[rel~=stylesheet]'));
      const kf = [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.name === 'ihk-keep'); } catch (e) { return false; } });
      return { m, first, kf, lib: document.documentElement.hasAttribute('data-ihroteka'), off: document.documentElement.getAttribute('data-motion') };
    });
    check(own.m >= 0 && own.kf && (own.first < 0 || own.m < own.first), 'the game\'s window has the motion vocabulary (<style data-ihroteka-motion>), before its own styles', own);
    check(own.lib && own.off === null, '… html[data-ihroteka]; motion on: no data-motion', own);
  }

  step('back to the shelf' + at);
  await p.evaluate(backWatch, GAME);
  await p.evaluate(() => window.SM.start());
  await f.evaluate(() => window.ihroteka.home());
  check(await until(() => p.evaluate(() => !!window.SM.back), 5000, 20), 'the room\'s view is the shelf again');
  const back = await p.evaluate(() => window.SM.back);
  check(back && back.shelf && !back.inert && !back.unheard && !back.stage && !back.frame, 'at once: the shelf shown, reachable and heard; the stage hidden, the frame gone', back);
  check(back && back.scroll === tap.scroll && tap.scroll > 0, '… with its scroll as it was', [back && back.scroll, tap && tap.scroll]);
  check(back && back.veil && back.safe, '… under a page-coloured veil (in the fx layer: unheard, untouchable)', back);
  if (reduced) check(back && !back.flying && !back.lifted, '«менше руху»: no flight back', back);
  else check(back && back.flying && back.lifted, '… while a copy of the card flies back into the tapped card (hidden meanwhile)', back);
  check(back && back.came && back.focus, 'the card the game came from: marked, and it has the focus', back);
  const after = await p.evaluate(async id => {
    const card = document.querySelector('a.game[href*="/' + id + '/"]'), names = new Set(), lost = [];
    const t0 = performance.now();
    let quiet = null;
    while (performance.now() - t0 < 1000) {
      for (const a of card.getAnimations()) if (a.animationName) names.add(a.animationName);
      if (quiet === null && !window.SM.running().length) quiet = Math.round(performance.now() - t0);
      if (document.activeElement !== card && lost.length < 4) lost.push(Math.round(performance.now() - t0) + ': ' + (document.activeElement && document.activeElement.tagName));
      await window.SM.frame();
    }
    const R = window.SM.stop();
    return { names: [...names], quiet, R, fx: document.querySelectorAll('.ihk-fx > *').length, lifted: window.SM.unseen(card), came: card.classList.contains('came'), lost };
  }, GAME);
  // (hidden while the copy flies, the card must stay focusable: a keyboard player goes on from it, not from the top)
  check(!after.lost.length, '… and keeps the focus every frame, while the copy flies and as it lands', after.lost);
  if (!reduced) check(after.names.includes('ihk-land'), 'the card lands (ihk-land) once the copy has arrived', after.names);
  check(after.quiet !== null && after.quiet <= 600 && after.fx === 0 && !after.lifted, '(d) within 600 ms nothing runs, nothing is left in the fx layer, the card shows', after);
  check(after.R.unsafe.length === 0, '(c) every ghost and veil meanwhile: unheard, untouchable', after.R.unsafe);
  check(!after.came, 'the mark goes after 900 ms', after);
  if (reduced) check(after.R.moved.length === 0, '(j) «менше руху»: nothing moved or scaled', after.R.moved);
  await ctx.close();
}

scenario('stage-motion: opening a game and coming back, with motion on', async () => {
  const b = await launch();
  await openAndBack(b, { width: 390, height: 844 });
  await openAndBack(b, { width: 320, height: 568 });
  await openAndBack(b, { width: 390, height: 844 }, { reduced: true });

  step('a slow game: «Відкриваю гру…» and «До бібліотеки» only after 300 ms');
  let ctx = await b.newContext({ viewport: { width: 390, height: 844 }, motion: true });
  await ctx.addInitScript(helpers);
  let p = await openPage(ctx, 'bbbbbbbbbbbb');
  await p.route(FRAME, async r => { await w(2000); await r.continue().catch(() => {}); });
  await p.click(CARD);
  const later = () => p.evaluate(() => {
    const c = document.querySelector('#stage-note .open-card'), s = c && c.querySelector('[role=status]'), back = c && [...c.querySelectorAll('button')].find(x => x.textContent === 'До бібліотеки');
    return { status: s ? s.textContent : null, back: !!back && back.getClientRects().length > 0 && getComputedStyle(back).visibility === 'visible',
      heard: !!s && s.getClientRects().length > 0 && getComputedStyle(s).visibility === 'visible' };
  });
  const early = await later();
  await w(550);
  const late = await later();
  check(early.status === '' && !early.back, 'at first the card says nothing more', early);
  check(early.heard, '… its status line already rendered, empty (a live region is there before it speaks)', early);
  check(late.status === 'Відкриваю гру…' && late.back, 'after 300 ms: «Відкриваю гру…» (a status) and «До бібліотеки»', late);
  const home = await p.$('#stage-note .open-card button:has-text("До бібліотеки")');
  await (home ? home.click() : p.click('#stage-back'));
  check(await until(() => p.evaluate(() => !document.getElementById('shelf').hidden && document.getElementById('stage').hidden), 3000, 50), '«До бібліотеки»: the shelf');
  await p.unroute(FRAME);
  await ctx.close();

  step('a game that breaks as it starts: the card, «Відкрити ще раз»');
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, motion: true });
  await ctx.addInitScript(helpers);
  p = await ctx.newPage();                               // (not watched: the game's error is the point)
  let add = true;
  await p.route(FRAME, async r => {
    const res = await r.fetch(), html = await res.text();
    await r.fulfill({ response: res, body: add ? html.replace('</head>', '<script>throw new TypeError("the game broke")</script></head>') : html });
  });
  await p.addInitScript(fakeNet('cccccccccccc'));
  await p.goto(U);
  await p.waitForSelector('#shelf:not([hidden])');
  await p.click(CARD);
  const note = () => p.evaluate(() => {
    const n = document.getElementById('stage-note'), bg = n.querySelector(':scope > .note-bg');
    const seen = [...n.querySelectorAll('p, h2, button')].filter(x => x.getClientRects().length && !x.closest('.open-card'));
    return { shown: !n.hidden, over: n.classList.contains('over'), veil: !!bg && bg.classList.contains('veil'), text: document.getElementById('stage-text').textContent,
      lines: seen.filter(x => x.tagName !== 'BUTTON').map(x => x.textContent), buttons: seen.filter(x => x.tagName === 'BUTTON').map(x => x.getAttribute('aria-label') || x.textContent),
      focus: document.activeElement && (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent) };
  });
  const n = await until(async () => { const x = await note(); return x.shown && x.text === BROKEN[0] && x; }, 15000, 50);
  check(n && n.over && n.veil, 'over the game, faintly in sight under a veil', n);
  check(n && n.lines.join('|') === BROKEN.join('|'), '«' + BROKEN.join(' ') + '»', n && n.lines);
  check(n && n.buttons.join('|') === 'Відкрити ще раз|Скопіювати звіт|До бібліотеки', '«Відкрити ще раз», «Скопіювати звіт», «До бібліотеки»', n && n.buttons);
  check(n && n.focus === 'Відкрити ще раз', 'the focus on «Відкрити ще раз»', n && n.focus);
  add = false;
  const was = await p.$('iframe.frame');
  await p.click('#stage-note button:has-text("Відкрити ще раз")');
  check(await until(() => p.evaluate(old => { const f = document.querySelector('iframe.frame'); return !!f && f !== old && document.getElementById('stage-note').hidden; }, was), 15000, 50),
    '«Відкрити ще раз»: the game opens again (a new frame), the note gone');
  await ctx.close();

  step('motion off (the tests\' switch): the game\'s window gets it too');
  ctx = await b.newContext({ viewport: { width: 390, height: 844 }, motion: false });   // (off even with E2E_MOTION=on)
  p = await openPage(ctx, 'dddddddddddd');
  await p.click(CARD);
  const f = await frameOf(p);
  const off = await f.evaluate(() => ({ off: document.documentElement.getAttribute('data-motion'), style: !!document.querySelector('style[data-ihroteka-motion]') }));
  check(off.off === 'off' && off.style, 'the game\'s <html> has data-motion=off (the library\'s), and the vocabulary', off);
  await ctx.close();

  // L-T25, L-T26 (owner, UX Q2): a follower's opening card names who opened the game; back on the shelf, a note names
  // who took everyone there. Words only: the same with motion off.
  for (const motion of [true, false]) {
    const how = motion ? '' : ' (motion off)';
    step('following a friend: «Аня відкриває «…»…», then «Аня повертає всіх до бібліотеки»' + how);
    ctx = await b.newContext({ viewport: { width: 390, height: 844 }, motion });   // (one context: one fake network)
    const An = await openPage(ctx, motion ? 'eeeeeeeeeeee' : 'eeee0000eeee', U, { label: 'Аня' });
    const code = await createLink(An, 'Аня');
    const Bo = await openPage(ctx, motion ? 'ffffffffffff' : 'ffff0000ffff', code, { name: 'Богдан' });
    check(await allLinked([An, Bo]), 'Аня and Богдан together' + how);
    await until(async () => !(await An.$('#layer > .backdrop')), 5000);
    const title = await An.$eval(CARD + ' b', x => x.textContent);
    const plain = t => (t || '').replace(/[\u2066-\u2069]/g, '');
    // (what Богдан's page shows: the opening card's who-line, and every note, as they come)
    const listen = P => P.evaluate(() => {
      window.__who = null; window.__notes = [];
      new MutationObserver(() => {
        const who = document.querySelector('#stage-note .open-card .who');
        if (who && window.__who === null) window.__who = who.textContent;
        for (const t of document.querySelectorAll('#layer .toast')) if (!window.__notes.includes(t.textContent)) window.__notes.push(t.textContent);
      }).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
    await listen(Bo); await listen(An);
    await An.click(CARD);
    check(await until(() => Bo.evaluate(() => !document.getElementById('stage').hidden), 10000, 50), 'Богдан follows into the game' + how);
    const who = plain(await Bo.evaluate(() => window.__who));
    check(who === 'Аня відкриває «' + title + '»…', 'Богдан\'s opening card: «Аня відкриває «' + title + '»…»' + how, who);
    check(plain(await An.evaluate(() => window.__who)) === '', '… and none on Аня\'s own (she opened it)', await An.evaluate(() => window.__who));
    const fa = await frameOf(An);
    await frameOf(Bo);
    await fa.evaluate(() => window.ihroteka.home());
    check(await until(() => Bo.evaluate(() => !document.getElementById('shelf').hidden), 10000, 50), 'Богдан follows back to the shelf' + how);
    const said = await until(async () => { const n = (await Bo.evaluate(() => window.__notes)).map(plain); return n.includes('Аня повертає всіх до бібліотеки') && n; }, 3000, 50);
    check(!!said, 'Богдан\'s shelf: «Аня повертає всіх до бібліотеки»' + how, await Bo.evaluate(() => window.__notes));
    check(!(await An.evaluate(() => window.__notes)).some(t => /повертає/.test(t)), '… and nothing so on Аня\'s own', await An.evaluate(() => window.__notes));
    await ctx.close();
  }
}, { timeout: 240000 });
