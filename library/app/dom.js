// Small things every part of the library page uses.
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
// show(...nodes): what it shows now (focus on a node that went goes to the dialog itself, not to the page's <body>);
// focus(field): the field to have the focus (its text selected) instead of the dialog itself.
// Where the browser knows no inert (Safari before 15.5), the focus that leaves the topmost dialog is brought back to
// it; and a game's own focus() that pulls the focus into its frame behind the dialog (inert does not stop that, and
// the keys would go there, Escape too) loses it back to the dialog once the move is over (deferred: a refocus inside
// the window's blur leaves the keys going to the frame).
// A game on the whole screen (its frame in the browser's top layer) would cover the dialog, and while it is so the
// browser keeps the rest of the page inert, the dialog too: the dialog leaves fullscreen first and takes the focus
// once out of it (owner, decision 51).
const behind = () => [$('busy'), $('shelf'), $('stage')];
const dialogs = () => $('layer').querySelectorAll('.backdrop');
const noInert = !!globalThis.HTMLElement && !('inert' in HTMLElement.prototype);   // (the worker tabs of the tests have no HTMLElement)
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
    back.remove();
    removeEventListener('keydown', onKey);
    removeEventListener('blur', guard);
    if (noInert) document.removeEventListener('focusin', onFocus);
    if (!dialogs().length) for (const n of behind()) n.inert = false;
    if (before && before.isConnected && before.focus) before.focus();
    onClose();
  };
  queueMicrotask(focusIn);
  back.addEventListener('click', e => { if (e.target === back) close(); });
  addEventListener('keydown', onKey);
  addEventListener('blur', guard);
  if (noInert) document.addEventListener('focusin', onFocus);
  $('layer').append(back);
  for (const n of behind()) n.inert = true;
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().then(() => land(), () => {});
  const show = (...nodes) => {
    const had = box.contains(document.activeElement);
    box.replaceChildren(...nodes);
    if (had && !box.contains(document.activeElement)) box.focus();
  };
  return { box, close, show, focus: f => { want = f; queueMicrotask(focusIn); } };
}

// Short notes at the bottom of the screen (owner, decision 40): one above the other, never one over another; at most
// TOASTS (the oldest goes), and the same one again while it shows only shows longer. Their column (#layer > .toasts) is
// one live region, there before it says anything (toasts(): invite.js makes it as the page starts), that reads each new
// note by itself (not atomic, as a status region would be: the notes still on the screen are not read again).
const TOASTS = 3, timers = new WeakMap();
export function toasts() {
  let c = $('layer').querySelector(':scope > .toasts');
  if (!c) {
    c = el('div', { className: 'toasts' });
    c.setAttribute('role', 'status');
    c.setAttribute('aria-live', 'polite');
    c.setAttribute('aria-atomic', 'false');
    $('layer').append(c);
  }
  return c;
}
export function toast(text) {
  const c = toasts(), drop = t => { for (const id of timers.get(t) || []) clearTimeout(id); t.remove(); };
  let t = [...c.children].find(x => x.textContent === text && !x.classList.contains('out'));
  if (t) for (const id of timers.get(t)) clearTimeout(id);
  else c.append(t = el('div', { className: 'toast', textContent: text }));
  timers.set(t, [setTimeout(() => t.classList.add('out'), 2600), setTimeout(() => drop(t), 3000)]);
  while (c.children.length > TOASTS) drop(c.firstElementChild);
}

export async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = 'Скопійовано ✓'; }
  catch (e) { prompt('Скопіюй:', text); }
}
