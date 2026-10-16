// Motion (library/app/motion.js and library/app/style.css; the UX spec's rules): «менше руху» redefines every keyframe
// that moves into one that does not; no var() inside @keyframes (Safari 15); an entry starts at opacity .01, never 0;
// durations of 240 ms at most (the owner's holds live in JS, later()); the html[data-motion=off] switch the tests use;
// style.css reads the tokens with fallbacks (its first paint is before motion.js). Then the pure parts of motion.js on
// a small stand-in DOM: mode() read live, later(), the off switch (every helper at once, in the call, and nothing
// made), what a ghost keeps and strips, busy()/free() timing, install() and the focus ring's modality.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as M from '../library/app/motion.js';

const STYLE = fs.readFileSync(fileURLToPath(new URL('../library/app/style.css', import.meta.url)), 'utf8');
const CSS = { 'MOTION_CSS': M.MOTION_CSS, 'style.css': STYLE };
const REDUCE = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)\s*\{/g;

/* ---------- a small CSS reader: comments out, blocks by brace depth ---------- */
const bare = css => css.replace(/\/\*[\s\S]*?\*\//g, '');
// the body of the block that opens at css[open] ('{'), and where it ends
function block(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
  }
  throw new Error('unbalanced braces at ' + open);
}
// every @keyframes: { name, body, reduced: inside a prefers-reduced-motion block }
function keyframes(css) {
  css = bare(css);
  const reduced = [];
  for (const m of css.matchAll(REDUCE)) { const b = block(css, m.index + m[0].length - 1); reduced.push([m.index, b.end]); }
  return [...css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)].map(m => ({
    name: m[1], body: block(css, m.index + m[0].length - 1).body, reduced: reduced.some(([a, b]) => m.index > a && m.index < b)
  }));
}
// [property, value] of every declaration (selectors and at-rules aside)
const declarations = css => [...bare(css).matchAll(/([\w-]+)\s*:\s*([^;{}]+)/g)].map(m => [m[1], m[2].trim()]);
const ms = t => /ms$/.test(t) ? parseFloat(t) : parseFloat(t) * 1000;
// a value's comma-separated layers (commas inside var(), cubic-bezier() stay), and the times in one (easings aside)
function layers(v) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of v) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && !depth) { out.push(cur); cur = ''; } else cur += ch;
  }
  return [...out, cur];
}
const times = layer => [...layer.replace(/(cubic-bezier|steps)\([^)]*\)/g, '').matchAll(/(?<![\w.-])(\d*\.?\d+m?s)\b/g)].map(m => ms(m[1]));

test('«менше руху»: every keyframe that moves is redefined without a move inside prefers-reduced-motion', () => {
  for (const [file, css] of Object.entries(CSS)) {
    const all = keyframes(css), moving = all.filter(k => !k.reduced && /transform|translate|scale|rotate/.test(k.body));
    if (file === 'MOTION_CSS') assert.ok(moving.length >= 10, 'MOTION_CSS has its moving keyframes');
    for (const k of moving) {
      const calm = all.filter(r => r.reduced && r.name === k.name);
      assert.ok(calm.length, file + ': @keyframes ' + k.name + ' moves, and «менше руху» does not redefine it');
      for (const r of calm) assert.doesNotMatch(r.body, /transform|translate|scale|rotate/, file + ': ' + k.name + ' still moves under «менше руху»');
    }
  }
});

test('no var() inside @keyframes (Safari 15 ignores it there); an entry starts at opacity .01, never 0', () => {
  for (const [file, css] of Object.entries(CSS)) {
    for (const k of keyframes(css)) {
      assert.doesNotMatch(k.body, /var\(/, file + ': @keyframes ' + k.name + ' reads a var()');
      const from = k.body.match(/(?:^|[},])\s*(?:from|0%)\s*(?:,[^{]*)?\{([^}]*)\}/);
      if (from) assert.doesNotMatch(from[1], /opacity\s*:\s*0(?:\.0*)?\s*(?:;|$)/, file + ': @keyframes ' + k.name + ' starts at opacity 0 (screens.js seen() would take it for unseen)');
    }
  }
});

test('durations: the tokens and every transition or animation in CSS at most 240 ms (spinners aside)', () => {
  const tokens = [...M.MOTION_CSS.matchAll(/--m-[\w-]+\s*:\s*([\d.]+m?s)/g)].map(m => ms(m[1]));
  assert.ok(tokens.length >= 5, 'MOTION_CSS has its duration tokens');
  for (const t of tokens) assert.ok(t <= 240, 'a token of ' + t + ' ms');
  for (const [file, css] of Object.entries(CSS)) {
    for (const [prop, value] of declarations(css)) {
      if (!/^(transition|animation)(-duration)?$/.test(prop)) continue;
      for (const layer of layers(value)) {
        if (/\binfinite\b/.test(layer)) continue;               // a spinner turns while something runs: not a transition
        // the first time of a layer is its duration (a var()'s fallback counts); a second one is a delay
        const t = times(layer);
        if (t.length) assert.ok(t[0] <= 240, file + ': ' + prop + ':' + value + ' lasts ' + t[0] + ' ms');
      }
    }
  }
});

test('the switch the tests use: html[data-motion=off] makes every animation and transition instant', () => {
  const off = bare(M.MOTION_CSS).match(/:root\[data-motion=off\]\s*\*[^{]*\{([^}]*)\}/);
  assert.ok(off, 'MOTION_CSS has the data-motion=off block');
  for (const p of ['animation-duration', 'animation-delay', 'transition-duration', 'transition-delay']) {
    assert.match(off[1], new RegExp(p + '\\s*:\\s*0s\\s*!important'), p);
  }
  assert.match(M.MOTION_CSS, /^:where\(:root\)\{/, 'the tokens at zero specificity: any rule of the page wins');
  assert.match(M.MOTION_CSS, /:root\[data-input=pointer\] :focus-visible:not\(input,textarea,select\)\{outline-color:transparent\}/, 'the ring by modality');
});

test('style.css reads the motion tokens with a fallback (its first paint comes before motion.js)', () => {
  assert.doesNotMatch(STYLE, /var\(--m-[\w-]+\s*\)/, 'a var(--m-…) without its fallback');
  assert.match(STYLE, /var\(--m-[\w-]+\s*,/, 'style.css uses the tokens');
  assert.doesNotMatch(STYLE, /body:has\(/, 'no body:has() (Safari 15.0–15.3): every view stands at the top, no class needed');
});

/* ---------- a stand-in DOM: what motion.js touches, no more ---------- */
class ClassList {
  constructor(el) { this.el = el; }
  get list() { return (this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean); }
  contains(c) { return this.list.includes(c); }
  add(...c) { this.el.setAttribute('class', [...new Set([...this.list, ...c])].join(' ')); }
  remove(...c) { this.el.setAttribute('class', this.list.filter(x => !c.includes(x)).join(' ')); }
}
class El {
  constructor(doc, tag) {
    Object.assign(this, { ownerDocument: doc, localName: tag, attrs: new Map(), children: [], parentNode: null, style: {}, on: {}, rect: null, value: '', type: '', animations: [] });
    this.classList = new ClassList(this);
  }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  removeAttribute(k) { this.attrs.delete(k); }
  hasAttribute(k) { return this.attrs.has(k); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get inert() { return this.hasAttribute('inert'); }
  set inert(v) { if (v) this.setAttribute('inert', ''); else this.removeAttribute('inert'); }
  get childNodes() { return this.children; }
  get textContent() { return this.children.map(c => c.textContent).join(''); }
  set textContent(t) { this.replaceChildren(this.ownerDocument.createTextNode(t)); }
  append(...nodes) { for (let n of nodes) { if (typeof n === 'string') n = this.ownerDocument.createTextNode(n); n.remove(); n.parentNode = this; this.children.push(n); } }
  insertBefore(n, ref) { if (!ref) return this.append(n); n.remove(); n.parentNode = this; this.children.splice(this.children.indexOf(ref), 0, n); return n; }
  prepend(n) { this.insertBefore(n, this.children[0] || null); }
  replaceChildren(...nodes) { for (const c of [...this.children]) c.remove(); this.append(...nodes); }
  remove() { if (this.parentNode) { const s = this.parentNode.children; s.splice(s.indexOf(this), 1); this.parentNode = null; } }
  replaceWith(n) { const p = this.parentNode; p.insertBefore(n, this); this.remove(); }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n === this.ownerDocument.documentElement; }
  querySelectorAll(sel) { assert.equal(sel, '*'); const out = []; const walk = n => { for (const c of n.children) if (c instanceof El) { out.push(c); walk(c); } }; walk(this); return out; }
  cloneNode(deep) {
    const c = this.ownerDocument.createElement(this.localName);
    for (const [k, v] of this.attrs) c.attrs.set(k, v);
    Object.assign(c.style, this.style);
    c.type = this.type; c.value = this.getAttribute('value') || '';   // (a browser copies the attribute, not what was typed)
    if (deep) for (const k of this.children) c.append(k.cloneNode(true));
    return c;
  }
  getBoundingClientRect() { return this.rect || { left: 0, top: 0, width: 0, height: 0 }; }
  addEventListener(t, f, o) { (this.on[t] ??= []).push([f, o]); }
  removeEventListener(t, f) { this.on[t] = (this.on[t] || []).filter(([g]) => g !== f); }
  animate(frames, timing) { const a = { frames, timing, cancel() {} }; this.animations.push(a); return a; }
}
class Text {
  constructor(t) { this.data = t; this.parentNode = null; }
  get textContent() { return this.data; }
  remove() { El.prototype.remove.call(this); }
  cloneNode() { return new Text(this.data); }
}
function makeDoc({ reduced = false, motion = null, parent = null } = {}) {
  const media = { matches: reduced };
  const win = { on: {}, matchMedia: q => { assert.match(q, /prefers-reduced-motion:\s*reduce/); return media; },
    getComputedStyle: () => ({ animationName: 'none' }),
    addEventListener(t, f, o) { (this.on[t] ??= []).push([f, o]); },
    HTMLElement: { prototype: { inert: false } },        // (an engine with inert: no tab stops to take away)
    parent: null };
  win.parent = parent ? parent.win : win;
  const doc = { defaultView: win, on: {}, createElement: tag => new El(doc, tag), createTextNode: t => new Text(t), addEventListener: win.addEventListener };
  doc.documentElement = new El(doc, 'html');
  doc.head = new El(doc, 'head'); doc.body = new El(doc, 'body');
  doc.documentElement.append(doc.head, doc.body);
  if (motion) doc.documentElement.setAttribute('data-motion', motion);
  win.document = doc;
  return { doc, win, media, el: (tag, attrs = {}, ...kids) => { const e = doc.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; } };
}
const fire = (target, type, e = {}) => { for (const [f] of target.on[type] || []) f({ type, ...e }); };

test('mode(): off with no document or with data-motion=off; reduced as the system says, read live', () => {
  assert.equal(M.mode(), 'off', 'no DOM (Node, a worker tab of the tests): nothing to move');
  assert.equal(M.mode({}), 'off', 'a stand-in element with no document');
  const D = makeDoc(), e = D.el('div');
  D.doc.body.append(e);
  assert.equal(M.mode(e), 'full');
  assert.equal(M.mode(D.doc), 'full', 'a document too');
  D.media.matches = true;
  assert.equal(M.mode(e), 'reduced', 'read live: the setting changed while the page is open');
  D.doc.documentElement.setAttribute('data-motion', 'off');
  assert.equal(M.mode(e), 'off', 'the switch wins over the system setting');
});

test('later(): runs once after its time; the function it returns cancels it', async () => {
  let a = 0, b = 0;
  const stopA = M.later(20, () => a++), stopB = M.later(20, () => b++);
  assert.equal(typeof stopB, 'function');
  stopB();
  await new Promise(r => setTimeout(r, 60));
  assert.equal(a, 1); assert.equal(b, 0);
  stopA();                                               // (after it ran: nothing)
  assert.equal(a, 1);
});

test('off: every helper does its state at once, in the call, and makes no ghost, glide, flight or busy look', async () => {
  const D = makeDoc({ motion: 'off' }), box = D.el('div', { class: 'card', id: 'x' }), btn = D.el('button', { class: 'btn' }, 'Далі');
  box.rect = { left: 10, top: 20, width: 100, height: 50 };
  D.doc.body.append(box, btn);
  let n = 0;
  const p = M.play(box, 'ihk-in', { done: () => n++ });
  assert.equal(n, 1, 'play: done in the call'); assert.ok(p instanceof Promise);
  assert.equal(box.style.animation, undefined, 'play: no animation set');
  assert.equal(M.ghost(box, 'ihk-out'), null, 'ghost: none'); assert.equal(D.doc.body.children.length, 2, '… and no fx layer');
  M.fadeHide(box, { done: () => n++ });
  assert.ok(box.hidden, 'fadeHide: hidden in the call'); assert.equal(n, 2);
  let changed = false;
  M.flip([box], () => { changed = true; box.rect = { left: 10, top: 80, width: 100, height: 50 }; });
  assert.ok(changed, 'flip: the change runs'); assert.equal(box.animations.length, 0, '… with no glide');
  assert.equal(M.fly(box, { left: 0, top: 0, width: 50, height: 25 }, null, { done: () => n++ }), null, 'fly: no flight');
  assert.equal(n, 3, '… its done at once');
  M.busy(btn, 'Перевіряю інтернет…');
  await new Promise(r => setTimeout(r, 330));
  assert.equal(btn.textContent, 'Далі'); assert.ok(!btn.hasAttribute('aria-busy'), 'busy: no look');
  await M.free(btn);
});

test('ghost(): a copy in the fx layer with no ids, roles, names or tab stops, unheard and untouchable, gone by itself', async () => {
  const D = makeDoc();
  const pw = D.el('input', { id: 'pw', name: 'pw', type: 'password', 'aria-describedby': 'pw-err' });
  pw.type = 'password'; pw.value = 'секрет';
  const wait = D.el('ihroteka-wait', { class: 'wait' }, D.el('p', {}, 'Чекаємо…')), empty = D.el('ihroteka-wait', { class: 'wait' });
  const dialog = D.el('div', { class: 'dialog card', role: 'dialog', tabindex: '-1', 'aria-modal': 'true', id: 'dlg' },
    D.el('label', { for: 'pw' }, 'Пароль'), pw, D.el('p', { class: 'err', role: 'alert', id: 'pw-err', 'aria-live': 'polite' }),
    D.el('button', { class: 'btn', id: 'go', tabindex: '0' }, 'Відкрити'), D.el('iframe', { class: 'frame', src: 'x' }), wait, empty);
  dialog.style.animation = 'ihk-pop var(--m-in,200ms) both';
  const back = D.el('div', { class: 'backdrop' }, dialog);
  back.rect = { left: 0, top: 0, width: 390, height: 844 };
  D.doc.body.append(back);
  const g = M.ghost(back, 'ihk-fade-out', { inner: c => M.play(c.children[0], 'ihk-out', { keep: true }) });
  back.remove();                                          // (state first: the real one goes in the same task)
  assert.ok(g, 'a ghost');
  const fx = g.parentNode;
  assert.ok(fx && fx.parentNode === D.doc.body, 'in an fx layer of the page');
  assert.equal(fx.getAttribute('aria-hidden'), 'true');
  assert.equal(g.getAttribute('aria-hidden'), 'true', 'unheard');
  assert.ok(g.hasAttribute('inert'), 'inert');
  assert.equal(g.style.pointerEvents, 'none', 'no taps');
  assert.deepEqual([g.style.left, g.style.top, g.style.width, g.style.height], ['0px', '0px', '390px', '844px'], 'where it was');
  for (const n of [g, ...g.querySelectorAll('*')]) {
    for (const a of ['id', 'role', 'for', 'name', 'tabindex', 'aria-live']) assert.ok(!n.hasAttribute(a), n.localName + ' keeps ' + a);
  }
  const copy = g.querySelectorAll('*');
  assert.ok(!copy.some(n => n.localName === 'iframe'), 'no frame (a copy would load the game again)');
  assert.ok(!copy.some(n => n.localName === 'ihroteka-wait'), 'no <ihroteka-wait> (a copy would count as a waiting screen)');
  assert.ok(copy.some(n => n.textContent === 'Чекаємо…'), '… its rows still shown');
  const field = copy.find(n => n.localName === 'input');
  assert.equal(field.value, '••••••', 'a password: as many dots, not the password');
  assert.match(g.style.animation, /^ihk-fade-out /, 'it plays its exit');
  assert.match(g.children[0].style.animation, /^ihk-out /, 'the inner part its own (the entry it was playing is gone)');
  await new Promise(r => setTimeout(r, 450));
  assert.ok(!g.parentNode, 'gone when its exit is over (no animationend here: the timeout)');
  assert.equal(M.ghost(D.el('div'), 'ihk-out'), null, 'an element not on the page: none');
});

test('overlay(): a decoration of the caller\'s (a veil, a card in flight) in the fx layer, unheard and untouchable; none with motion off', async () => {
  const off = makeDoc({ motion: 'off' });
  let done = 0;
  assert.equal(M.overlay(off.el('div', { class: 'page-veil' }), { doc: off.doc, name: 'ihk-fade-out', done: () => done++ }), null, 'off: nothing made');
  assert.equal(off.doc.body.children.length, 0); assert.equal(done, 1, '… its done at once');
  const D = makeDoc(), veil = D.el('div', { class: 'page-veil' }), card = D.el('div', { class: 'open-card' });
  assert.equal(M.overlay(veil, { doc: D.doc, name: 'ihk-fade-out', duration: 'in' }), veil);
  assert.ok(veil.parentNode && veil.parentNode.getAttribute('class') === 'ihk-fx', 'in the fx layer');
  assert.equal(veil.getAttribute('aria-hidden'), 'true'); assert.ok(veil.hasAttribute('inert')); assert.equal(veil.style.pointerEvents, 'none');
  assert.match(veil.style.animation, /^ihk-fade-out var\(--m-in,200ms\) /, 'its animation, for the time asked');
  M.overlay(card, { doc: D.doc, at: { left: 16, top: 136, width: 358, height: 283 } });
  assert.deepEqual([card.style.position, card.style.left, card.style.top, card.style.width], ['absolute', '16px', '136px', '358px'], 'where it was asked to stand');
  const under = D.el('div', { class: 'page-veil' });
  M.overlay(under, { doc: D.doc, under: true });
  assert.equal(veil.parentNode.children[0], under, 'under: below what is in the fx layer already (a closing dialog\'s ghost fades over it)');
  await new Promise(r => setTimeout(r, 400));
  assert.ok(!veil.parentNode, 'gone after its animation'); assert.ok(card.parentNode, 'with no animation: the caller removes it');
});

test('fadeHide(): decorative, unheard while it fades, hidden at the end (and heard as before)', async () => {
  const D = makeDoc(), coach = D.el('p', { class: 'coach' });
  D.doc.body.append(coach);
  let done = 0;
  M.fadeHide(coach, { done: () => done++ });
  assert.equal(coach.getAttribute('aria-hidden'), 'true'); assert.ok(!coach.hidden, 'still there while it fades');
  await new Promise(r => setTimeout(r, 350));
  assert.ok(coach.hidden && done === 1 && !coach.hasAttribute('aria-hidden'), 'hidden at the end');
});

test('busy()/free(): the look only after 300 ms, then at least 500 ms; a quick answer shows nothing', () => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  try {
    const D = makeDoc(), btn = D.el('button', { class: 'btn' }, 'Далі');
    D.doc.body.append(btn);
    M.busy(btn, 'Перевіряю інтернет…');
    mock.timers.tick(299);
    assert.equal(btn.textContent, 'Далі', 'nothing before 300 ms');
    M.free(btn);
    mock.timers.tick(1000);
    assert.equal(btn.textContent, 'Далі'); assert.ok(!btn.classList.contains('is-busy'), 'a quick answer: no look at all');
    M.busy(btn, 'Перевіряю інтернет…');
    mock.timers.tick(300);
    assert.equal(btn.textContent, 'Перевіряю інтернет…', 'after 300 ms: in place, in the button');
    assert.ok(btn.classList.contains('is-busy')); assert.equal(btn.getAttribute('aria-busy'), 'true');
    assert.ok(btn.children.some(c => c.classList?.contains('spin') && c.getAttribute('aria-hidden') === 'true'), 'a ring, unheard');
    mock.timers.tick(100);
    let freed = false;
    M.free(btn, { done: () => { freed = true; } });
    mock.timers.tick(399);
    assert.ok(!freed && btn.classList.contains('is-busy'), 'shown 400 ms: stays to 500');
    mock.timers.tick(1);
    assert.ok(freed && !btn.classList.contains('is-busy') && !btn.hasAttribute('aria-busy'), 'then back');
    assert.equal(btn.textContent, 'Далі', 'with its own words');
  } finally { mock.timers.reset(); }
});

test('flip() and fly() move only with full motion; «менше руху» changes the state the same, with no glide', () => {
  const D = makeDoc(), row = D.el('div'), card = D.el('div');
  row.rect = { left: 0, top: 100, width: 200, height: 40 };
  card.rect = { left: 20, top: 300, width: 300, height: 200 };
  D.doc.body.append(row, card);
  M.flip([row], () => { row.rect = { left: 0, top: 140, width: 200, height: 40 }; });
  assert.equal(row.animations.length, 1, 'a glide');
  assert.equal(row.animations[0].frames[0].transform, 'translate(0px,-40px)', 'from where it was');
  assert.equal(row.animations[0].timing.duration, 240);
  const a = M.fly(card, { left: 10, top: 50, width: 150, height: 100 });
  assert.ok(a && /translate\(-10px,-250px\) scale\(0\.5\)/.test(card.animations[0].frames[0].transform), 'a flight from the tapped card');
  D.media.matches = true;
  let changed = false;
  M.flip([row], () => { changed = true; row.rect = { left: 0, top: 100, width: 200, height: 40 }; });
  assert.ok(changed && row.animations.length === 1, '«менше руху»: the change, no glide');
  assert.equal(M.fly(card, { left: 10, top: 50, width: 150, height: 100 }), null, '… and no flight');
});

test('install(): the vocabulary once, before the page\'s own styles; the off switch and the modality go into a game', () => {
  const lib = makeDoc(), own = lib.el('link', { rel: 'stylesheet', href: 'lib/ihroteka.css' });
  lib.doc.head.append(lib.el('meta', { charset: 'utf-8' }), own);
  lib.win.__ihrotekaMotion = 'off';
  M.install(lib.doc, lib.win);
  M.install(lib.doc, lib.win);
  const styles = lib.doc.head.children.filter(n => n.hasAttribute?.('data-ihroteka-motion'));
  assert.equal(styles.length, 1, 'once');
  assert.equal(lib.doc.head.children.indexOf(styles[0]), 1, 'before the page\'s stylesheet: its rules win');
  assert.equal(styles[0].textContent, M.MOTION_CSS);
  const html = lib.doc.documentElement;
  assert.equal(html.getAttribute('data-motion'), 'off', 'the tests\' switch (window.__ihrotekaMotion)');
  assert.ok(html.hasAttribute('data-ihroteka'));
  assert.equal(lib.win.on.pointerdown.length, 1, 'its listeners once');
  // a game, attached while its <head> is parsed: no stylesheet of its own yet
  const game = makeDoc({ parent: lib });
  game.doc.head.append(game.el('script'));
  fire(lib.win, 'pointerdown');
  M.install(game.doc, game.win);
  const gh = game.doc.documentElement;
  assert.ok(game.doc.head.children.some(n => n.hasAttribute?.('data-ihroteka-motion')), 'the vocabulary in the game too');
  assert.equal(gh.getAttribute('data-motion'), 'off', 'the library\'s switch, copied');
  assert.equal(gh.getAttribute('data-input'), 'pointer', 'the library\'s modality: a tap opened it, no ring');
  assert.ok(gh.hasAttribute('data-ihroteka'), 'html[data-ihroteka]: the game knows it is in the library before its body parses');
  assert.ok(game.doc.on.touchstart.some(([, o]) => o && o.passive), 'a passive touchstart (iPhones show :active)');
  // the modality, in either window, for both: a navigation key shows the ring, a pointer hides it, typing does not count
  fire(game.win, 'keydown', { key: 'Tab', target: { tagName: 'BUTTON' } });
  assert.equal(html.getAttribute('data-input'), 'key'); assert.equal(gh.getAttribute('data-input'), 'key');
  fire(game.win, 'pointerdown');
  fire(lib.win, 'keydown', { key: 'ArrowLeft', target: { tagName: 'INPUT' } });
  fire(lib.win, 'keydown', { key: ' ', target: { tagName: 'TEXTAREA' } });
  fire(lib.win, 'keydown', { key: 'Tab', target: { tagName: 'INPUT' }, ctrlKey: true });
  assert.equal(html.getAttribute('data-input'), 'pointer', 'keys in a field and shortcuts: still a pointer');
  fire(lib.win, 'keydown', { key: 'Enter', target: { tagName: 'BUTTON' } });
  assert.equal(gh.getAttribute('data-input'), 'key');
  const plain = makeDoc();
  M.install(plain.doc, plain.win);
  assert.ok(!plain.doc.documentElement.hasAttribute('data-motion'), 'motion stays on unless switched off');
});

test('ghost(): a part still entering (play) leaves from where its entry got to, not from full sight', () => {
  const D = makeDoc(), card = D.el('div', { class: 'waiting card' }, 'Чекаємо…'), note = D.el('div', { class: 'toast' }, 'Ви разом!');
  card.rect = { left: 12, top: 700, width: 366, height: 60 };
  note.rect = { left: 40, top: 600, width: 300, height: 44 };
  D.doc.body.append(card, note);
  D.win.getComputedStyle = el => ({ animationName: 'none', opacity: el === card ? '0.37' : '1' });
  M.play(card, 'ihk-in');                                // (its entry under way: 37 % in sight now)
  const g = M.ghost(card, 'ihk-out');
  assert.equal(g.style.opacity, '0.37', 'the copy starts as the card is seen now (its entry is not in the copy)');
  assert.equal(M.ghost(note, 'ihk-fade-out').style.opacity, undefined, 'one that plays nothing: its own look');
  M.stop(card);
});

test('tint(): a colour on a small element (a step under «менше руху»); settle(): glides end now; typeset(): the house fonts, capped', async () => {
  const D = makeDoc(), dot = D.el('i');
  D.doc.body.append(dot);
  const a = M.tint(dot, '#fffdf7', '#1b1a17');
  assert.deepEqual(a.frames, [{ backgroundColor: '#fffdf7' }, { backgroundColor: '#1b1a17' }], 'from the colour given to the one it ends on');
  assert.equal(a.timing.duration, 140, 'quick by default');
  assert.equal(M.tint(dot, '#f2b91b', '#fffdf7', { duration: 600, easing: 'ease-in' }).timing.easing, 'ease-in');
  D.media.matches = true;
  assert.equal(M.tint(dot, '#fffdf7', '#1b1a17').timing.easing, 'step-end', '«менше руху»: a step, not a fade');
  D.doc.documentElement.setAttribute('data-motion', 'off');
  assert.equal(M.tint(dot, '#fffdf7', '#1b1a17'), null, 'off: nothing');
  const E = makeDoc(), row = E.el('div');
  E.doc.body.append(row);
  row.rect = { left: 0, top: 100, width: 200, height: 40 };
  M.flip([row], () => { row.rect = { left: 0, top: 140, width: 200, height: 40 }; });
  let ended = 0;
  row.animations[0].finish = () => ended++;
  M.settle([row, null]);
  M.settle([row]);
  assert.equal(ended, 1, 'settle: its glide ends at once, once');
  const asked = [], t0 = Date.now();
  await M.typeset({ fonts: { load: f => { asked.push(f); return Promise.resolve([]); } } }, 5000);
  assert.ok(Date.now() - t0 < 1000 && asked.some(f => /500 .*"Inter Tight"/.test(f)) && asked.some(f => /700 .*Oswald/.test(f)), 'typeset: Inter Tight and Oswald, as soon as they are in');
  const t1 = Date.now();
  await M.typeset({ fonts: { load: () => new Promise(() => {}) } }, 40);
  assert.ok(Date.now() - t1 >= 35, 'fonts that never come: the cap');
  let first = false;
  await M.typeset({ fonts: { load: () => { assert.ok(first, 'after what it waits for first'); return Promise.resolve(); } } }, 5000, new Promise(r => setTimeout(() => { first = true; r(); }, 10)));
  await M.typeset(null, 10);
  await M.typeset({ fonts: { load: () => Promise.reject(new Error('no')) } }, 5000);
});
