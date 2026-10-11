// Small things every part of the library page uses.
export const $ = id => document.getElementById(id);
export const root = new URL('../', import.meta.url);   // the site root (the bundle lives in lib/)
export const el = (tag, props, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
export const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.error(e); } };
export const btn = (text, onclick, className = 'btn') => el('button', { className, type: 'button', textContent: text, onclick });
export const para = (text, className = '') => el('p', { className, textContent: text });

// A dialog over everything. Escape (the topmost dialog only), a tap outside it or close() closes it; onClose
// runs once. Focus moves into it and comes back where it was when it closes; the page behind is inert meanwhile.
const behind = () => [$('busy'), $('shelf'), $('stage')];
const dialogs = () => $('layer').querySelectorAll('.backdrop');
export function modal(onClose = () => {}) {
  const box = el('div', { className: 'dialog card', role: 'dialog', tabIndex: -1 }), back = el('div', { className: 'backdrop' }, box);
  box.setAttribute('aria-modal', 'true');
  const before = document.activeElement;
  const onKey = e => { if (e.key === 'Escape' && [...dialogs()].pop() === back) close(); };
  const close = () => {
    if (!back.isConnected) return;
    back.remove();
    removeEventListener('keydown', onKey);
    if (!dialogs().length) for (const n of behind()) n.inert = false;
    if (before && before.isConnected && before.focus) before.focus();
    onClose();
  };
  queueMicrotask(() => { if (!box.contains(document.activeElement)) box.focus(); });
  back.addEventListener('click', e => { if (e.target === back) close(); });
  addEventListener('keydown', onKey);
  $('layer').append(back);
  for (const n of behind()) n.inert = true;
  return { box, close, show: (...nodes) => box.replaceChildren(...nodes) };
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
