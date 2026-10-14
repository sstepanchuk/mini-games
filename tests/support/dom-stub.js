// A stand-in for library/app/dom.js in Node (tests/app/lock.test.js puts it in place with a loader hook): an element
// is a plain object that keeps its props, children, attributes and listeners; modal() keeps every dialog it made
// (dialogs), open until closed, and what it shows (nodes). Enough for lock.js's password dialog.
export const root = new URL('https://example.github.io/lib/');
export const $ = () => null;
export const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.error(e); } };
export function el(tag, props = {}, ...children) {
  return { tag, ...props, children, listeners: {}, attrs: {},
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    removeAttribute(k) { delete this.attrs[k]; },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; },
    focus() {}, select() {} };
}
export const btn = (text, onclick, className = 'btn') => el('button', { className, type: 'button', textContent: text, onclick });
export const para = (text, className = '') => el('p', { className, textContent: text });

export const dialogs = [];
// close(): what «Скасувати», Escape and a tap outside all do; onClose runs once
export function modal(onClose = () => {}) {
  const d = { open: true, nodes: [],
    show(...nodes) { d.nodes = nodes; },
    close() { if (!d.open) return; d.open = false; onClose(); } };
  dialogs.push(d);
  return d;
}
export const toast = () => {};
export const copy = async () => {};
