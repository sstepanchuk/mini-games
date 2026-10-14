// tags: @ci @webkit
// screens-unit: library/app/screens.js and dom.js modal() on their own, in one page made here (page.route on the
// dev server's origin: the page and the library's own modules, read from disk) with a same-origin srcdoc frame as the
// game (no scripts in it: this page drives it). Each case takes a fresh screens.js (attachScreens, waitScreen, show
// as invite.js calls them) and asks whether the game's copy holds the rows (seen) or the card would say them: hidden
// by display, visibility or opacity (on today's engine, one whose checkVisibility knows only the old option names,
// Chromium 105–120, and one without it, Safari before 17.4; opacity .5 is still seen), its pointer events off, scrolled
// out of the frame's view, covered, only its button covered (one out of view still counts), held while a library
// dialog is open, two copies, and the event after the rows are in place; a name that writes right to left, or carries
// direction controls, in an isolate of its own (the time's digits in order after it); copies connected, moved and dropped inside the
// browser's ResizeObserver delivery (from the game's own observer and from a 'showing' listener), pass after pass: the
// browser has no ResizeObserver loop to report (WebKit reports it as an error). Then the dialog's guards: a browser that
// knows no inert (Safari before 15.5) keeps Tab and Shift+Tab in the dialog, and a game that pulls the focus into its
// frame behind a dialog loses it back to the dialog (Escape still closes it). screens is the integration test.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { U, launch, scenario, check, step, until, w, watch } = require('./support/scenario.cjs');

const APP = path.join(__dirname, '..', '..', 'library', 'app'), AT = U + '__unit/';
const SERVED = ['screens.js', 'dom.js', 'waiting.js', 'style.css'];
const GAME = '<!doctype html><meta charset=utf-8><body style=\'margin:0;font:16px sans-serif\'><main id=game style=\'height:100vh;background:#eee\'>поле</main></body>';
const PAGE = `<!doctype html><html lang="uk"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="./style.css">
<body>
<p class="busy" id="busy" hidden></p>
<section class="shelf" id="shelf" hidden><button class="chip" id="opener" type="button">Грати разом</button><input id="behind" class="link"><button class="btn" type="button">Друга</button></section>
<section class="stage" id="stage"><iframe class="frame" id="f" srcdoc="${GAME}"></iframe></section>
<div id="layer"></div>
<script type="module">
import { screen } from './app/waiting.js';
const f = document.getElementById('f');
let S = null, n = 0;
// what the waiting screens say: Богдан dropped out, «Не чекати» (key: a new one says something else)
const model = (key = 'a') => key === 'none' ? screen(null) : { ...screen({ waits: [{ name: key === 'a' ? 'Богдан' : 'Віра', left: 150000, why: 'link', release: true }] }) };
window.U = {
  // a fresh screens.js on a clean game page (its style stays: injected once per document)
  async fresh() {
    if (S) S.detachScreens();
    S = await import('./app/screens.js?' + ++n);
    const d = f.contentDocument;
    d.body.replaceChildren(Object.assign(d.createElement('main'), { id: 'game', textContent: 'поле', style: 'height:100vh;background:#eee' }));
    f.contentWindow.scrollTo(0, 0);
    S.initScreens(() => {});
    S.attachScreens(f.contentWindow);
    return true;
  },
  // a copy, in a layer of its own over the field (fixed, at the top) unless asked into the page's flow; → the copy
  add({ layer = '', style = '', flow = false, first = false } = {}) {
    const d = f.contentDocument, c = d.createElement('ihroteka-wait');
    c.style.cssText = style;
    if (flow) d.body[first ? 'prepend' : 'append'](c);
    else {
      const l = d.createElement('div');
      l.className = 'layer';
      l.style.cssText = 'position:fixed;left:0;right:0;top:40px;z-index:5;padding:8px;background:#fff;' + layer;
      l.append(c);
      d.body[first ? 'prepend' : 'append'](l);
    }
    S.waitScreen(c, true);
    return c;
  },
  drop(c) { c.remove(); S.waitScreen(c, false); },
  // a copy put (back) into parent, as the element's connected callback says it (a move: drop, then put)
  put(c, parent, first = false) { parent[first ? 'prepend' : 'append'](c); S.waitScreen(c, true); return c; },
  // the passes come by themselves, as invite.js runs them when screens.js asks (soon): each one with what fn says
  passes(fn) { S.initScreens(() => S.show(model(fn()), { release: () => {}, repair: () => {}, update: () => {} })); },
  // the pass: whether a copy holds the rows (then the card says nothing)
  show(key = 'a') { return S.show(model(key), { release: () => {}, repair: () => {}, update: () => {} }); },
  state() { return S.state(); },
  // a link row for this name, in the copy that holds it: its line as read and the text the row says, the names
  // isolated in it, where each digit of its time stands and the right edge of the name (left to right, px)
  named(n) {
    const m = screen({ waits: [{ name: n, left: 150000, why: 'link', release: true }] });
    const held = S.show(m, { release: () => {}, repair: () => {}, update: () => {} });
    const c = [...f.contentDocument.querySelectorAll('ihroteka-wait')].find(x => x.firstElementChild);
    const p = c && c.querySelector('.wait-row p'), t = p && p.querySelector('.wait-time');
    if (!t) return { held };
    const d = p.ownerDocument, box = (node, a, b) => { const r = d.createRange(); r.setStart(node, a); r.setEnd(node, b); return r.getBoundingClientRect(); };
    const xs = [];
    for (let i = 0; i < t.firstChild.length; i++) if (/\\d/.test(t.firstChild.data[i])) xs.push(Math.round(box(t.firstChild, i, i + 1).left));
    // the name as the row shows it, wherever it stands in the line's text (its characters' boxes, together)
    const shown = n.replace(/\\p{Bidi_Control}/gu, ''), texts = [], tw = d.createTreeWalker(p, 4);
    for (let x = tw.nextNode(); x; x = tw.nextNode()) if (!t.contains(x)) texts.push(x);
    let all = '', right = null;
    const starts = texts.map(x => { const s = all.length; all += x.data; return s; }), at = all.indexOf(shown);
    if (at >= 0) for (let i = at; i < at + shown.length; i++) {
      let k = starts.length - 1;
      while (starts[k] > i) k--;
      right = Math.max(right ?? -Infinity, box(texts[k], i - starts[k], i - starts[k] + 1).right);
    }
    return { held, line: p.textContent, text: m.rows[0].text, isolated: [...p.querySelectorAll('bdi')].map(b => b.textContent), xs, nameRight: right && Math.round(right) };
  },
  // the game's engine, as old browsers have it: 'today', 'old names' (checkVisibility knows only checkOpacity and
  // checkVisibilityCSS: Chromium 105–120), 'none' (no checkVisibility: Safari before 17.4)
  engine(kind) {
    const P = f.contentWindow.Element.prototype;
    if (!U.cv) U.cv = P.checkVisibility || null;
    const cv = U.cv;
    if (kind === 'none' || !cv) delete P.checkVisibility;
    else if (kind === 'old names') P.checkVisibility = function (o) { return cv.call(this, o ? { checkOpacity: !!o.checkOpacity, checkVisibilityCSS: !!o.checkVisibilityCSS } : undefined); };
    else P.checkVisibility = cv;
    return !!cv;
  },
  // a fixed div over a rect of the game's page
  cover(r) {
    const d = f.contentDocument, c = d.createElement('div');
    c.className = 'cover';
    c.style.cssText = 'position:fixed;z-index:99;background:#888;left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px;' + (r.css || '');
    d.body.append(c);
    return c;
  }
};
window.ok = true;
</script>`;

scenario('screens-unit: which copy is seen, and the dialog\'s guards', async () => {
  const b = await launch(), ctx = await b.newContext({ viewport: { width: 360, height: 640 } });
  await ctx.route(AT + '**', r => {
    const u = new URL(r.request().url()), rel = u.pathname.slice(new URL(AT).pathname.length);
    if (rel === '') return r.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE });
    const name = rel.replace(/^app\//, '');
    if (!SERVED.includes(name)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ contentType: (name.endsWith('.css') ? 'text/css' : 'text/javascript') + '; charset=utf-8', body: fs.readFileSync(path.join(APP, name), 'utf8') });
  });
  const p = watch(await ctx.newPage(), 'unit');
  await p.goto(AT);
  await p.waitForFunction(() => window.ok && document.getElementById('f').contentDocument?.getElementById('game'));
  const run = (fn, arg) => p.evaluate(fn, arg);

  step('hidden, transparent, without pointer events');
  let r = await run(async () => {
    const out = {};
    await U.fresh(); let c = U.add({ style: 'display:none' });
    out.none = U.show(); c.style.display = ''; out.shown = U.show();
    await U.fresh(); c = U.add({ layer: 'visibility:hidden' });
    out.hidden = U.show(); c.parentElement.style.visibility = 'visible'; out.visible = U.show();
    await U.fresh(); c = U.add({ style: 'pointer-events:none' });
    out.noPointer = U.show();
    await U.fresh(); c = U.add(); U.show();
    const rc = c.getBoundingClientRect();
    U.cover({ left: rc.left, top: rc.top, width: rc.width, height: rc.height, css: 'pointer-events:none;opacity:.3' });
    out.through = U.show();
    return out;
  });
  check(!r.none && r.shown, 'display:none: unseen (the card says it); shown: the copy holds the rows', r);
  check(!r.hidden && r.visible, 'a layer with visibility:hidden: unseen; visible again: seen', r);
  check(!r.noPointer, 'the copy\'s pointer events off (its buttons cannot be pressed): unseen', r);
  check(r.through, 'a layer over it that lets the pointer through (a game\'s effects): seen', r);

  step('opacity on every engine (screens-08)');
  r = await run(async () => {
    const out = {};
    for (const kind of ['today', 'old names', 'none']) {
      for (const [k, layer] of [['zero', 'opacity:0'], ['half', 'opacity:.5'], ['zeroOwn', '']]) {
        await U.fresh();
        U.add({ layer, style: k === 'zeroOwn' ? 'opacity:0' : '' });
        out.has = U.engine(kind);
        out[kind + ' ' + k] = U.show();
        U.engine('today');
      }
    }
    // (an engine whose own checkVisibility does not know the old names cannot stand in for Chromium 105–120)
    const t = f => { const d = document.getElementById('f').contentDocument, x = d.createElement('div'); x.style.opacity = '0'; d.body.append(x); const v = f(x); x.remove(); return v; };
    out.oldNamesKnown = !!U.cv && t(x => U.cv.call(x, { checkOpacity: true }) === false);
    return out;
  });
  check(!r['today zero'] && !r['today zeroOwn'] && r['today half'], 'today\'s checkVisibility: a copy in an opacity:0 layer (or of its own) unseen; opacity .5 seen', r);
  if (r.oldNamesKnown) check(!r['old names zero'] && !r['old names zeroOwn'] && r['old names half'], 'checkVisibility with the old option names only (Chromium 105–120): the same', r);
  else console.log('  (this engine\'s checkVisibility knows no checkOpacity: no stand-in for Chromium 105–120)');
  check(!r['none zero'] && !r['none zeroOwn'] && r['none half'], 'no checkVisibility (Safari before 17.4): the same', r);

  step('out of view, covered, only the button covered (screens-07)');
  r = await run(async () => {
    const out = {}, W = document.getElementById('f').contentWindow;
    // (in the page's flow under the field, and as much again under it: an empty copy takes no room)
    await U.fresh(); let c = U.add({ flow: true });
    W.document.body.append(Object.assign(W.document.createElement('div'), { style: 'height:100vh' }));
    out.below = U.show(); W.scrollTo(0, W.innerHeight / 2); out.scrolled = U.show();   // (the field still in view: it anchors the scroll)
    await U.fresh(); c = U.add();
    const cover = U.cover({ left: 0, top: 0, width: W.innerWidth, height: W.innerHeight });
    out.covered = U.show(); cover.remove(); out.uncovered = U.show();
    // only «Не чекати»: from 1 px below the row's centre if it spans it, the line still on top
    const row = c.querySelector('.wait-row').getBoundingClientRect(), bt = c.querySelector('button').getBoundingClientRect();
    const cx = row.left + row.width / 2, cy = row.top + row.height / 2, top = Math.max(bt.top, bt.right > cx && bt.left < cx ? cy + 1 : bt.top);
    const part = U.cover({ left: bt.left, top, width: bt.width, height: bt.bottom - top });
    const on = (x, y) => { const e = W.document.elementFromPoint(x, y); return !!e && c.contains(e); };
    out.line = on(cx, cy); out.button = on(bt.left + bt.width / 2, bt.top + bt.height / 2);
    out.buttonCovered = U.show(); part.remove(); out.buttonFree = U.show();
    // a button whose centre is out of the frame's view still counts (scrolling reaches it): the row's top in view
    await U.fresh(); c = U.add({ layer: 'top:auto;bottom:0;width:140px', style: 'transform:translateY(calc(100% - 30px))' });
    out.partly = U.show();
    const b2 = c.querySelector('button')?.getBoundingClientRect();
    out.buttonOut = !!b2 && b2.top + b2.height / 2 > W.innerHeight;
    return out;
  });
  check(!r.below && r.scrolled, 'out of the frame\'s view: unseen; scrolled into it: seen', r);
  check(!r.covered && r.uncovered, 'covered by a layer of the game\'s: unseen; uncovered: seen', r);
  check(r.line && !r.button, '(only «Не чекати» covered: the row\'s centre is still the copy\'s)', r);
  check(!r.buttonCovered && r.buttonFree, 'only «Не чекати» covered: unseen (it cannot be pressed: the card); uncovered: seen', r);
  check(r.buttonOut && r.partly, 'a button out of the frame\'s view (the row in it): still seen', r);

  step('a library dialog open; two copies; the event');
  r = await run(async () => {
    const out = {}, stage = document.getElementById('stage'), W = document.getElementById('f').contentWindow;
    await U.fresh(); let c = U.add();
    out.held = U.show();
    stage.inert = true;
    const cover = U.cover({ left: 0, top: 0, width: W.innerWidth, height: W.innerHeight });
    out.inertHeld = U.show() && U.state().holder === 0 && !!c.firstElementChild;
    stage.inert = false; out.after = U.show(); cover.remove();
    await U.fresh(); c = U.add();
    U.show();
    const c0 = U.add({ first: true });
    out.keeps = U.show() && U.state().holder === 1 && !c0.firstElementChild && !!c.firstElementChild;
    U.drop(c);
    out.takes = U.show() && U.state().holder === 0 && !!c0.firstElementChild;
    await U.fresh(); c = U.add();
    const heard = [];
    c.addEventListener('showing', () => heard.push((c.firstElementChild ? 'rows ' : 'empty ') + c.getAttribute('showing')));
    U.show('a'); U.show('a'); U.show('b'); U.show('none');
    out.heard = heard;
    return out;
  });
  check(r.held && r.inertHeld && !r.after, 'a library dialog open (the stage inert): the holder keeps the rows, covered or not; closed: looked at again', r);
  check(r.keeps && r.takes, 'two copies: the one that holds the rows keeps them; it gone: the other takes them', r);
  check(JSON.stringify(r.heard) === JSON.stringify(['rows link', 'rows link', 'empty null']), '`showing` heard when what is said changed, with the rows (and the attribute) in place', r.heard);

  step('names that write right to left, or carry direction controls (names-and-3plus-03): isolated, the time in order');
  r = await run(async () => {
    const out = {};
    for (const [k, n] of [['odd', 'Бо⁩‮гдан'], ['rtl', 'محمد'], ['plain', 'Богдан']]) { await U.fresh(); U.add({ layer: 'font-size:10px' }); out[k] = U.named(n); }
    return out;
  });
  const inOrder = x => x.xs && x.xs.length === 3 && x.xs.every((v, i) => !i || v > x.xs[i - 1]) && x.nameRight != null && x.nameRight <= x.xs[0];
  check(r.odd.held && inOrder(r.odd), 'a name with a stray isolate end and a right-to-left override: the time reads 2:30, after the name', r.odd);
  check(JSON.stringify(r.odd.isolated) === '["Богдан"]' && !/\p{Bidi_Control}/u.test(r.odd.line), 'that name without its controls, in an isolate of its own', r.odd);
  check(inOrder(r.rtl) && JSON.stringify(r.rtl.isolated) === '["محمد"]', 'a name written right to left (no controls): in an isolate, the time after it', r.rtl);
  check(inOrder(r.plain) && JSON.stringify(r.plain.isolated) === '["Богдан"]' && r.plain.line === r.plain.text + ' 2:30', 'an ordinary name reads exactly as the row says it', r.plain);

  // (CI, WebKit: «ResizeObserver loop completed with undelivered notifications» on a page of the template game; Chromium
  // dispatches the same error event, it only does not report it)
  step('a copy connected and moved from inside the game\'s own ResizeObserver and from a showing listener, many passes: no ResizeObserver loop');
  r = await run(async () => {
    const W = document.getElementById('f').contentWindow, d = W.document, loops = [], frame = () => new Promise(res => W.requestAnimationFrame(() => res()));
    const loop = e => { if (/ResizeObserver loop/.test(e.message || '')) loops.push(e.message); };
    W.addEventListener('error', loop); window.addEventListener('error', loop);
    await U.fresh();
    let k = 0, passes = 0;
    U.passes(() => { passes++; return ++k < 40 ? (k % 2 ? 'a' : 'b') : 'a'; });   // (a new key each pass for a while: the event each time)
    // the game: a deep node its own observer watches; each delivery it places a copy (now in a new layer, now in the
    // page's flow), moves one (the oldest, which may hold the rows), drops one; then it changes that node's size in its
    // next frame (never inside: that would be the game's own loop). A 'showing' listener moves copies too.
    const deep = d.getElementById('game').appendChild(d.createElement('section')).appendChild(d.createElement('div')).appendChild(d.createElement('div'));
    deep.style.cssText = 'height:12px;width:10px;background:#ccc';
    const copies = [U.add(), U.add({ flow: true })];
    let n = 0, moved = 0;
    const onShowing = e => {
      if (moved++ > 30) return;
      const c = e.currentTarget;
      if (!c.isConnected) return;
      const to = c.parentElement === d.body ? d.querySelector('.layer') || d.body : d.body;
      U.drop(c); U.put(c, to, moved % 2 === 0);
    };
    const watchOne = c => { c.addEventListener('showing', onShowing); return c; };
    copies.forEach(watchOne);
    const game = new W.ResizeObserver(() => {
      if (++n > 30) return;
      copies.push(watchOne(U.add({ flow: n % 3 === 0, first: n % 2 === 0 })));
      const old = copies.shift();
      U.drop(old); U.put(old, n % 2 ? d.body : d.querySelector('.layer') || d.body, n % 4 === 0);
      copies.push(old);
      if (copies.length > 4) U.drop(copies.shift());
      W.requestAnimationFrame(() => { deep.style.width = (10 + n) + 'px'; });
    });
    game.observe(deep);
    for (let i = 0; i < 90 && n <= 30; i++) await frame();
    for (let i = 0; i < 10; i++) await frame();
    game.disconnect();
    W.removeEventListener('error', loop); window.removeEventListener('error', loop);
    const out = { loops, deliveries: n, passes, moved, held: U.state().held, copies: U.state().copies };
    await U.fresh();                                       // (no passes by themselves after this)
    return out;
  });
  check(r.deliveries > 30 && r.moved > 10 && r.passes > 20, 'the game\'s observer placed and moved copies in 30 deliveries, a \'showing\' listener moved them, pass after pass', r);
  check(r.loops.length === 0, 'no ResizeObserver loop: the browser had nothing to report', r.loops);
  check(r.held, 'and a copy holds the rows', r);

  step('the dialog with no inert (Safari before 15.5): Tab and Shift+Tab stay in it');
  await run(() => { delete HTMLElement.prototype.inert; document.getElementById('stage').hidden = true; document.getElementById('shelf').hidden = false; });
  await run(async () => { window.D = await import('./app/dom.js?noinert'); });
  const keys = {};
  for (const key of ['Tab', 'Shift+Tab']) {
    await p.focus('#opener');
    await run(() => {
      const m = window.D.modal(), d = document;
      m.show(Object.assign(d.createElement('h2'), { textContent: 'Діалог' }), Object.assign(d.createElement('input'), { className: 'link' }),
        Object.assign(d.createElement('button'), { className: 'btn', textContent: 'Перша' }), Object.assign(d.createElement('button'), { className: 'btn ghost', textContent: 'Закрити', onclick: () => m.close() }));
    });
    await w(100);
    let behind = 0, inside = 0;
    for (let i = 0; i < 14; i++) {
      await p.keyboard.press(key);
      const k = await run(() => { const a = document.activeElement; return !a || a === document.body ? 'body' : a.closest('.dialog') ? 'in' : 'behind:' + (a.id || a.tagName); });
      if (k === 'in') inside++; else if (k !== 'body') behind++;
    }
    await p.keyboard.press('Escape');
    keys[key] = { behind, inside, closed: !(await p.$('.backdrop')), back: await run(() => document.activeElement && document.activeElement.id) };
  }
  check(Object.values(keys).every(k => k.behind === 0 && k.inside > 0), '14 Tab and 14 Shift+Tab presses never leave the dialog', keys);
  check(Object.values(keys).every(k => k.closed && k.back === 'opener'), 'Escape closes it, and the focus is back where it was', keys);

  step('a game that pulls the focus into its frame behind a dialog');
  await p.close();
  const p2 = watch(await ctx.newPage(), 'unit 2');
  await p2.goto(AT);
  await p2.waitForFunction(() => window.ok && document.getElementById('f').contentDocument?.getElementById('game'));
  await p2.evaluate(async () => {
    window.D = await import('./app/dom.js');
    const d = document.getElementById('f').contentDocument;
    const mine = d.body.appendChild(Object.assign(d.createElement('button'), { id: 'mine', textContent: 'Хід' }));
    mine.addEventListener('focus', () => { window.__pulled = true; });
    window.M = window.D.modal();
    window.M.show(Object.assign(document.createElement('h2'), { textContent: 'Діалог' }), Object.assign(document.createElement('button'), { className: 'btn', textContent: 'Гаразд' }));
    // the game's own focus(), 100 ms later (inert does not stop it)
    setTimeout(() => d.getElementById('mine').focus(), 100);
  });
  await w(150);
  const back = await until(() => p2.evaluate(() => window.M.box.contains(document.activeElement)), 1000, 50);
  const pulled = await p2.evaluate(() => !!window.__pulled);
  check(back, 'the dialog has the focus again' + (pulled ? ' (the game had pulled it into its frame)' : ' (this engine never let the game pull it)'),
    await p2.evaluate(() => document.activeElement.tagName + '.' + document.activeElement.className));
  await p2.keyboard.press('Escape');
  check(await until(async () => !(await p2.$('.backdrop')), 1000, 50), 'Escape closes it');
}, { timeout: 120000 });
