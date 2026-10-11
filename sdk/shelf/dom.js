// Small things every part of the library page uses.
export const $ = id => document.getElementById(id);
export const root = new URL('../', import.meta.url);   // the site root (the bundle lives in lib/)
export const el = (tag, props, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
export const safe = (fn, ...a) => { try { return fn(...a); } catch (e) { console.error(e); } };
