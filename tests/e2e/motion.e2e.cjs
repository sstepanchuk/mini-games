// tags: @ci
// motion: the library with motion on as two players use it (the UX spec's proofs (c), (d), (f), (j) and (k); its rules
// 2, 6 and 8; L-T19…L-T23, L-T28…L-T30, S-T17), at 390×844 and 320×568, then under «менше руху». Аня and Богдан:
// «Грати разом» (the name, the menu, the link), Богдан comes by the link («Ви разом!» on his page, «Ви граєте разом» on
// hers for 2.4 s), the game opens on both (E2E_GAME: the probe on CI), Богдан drops out and comes back (the waiting
// message wherever it is: the card over the game, or a copy of the game's), again with a copy of <ihroteka-wait> put in
// Аня's game as a game would place one (the probe places none), Богдан's page reloads, he drops out once more and Аня
// presses «Не чекати», and Аня goes back to the shelf. Throughout, in every frame of both pages: (c) each node put into
// the fx layer (a ghost, a veil, a card in flight) is unheard and untouchable as it comes: aria-hidden, inert, no id,
// role, live region or modal mark in it, pointer events off on it and on everything inside it (no inert: Safari before
// 15.5), the point at its centre hitting what is under it; (d) within 600 ms of each transition (from the frame its
// state is there) nothing of the library runs any more, and nothing is left in the fx layer (a spinner's loop and the
// owner's holds aside: a state, not a transition); (f) on every animation frame of the drops and the reload the waiting
// message is in one place (waitShown's rule: never the card and a copy), and no copy that holds the rows, nor anything
// around it, is under opacity .01; (j) under «менше руху» no animation of the library's moves or scales anything, and
// none of its fades lasts longer than 120 ms. (Opening a game and coming back have their own checks in stage-motion,
// the dialogs in dialogs-motion, the chip in together-motion.)
// (k) E2E_STRIPS=1 (Chromium): frame strips of the opening, the way back, the dialog's steps, a note's life and the
// card, at 390×844, from the DevTools protocol's screencast, saved as PNG into E2E_STRIPS_DIR (default: the system's
// temp dir, ihroteka-strips) for the owner to look at. Without it nothing is written (CI).
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { GAME, CHROMIUM, launch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { openPage, enterName, frameOf, libState, short, waitShown } = require('./support/pages.cjs');

const CARD = 'a.game[href*="/' + GAME + '/"]';
const STRIPS = process.env.E2E_STRIPS === '1' && CHROMIUM;
const STRIPS_DIR = process.env.E2E_STRIPS_DIR || path.join(os.tmpdir(), 'ihroteka-strips');

// (every frame of the contexts here, before its own code) (c): every node put into an fx layer, checked as it comes;
// (j): every running animation of the library's that moves or scales, or fades longer than 120 ms, each animation
// frame (in a game's frame only the library's own: those on its <ihroteka-wait>). Into the page's window.__M.
function WATCH() {
  let top = window;
  try { if (window.top.document) top = window.top; } catch (e) {}
  const M = top.__M = top.__M || { fx: 0, kinds: {}, unsafe: [], moved: [], long: [] };
  const game = top !== window;
  const add = (list, v) => { if (!list.includes(v) && list.length < 40) list.push(v); };
  const name = n => !n ? '?' : n.localName + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).join('.') : '');
  const still = n => !n.id && !n.hasAttribute('role') && !n.hasAttribute('aria-live') && !n.hasAttribute('aria-modal') && getComputedStyle(n).pointerEvents === 'none';
  const look = g => {
    const fx = g.parentElement, k = name(g), why = [];
    M.fx++; M.kinds[k] = (M.kinds[k] || 0) + 1;
    if (!(fx.getAttribute('aria-hidden') === 'true' && fx.hasAttribute('inert') && getComputedStyle(fx).pointerEvents === 'none')) why.push('its layer');
    if (g.getAttribute('aria-hidden') !== 'true' || !g.hasAttribute('inert')) why.push('not aria-hidden and inert');
    const loud = [g, ...g.querySelectorAll('*')].filter(n => !still(n));
    if (loud.length) why.push('an id, role, live region, modal mark or pointer events: ' + [...new Set(loud.map(name))].slice(0, 3).join(', '));
    const r = g.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (r.width && r.height && x >= 0 && y >= 0 && x < innerWidth && y < innerHeight) { const e = document.elementFromPoint(x, y); if (e && e.closest('.ihk-fx')) why.push('it catches the pointer'); }
    if (why.length) add(M.unsafe, k + ': ' + why.join('; '));
  };
  new MutationObserver(list => {
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1) continue;
      if (n.classList.contains('ihk-fx')) for (const c of n.children) look(c);
      else if (n.parentElement && n.parentElement.classList.contains('ihk-fx')) look(n);
    }
  }).observe(document, { childList: true, subtree: true });
  const ours = a => !game || !!(a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest('ihroteka-wait'));
  const tick = () => {
    for (const a of document.getAnimations ? document.getAnimations() : []) {
      if (a.playState !== 'running' || !a.effect || !ours(a)) continue;
      let kf = [];
      try { kf = a.effect.getKeyframes(); } catch (e) {}
      const what = (a.animationName || a.transitionProperty || 'script') + ' on ' + name(a.effect.target) + (game ? ' (in the game)' : '');
      if (kf.some(k => (k.transform && k.transform !== 'none') || k.translate || k.scale || k.rotate)) add(M.moved, what);
      const ms = a.effect.getComputedTiming().duration;
      if (kf.some(k => 'opacity' in k) && ms > 120) add(M.long, what + ': ' + Math.round(ms) + ' ms');
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// (the library's page only) __settle(kind, arg): waits for a state (COND), then for the library to be still: no
// animation of its own running (in its page, and on the game's <ihroteka-wait>), nothing left in the fx layer → { ms:
// from the frame the state was there } (ms null: no such state within 30 s, or not still 3 s after it: what was left). The owner's holds (ihk-drain) and loops (a
// spinner) are a state, not a transition. __F: what the waiting message does each animation frame, for (f).
function HELP() {
  if (window.top !== window) return;
  const frameDoc = () => { try { return document.querySelector('iframe.frame')?.contentDocument || null; } catch (e) { return null; } };
  const name = n => !n ? '?' : n.localName + (typeof n.className === 'string' && n.className.trim() ? '.' + n.className.trim().split(/\s+/).join('.') : '');
  // where the waiting message is (as pages.cjs waitShown says it), and the copies of the game
  const where = () => {
    const c = document.getElementById('waiting'), card = !!c && !c.hidden && !!c.firstElementChild, doc = frameDoc();
    const all = doc ? [...doc.querySelectorAll('ihroteka-wait')] : [];
    const held = all.find(x => x.firstElementChild && x.getClientRects().length > 0);
    return { at: card && held ? 'both' : held ? 'screen' : card ? 'card' : 'none', all, doc };
  };
  const toast = t => [...document.querySelectorAll('#layer .toast')].some(x => x.textContent === t);
  const COND = {
    opened: () => !!document.querySelector('#layer > .backdrop .dialog input'),
    menu: () => /Через посилання/.test(document.querySelector('#layer > .backdrop .dialog')?.textContent || ''),
    link: () => !!document.querySelector('#layer > .backdrop canvas.qr')?.dataset.code,
    closed: () => !document.querySelector('#layer > .backdrop'),
    toast, untoast: t => !toast(t),
    waits: () => where().at !== 'none',
    free: () => where().at === 'none'
  };
  const live = () => {
    const out = [];
    const take = (doc, mine) => {
      for (const a of doc && doc.getAnimations ? doc.getAnimations() : []) {
        if (a.playState !== 'running' || !a.effect || !mine(a) || a.animationName === 'ihk-drain') continue;
        if (!isFinite(a.effect.getComputedTiming().endTime)) continue;
        out.push((a.animationName || a.transitionProperty || 'script') + ' on ' + name(a.effect.target));
      }
    };
    take(document, () => true);
    take(frameDoc(), a => !!(a.effect.target && a.effect.target.closest && a.effect.target.closest('ihroteka-wait')));
    for (const g of document.querySelectorAll('.ihk-fx > *')) out.push('left in the fx layer: ' + name(g));
    return out;
  };
  window.__settle = (kind, arg) => new Promise(res => {
    const t0 = performance.now();
    let at = null;
    const look = () => {
      const now = performance.now();
      if (at === null && COND[kind](arg)) at = now;
      const left = at === null ? [] : live();
      if (at !== null && !left.length) return res({ ms: Math.round(now - at) });
      if (at === null ? now - t0 > 30000 : now - at > 3000) return res({ ms: null, state: at !== null, left });
      requestAnimationFrame(look);
    };
    look();
  });
  window.__F = {
    start() {
      const R = this.R = { frames: 0, at: {}, rows: 0, min: 1, low: [], stop: false };
      const tick = () => {
        if (R.stop) return;
        R.frames++;
        const s = where();
        R.at[s.at] = (R.at[s.at] || 0) + 1;
        for (const x of s.all) {
          if (!x.firstElementChild) continue;
          R.rows++;
          for (let n = x; n && n.nodeType === 1; n = n.parentElement) {
            const o = +s.doc.defaultView.getComputedStyle(n).opacity;
            R.min = Math.min(R.min, o);
            if (o < 0.01 && R.low.length < 8) R.low.push(name(n) + ' ' + o + ' at frame ' + R.frames);
          }
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    stop() { const R = this.R; R.stop = true; return R; }
  };
}

/* ---------- (k) frame strips: the DevTools protocol's screencast of a page, frames picked from time windows ---------- */
async function recorder(p) {
  if (!STRIPS) return null;
  const cdp = await p.context().newCDPSession(p), shots = [];
  cdp.on('Page.screencastFrame', f => {
    shots.push({ t: (f.metadata.timestamp || Date.now() / 1000) * 1000, data: f.data });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 85, everyNthFrame: 1 });
  return { shots, stop: () => cdp.send('Page.stopScreencast').catch(() => {}) };
}
// windows: [{ label, t0, t1 }] (Date.now()); from each, the last frame before it and up to n frames in it, evenly
async function strip(b, rec, file, windows, n = 6) {
  if (!rec) return;
  const cells = [];
  for (const { label, t0, t1 } of windows) {
    const before = rec.shots.filter(s => s.t < t0).slice(-1), inside = rec.shots.filter(s => s.t >= t0 && s.t <= t1);
    const pick = inside.length <= n ? inside : Array.from({ length: n }, (_, i) => inside[Math.round(i * (inside.length - 1) / (n - 1))]);
    for (const s of [...before, ...pick]) cells.push({ s, cap: label + ' ' + (s.t < t0 ? '(before)' : '+' + Math.round(s.t - t0) + ' ms') });
  }
  if (!cells.length) return;
  const ctx = await b.newContext({ viewport: { width: 1200, height: 800 } }), p = await ctx.newPage();
  const cols = Math.min(cells.length, 7);
  await p.setContent('<style>body{margin:0;background:#fff;font:13px sans-serif}div{display:grid;grid-template-columns:repeat(' + cols + ',auto);gap:6px;padding:6px;width:max-content}' +
    'figure{margin:0}img{display:block}figcaption{text-align:center;padding:2px}</style><div>' +
    cells.map(c => '<figure><img src="data:image/jpeg;base64,' + c.s.data + '"><figcaption>' + c.cap + '</figcaption></figure>').join('') + '</div>');
  await p.waitForFunction(() => [...document.images].every(i => i.complete));
  fs.mkdirSync(STRIPS_DIR, { recursive: true });
  await (await p.$('div')).screenshot({ path: path.join(STRIPS_DIR, file) });
  await ctx.close();
  console.log('  (strip: ' + path.join(STRIPS_DIR, file) + ')');
}

// what the watchers of a page saw (window.__M), added into M; the page's own record starts again
async function collect(p, M) {
  const m = await p.evaluate(() => { const x = window.__M || {}; window.__M = { fx: 0, kinds: {}, unsafe: [], moved: [], long: [] }; return x; }).catch(() => ({}));
  M.fx += m.fx || 0;
  for (const [k, n] of Object.entries(m.kinds || {})) M.kinds[k] = (M.kinds[k] || 0) + n;
  for (const k of ['unsafe', 'moved', 'long']) for (const v of m[k] || []) if (!M[k].includes(v)) M[k].push(v);
}

// The way two players go, with motion on (reduced: «менше руху»); strips: (k) at this size
async function journey(b, viewport, { reduced = false, strips = false } = {}) {
  const at = ' (' + viewport.width + '×' + viewport.height + (reduced ? ', «менше руху»' : '') + ')', tag = viewport.width + (reduced ? 'r' : 'm');
  const ctx = await b.newContext({ viewport, motion: true, ...(reduced && { reducedMotion: 'reduce' }) });
  await ctx.addInitScript(WATCH);
  await ctx.addInitScript(HELP);
  const M = { fx: 0, kinds: {}, unsafe: [], moved: [], long: [] }, quiet = {}, F = {};
  // (d): the transition's state, then still; started before what makes it, awaited after
  const settle = (p, label, kind, arg) => {
    const r = p.evaluate(([k, a]) => window.__settle(k, a), [kind, arg]).catch(e => ({ ms: null, error: e.message }));
    return async () => { quiet[label] = await r; };
  };
  const now = Date.now;

  step('«Грати разом»: the name, the menu, the link' + at);
  const A = await openPage(ctx, 'aaaaaaaa' + tag, undefined, { label: 'Аня' });
  check(await A.evaluate(r => document.documentElement.dataset.motion !== 'off' && matchMedia('(prefers-reduced-motion: reduce)').matches === r, reduced), 'motion on' + (reduced ? ', «менше руху» on' : ''));
  const recA = strips ? await recorder(A) : null, dialogAt = [];
  let done = settle(A, 'the dialog opens', 'opened');
  dialogAt.push({ label: 'відкрити', t0: now() });
  await A.click('#together');
  await done();
  done = settle(A, 'name → menu', 'menu');
  await A.fill('.dialog input.link', 'Аня');
  dialogAt.push({ label: 'ім’я → меню', t0: now() });
  await A.press('.dialog input.link', 'Enter');
  await done();
  done = settle(A, 'menu → link', 'link');
  dialogAt.push({ label: 'меню → посилання', t0: now() });
  await A.click('text=Через посилання');
  await done();
  const link = await (await A.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code)).jsonValue();
  for (const d of dialogAt) d.t1 = d.t0 + 700;

  step('Богдан comes by the link: «Ви разом!» on his page, «Ви граєте разом» on hers' + at);
  const closes = settle(A, '«Ви граєте разом» goes by itself', 'closed');
  const B = await openPage(ctx, 'bbbbbbbb' + tag, link, { label: 'Богдан' });
  const recB = strips ? await recorder(B) : null, linkAt = now();
  const comes = settle(B, 'a note comes («Ви разом!»)', 'toast', 'Ви разом!');
  await enterName(B, 'Богдан');
  await comes();
  const note = quiet['a note comes («Ви разом!»)'];
  check(note.ms != null || note.state, 'Богдан\'s page: «Ви разом!»', note);
  done = settle(B, 'the note goes', 'untoast', 'Ви разом!');
  await done();
  const goneAt = now();
  await closes();
  check(await until(async () => (await libState(A)).linked && (await libState(B)).linked, 15000), 'together', [await short(A), await short(B)]);

  step('the game opens on both' + at);
  const openAt = now();
  await A.click(CARD);
  const fa = await frameOf(A);
  const playing = async () => { const s = [await libState(A), await libState(B)]; return s.every(x => x.game && x.game.linked); };
  if (!check(await until(playing, 20000), 'both in ' + GAME + ', playing together (needs it on the dev server)', [await short(A), await short(B)])) return { M, quiet, F };
  await until(() => A.evaluate(() => document.getElementById('stage-note').hidden), 10000, 50);
  const openEnd = now() + 600;
  await w(600);

  // Богдан drops out and comes back; Аня's waiting message every animation frame meanwhile (f), and its transitions (d)
  const dropAndBack = async (label, want) => {
    await A.evaluate(() => window.__F.start());
    const t = { drop: now() };
    done = settle(A, label + ' comes', 'waits');
    await B.evaluate(() => window.__net(false));
    await done();
    t.came = now();
    const s = await waitShown(A);
    if (want) check(s.where === want, 'Аня\'s game waits for Богдан: ' + (want === 'card' ? 'the card over the game' : 'in the game\'s copy'), s);
    await w(600);                                         // (a moment at rest: the strip shows it)
    done = settle(A, label + ' goes', 'free');
    t.back = now();
    await B.evaluate(() => window.__net(true));
    await done();
    t.gone = now();
    F[label] = await A.evaluate(() => window.__F.stop());
    return t;
  };

  step('Богдан drops out and comes back: the waiting message' + at);
  const shown0 = await A.evaluate(() => window.__ihroteka.screens());
  const card = await dropAndBack('the message', shown0.adopted ? null : 'card');

  step('the same with a copy of <ihroteka-wait> in Аня\'s game (as a game places one)' + at);
  const put = await fa.evaluate(() => {
    const l = document.createElement('div');
    l.id = 'motion-e2e-wait';
    l.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:2147483000;padding:8px;background:#fff';
    l.append(document.createElement('ihroteka-wait'));
    document.body.append(l);
    return !!customElements.get('ihroteka-wait');
  });
  check(put && await until(() => A.evaluate(() => window.__ihroteka.screens().adopted), 3000, 50), 'the game\'s copy is the library\'s (adopted)', put);
  await dropAndBack('the copy', 'screen');

  step('Богдан\'s page reloads' + at);
  await collect(B, M);
  await A.evaluate(() => window.__F.start());
  await B.reload();
  await enterName(B, 'Богдан');                           // (the room's link asks for the name again)
  const back = async () => (await libState(B)).game?.linked && (await waitShown(A)).where === null;
  check(await until(back, 30000), 'Богдан back in the game, Аня\'s game waits for nobody', [await short(B), await waitShown(A)]);
  await w(400);
  F['the reload'] = await A.evaluate(() => window.__F.stop());

  step('Богдан drops out once more; Аня: «Не чекати»' + at);
  const copies = await A.evaluate(() => window.__ihroteka.screens().copies);
  await fa.evaluate(() => document.getElementById('motion-e2e-wait').remove());
  await until(() => A.evaluate(n => window.__ihroteka.screens().copies < n, copies), 3000, 50);
  await A.evaluate(() => window.__F.start());
  done = settle(A, '«Не чекати»: the message comes', 'waits');
  await B.evaluate(() => window.__net(false));
  await done();
  const before = await until(async () => { const s = await waitShown(A); return s.buttons.includes('Не чекати') && s; }, 5000, 50);
  const onCard = !!before && before.where === 'card', width = () => A.evaluate(() => Math.round(document.getElementById('waiting').getBoundingClientRect().width));
  const w0 = onCard ? await width() : null;
  done = settle(A, '«Не чекати»: the message goes', 'free');
  const pressed = now();
  if (onCard) await A.click('#waiting:not([hidden]) >> text=Не чекати');
  else if (before) await fa.click('ihroteka-wait:not(:empty) >> text=Не чекати');
  if (onCard) {
    const ack = await until(async () => { const s = await waitShown(A); return s.text === 'Гаразд, не чекаємо.' && s; }, 1000, 20);
    const w1 = await width();
    check(ack && !ack.buttons.length && Math.abs(w1 - w0) <= 1, 'the card says «Гаразд, не чекаємо.» (nothing to press), as wide as it was', [ack || await waitShown(A), w0, w1]);
  } else console.log('  (the game\'s own copy held the message: «Не чекати» pressed there)');
  await until(async () => !(await waitShown(A)).where, 5000, 20);
  const held = now() - pressed;
  if (onCard) check(held >= 1000 && held < 3000, '… for 1.2 s, then it goes', held);
  await done();
  F['«Не чекати»'] = await A.evaluate(() => window.__F.stop());

  step('Аня back to the shelf' + at);
  const homeAt = now();
  await fa.evaluate(() => window.ihroteka.home());
  await until(() => A.evaluate(() => !document.getElementById('shelf').hidden), 5000, 50);
  await w(1200);                                          // (for the strip: the card the game came from, its mark 900 ms)
  const homeEnd = now();

  await collect(A, M);
  await collect(B, M);
  if (strips) {
    await strip(b, recA, 'motion-dialog.png', dialogAt);
    await strip(b, recB, 'motion-toast.png', [{ label: '«Ви разом!»', t0: linkAt, t1: goneAt + 200 }], 12);
    await strip(b, recA, 'motion-open.png', [{ label: 'відкрити', t0: openAt, t1: openEnd }], 12);
    await strip(b, recA, 'motion-card.png', [{ label: 'зв’язок зник', t0: card.drop + 1200, t1: card.came + 500 }, { label: 'повернувся', t0: card.back, t1: card.gone + 400 }]);
    await strip(b, recA, 'motion-back.png', [{ label: 'до бібліотеки', t0: homeAt, t1: homeEnd }], 12);
    await recA.stop(); await recB.stop();
  }
  await ctx.close();
  return { M, quiet, F };
}

// the proofs, for one journey
function proofs({ M, quiet, F }, at, reduced) {
  check(M.fx > 0 && !M.unsafe.length, '(c) every ghost, veil and flight in the fx layer, as it came (' + M.fx + ': ' + Object.keys(M.kinds).join(', ') + '): aria-hidden, inert, no id, role, live region or pointer events in it; a tap goes through it' + at, M.unsafe);
  const late = Object.entries(quiet).filter(([, r]) => r.ms == null || r.ms > 600);
  check(Object.keys(quiet).length >= 10 && !late.length, '(d) within 600 ms of each transition nothing runs, nothing is left in the fx layer' + at + ': ' +
    Object.entries(quiet).map(([k, r]) => k + ' ' + r.ms).join(', '), late);
  const phases = Object.entries(F);
  check(phases.length >= 4 && phases.every(([, R]) => !R.at.both && R.frames > 10), '(f) every animation frame of the drops and the reload: the waiting message in one place, never the card and a copy' + at + ': ' +
    phases.map(([k, R]) => k + ' ' + JSON.stringify(R.at)).join(', '), F);
  check(F['the copy'] && F['the copy'].rows > 0 && phases.every(([, R]) => R.min >= 0.01), '… and a copy that holds the rows, with all around it, never under opacity .01 (lowest: ' +
    phases.map(([k, R]) => k + ' ' + (R.rows ? R.min : '-')).join(', ') + ')', phases.map(([k, R]) => [k, R.low]));
  if (reduced) {
    check(!M.moved.length, '(j) «менше руху»: no animation of the library\'s moved or scaled anything', M.moved);
    check(!M.long.length, '… and none of its fades lasted longer than 120 ms', M.long);
  }
}

scenario('motion: the library with motion on, two players in a room and a game', async () => {
  const b = await launch();
  for (const [viewport, o] of [[{ width: 390, height: 844 }, { strips: STRIPS }], [{ width: 320, height: 568 }, {}], [{ width: 390, height: 844 }, { reduced: true }]]) {
    const r = await journey(b, viewport, o);
    proofs(r, ' (' + viewport.width + '×' + viewport.height + (o.reduced ? ', «менше руху»' : '') + ')', !!o.reduced);
  }
}, { timeout: 280000 });
