// Small things every part of the library page uses.
import { flip, ghost, mode, play, settle } from './motion.js';

export const $ = id => document.getElementById(id);
export const root = new URL('../', import.meta.url);   // the site root (the bundle lives in lib/)
export const el = (tag, props, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
export const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.error(e); } };
export const btn = (text, onclick, className = 'btn') => el('button', { className, type: 'button', textContent: text, onclick });
export const para = (text, className = '') => el('p', { className, textContent: text });
// a line that says what went wrong, heard by a screen reader as it comes (empty: nothing to say)
export const errLine = (text = '') => el('p', { className: 'err', role: 'alert', textContent: text });
// a player's name inside a sentence: isolated (FSI … PDI), so that a name written right to left, or one with a
// direction mark of its own, never turns the rest of the line round (owner, decision 43)
export const iso = n => '\u2068' + String(n).replace(/\p{Bidi_Control}/gu, '') + '\u2069';

// A dialog over everything. Escape (the topmost dialog only), a tap outside it or close() closes it; onClose
// runs once. Focus moves into it and comes back where it was when it closes; the page behind is inert meanwhile.
// show(...nodes) or show([nodes], o), o last ({ dir }): what it shows now (focus on a node that went goes to the dialog
// itself, not to the page's <body>); focus(field): the field to have the focus (its text selected) instead of the
// dialog itself.
// Only a press that begins on the backdrop and ends there closes the dialog: one slid off a button onto it does not.
// Where the browser knows no inert (Safari before 15.5), the focus that leaves the topmost dialog is brought back to
// it; and a game's own focus() that pulls the focus into its frame behind the dialog (inert does not stop that, and
// the keys would go there, Escape too) loses it back to the dialog once the move is over (deferred: a refocus inside
// the window's blur leaves the keys going to the frame).
// A game on the whole screen (its frame in the browser's top layer) would cover the dialog, and while it is so the
// browser keeps the rest of the page inert, the dialog too: the dialog leaves fullscreen first and takes the focus
// once out of it (owner, decision 51).
// Motion (motion.js; the UX spec L-T16, L-T17, L-T19): state first. Open, the backdrop fades in and the dialog rises
// (ihk-pop) while it already has the focus; closed, it is gone at once (no #layer > .backdrop, nothing inert, the focus
// back) and its ghost fades, the dialog in it sinking from where its entry had got to. What show() shows is one .step
// (a .step the caller made is taken as it is) that enters as o.dir says: 'fwd' from the right, 'back' from the left,
// 'fade' (another state of the same place); none: at once. The dialog stands by its top edge (style.css): a step moves
// only its bottom edge, and one with a dir starts at its top (however far the one before was scrolled on a small
// phone). Motion off: the nodes as they are, no step and no ghost.
const behind = () => [$('boot'), $('busy'), $('shelf'), $('stage')].filter(Boolean);
const dialogs = () => $('layer').querySelectorAll('.backdrop');
// a library dialog is open (a ghost that fades is none)
export const dialogOpen = () => dialogs().length > 0;
const noInert = !!globalThis.HTMLElement && !('inert' in HTMLElement.prototype);   // (the worker tabs of the tests have no HTMLElement)
const STEPS = { fwd: 'ihk-fwd', back: 'ihk-back', fade: 'ihk-fade' };
const options = x => !!x && typeof x === 'object' && !('nodeType' in x);   // (show's last argument: not a node)
export function modal(onClose = () => {}) {
  const box = el('div', { className: 'dialog card', role: 'dialog', tabIndex: -1 }), back = el('div', { className: 'backdrop' }, box);
  box.setAttribute('aria-modal', 'true');
  const before = document.activeElement;
  let want = null;                                       // the field to focus (focus()), else the dialog itself
  const target = () => want && want.isConnected ? want : box;
  // (the focus there already, or on something else in the dialog: the player put it there)
  const landed = () => { const a = document.activeElement; return a === target() || (a !== box && box.contains(a)); };
  const focusIn = () => {
    if (!back.isConnected || landed()) return;
    const f = target();
    f.focus();
    if (f !== box && f.select) f.select();
  };
  // (out of fullscreen: tried each frame until it lands, as an engine may keep the page inert a moment longer)
  const land = (n = 10) => { focusIn(); if (n && back.isConnected && !landed()) requestAnimationFrame(() => land(n - 1)); };
  // the focus taken away (a game's own focus(); Chromium gives it back to the frame that was fullscreen): back where it
  // was in the dialog, or where the dialog wants it
  let last = null;
  box.addEventListener('focusin', e => { last = e.target; });
  const regain = () => { if (last && last !== box && box.contains(last)) last.focus(); else focusIn(); };
  const top = () => [...dialogs()].pop() === back;
  const onKey = e => { if (e.key === 'Escape' && top()) close(); };
  const onFocus = e => { if (top() && !back.contains(e.target)) box.focus(); };
  const guard = () => setTimeout(() => { if (back.isConnected && top() && document.activeElement && document.activeElement.tagName === 'IFRAME') regain(); });
  const close = () => {
    if (!back.isConnected) return;
    leave(back, box);                                    // (its ghost first: a copy of what shows)
    back.remove();
    removeEventListener('keydown', onKey);
    removeEventListener('blur', guard);
    if (noInert) document.removeEventListener('focusin', onFocus);
    if (!dialogs().length) for (const n of behind()) n.inert = false;
    tappable();
    if (before && before.isConnected && before.focus) before.focus();
    onClose();
  };
  queueMicrotask(focusIn);
  let down = null;                                       // what the last press began on
  back.addEventListener('pointerdown', e => { down = e.target; });
  back.addEventListener('click', e => { const from = down; down = null; if (e.target === back && from === back) close(); });
  addEventListener('keydown', onKey);
  addEventListener('blur', guard);
  if (noInert) document.addEventListener('focusin', onFocus);
  $('layer').append(back);
  for (const n of behind()) n.inert = true;
  tappable();
  play(back, 'ihk-fade');
  play(box, 'ihk-pop');
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().then(() => land(), () => {});
  const show = (...a) => {
    let o = {};
    if (Array.isArray(a[0])) { o = a[1] || {}; a = a[0]; }
    else if (options(a[a.length - 1])) o = a.pop();
    const had = box.contains(document.activeElement);
    if (mode(box) === 'off') box.replaceChildren(...a);
    else {
      const own = a.length === 1 && a[0] && a[0].classList && a[0].classList.contains('step');
      const step = own ? a[0] : el('div', { className: 'step' }, ...a);
      box.replaceChildren(step);
      if (STEPS[o.dir]) play(step, STEPS[o.dir], o.dir === 'fade' ? { duration: 'quick' } : {});
    }
    if (STEPS[o.dir]) box.scrollTop = 0;                 // (a new screen starts at its top: its heading in sight)
    if (had && !box.contains(document.activeElement)) box.focus();
  };
  return { box, close, show, focus: f => { want = f; queueMicrotask(focusIn); } };
}
// The ghost of a dialog that closed: the backdrop fades, the dialog in it sinks 6 px (ihk-out), each from where its
// entry had got to (closed while it still rose: no flash to full), the dialog scrolled as it was.
function leave(back, box) {
  if (mode(back) === 'off') return;
  const cs = n => getComputedStyle(n);
  const was = { back: cs(back).opacity, box: cs(box).opacity, move: cs(box).transform, top: box.scrollTop, under: back.scrollTop };
  ghost(back, 'ihk-fade-out', { inner: c => {
    const d = c.querySelector('.dialog');
    c.style.opacity = was.back;
    c.scrollTop = was.under;
    if (!d) return;
    d.removeAttribute('aria-modal');
    d.style.opacity = was.box;
    if (was.move && was.move !== 'none') d.style.transform = was.move;
    d.scrollTop = was.top;
    play(d, 'ihk-out', { keep: true });
  } });
}

// Short notes at the bottom of the screen (owner, decision 40, and the UX round's Q4): one above the other, never one
// over another; at most TOASTS (the oldest goes), and the same one again while it shows only shows longer. Each lives by
// its length: 2.6 s, 60 ms more per letter over 24, 6 s at most. Their column (#layer > .toasts) is one live region,
// there before it says anything (toasts(): invite.js makes it as the page starts), that reads each new note by itself
// (not atomic, as a status region would be: the notes still on the screen are not read again; one shown longer changes
// nothing in it). Motion: a note rises in (those above make room for it at once); one that goes leaves the column at
// once and its ghost fades, while the rest glide into its place (motion.js flip). While the card over a game (#waiting,
// invite.js) shows, the column stands above it: --card-h on #layer, its height + 6 px (style.css), at once when the
// card comes or grows, the notes gliding down when it shrinks or goes. On the shelf and over a dialog a tap takes a note
// away (.tappable); over a game the column never catches a tap. Which notes not to show (what a dialog or the game says
// already) is the caller's: invite.js. toast() → a function that takes that note away.
const TOASTS = 3, timers = new WeakMap();
const lifeOf = text => Math.min(6000, 2600 + Math.max(0, [...text].length - 24) * 60);
let column = null, stageSeen = null, card = null, sized = null, cardH = 0;
const fading = new Set();                                // ghosts of notes that went, while they fade
export function toasts() {
  let c = $('layer').querySelector(':scope > .toasts');
  if (!c) {
    c = el('div', { className: 'toasts' });
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'false');
    // a tap where the column takes one (.tappable) takes the note away, and leaves the focus where it was
    c.addEventListener('mousedown', e => { if (e.target.closest('.toast')) e.preventDefault(); });
    c.addEventListener('click', e => { const t = e.target.closest('.toast'); if (t && c.classList.contains('tappable')) drop(t); });
    $('layer').append(c);
  }
  column = c;
  follow();
  tappable();
  return c;
}
export function toast(text) {
  const c = toasts();
  fit();
  let t = [...c.children].find(x => x.textContent === text);
  if (t) clearTimeout(timers.get(t));
  else {
    t = el('div', { className: 'toast', textContent: text });
    // (the notes above make room at once: gliding up from where the new one now rises, they would cross it)
    for (const x of [...c.children].slice(0, Math.max(0, c.children.length + 1 - TOASTS))) { away(x); x.remove(); }
    c.append(t);
    play(t, 'ihk-in');
  }
  const n = t;
  timers.set(n, setTimeout(() => drop(n), lifeOf(text)));
  return () => drop(n);
}
function drop(t) {
  if (!t.isConnected) { clearTimeout(timers.get(t)); return; }
  const rest = [...t.parentNode.children].filter(x => x !== t);
  away(t);
  flip(rest, () => t.remove());
}
// a note that goes: its ghost fades from where it is (a note still rising in: from its opacity then)
function away(t) {
  clearTimeout(timers.get(t));
  const o = mode(t) === 'off' ? '' : getComputedStyle(t).opacity;
  const g = ghost(t, 'ihk-fade-out', { inner: c => { c.style.opacity = o; } });
  if (!g) return;
  for (const x of fading) if (!x.isConnected) fading.delete(x);
  fading.add(g);
}
// what the column follows: whether a game shows (the stage) and whether a dialog is open (tappable), and the card
function follow() {
  const st = $('stage');
  if (st && st !== stageSeen && typeof MutationObserver === 'function') {
    stageSeen = st;
    new MutationObserver(tappable).observe(st, { attributes: true, attributeFilter: ['hidden'] });
  }
  const k = $('waiting');
  if (k === card) return;
  if (sized) sized.disconnect();
  card = k;
  sized = k && typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
  if (sized) sized.observe(k);
}
function tappable() {
  if (!column) return;
  const st = $('stage');
  column.classList.toggle('tappable', !st || st.hidden || dialogOpen());
}
// the column above the card while it shows. Higher at once, so nothing of a note is ever on the card (glides still under
// way end, and ghosts go, now); lower, the notes glide down.
function fit() {
  const layer = $('layer'), h = card && card.isConnected ? card.offsetHeight : 0, want = h ? h + 6 : 0;
  if (!layer || want === cardH) return;
  const up = want > cardH, set = () => { if (want) layer.style.setProperty('--card-h', want + 'px'); else layer.style.removeProperty('--card-h'); };
  cardH = want;
  const notes = column && column.isConnected ? [...column.children] : [];
  if (!up) { flip(notes, set); return; }
  settle(notes);
  for (const g of fading) g.remove();
  fading.clear();
  set();
}

// «Скопіювати» (the UX spec L-T14): both words of a copy button in one cell (.swap), so the button keeps its width;
// copied, it says «Скопійовано» with a drawn check (its name too: aria-label), and after 2 s its own word again.
// copyButton(label, text, className): a copy button with both words from the start (text: a string, or a function that
// gives it); copyLabels(button): a button of the page's own markup made so; copy(text, button): copies (a button of
// one word gets the two then: its width may grow once, so make copy buttons with copyButton or copyLabels).
const COPIED = 'Скопійовано', reverts = new WeakMap();
export function copyLabels(b, label = b.textContent) {
  const s = b.querySelector(':scope > .swap');
  if (s) return s;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', 'M3 8.5 6.5 12 13 4.5');
  svg.append(path);
  const w = el('span', { className: 'swap' }, el('span', { textContent: label }), el('span', { textContent: COPIED }, svg));
  b.replaceChildren(w);
  b.setAttribute('aria-label', label);
  return w;
}
export function copyButton(label, text, className = 'btn') {
  const b = btn('', () => copy(typeof text === 'function' ? text() : text, b), className);
  copyLabels(b, label);
  return b;
}
export async function copy(text, button) {
  const b = button && button.closest ? button.closest('button') || button : button;
  try {
    await navigator.clipboard.writeText(text);
    if (!b) return;
    const s = copyLabels(b);
    s.classList.add('done');
    b.setAttribute('aria-label', COPIED);
    clearTimeout(reverts.get(b));
    reverts.set(b, setTimeout(() => { s.classList.remove('done'); b.setAttribute('aria-label', s.firstChild.textContent); }, 2000));
  } catch (e) { prompt('Скопіюй:', text); }
}
