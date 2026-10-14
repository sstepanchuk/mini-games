/* =====================================================================
   The library's waiting screens inside a game (owner, decision 6 (c), «Спільний набір екранів»): `<ihroteka-wait>`,
   which a game places, empty, wherever its waiting messages belong (README "Waiting screens"). game-api.js defines the
   element in the game's own window and only says where its copies are (waitScreen, through shell.js); everything else
   is here, in the library page, so it changes without rebuilding the games.
   - One copy at a time holds the rows (the holder): the one that holds them while it is still seen, else the first seen
     copy in document order (seen: visible, opacity too on every engine; in the frame's view; and on top at the centre
     of its first row and of each of its buttons in view: a button the game covers cannot be pressed). Every other copy
     is empty, and an empty one takes no room (the style injected once into the game's <head>).
   - Never two messages: when no copy is seen, the card over the game (invite.js) says it instead, every row; a game
     that never placed one (adopted false: the probe, a build from before the screens) gets the card as it was
     (waiting.js placeLines); before the game's page has parsed (ready false), the card says only the version.
   - On every copy, the attribute `showing` says the kinds said now, wherever they show (a copy, the card); the event
     `showing` (the game's window's Event, no bubbling) says when what is said changed, after the rows are in place.
   - The rows are waiting.js's, painted by one renderer for the card and the copies (paint): each row built once per
     key, so each second only its time changes and a focused button keeps its focus. When the rows move (a copy to the
     card, the card to a copy, a copy to another), a focused button's focus goes with them (focused, carry).
   When it looks again (soon: one pass of invite.js waitNote, deduped in a microtask): the game's page parsed
   (DOMContentLoaded), the game attached or closed; in the game's next animation frame, a copy connected or gone, a size
   change of a copy or of its parent (a ResizeObserver of the game's window: a menu panel shown or hidden around a copy,
   any ancestor's display changes the parent's box, and an empty copy has none); and each second (invite.js), for what
   no observer sees: a layer over the holder, scrolling. No rAF loop. The observer never makes the browser report a
   "ResizeObserver loop": nothing of ours is observed or changes size inside its delivery of observations (a copy may
   connect from a game's own observer, or from a 'showing' listener): its callback and a copy that connects or goes only
   ask for the next frame (frame), where the observations are brought up to date by difference (reconcile) before the
   pass; a copy that goes is let go of at once (forget).
   While a library dialog is open (the stage inert), the holder stays as it is, with no hit test.
   ===================================================================== */
import { safe } from './dom.js';
import { LABEL, mmss, NAMED } from './waiting.js';

export const ELEMENT = 'ihroteka-wait', ATTR = 'showing', EVENT = 'showing';
export const CLASSES = ['btn', 'fine', 'ghost', 'wait-row', 'wait-time'];   // the markup's hooks (README "Waiting screens")
export const DATA = ['kind', 'name'];                                       // its data- attributes
// the default look: an empty copy takes no room; the rest at zero specificity (any rule of the game's wins)
const STYLE = 'ihroteka-wait:empty{display:none!important}\n' +
  ':where(ihroteka-wait){display:block}\n' +
  ':where(ihroteka-wait .wait-row){display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 12px}\n' +
  ':where(ihroteka-wait .wait-row+.wait-row){margin-top:6px}\n' +
  ':where(ihroteka-wait p){margin:0;overflow-wrap:anywhere}\n' +
  ':where(ihroteka-wait .wait-time){font-variant-numeric:tabular-nums;white-space:nowrap}\n' +
  ':where(ihroteka-wait .fine){flex-basis:100%}';
// the dev server (the page's version meta: 'dev', as together.js): a game's mistake the library can see says so, once
const DEV = globalThis.document?.querySelector?.('meta[name="ihroteka-version"]')?.content === 'dev';

let win = null;                                          // the open game's window (attachScreens), null: none
let copies = new Set(), holder = null;                   // its connected copies; the one that holds the rows, or null
let isReady = true, took = false;                        // its page has parsed (true with no frame); a copy connected (adopted)
let told = '', showing = '';                             // the model key last announced (the event); the kinds said now
let ro = null, raf = 0, queued = false, repaint = null;  // the game's ResizeObserver, its frame; a pass asked; invite's waitNote
let watched = new Set(), parentOf = new WeakMap();      // what the observer watches; a copy → the parent watched for it
const warned = new Set();
const built = new WeakMap();                             // box (a copy, the card) → Map(row key → { node, time })
const made = new WeakMap();                              // a button of the rows → { key, act }: the same one elsewhere

// invite.js: what to call for a new pass (its waitNote)
export function initScreens(fn) { repaint = fn; }
const soon = () => { if (queued || !repaint) return; queued = true; queueMicrotask(() => { queued = false; safe(repaint); }); };
const warn = (k, text) => { if (DEV && !warned.has(k)) { warned.add(k); console.warn('ihroteka-wait: ' + text); } };

// shell.js api(): the open game's window (each attach: a game whose frame reloads itself starts clean)
export function attachScreens(w) {
  detachScreens();
  win = w;
  isReady = w.document.readyState !== 'loading';
  if (!isReady) w.addEventListener('DOMContentLoaded', () => { if (win === w) { isReady = true; soon(); } }, { once: true });
}
// shell.js closeFrame: nothing of the frame is kept (its nodes go with it), and the card is asked again at once
export function detachScreens() {
  try { if (ro) ro.disconnect(); if (raf && win) win.cancelAnimationFrame(raf); } catch (e) {}   // (the window may be gone)
  copies = new Set(); holder = null; win = null; ro = null; raf = 0; took = false; told = ''; showing = ''; isReady = true;
  watched = new Set(); parentOf = new WeakMap();
  soon();
}
export const ready = () => isReady;
export const adopted = () => took;

// the element's callbacks (game-api.js, through shell.js __ihroteka.waitScreen): a copy connected (on) or gone
export function waitScreen(el, on) {
  if (!win || !el || el.ownerDocument !== win.document) return;
  if (on) {
    if (el.firstChild) { warn('empty', 'leave it empty: the library fills it'); el.replaceChildren(); }
    copies.add(el); took = true;
    mark([el], showing);                                 // (the game's code reads it as it starts)
    const doc = el.ownerDocument;
    if (!doc.querySelector('style[data-ihroteka-wait]')) {
      const s = doc.createElement('style');
      s.setAttribute('data-ihroteka-wait', '');
      s.textContent = STYLE;
      (doc.head || doc.documentElement).append(s);
    }
  } else {
    copies.delete(el);
    if (holder === el) holder = null;
    clear(el);                                           // (a copy the game moves arrives empty)
    forget(el);
  }
  frame();                                               // (this may run inside the browser's delivery: see the top)
}

// The observer's work and what a copy that connects or goes asks for: in the game's next animation frame, never now
// (now may be inside the browser's delivery of observations): the observations brought up to date, then a pass.
function frame() {
  const w = win;
  try { if (w && !raf) raf = w.requestAnimationFrame(() => { raf = 0; if (win !== w) return; reconcile(); soon(); }); } catch (e) {}
}
// What the observer watches: each connected copy and its parent (an empty copy takes no room, so its parent says when
// a panel around it is shown or hidden). By difference: what is new is observed, what went is let go of; never all of
// it again (observing again resets what a target last reported: every one, <html> and <body> too, would be due again
// inside the same delivery, where the browser skips them and reports a loop).
function reconcile() {
  const w = win;
  if (!w || !w.ResizeObserver) return;
  try {
    if (!ro) ro = new w.ResizeObserver(() => { if (win === w) frame(); });   // (it only asks for the next frame)
    const want = new Set();
    for (const el of copies) {
      if (!el.isConnected) continue;
      want.add(el);
      const p = el.parentElement;
      if (p) { want.add(p); parentOf.set(el, p); }
    }
    for (const n of watched) if (!want.has(n)) { ro.unobserve(n); watched.delete(n); }
    for (const n of want) if (!watched.has(n)) { ro.observe(n); watched.add(n); }
  } catch (e) {}
}
// A copy that goes, and the parent it was watched in, are let go of at once (letting go is safe anywhere): both may
// change size now, inside a delivery, where one still watched would be skipped. The next frame watches the parent
// again if another copy is in it.
function forget(el) {
  for (const n of [el, parentOf.get(el)]) {
    if (!n || !watched.has(n)) continue;
    watched.delete(n);
    try { ro.unobserve(n); } catch (e) {}
  }
  parentOf.delete(el);
}

// the connected copies, in document order
const sorted = () => [...copies].filter(el => el.isConnected).sort((a, b) => a.compareDocumentPosition(b) & 4 ? -1 : 1);
// the attribute `showing` on these copies: the kinds said now ('' : none), written only when it changed
function mark(list, v) {
  for (const el of list) {
    if (v) { if (el.getAttribute(ATTR) !== v) el.setAttribute(ATTR, v); } else if (el.hasAttribute(ATTR)) el.removeAttribute(ATTR);
  }
}
// a library dialog is open (the stage behind it inert): the holder stays as it is (no hit test behind the backdrop)
const inert = () => { try { return !!win.frameElement && !!win.frameElement.closest('[inert]'); } catch (e) { return false; } };
// Visible to the eye: not visibility:hidden or opacity:0, on it or around it (display:none leaves no box: seen says
// so). Both generations of checkVisibility's option names (Chromium 105–120 knows only checkOpacity and
// checkVisibilityCSS, and ignores the rest); without checkVisibility (Safari before 17.4), its visibility (inherited)
// and every ancestor's opacity, read here (a few nodes, at most once a second).
const VIS = { checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true };
function visible(el) {
  if (el.checkVisibility) return el.checkVisibility(VIS);
  if (win.getComputedStyle(el).visibility !== 'visible') return false;
  for (let n = el; n; n = n.parentElement) if (win.getComputedStyle(n).opacity === '0') return false;
  return true;
}
// Whether the player sees this copy (measured with its rows painted): visible, in the frame's view by 1×1 px at least,
// and on top (not under the game's own menu, bar or toast, say) at the centre of what is in view of its first row, and
// at the centre of each of its buttons whose centre is in the frame's view (one out of view still counts: scrolling
// reaches it). A false "unseen" still leaves one message: the card's.
function seen(el) {
  try {
    if (!el.isConnected || el.ownerDocument !== win.document) return false;
    if (!visible(el)) return false;
    const vw = win.innerWidth, vh = win.innerHeight;
    const centre = r => { const x = Math.max(r.left, 0), y = Math.max(r.top, 0), w = Math.min(r.right, vw) - x, h = Math.min(r.bottom, vh) - y; return w >= 1 && h >= 1 ? [x + w / 2, y + h / 2] : null; };
    const top = (x, y) => { const hit = win.document.elementFromPoint(x, y); return !!hit && (hit === el || el.contains(hit)); };
    const c = centre(el.getBoundingClientRect()) && centre((el.firstElementChild || el).getBoundingClientRect());
    if (!c || !top(c[0], c[1])) return false;
    for (const b of el.querySelectorAll('button')) {
      const r = b.getBoundingClientRect(), x = (r.left + r.right) / 2, y = (r.top + r.bottom) / 2;
      if (r.width && r.height && x >= 0 && y >= 0 && x < vw && y < vh && !top(x, y)) return false;   // (no box: the game hides it)
    }
    return true;
  } catch (e) { return false; }
}
// Which copy holds the rows: the holder while it is still seen, else the first seen one in document order (each tried
// with the rows painted into it, in this one task, so nothing is ever painted twice on screen); the others empty.
function place(list, rows, acts) {
  if (!isReady || !rows.length) { holder = null; for (const el of list) clear(el); return; }
  if (holder && list.includes(holder) && inert()) { paint(holder, rows, acts); for (const el of list) if (el !== holder) clear(el); return; }
  let found = null;
  for (const el of holder && list.includes(holder) ? [holder, ...list.filter(x => x !== holder)] : list) {
    if (el.firstChild && !built.has(el)) warn('empty', 'leave it empty: the library fills it');
    paint(el, rows, acts);
    if (seen(el)) { found = el; break; }
    clear(el);
  }
  holder = found;
  for (const el of list) if (el !== holder) clear(el);
}
// The pass (invite.js noteOnce): the attribute on every copy, the rows into the copy that holds them, then (what is
// said changed) the event on every copy, and once more where the rows go (a listener may have shown, hidden or moved
// a copy). The event waits for the game's page to have parsed: before that no copy holds the rows (and the game's
// code reads the attribute as it starts), so its listeners hear it with the rows in place. → whether a copy holds the
// rows (then the card says nothing)
export function show(model, acts) {
  const w = win;
  if (!w) return false;
  let list = sorted();
  showing = model.showing;
  mark(list, showing);
  place(list, model.rows, acts);
  if (isReady && model.key !== told) {
    told = model.key;
    for (const el of list) { if (win !== w) break; el.dispatchEvent(new w.Event(EVENT)); }
    if (win === w) { list = sorted(); mark(list, showing); place(list, model.rows, acts); }
  }
  if (win === w && took && isReady && model.rows.length && !holder && !inert()) {
    warn('seen', 'none of this game\'s waiting screens is seen (hidden, covered or out of view): the library\'s card over the game says it instead');
  }
  return !!holder;
}

// One renderer for the card and the copies: rows by key (each built once, removed when its key goes, moved only when
// out of place), then only the time; anything else in the box goes. (The markup and its hooks: README "Waiting screens".)
export function paint(box, rows, acts) {
  let map = built.get(box);
  if (!map) built.set(box, map = new Map());
  const keys = new Set(rows.map(r => r.key));
  for (const [k, x] of map) if (!keys.has(k)) { x.node.remove(); map.delete(k); }
  let at = box.firstChild;
  for (const r of rows) {
    let x = map.get(r.key);
    if (!x) map.set(r.key, x = build(box.ownerDocument, r, acts));
    if (x.node === at) at = at.nextSibling; else box.insertBefore(x.node, at);
    if (x.time) { const t = mmss(r.time); if (x.time.textContent !== t) x.time.textContent = t; }
  }
  while (at) { const n = at.nextSibling; at.remove(); at = n; }
}
export function clear(box) {
  if (box.firstChild) box.replaceChildren();
  built.delete(box);
}
// a row: the line (with the time, for a place that is kept), the small line, the buttons (library functions, also in
// the game's document; one that acts on a player is named for a screen reader with whom: waiting.js NAMED)
function build(doc, r, acts) {
  const make = (tag, cls, text) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (text) n.textContent = text; return n; };
  const node = make('div', 'wait-row'), line = make('p', '', r.text);
  node.dataset.kind = r.kind;
  if (r.name) node.dataset.name = r.name;
  const time = r.time == null ? null : make('span', 'wait-time');
  if (time) line.append(' ', time);
  node.append(line);
  if (r.fine) node.append(make('p', 'fine', r.fine));
  for (const { act, arg } of r.acts) {
    const b = make('button', LABEL[act][1], LABEL[act][0]);
    b.type = 'button';
    if (NAMED[act]) b.setAttribute('aria-label', NAMED[act](arg));
    b.addEventListener('click', () => safe(acts[act], arg));
    made.set(b, { key: r.key, act });
    node.append(b);
  }
  return { node, time };
}

// The focus across a move of the rows (a copy to the card, the card to a copy, a copy to another). focused(): the
// button of the rows that has the focus as a pass starts (the card's, or a copy's while the game's frame has the
// focus), or null. carry(was, card): after the pass, when that button went with the move and the focus is nowhere
// since (the page's <body>, or the frame with its <body>), the same row's same button in the holder or the card takes
// it; a game's 'showing' listener that put the focus somewhere wins. → whether it did. (A copy the game hides with
// display:none loses its focus to the browser before the pass: nothing to carry.)
export function focused() {
  const a = document.activeElement;
  if (a && made.has(a)) return a;
  try { if (win && a && a === win.frameElement) { const g = win.document.activeElement; if (g && made.has(g)) return g; } } catch (e) {}
  return null;
}
const nowhere = () => {
  const a = document.activeElement;
  if (!a || a === document.body) return true;
  try { return !!win && a === win.frameElement && (!win.document.activeElement || win.document.activeElement === win.document.body); } catch (e) { return false; }
};
export function carry(was, card) {
  if (!was || was.isConnected || !nowhere()) return false;
  const id = made.get(was);
  for (const box of [holder, card]) {
    if (!box) continue;
    for (const b of box.querySelectorAll('button')) {
      const x = made.get(b);
      if (x && x.key === id.key && x.act === id.act) { b.focus({ preventScroll: true }); return true; }
    }
  }
  return false;
}

// for checks (__ihroteka.screens()): the open game's page parsed, a copy ever placed, how many copies there are, which
// one holds the rows (its place in document order; -1: none)
export const state = () => { const list = sorted(); return { ready: isReady, adopted: took, copies: list.length, holder: holder ? list.indexOf(holder) : -1, held: !!holder }; };
