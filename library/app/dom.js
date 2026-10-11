// Small things every part of the library page uses.
export const $ = id => document.getElementById(id);
export const root = new URL('../', import.meta.url);   // the site root (the bundle lives in lib/)
export const el = (tag, props, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
export const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.error(e); } };
export const btn = (text, onclick, className = 'btn') => el('button', { className, type: 'button', textContent: text, onclick });
export const para = (text, className = '') => el('p', { className, textContent: text });

// A dialog over everything. Escape, a tap outside it or close() closes it; onClose runs once.
export function modal(onClose = () => {}) {
  const box = el('div', { className: 'dialog card', role: 'dialog' }), back = el('div', { className: 'backdrop' }, box);
  box.setAttribute('aria-modal', 'true');
  const onKey = e => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (!back.isConnected) return;
    back.remove();
    removeEventListener('keydown', onKey);
    onClose();
  };
  back.addEventListener('click', e => { if (e.target === back) close(); });
  addEventListener('keydown', onKey);
  $('layer').append(back);
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
