// tags: @ci
// dialogs-motion: the library's dialogs, its notes at the bottom of the screen, its copy buttons and the password
// dialog with motion on (library/app/dom.js, lock.js; the UX spec's L-T08, L-T14, L-T16…L-T19, L-T23, L-T39, its rules
// 1, 2, 5 and 8 and its proofs (a), (b), (c), (d), (g), (h), (j)). Part one drives dom.js and lock.js on their own, in
// a page made here on the dev server's origin (as screens-unit: the library's modules and style.css read from disk,
// motion.js installed as the library installs it at boot; a keyring made here for the password, never printed), at
// 390×844 and 320×568; part two the library itself (the shelf and «Грати разом»). State first: a dialog's field has the
// focus in the task that opened it; «Закрити» during the entry leaves no #layer > .backdrop, nothing inert, the page
// under it hit by elementFromPoint, in the same task, while a ghost (aria-hidden, inert, no id, role or pointer events)
// fades from where the entry was; a press that slides off a button onto the backdrop closes nothing; a step (forward,
// back, a fade) keeps the dialog's top edge; every animation ends within 600 ms. Notes rise in, live by their length
// (2.6 s, 60 ms per letter over 24, 6 s at most), never one over another nor over the card «Чекаємо…», leave as ghosts
// while the rest glide into their place, are said once, and a tap takes one away on the shelf and over a dialog, never over a game.
// «Скопіювати» keeps its width, says «Скопійовано» (its name too) and comes back after 2 s. The password: «Відмикаю…»
// in «Відкрити» only after 300 ms (the line under it is for a screen reader), the error in its slot under the field.
// «Менше руху»: nothing moves, fades of 120 ms at most. Motion off: no ghost, no step wrapper (today's DOM).
'use strict';
/* global T, D, L */                                 // (the page's: its helpers, dom.js, lock.js)
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { U, launch, scenario, check, step, w, watch } = require('./support/scenario.cjs');
const { openPage } = require('./support/pages.cjs');

const LIB = path.join(__dirname, '..', '..', 'library'), AT = U + '__dialogs/';
const SERVED = ['dom.js', 'motion.js', 'lock.js', 'device.js'];
const PAGE = `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<script>if (location.search.includes('off')) document.documentElement.dataset.motion = 'off';</script>
<link rel="stylesheet" href="./style.css">
<body>
<section class="shelf" id="shelf">
  <div class="shelf-head"><h1 class="title">Ігротека</h1><button class="chip" id="together" type="button">Грати разом</button></div>
  <div class="games" id="games"><a class="game" id="card" href="#g"><div class="game-body"><b>Два дракони</b><span>Гра на двох</span></div></a></div>
</section>
<section class="stage" id="stage" hidden><button id="under" type="button" style="position:absolute;inset:0;width:100%;border:0;background:#dfe">поле</button><div id="waiting" class="waiting card" hidden></div></section>
<div class="boot" id="boot"><p class="busy" id="busy">Відкриваю Ігротеку…</p></div>
<div id="layer"></div>
<script type="module">
// Web Crypto's password derivation answers window.__slow ms late (a cheap phone)
const derive = SubtleCrypto.prototype.deriveKey;
SubtleCrypto.prototype.deriveKey = function (algo, ...rest) {
  const p = derive.call(this, algo, ...rest);
  return algo && algo.name === 'PBKDF2' && window.__slow ? new Promise(r => setTimeout(r, window.__slow)).then(() => p) : p;
};
navigator.clipboard.writeText = async t => { window.__copied = t; };
try { window.M = await import('./app/motion.js'); window.M.install(document, window); } catch (e) {}
window.D = await import('./app/dom.js');
window.L = await import('./app/lock.js');
const h = (tag, props = {}, ...kids) => {
  const { attrs = {}, ...rest } = props, n = Object.assign(document.createElement(tag), rest);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  n.append(...kids);
  return n;
};
const LINE = 'Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.';
window.T = {
  h,
  frame: () => new Promise(r => requestAnimationFrame(() => r())),
  wait: ms => new Promise(r => setTimeout(r, ms)),
  ghosts: () => [...document.querySelectorAll('.ihk-fx > *')],
  // a ghost as rule 2 wants it: unheard, untouchable, nothing in it to name or reach
  safe: g => g.getAttribute('aria-hidden') === 'true' && g.hasAttribute('inert') && getComputedStyle(g).pointerEvents === 'none'
    && !g.id && !g.hasAttribute('role') && !g.querySelector('[id],[role],[aria-modal],[aria-live]'),
  // a screen of a dialog: a heading, lines, then more
  screen: (title, lines = 1, more = []) => [h('h2', { textContent: title }), ...Array.from({ length: lines }, () => h('p', { textContent: LINE })), ...more],
  option: t => h('button', { className: 'option', type: 'button' }, h('span', { className: 'option-icon' }), h('span', {}, h('b', { textContent: t }), h('span', { textContent: 'Друг може бути де завгодно' }))),
  closed: 0,
  // a dialog as the library makes one: a name field, its error slot, «Далі», «Закрити»
  dialog() {
    const m = D.modal(() => { T.closed++; });
    const input = h('input', { className: 'link', placeholder: 'Твоє ім’я' });
    const next = h('button', { className: 'btn', type: 'submit', textContent: 'Далі' });
    const close = h('button', { className: 'btn ghost', type: 'button', textContent: 'Закрити', onclick: () => m.close() });
    m.show(...T.screen('Грати разом', 1, [h('form', { className: 'stack', onsubmit: e => e.preventDefault() }, input, h('p', { className: 'err', attrs: { role: 'alert' } }), next), close]));
    m.focus(input);
    return { m, input, next, close, back: m.box.parentNode };
  },
  // every animation running now: its name, whether its keyframes move (transform, translate, scale), its duration
  running: () => document.getAnimations().filter(a => a.playState === 'running').map(a => {
    const k = a.effect.getKeyframes(), t = a.effect.target;
    return { name: a.animationName || 'script', moves: k.some(x => (x.transform && x.transform !== 'none') || x.translate || x.scale), ms: a.effect.getTiming().duration,
      on: t ? (t.className && t.className.baseVal === undefined ? t.className : t.tagName) : '' };
  }),
  // a glide (motion.js flip: a script's animation, not a CSS animation or transition)
  glide: a => !('animationName' in a) && !('transitionProperty' in a),
  stepOf: m => { const s = m.box.firstElementChild; return { wrapped: m.box.children.length === 1 && !!s && s.classList.contains('step'), names: s ? s.getAnimations().map(a => a.animationName) : [] }; }
};
window.ok = true;
</script>`;

// a keyring for one person with a password made here (1000 PBKDF2 iterations: fast), as tests/app/lock.test.js makes it
async function keyring() {
  const vault = await import(pathToFileURL(path.join(LIB, 'crypto.js')).href);
  const raw = vault.newLibraryKey(), kr = { ...vault.newKeyring(), kid: await vault.keyId(raw), kdf: { iterations: 1000 } };
  const pw = Buffer.from(vault.random(12)).toString('base64');
  const p = { ...(await vault.newPerson(kr, 'alice-id', pw)), name: 'alice' };
  p.box = await vault.boxFor(p, raw);
  kr.people.push(p);
  return { json: JSON.stringify(kr), pw };
}
async function unitPage(b, { viewport, reducedMotion, off = false, kr }) {
  const ctx = await b.newContext({ viewport, motion: true, ...(reducedMotion && { reducedMotion }) });
  await ctx.route(AT + '**', r => {
    const u = new URL(r.request().url()), rel = u.pathname.slice(new URL(AT).pathname.length);
    if (rel === '') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    if (rel === 'keyring.json') return r.fulfill({ contentType: 'application/json', body: kr.json });
    const file = rel === 'style.css' ? path.join(LIB, 'app', 'style.css') : rel === 'crypto.js' ? path.join(LIB, 'crypto.js')
      : rel.startsWith('app/') && SERVED.includes(rel.slice(4)) ? path.join(LIB, 'app', rel.slice(4)) : null;
    if (!file || !fs.existsSync(file)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ contentType: (file.endsWith('.css') ? 'text/css' : 'text/javascript') + '; charset=utf-8', body: fs.readFileSync(file, 'utf8') });
  });
  const p = watch(await ctx.newPage(), 'unit ' + viewport.width + (reducedMotion ? ' reduced' : '') + (off ? ' off' : ''));
  await p.goto(AT + (off ? '?off' : ''));
  await p.waitForFunction(() => window.ok, null, { timeout: 15000 });
  return { ctx, p, run: (fn, arg) => p.evaluate(fn, arg) };
}

scenario('dialogs-motion: dialogs, notes, copy and the password with motion on', async () => {
  const b = await launch(), kr = await keyring();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const at = ' (' + viewport.width + '×' + viewport.height + ')';
    const { ctx, p, run } = await unitPage(b, { viewport, kr });

    step('a dialog opens' + at);
    let r = await run(async () => {
      const out = {}, opener = document.getElementById('together');
      opener.focus();
      const d = window.d = T.dialog();
      await Promise.resolve();
      out.atOnce = document.activeElement === d.input;
      out.inert = document.getElementById('shelf').inert;
      out.entry = d.m.box.getAnimations().map(a => a.animationName);
      out.backEntry = d.back.getAnimations().map(a => a.animationName);
      await T.frame();
      out.inFrame = document.activeElement === d.input;
      return out;
    });
    check(r.atOnce && r.inFrame, '(a) the field has the focus in the task that opened the dialog, and a frame later', r);
    check(r.inert, 'the page behind is inert at once', r);
    check(r.entry.includes('ihk-pop') && r.backEntry.includes('ihk-fade'), 'the dialog rises in (ihk-pop) over a backdrop that fades in', r);

    step('«Закрити» during the entry' + at);
    r = await run(async () => {
      await T.wait(30);
      const out = {}, d = window.d, opener = document.getElementById('together');
      out.backOpacity = +getComputedStyle(d.back).opacity;
      d.close.click();
      out.layer = !!document.querySelector('#layer > .backdrop');
      out.inert = document.getElementById('shelf').inert;
      const o = opener.getBoundingClientRect(), hit = document.elementFromPoint(o.left + o.width / 2, o.top + o.height / 2);
      out.hit = !!hit && !!hit.closest('#together');
      out.focus = document.activeElement === opener;
      out.closed = T.closed;
      const g = T.ghosts();
      out.ghosts = g.map(x => x.className);
      out.safe = g.length > 0 && g.every(T.safe);
      out.ghostOpacity = g[0] ? +getComputedStyle(g[0]).opacity : null;
      const gd = g[0] && g[0].querySelector('.dialog');
      out.sinks = gd ? gd.getAnimations().map(a => a.animationName) : [];
      const d2 = T.dialog();
      await Promise.resolve();
      out.again = document.activeElement === d2.input;
      d2.m.close();
      await T.wait(600);
      out.cleared = T.ghosts().length;
      out.left = T.running();
      return out;
    });
    check(!r.layer && !r.inert && r.hit, '(b) no #layer > .backdrop, nothing inert, the page under it hit by elementFromPoint: in the same task', r);
    check(r.focus && r.closed === 1, 'the focus back on what opened it; onClose once', r);
    check(r.safe && r.ghosts.some(c => /backdrop/.test(c)), '(c) its ghost plays the exit: aria-hidden, inert, no id, role or pointer events', r);
    check(r.ghostOpacity !== null && r.ghostOpacity <= r.backOpacity + 0.1, 'the ghost fades from where the entry was (no flash to full)', r);
    check(r.sinks.includes('ihk-out'), 'the dialog in the ghost sinks (ihk-out)', r);
    check(r.again, 'a dialog opened again at once takes the focus (the ghost catches nothing)', r);
    check(r.cleared === 0 && r.left.length === 0, '(d) within 600 ms: no ghost left, no animation running', r);

    step('a press slid off a button onto the backdrop (L-T39)' + at);
    const pos = await run(async () => { const d = window.d = T.dialog(); await T.wait(260); const k = d.next.getBoundingClientRect(); return { x: k.left + k.width / 2, y: k.top + k.height / 2, H: innerHeight }; });
    await p.mouse.move(pos.x, pos.y);
    await p.mouse.down();
    await p.mouse.move(8, pos.H - 8, { steps: 4 });
    await p.mouse.up();
    check(await run(() => !!document.querySelector('#layer > .backdrop')), 'pressed on «Далі», released on the backdrop: the dialog stays');
    await p.mouse.click(8, pos.H - 8);
    check(await run(() => !document.querySelector('#layer > .backdrop')), 'pressed and released on the backdrop: it closes');
    await w(400);

    step('steps: forward, back and a fade keep the top edge' + at);
    r = await run(async () => {
      const out = {}, d = window.d = T.dialog();
      await T.wait(260);
      const top = () => Math.round(d.m.box.getBoundingClientRect().top * 10) / 10;
      out.top0 = top();
      const tops = [];
      const looking = (async () => { for (let i = 0; i < 40; i++) { tops.push(top()); await T.frame(); } })();
      d.m.show(T.screen('Грати разом', 2, [T.option('Через посилання'), T.option('Поруч, без інтернету'), T.h('button', { className: 'btn ghost', type: 'button', textContent: 'Закрити' })]), { dir: 'fwd' });
      out.fwd = T.stepOf(d.m);
      out.kept = d.m.box.contains(document.activeElement);
      await T.wait(150);
      d.m.show(...T.screen('Через посилання', 5, [T.h('input', { className: 'link', readOnly: true, value: 'https://ihroteka/?room=k7q2m9xd' })]), { dir: 'back' });
      out.back = T.stepOf(d.m);
      await T.wait(150);
      d.m.show(...T.screen('Ви граєте разом', 1), { dir: 'fade' });
      out.fade = T.stepOf(d.m);
      await T.wait(150);
      const own = T.h('div', { className: 'step' }, ...T.screen('Ви граєте разом', 2));   // (a step made by the caller, invite.js)
      d.m.show(own);
      out.own = { same: d.m.box.firstElementChild === own && d.m.box.children.length === 1, names: own.getAnimations().map(a => a.animationName) };
      await looking;
      out.tops = [...new Set(tops)];
      out.stable = tops.every(t => Math.abs(t - out.top0) < 0.6);
      d.m.close();
      await T.wait(500);
      out.left = T.running();
      return out;
    });
    check(r.fwd.wrapped && r.fwd.names.includes('ihk-fwd'), 'show([…], { dir: \'fwd\' }): one .step that enters forward (ihk-fwd)', r.fwd);
    check(r.back.wrapped && r.back.names.includes('ihk-back'), 'show(…nodes, { dir: \'back\' }): enters backward (ihk-back)', r.back);
    check(r.fade.wrapped && r.fade.names.includes('ihk-fade'), 'show(…nodes, { dir: \'fade\' }): a state, it fades in', r.fade);
    check(r.own.same && !r.own.names.length, 'show(step): a .step the caller made is shown as it is (not wrapped again, no entry of dom.js\'s)', r.own);
    check(r.kept, 'the field that went: the dialog itself keeps the focus', r);
    check(r.stable, '(h) the dialog\'s top edge stays through every step (nothing re-centres)', { top0: r.top0, tops: r.tops });
    check(!r.left.length, '(d) within 500 ms of closing nothing runs', r.left);

    step('notes: they rise in, live by their length, never one over another, said once' + at);
    r = await run(async () => {
      const out = {}, c = D.toasts();
      const A = 'Одне місце звільнилося', B = 'У друга новіша версія — онови сторінку, коли буде інтернет.';
      const C = 'Немає інтернету на цьому пристрої — чекаємо, поки зв’язок повернеться… Кімнату поруч тримав телефон, на якому грає Аня.';
      const t0 = performance.now(), gone = {}, added = [];
      new MutationObserver(l => { for (const m of l) { for (const n of m.removedNodes) gone[n.textContent] = Math.round(performance.now() - t0); for (const n of m.addedNodes) added.push(n.textContent); } })
        .observe(c, { childList: true });
      D.toast(C); D.toast(B); D.toast(A);
      out.entry = [...c.children].map(t => t.getAnimations().map(a => a.animationName).join());
      let over = 0, glided = 0, again = false;
      const meet = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
      while (performance.now() - t0 < 6700) {
        if (!again && performance.now() - t0 > 1500) { again = true; D.toast(A); out.once = c.children.length; }
        const rs = [...c.children].map(t => t.getBoundingClientRect());
        for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (meet(rs[i], rs[j])) over++;
        if ([...c.children].some(t => t.getAnimations().some(T.glide))) glided++;
        await T.frame();
      }
      Object.assign(out, { gone, added, over, glided, want: { [A]: 1500 + 2600, [B]: 2600 + ([...B].length - 24) * 60, [C]: 6000 } });
      out.region = [c.getAttribute('role'), c.getAttribute('aria-live'), c.getAttribute('aria-atomic')].join();
      return out;
    });
    check(r.entry.every(n => n.includes('ihk-in')), 'each note rises in (ihk-in)', r.entry);
    const late = Object.entries(r.want).map(([k, v]) => [k.slice(0, 12), v, r.gone[k]]).filter(([, v, g]) => !(g >= v - 60 && g <= v + 400));
    check(!late.length, 'each lives by its length: 2.6 s; 60 ms more per letter over 24; 6 s at most; the same one again only longer', { late, gone: r.gone, want: r.want });
    check(r.once === 3 && r.added.length === 3, '… shown once, and said once (the column only ever had each note added once)', { added: r.added, once: r.once });
    check(r.over === 0, 'never one over another (every frame)', r.over);
    check(r.glided > 0, 'when one goes, the notes above it glide down', r.glided);
    check(r.region === 'status,polite,false', 'one live region that reads each new note by itself', r.region);

    step('a fourth note: the oldest goes at once, as a ghost' + at);
    r = await run(async () => {
      const c = D.toasts();
      D.toast('Тепер вас 3'); D.toast('Тепер вас 4'); D.toast('Тепер вас 5');
      const before = T.ghosts().length;
      D.toast('Друг вийшов. Посилання діє далі — чекаю…');
      const g = T.ghosts().filter(x => x.classList.contains('toast'));
      return { left: [...c.children].map(t => t.textContent), ghosts: g.map(x => x.textContent), before, safe: g.every(T.safe), entry: c.lastElementChild.getAnimations().map(a => a.animationName) };
    });
    check(r.left.join('|') === 'Тепер вас 4|Тепер вас 5|Друг вийшов. Посилання діє далі — чекаю…', 'three at most: the oldest left the column at once', r);
    check(r.ghosts.includes('Тепер вас 3') && r.safe, '… and fades as a ghost (aria-hidden, inert, untouchable)', r);
    check(r.entry.includes('ihk-in'), 'the new one rises in at the bottom', r);

    step('a tap takes a note away on the shelf and over a dialog, never over a game' + at);
    const centre = sel => run(s => { const t = [...document.querySelectorAll(s)].pop(); if (!t) return null; const k = t.getBoundingClientRect(); return { x: k.left + k.width / 2, y: k.top + k.height / 2 }; }, sel);
    await run(() => D.toast('Ви разом!'));
    let at0 = await centre('#layer > .toasts > .toast');
    check(await run(() => D.toasts().classList.contains('tappable')), 'on the shelf the notes can be tapped');
    await p.mouse.click(at0.x, at0.y);
    r = await run(() => ({ left: [...D.toasts().children].map(t => t.textContent), ghost: T.ghosts().some(g => g.textContent === 'Ви разом!') }));
    check(!r.left.includes('Ви разом!') && r.ghost, 'tapped on the shelf: it goes at once (its ghost fades)', r);
    await run(async () => { window.d = T.dialog(); await T.wait(260); D.toast('Зв’язок обірвався'); });
    at0 = await centre('#layer > .toasts > .toast');
    await p.mouse.click(at0.x, at0.y);
    r = await run(() => ({ left: [...D.toasts().children].map(t => t.textContent), open: !!document.querySelector('#layer > .backdrop'), focus: document.activeElement === window.d.input }));
    check(!r.left.includes('Зв’язок обірвався') && r.open && r.focus, 'over a dialog: tapped, it goes; the dialog stays, its field keeps the focus', r);
    await run(async () => { window.d.m.close(); document.getElementById('shelf').hidden = true; document.getElementById('stage').hidden = false; window.__under = 0; document.getElementById('under').onclick = () => window.__under++; await Promise.resolve(); D.toast('Чекаємо, поки повернеться Богдан…'); });
    at0 = await centre('#layer > .toasts > .toast');
    r = await run(([x, y]) => { const e = document.elementFromPoint(x, y); return { tappable: D.toasts().classList.contains('tappable'), hit: e && e.id }; }, [at0.x, at0.y]);
    await p.mouse.click(at0.x, at0.y);
    r.under = await run(() => window.__under);
    r.left = await run(() => [...D.toasts().children].map(t => t.textContent));
    check(!r.tappable && r.hit === 'under' && r.under === 1 && r.left.includes('Чекаємо, поки повернеться Богдан…'), 'over a game: the tap goes to the game, the note stays', r);
    r = await run(async () => { window.d = T.dialog(); await Promise.resolve(); const t = D.toasts().classList.contains('tappable'); window.d.m.close(); await Promise.resolve(); return { dialog: t, after: D.toasts().classList.contains('tappable') }; });
    check(r.dialog && !r.after, 'a dialog over the game: tappable while it is open, not once it closed', r);
    await w(6200);                                        // (the notes go)

    step('(g) never over the card «Чекаємо…»' + at);
    r = await run(async () => {
      const card = document.getElementById('waiting');
      const row = n => T.h('div', { className: 'wait-row' }, T.h('p', {}, 'Чекаємо, поки повернеться ' + n + '… ', T.h('span', { className: 'wait-time', textContent: '2:45' })),
        T.h('button', { className: 'btn ghost', type: 'button', textContent: 'Не чекати' }));
      const plan = { 2: () => D.toast('Ви разом!'), 6: () => D.toast('Тепер вас 3'), 10: () => { card.replaceChildren(row('Богдан')); card.hidden = false; },
        30: () => D.toast('Одне місце звільнилося'), 33: () => card.append(row('Віра')), 60: () => D.toast('У друга новіша версія — онови сторінку'),
        62: () => card.lastElementChild.remove(), 75: () => D.toast('Зв’язок обірвався'), 78: () => card.append(row('Віра')), 100: () => { card.hidden = true; } };
      const hits = [];
      let shown = 0;
      for (let f = 0; f < 125; f++) {
        await T.frame();
        if (!card.hidden) {
          shown++;
          const k = card.getBoundingClientRect();
          for (const t of document.querySelectorAll('#layer .toast, .ihk-fx > .toast')) {
            const q = t.getBoundingClientRect();
            if (q.bottom > k.top + 0.5 && q.top < k.bottom - 0.5 && q.right > k.left && q.left < k.right) hits.push([f, t.textContent.slice(0, 12), Math.round(q.bottom), Math.round(k.top)]);
          }
        }
        if (plan[f]) plan[f]();
      }
      return { hits: hits.slice(0, 8), n: hits.length, shown, cardH: getComputedStyle(document.getElementById('layer')).getPropertyValue('--card-h') };
    });
    check(r.shown > 60 && r.n === 0, 'sampled every frame while the card comes, grows and shrinks and notes come and go: no note on it', r);
    await run(() => { document.getElementById('stage').hidden = true; document.getElementById('shelf').hidden = false; });
    await w(6200);

    step('«Скопіювати»: the same width, «Скопійовано», back after 2 s (L-T14)' + at);
    r = await run(async () => {
      if (typeof D.copyButton !== 'function') return { missing: 'copyButton' };
      const d = window.d = T.dialog();
      await T.wait(260);
      const a = Object.assign(D.copyButton('Скопіювати', 'https://ihroteka/?room=k7q2m9xd'), { id: 'cp' });
      const z = T.h('button', { className: 'btn ghost', type: 'button', textContent: 'Скопіювати код', id: 'cp2', onclick: e => D.copy('КОД', e.target) });
      d.m.box.append(T.h('div', { className: 'row' }, a), z);
      return { w: [a.offsetWidth, z.offsetWidth], name: a.getAttribute('aria-label') };
    });
    check(!r.missing, 'dom.js copyButton(label, text): a copy button made with both its labels', r);
    if (!r.missing) {
      await p.click('#cp');
      await w(60);
      const s = await run(() => { const a = document.getElementById('cp'); return { w: a.offsetWidth, name: a.getAttribute('aria-label'), done: !!a.querySelector('.swap.done'), svg: !!a.querySelector('svg'), focus: document.activeElement === a, copied: window.__copied }; });
      check(s.w === r.w[0] && s.done && s.svg && s.name === 'Скопійовано' && s.copied === 'https://ihroteka/?room=k7q2m9xd', 'pressed: copied, «Скопійовано» with a drawn check, its name too, and the button keeps its width', { before: r, after: s });
      check(s.focus, '… and keeps the focus', s);
      await p.click('#cp2');
      await w(60);
      const z = await run(() => { const a = document.getElementById('cp2'); return { w: a.offsetWidth, name: a.getAttribute('aria-label'), done: !!a.querySelector('.swap.done'), copied: window.__copied }; });
      check(z.w === r.w[1] && z.done && z.name === 'Скопійовано' && z.copied === 'КОД', 'copy(text, e.target) on a button of one label: the same, the width kept', { before: r.w[1], after: z });
      await w(2100);
      const back = await run(() => ['cp', 'cp2'].map(id => { const a = document.getElementById(id); return { name: a.getAttribute('aria-label'), done: !!a.querySelector('.swap.done') }; }));
      check(back[0].name === 'Скопіювати' && back[1].name === 'Скопіювати код' && !back[0].done && !back[1].done, 'after 2 s each says its own label again', back);
    }
    await run(async () => { if (window.d) window.d.m.close(); await T.wait(300); });

    step('the password (L-T08): «Відмикаю…» in «Відкрити» after 300 ms, the error under the field' + at);
    r = await run(async () => {
      const out = {};
      window.__slow = 1500;
      window.__open = L.unlock({ id: 'demo', title: 'Демо' }).then(() => 'opened', e => e.cancelled ? 'cancelled' : 'failed: ' + (e.say || e.message));
      for (let i = 0; i < 300 && !document.querySelector('#layer .dialog input[type=password]'); i++) await T.frame();
      const box = document.querySelector('#layer .dialog'), f = box.querySelector('input[type=password]'), go = box.querySelector('button[type=submit]');
      const err = box.querySelector('.err'), line = box.querySelector('.busy');
      out.focus = document.activeElement === f;
      const F = Node.DOCUMENT_POSITION_FOLLOWING;
      out.slot = !!(f.compareDocumentPosition(err) & F) && !!(err.compareDocumentPosition(go) & F);
      await T.wait(260);
      const top0 = box.getBoundingClientRect().top;
      f.value = 'не-той-' + Math.random().toString(36).slice(2);
      const t0 = performance.now(), seen = [];
      f.form.requestSubmit();
      const look = () => ({ t: Math.round(performance.now() - t0), busy: go.classList.contains('is-busy') && go.getAttribute('aria-busy') === 'true', btn: go.textContent,
        line: line.textContent, lineH: Math.round(line.getBoundingClientRect().height), dashed: getComputedStyle(go).borderTopStyle === 'dashed', err: err.textContent,
        fade: err.getAnimations().map(a => a.animationName).join(), top: Math.round((box.getBoundingClientRect().top - top0) * 10) / 10 });
      while (performance.now() - t0 < 2300) { seen.push(look()); await T.frame(); }
      const at = ms => seen.filter(s => s.t >= ms[0] && s.t < ms[1]);
      out.first = seen[0];
      out.early = at([0, 280]);
      out.mid = at([450, 950]);                         // (a little after 300 ms and 1 s: a timer may come late on a busy machine)
      out.slow = at([1150, 1450]);
      out.answer = seen.find(s => s.err);
      out.end = seen[seen.length - 1];
      out.moved = seen.filter(s => s.top !== 0).length;
      out.invalid = f.getAttribute('aria-invalid');
      return out;
    });
    check(r.focus, 'the password field has the focus', r.focus);
    check(r.slot, 'the error\'s slot is under the field, before «Відкрити»', r.slot);
    check(r.first.line === 'Відмикаю…' && r.first.lineH <= 1, 'sent: «Відмикаю…» at once in the line for a screen reader, out of sight', r.first);
    check(r.early.length > 3 && r.early.every(s => !s.busy && !s.dashed && s.btn === 'Відкрити'), 'nothing to see for 300 ms: «Відкрити» as it was', r.early.slice(0, 3));
    check(r.mid.length > 3 && r.mid.every(s => s.busy && s.btn === 'Відмикаю…'), 'then «Відмикаю…» in «Відкрити», with aria-busy', r.mid.slice(0, 2));
    check(r.slow.length > 3 && r.slow.every(s => s.busy && s.line === 'Відмикаю… Це може тривати кілька секунд.' && s.btn === 'Відмикаю…'), 'after a second the line says «Відмикаю… Це може тривати кілька секунд.»; the button stays as it is', r.slow.slice(0, 2));
    check(!!r.answer && r.answer.err === 'Не той пароль.' && /ihk-fade/.test(r.answer.fade) && r.invalid === 'true', '«Не той пароль.» fades into its slot, the field marked invalid', { answer: r.answer, invalid: r.invalid });
    check(r.end.btn === 'Відкрити' && !r.end.busy && r.end.line === '', '«Відкрити» again, the line empty', r.end);
    check(r.moved === 0, 'the dialog\'s top edge never moved', r.moved);
    r = await run(async () => {
      window.__slow = 0;
      const box = document.querySelector('#layer .dialog'), f = box.querySelector('input[type=password]'), go = box.querySelector('button[type=submit]');
      let busy = false;
      const mo = new MutationObserver(() => { if (go.classList.contains('is-busy')) busy = true; });
      mo.observe(go, { attributes: true });
      f.value = 'не-той-' + Math.random().toString(36).slice(2);
      f.form.requestSubmit();
      for (let i = 0; i < 120 && box.querySelector('.err').textContent !== 'Не той пароль.'; i++) await T.frame();
      await T.wait(400);
      mo.disconnect();
      return { busy, err: box.querySelector('.err').textContent };
    });
    check(r.err === 'Не той пароль.' && !r.busy, 'a quick answer: no busy look at all', r);
    r = await run(async pw => {
      const box = document.querySelector('#layer .dialog'), f = box.querySelector('input[type=password]');
      f.value = pw;
      f.form.requestSubmit();
      let out = null;
      for (let i = 0; i < 600 && !out; i++) {
        if (!document.querySelector('#layer > .backdrop')) { const g = T.ghosts(); out = { ghosts: g.length, safe: g.length > 0 && g.every(T.safe), inert: document.getElementById('shelf').inert }; }
        else await T.frame();
      }
      out.open = await window.__open;
      return out;
    }, kr.pw);
    check(r.open === 'opened' && !r.inert && r.safe, 'the right password: the dialog goes at once, its ghost fades; the game opens', r);
    await ctx.close();
  }

  step('no inert (Safari before 15.5): a ghost has no tab stop, and a dialog keeps Tab over one');
  {
    const { ctx, p, run } = await unitPage(b, { viewport: { width: 390, height: 844 }, kr });
    await run(async () => { delete HTMLElement.prototype.inert; window.D = await import('./app/dom.js?noinert'); });
    const keys = {};
    for (const key of ['Tab', 'Shift+Tab']) {
      const g = await run(async () => {
        document.getElementById('together').focus();
        const d = T.dialog();
        await T.wait(260);
        d.close.click();
        const gs = T.ghosts(), stops = gs.flatMap(x => [x, ...x.querySelectorAll('*')]).filter(e => e.tabIndex >= 0);
        window.d = T.dialog();
        return { ghosts: gs.length, stops: stops.map(e => e.tagName + '.' + e.className) };
      });
      let inside = 0, ghost = 0, other = 0;
      for (let i = 0; i < 8; i++) {
        await p.keyboard.press(key);
        // (body: past the page's last stop, to the browser's own, as screens-unit allows)
        const k = await run(() => { const a = document.activeElement; return !a || a === document.body ? 'body' : a.closest('.ihk-fx') ? 'ghost' : a.closest('#layer .dialog') ? 'in' : 'other'; });
        if (k === 'in') inside++; else if (k === 'ghost') ghost++; else if (k !== 'body') other++;
      }
      await run(() => window.d.m.close());
      keys[key] = { ...g, inside, ghost, other };
    }
    check(Object.values(keys).every(k => k.ghosts > 0 && !k.stops.length), 'a ghost has nothing Tab can reach (no inert to say so)', keys);
    check(Object.values(keys).every(k => k.ghost === 0 && k.other === 0 && k.inside > 4), 'Tab and Shift+Tab stay in the new dialog over a fading ghost', keys);
    await ctx.close();
  }

  step('«менше руху» (j): nothing moves, fades of 120 ms at most');
  {
    const { ctx, run } = await unitPage(b, { viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', kr });
    const r = await run(async () => {
      const seen = new Map();
      const look = () => { for (const a of T.running()) seen.set(a.name + ' ' + a.on + ' ' + a.ms + (a.moves ? ' moves' : ''), a); };
      const d = T.dialog();
      for (let i = 0; i < 6; i++) { look(); await T.frame(); }
      d.m.show(T.screen('Через посилання', 2), { dir: 'fwd' });
      D.toast('Ви разом!'); D.toast('Тепер вас 3');
      for (let i = 0; i < 6; i++) { look(); await T.frame(); }
      D.toast('Одне місце звільнилося'); D.toast('Зв’язок обірвався');
      d.m.close();
      for (let i = 0; i < 12; i++) { look(); await T.frame(); }
      const all = [...seen.values()];
      return { all: [...seen.keys()], moving: all.filter(a => a.moves).length, long: all.filter(a => a.ms > 120).length };
    });
    check(r.all.length > 0 && r.moving === 0 && r.long === 0, 'a dialog, a step, notes and a close: only fades, none longer than 120 ms', r.all);
    await ctx.close();
  }

  step('motion off: today\'s DOM (no ghost, no step wrapper), the password line in sight');
  {
    const { ctx, run } = await unitPage(b, { viewport: { width: 390, height: 844 }, off: true, kr });
    const r = await run(async () => {
      const d = T.dialog(), out = {};
      out.kids = d.m.box.firstElementChild && d.m.box.firstElementChild.tagName;
      d.m.show(T.screen('Через посилання', 1), { dir: 'fwd' });
      out.step = d.m.box.firstElementChild && d.m.box.firstElementChild.tagName;
      d.m.close();
      D.toast('Ви разом!'); D.toast('Тепер вас 3'); D.toast('Одне місце звільнилося'); D.toast('Зв’язок обірвався');
      out.ghosts = T.ghosts().length;
      out.running = T.running().length;
      window.__slow = 600;
      L.unlock({ id: 'demo', title: 'Демо' }).catch(() => {});
      for (let i = 0; i < 300 && !document.querySelector('#layer .dialog input[type=password]'); i++) await T.frame();
      const box = document.querySelector('#layer .dialog'), f = box.querySelector('input[type=password]');
      f.value = 'не-той';
      f.form.requestSubmit();
      await T.wait(450);
      const line = box.querySelector('.busy'), go = box.querySelector('button[type=submit]');
      out.line = [line.textContent, Math.round(line.getBoundingClientRect().height) > 1];
      out.busy = go.classList.contains('is-busy');
      out.disabled = go.disabled;
      return out;
    });
    check(r.kids === 'H2' && r.step === 'H2', 'no .step wrapper: the dialog holds its nodes as today', r);
    check(r.ghosts === 0 && r.running === 0, 'no ghost, nothing running', r);
    check(r.line[0] === 'Відмикаю…' && r.line[1] && !r.busy && r.disabled, 'the password: «Відмикаю…» under the button as today, «Відкрити» unavailable meanwhile', r);
    await ctx.close();
  }

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const at = ' (' + viewport.width + '×' + viewport.height + ')';
    step('the library: «Грати разом» opens and closes' + at);
    const ctx = await b.newContext({ viewport, motion: true });
    const p = await openPage(ctx, 'aaaaaaaaaaaa');
    const r = await p.evaluate(async () => {
      const out = {}, t = document.getElementById('together');
      const field = () => !!document.activeElement && document.activeElement.matches('#layer .dialog input.link');
      t.click();
      await Promise.resolve();
      out.atOnce = field();
      await new Promise(f => requestAnimationFrame(() => f()));
      out.inFrame = field();
      await new Promise(f => setTimeout(f, 30));
      const close = [...document.querySelectorAll('#layer .dialog button')].find(x => x.textContent === 'Закрити');
      close.click();
      out.layer = !!document.querySelector('#layer > .backdrop');
      out.inert = document.getElementById('shelf').inert;
      const k = t.getBoundingClientRect(), hit = document.elementFromPoint(k.left + k.width / 2, k.top + k.height / 2);
      out.hit = !!hit && !!hit.closest('#together');
      const g = [...document.querySelectorAll('.ihk-fx > *')];
      out.ghosts = g.length;
      out.safe = g.every(x => x.getAttribute('aria-hidden') === 'true' && x.hasAttribute('inert') && getComputedStyle(x).pointerEvents === 'none' && !x.id && !x.hasAttribute('role') && !x.querySelector('[id],[role]'));
      await new Promise(f => setTimeout(f, 600));
      out.cleared = document.querySelectorAll('.ihk-fx > *').length;
      return out;
    });
    check(r.atOnce && r.inFrame, '(a) the name field has the focus at once', r);
    check(!r.layer && !r.inert && r.hit, '(b) «Закрити» during the entry: no #layer > .backdrop, the shelf live and hit at once', r);
    check(r.ghosts > 0 && r.safe && r.cleared === 0, '(c) a ghost fades, unheard and untouchable, gone within 600 ms', r);

    step('the library: name → menu → link keep the dialog\'s top edge (h)' + at);
    await p.click('#together');
    await p.waitForSelector('#layer .dialog input.link');
    await w(300);
    await p.evaluate(() => {
      window.__tops = [];
      const look = () => { const d = document.querySelector('#layer > .backdrop > .dialog'); if (d) window.__tops.push(Math.round(d.getBoundingClientRect().top * 10) / 10); if (!window.__stop) requestAnimationFrame(look); };
      look();
    });
    await p.fill('#layer .dialog input.link', 'Аня');
    await p.press('#layer .dialog input.link', 'Enter');
    await p.waitForSelector('#layer .dialog >> text=Через посилання', { timeout: 15000 });
    await w(300);
    await p.click('#layer .dialog >> text=Через посилання');
    await p.waitForSelector('#layer canvas.qr', { timeout: 15000 });
    await w(300);
    const tops = await p.evaluate(() => { window.__stop = true; return [...new Set(window.__tops)]; });
    check(tops.length === 1, 'the top edge, every frame from the name to the link: one value', tops);
    await ctx.close();
  }
}, { timeout: 240000 });
