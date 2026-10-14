// Small things every part of the library page uses.
export const $ = id => document.getElementById(id);
export const root = new URL('../', import.meta.url);   // the site root (the bundle lives in lib/)
export const el = (tag, props, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
export const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.error(e); } };
export const btn = (text, onclick, className = 'btn') => el('button', { className, type: 'button', textContent: text, onclick });
export const para = (text, className = '') => el('p', { className, textContent: text });
// a line that says what went wrong, heard by a screen reader as it comes (empty: nothing to say)
export const errLine = (text = '') => el('p', { className: 'err', role: 'alert', textContent: text });

// A dialog over everything. Escape (the topmost dialog only), a tap outside it or close() closes it; onClose
// runs once. Focus moves into it and comes back where it was when it closes; the page behind is inert meanwhile.
// show(...nodes): what it shows now (focus on a node that went goes to the dialog itself, not to the page's <body>).
// Where the browser knows no inert (Safari before 15.5), the focus that leaves the topmost dialog is brought back to
// it; and a game's own focus() that pulls the focus into its frame behind the dialog (inert does not stop that, and
// the keys would go there, Escape too) loses it back to the dialog once the move is over (deferred: a refocus inside
// the window's blur leaves the keys going to the frame).
const behind = () => [$('busy'), $('shelf'), $('stage')];
const dialogs = () => $('layer').querySelectorAll('.backdrop');
const noInert = !!globalThis.HTMLElement && !('inert' in HTMLElement.prototype);   // (the worker tabs of the tests have no HTMLElement)
export function modal(onClose = () => {}) {
  const box = el('div', { className: 'dialog card', role: 'dialog', tabIndex: -1 }), back = el('div', { className: 'backdrop' }, box);
  box.setAttribute('aria-modal', 'true');
  const before = document.activeElement;
  const top = () => [...dialogs()].pop() === back;
  const onKey = e => { if (e.key === 'Escape' && top()) close(); };
  const onFocus = e => { if (top() && !back.contains(e.target)) box.focus(); };
  const guard = () => setTimeout(() => { if (back.isConnected && top() && document.activeElement && document.activeElement.tagName === 'IFRAME') box.focus(); });
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
  queueMicrotask(() => { if (!box.contains(document.activeElement)) box.focus(); });
  back.addEventListener('click', e => { if (e.target === back) close(); });
  addEventListener('keydown', onKey);
  addEventListener('blur', guard);
  if (noInert) document.addEventListener('focusin', onFocus);
  $('layer').append(back);
  for (const n of behind()) n.inert = true;
  const show = (...nodes) => {
    const had = box.contains(document.activeElement);
    box.replaceChildren(...nodes);
    if (had && !box.contains(document.activeElement)) box.focus();
  };
  return { box, close, show };
}

// a short note at the bottom of the screen
export function toast(text) {
  const t = el('div', { className: 'toast', textContent: text, role: 'status' });
  $('layer').append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

export async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = 'Скопійовано ✓'; }
  catch (e) { prompt('Скопіюй:', text); }
}
