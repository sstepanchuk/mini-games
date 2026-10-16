/* =====================================================================
   Motion: the one vocabulary of movement of the library and of its games (the UX spec: rules, tokens, choreography).
   The rules every caller keeps (they matter more than any animation):
   1. State first, motion after. hidden, inert, focus, textContent and a live region's text change in the same task
      as with no motion at all; motion only decorates the new state, and no logic waits for it. A helper's `done`
      runs when its motion ends, and in the call itself when nothing moves: motion off, no element, one off the page.
      Motion off (html[data-motion=off]: the tests' switch, window.__ihrotekaMotion = 'off', or localStorage
      'ihroteka-motion' = 'off' by hand) makes nothing either: no ghost, glide, flight or busy look.
   2. What leaves is gone at once: ghost(el) while it is still in place, then remove or hide it in the same task. The
      ghost, a copy with no ids, roles, names or tab stops (aria-hidden, inert, pointer-events:none) in the page's fx
      layer (.ihk-fx, over everything), plays the exit and goes by itself. A decorative element (never pressed, never
      read) fades by itself instead: fadeHide().
   3. Only transform and opacity move, 240 ms at most (the tokens); longer only the owner's holds (later()). What a
      change pushes glides (flip). What glides or flies has no transform of its own in CSS (centre it with margins).
   4. «Менше руху» (prefers-reduced-motion, read live): every keyframe that moves is a fade of 120 ms at most
      (MOTION_CSS), play() drops its delay, flip() and fly() do nothing; ghosts and fades stay.
   MOTION_CSS                 the tokens (--m-*), the keyframes (ihk-*), «менше руху», the off switch, the focus ring by
                              modality: one string, at zero specificity (any rule of the page wins)
   install(doc, win)          once per document: MOTION_CSS before the page's own styles; on its <html> data-ihroteka,
                              data-motion=off (the window's switch, or its library's), data-input (the modality,
                              'pointer' or 'key': the last input in any window installed sets it in all, so a ring
                              shows only after a navigation key); a passive touchstart (iPhones show :active only with
                              one). The library's page at boot (index.js), a game's at attach (shell.js api, while its
                              <head> is parsed, before its own styles)
   mode(node?)                'off' | 'reduced' | 'full', read now (node: an element or document; the page's by default)
   play(el, name, o)          a keyframe of MOTION_CSS on el, restartable. o: delay (ms; none under «менше руху»),
                              duration (ms, or a token: 'press', 'release', 'quick', 'in', 'move'), keep (stays on its
                              last frame), done. Each keyframe has its own duration and easing (KIND)
   ghost(el, name?, o)        the exit of el (ihk-fade-out; ihk-out, ihk-sink), played by a copy of it → the copy, or
                              null. o.inner(copy): a part's own exit (play(part, 'ihk-out', { keep: true }))
   overlay(node, o)           a decoration of the caller's (a page veil, a card in flight) in the fx layer: o.at (a
                              rect), o.under (below the ghosts there), o.name (it plays that and goes) → node, or null
                              with motion off
   fadeHide(el, o)            a decorative element fades (unheard meanwhile) and is hidden
   flip(els, change)          change() now; what it moved glides from where it was (transforms, 240 ms)
   settle(els)                their glides end now, where they were going (before a change that must not cross them)
   fly(el, from, to?, o)      el flies from the rect `from` to where it stands (or to the rect `to`, staying there until
                              it is removed) → its Animation, or null
   tint(el, from, to, o)      a colour on a small element (a dot that fills, a chip that is new: never a surface) goes
                              from `from` to `to` (its own), o.duration (140 ms), o.easing; under «менше руху» a step
                              (`from` held as long): a colour, not motion → its Animation, or null
   typeset(doc, ms, first?)   → a Promise: the house fonts (Inter Tight, Oswald) in doc, or ms, whichever comes first (after
                              the Promise first: their stylesheet); never rejects (a first paint in the final font)
   busy(btn, text?)/free(btn, o)   the pressed button's busy look: only after 300 ms, then for 500 ms at least, in place
                              (a ring and the words in it, aria-busy). The look only: it blocks no press
   later(ms, fn) → cancel     a timer (the holds: the off switch never shortens them)
   stop(el)                   ends el's play() now (its done does not run)
   Every helper returns at once; play, fadeHide and free also give a Promise of their end (play's: true when it
   ran to its end, false when it did not run or a newer one took over). The e2e find ghosts and overlays as .ihk-fx > *.
   ===================================================================== */

export const MOTION_CSS = `:where(:root){
  --m-press:80ms;      /* press goes down */
  --m-release:160ms;   /* press comes back (with --m-spring) */
  --m-quick:140ms;     /* something leaves; colour/state change; text crossfade */
  --m-in:200ms;        /* a surface enters: dialog, card, toast, row, HUD */
  --m-move:240ms;      /* change of place: shelf↔game, dialog step, FLIP glide, strike line (the maximum) */
  --m-ease-out:cubic-bezier(.2,.8,.3,1);
  --m-ease-in:cubic-bezier(.55,0,.8,.3);
  --m-ease-move:cubic-bezier(.4,0,.2,1);
  --m-spring:cubic-bezier(.3,1.45,.55,1);   /* release only: ~5% overshoot */
}
/* distances live in the keyframes (no var() inside @keyframes: Safari 15): 4 px row · 12 px surface · 16 px step ·
   3 px press · 2 px hover. Entries never start at opacity 0 (screens.js seen() treats 0 as unseen). */
@keyframes ihk-in{from{opacity:.01;transform:translateY(12px)}}
@keyframes ihk-pop{from{opacity:.01;transform:translateY(12px) scale(.98)}}      /* dialog */
@keyframes ihk-drop{from{opacity:.01;transform:translateY(-12px)}}               /* HUD from the top */
@keyframes ihk-keep{from{opacity:.01;transform:translateY(4px)}}                 /* a waiting copy, a row */
@keyframes ihk-fwd{from{opacity:.4;transform:translateX(16px)}}                  /* next step: no empty frame */
@keyframes ihk-back{from{opacity:.4;transform:translateX(-16px)}}
@keyframes ihk-out{to{opacity:0;transform:translateY(6px)}}                      /* ghost of a dialog/card */
@keyframes ihk-sink{to{opacity:0;transform:scale(.97)}}                          /* ghost of a game panel */
@keyframes ihk-fade{from{opacity:.01}}
@keyframes ihk-fade-out{to{opacity:0}}
@keyframes ihk-beat{from{opacity:.01;transform:scale(1.2)}}                      /* countdown digit */
@keyframes ihk-tick{40%{transform:scale(1.08)}}                                  /* timer in the last 5 s */
@keyframes ihk-up{from{opacity:.01;transform:translateY(.45em)}}                 /* score gained */
@keyframes ihk-down{from{opacity:.01;transform:translateY(-.45em)}}              /* score lost */
@keyframes ihk-land{from{transform:scale(.96)}}                                  /* card the player came back to */
@keyframes ihk-look{from{outline-color:#1b1a17}to{outline-color:rgba(27,26,23,0)}}   /* «look here», 700 ms */
@keyframes ihk-drain{to{transform:scaleX(0)}}                                    /* armed ✕ / auto-closing dialog */
@media (prefers-reduced-motion:reduce){
  :where(:root){--m-press:0ms;--m-release:0ms;--m-quick:100ms;--m-in:120ms;--m-move:120ms}
  @keyframes ihk-in{from{opacity:.01}}   @keyframes ihk-pop{from{opacity:.01}}  @keyframes ihk-drop{from{opacity:.01}}
  @keyframes ihk-keep{from{opacity:.01}} @keyframes ihk-fwd{from{opacity:.01}}  @keyframes ihk-back{from{opacity:.01}}
  @keyframes ihk-beat{from{opacity:.01}} @keyframes ihk-up{from{opacity:.01}}   @keyframes ihk-down{from{opacity:.01}}
  @keyframes ihk-out{to{opacity:0}}      @keyframes ihk-sink{to{opacity:0}}
  @keyframes ihk-tick{to{}} @keyframes ihk-land{to{}} @keyframes ihk-drain{to{}}   /* nothing moves; the static state says it */
  @keyframes ihk-look{0%,99.9%{outline-color:#1b1a17}to{outline-color:rgba(27,26,23,0)}}   /* a step: 600 ms, no fade */
}
/* tests and screenshots: everything instant (motion.js also makes no ghosts, glides or flights) */
:root[data-motion=off] *,:root[data-motion=off] *::before,:root[data-motion=off] *::after{
  animation-duration:0s!important;animation-delay:0s!important;transition-duration:0s!important;transition-delay:0s!important}
/* focus ring by modality (data-input set by motion.js in the library and in the game's window) */
:root[data-input=pointer] :focus-visible:not(input,textarea,select){outline-color:transparent}
`;

const DUR = { press: 80, release: 160, quick: 140, in: 200, move: 240 };       // the tokens, ms
const CALM = { press: 0, release: 0, quick: 100, in: 120, move: 120 };         // … under «менше руху»
const EASE = { out: ['--m-ease-out', 'cubic-bezier(.2,.8,.3,1)'], in: ['--m-ease-in', 'cubic-bezier(.55,0,.8,.3)'],
  move: ['--m-ease-move', 'cubic-bezier(.4,0,.2,1)'], spring: ['--m-spring', 'cubic-bezier(.3,1.45,.55,1)'] };
// each keyframe: its duration (a token, or ms) and easing
const KIND = {
  'ihk-in': ['in', 'out'], 'ihk-pop': ['in', 'out'], 'ihk-drop': ['in', 'out'], 'ihk-keep': ['in', 'out'], 'ihk-fwd': ['in', 'out'],
  'ihk-back': ['in', 'out'], 'ihk-fade': ['in', 'out'], 'ihk-beat': ['in', 'out'], 'ihk-up': ['in', 'out'], 'ihk-down': ['in', 'out'],
  'ihk-out': ['quick', 'in'], 'ihk-sink': ['quick', 'in'], 'ihk-fade-out': ['quick', 'in'],
  'ihk-tick': ['move', 'move'], 'ihk-land': ['move', 'spring'],
  'ihk-look': [700, 'out'],                              // (a step of 600 ms under «менше руху»)
  'ihk-drain': [2400, 'linear']                          // (a hold: say its own duration)
};
const LATE = 150;                                        // an animationend may never come (display:none): a timeout too
const BUSY_AFTER = 300, BUSY_MIN = 500;
const r2 = x => Math.round(x * 100) / 100;

export function mode(node) {
  const doc = !node ? globalThis.document : node.documentElement ? node : node.ownerDocument;
  const html = doc && doc.documentElement;
  if (!html || !html.getAttribute || html.getAttribute('data-motion') === 'off') return 'off';
  try { const w = doc.defaultView; if (w && w.matchMedia && w.matchMedia('(prefers-reduced-motion: reduce)').matches) return 'reduced'; } catch (e) {}
  return 'full';
}

const plays = new WeakMap();                             // el → its play's token: a newer play() or stop() ends the older
const ours = new WeakSet();                              // the elements whose inline animation play() set
export function stop(el) {
  if (!el || typeof el !== 'object') return;
  plays.set(el, (plays.get(el) || 0) + 1);
  if (ours.has(el)) { ours.delete(el); el.style.animation = ''; }
}
export function play(el, name, o = {}) {
  const m = mode(el);
  stop(el);
  if (!el || !name || m === 'off' || !el.isConnected) { if (o.done) o.done(); return Promise.resolve(false); }
  const tok = plays.get(el), [d, e] = KIND[name] || ['in', 'out'];
  const dur = o.duration != null ? o.duration : name === 'ihk-look' && m === 'reduced' ? 600 : d;
  const ms = typeof dur === 'number' ? dur : (m === 'reduced' ? CALM : DUR)[dur];
  const css = typeof dur === 'number' ? dur + 'ms' : 'var(--m-' + dur + ',' + DUR[dur] + 'ms)';
  const ease = EASE[e] ? 'var(' + EASE[e][0] + ',' + EASE[e][1] + ')' : e;
  const delay = m === 'reduced' ? 0 : o.delay || 0;
  el.style.animation = 'none';
  try { void el.ownerDocument.defaultView.getComputedStyle(el).animationName; } catch (err) {}   // (a style flush: the same name restarts)
  el.style.animation = name + ' ' + css + ' ' + ease + ' ' + delay + 'ms both';
  ours.add(el);
  return new Promise(resolve => {
    // (animationend only: a restart's animationcancel of the older one comes after the newer started)
    const end = ev => {
      if (ev && (ev.target !== el || ev.animationName !== name)) return;
      el.removeEventListener('animationend', end);
      clearTimeout(timer);
      if (plays.get(el) !== tok) { resolve(false); return; }
      if (!o.keep) { ours.delete(el); el.style.animation = ''; }
      if (o.done) o.done();
      resolve(true);
    };
    const timer = setTimeout(end, ms + delay + LATE);
    el.addEventListener('animationend', end);
  });
}

/* ---------- ghosts: the copy that plays what left ---------- */
const STRIP = ['id', 'role', 'for', 'name', 'tabindex', 'aria-live', 'autofocus', 'autoplay', 'accesskey'];
const FOCUSABLE = /^(a|button|input|select|textarea|summary|details)$/;
const fxs = new WeakMap();                               // document → its fx layer
function fxLayer(doc) {
  let fx = fxs.get(doc);
  if (fx && fx.isConnected) return fx;
  fx = doc.createElement('div');
  fx.setAttribute('class', 'ihk-fx'); fx.setAttribute('aria-hidden', 'true'); fx.setAttribute('inert', '');
  Object.assign(fx.style, { position: 'fixed', left: '0', top: '0', right: '0', bottom: '0', zIndex: '2147483647', pointerEvents: 'none', overflow: 'hidden' });
  (doc.body || doc.documentElement).append(fx);
  fxs.set(doc, fx);
  return fx;
}
// one node of the copy (s: the same node of the original): no ids, roles, names or tab stops; what a copy would not
// show as it was (pixels, a typed value) put back; what a copy must never be (a frame that would load the game again, a
// waiting screen that the library would count) made plain
function tidy(n, s, doc, noInert) {
  for (const a of STRIP) n.removeAttribute(a);
  if (n.style) n.style.animation = '';
  const tag = n.localName, plain = () => {
    const p = doc.createElement('div');
    for (const a of ['class', 'style']) if (n.hasAttribute(a)) p.setAttribute(a, n.getAttribute(a));
    return p;
  };
  try {
    if (tag === 'canvas') { n.width = s.width; n.height = s.height; n.getContext('2d').drawImage(s, 0, 0); }
    else if (tag === 'input' || tag === 'textarea') n.value = s.type === 'password' ? '•'.repeat(s.value.length) : s.value;
    else if (tag === 'select') n.selectedIndex = s.selectedIndex;
    else if (tag === 'video') {
      const c = doc.createElement('canvas'), b = s.getBoundingClientRect();
      for (const a of ['class', 'style']) if (n.hasAttribute(a)) c.setAttribute(a, n.getAttribute(a));
      Object.assign(c.style, { width: b.width + 'px', height: b.height + 'px', objectFit: 'cover', background: '#000' });
      c.width = s.videoWidth || 1; c.height = s.videoHeight || 1;
      n.replaceWith(c);
      c.getContext('2d').drawImage(s, 0, 0);
    } else if (tag === 'iframe' || tag === 'audio') n.replaceWith(plain());
    else if (tag === 'ihroteka-wait') { if (!n.children.length) n.remove(); else { const p = plain(); p.append(...n.childNodes); n.replaceWith(p); } }
  } catch (e) {}
  if (noInert && FOCUSABLE.test(tag)) n.setAttribute('tabindex', '-1');   // (no inert: Safari before 15.5)
}
// what still moves in el by script (a flight, a glide) moves on in the copy, from where it is
function replay(el, from, to) {
  let list = [];
  try { list = el.getAnimations ? el.getAnimations({ subtree: true }) : []; } catch (e) {}
  for (const a of list) {
    const i = a.effect && a.effect.target ? from.indexOf(a.effect.target) : -1;
    if (i < 0 || 'animationName' in a || 'transitionProperty' in a) continue;   // (CSS: the copy's own, or stripped)
    try { const b = to[i].animate(a.effect.getKeyframes(), a.effect.getTiming()); b.currentTime = a.currentTime; } catch (e) {}
  }
}
export function ghost(el, name = 'ihk-fade-out', o = {}) {
  if (!el || mode(el) === 'off' || !el.isConnected) return null;
  const doc = el.ownerDocument, r = el.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  // (an entry of play()'s still under way: the copy has none, so it starts as el is seen now, not from full sight)
  let look = '';
  if (ours.has(el)) try { look = doc.defaultView.getComputedStyle(el).opacity || ''; } catch (e) {}
  const c = el.cloneNode(true), from = [el, ...el.querySelectorAll('*')], to = [c, ...c.querySelectorAll('*')];
  const H = doc.defaultView && doc.defaultView.HTMLElement, noInert = !H || !('inert' in H.prototype);
  for (let i = 0; i < to.length; i++) tidy(to[i], from[i], doc, noInert);
  const fx = fxLayer(doc), q = fx.getBoundingClientRect();
  c.setAttribute('aria-hidden', 'true'); c.setAttribute('inert', ''); c.removeAttribute('hidden');
  Object.assign(c.style, { position: 'absolute', left: r.left - q.left + 'px', top: r.top - q.top + 'px', width: r.width + 'px', height: r.height + 'px',
    right: 'auto', bottom: 'auto', margin: '0', transform: 'none', translate: 'none', scale: 'none', rotate: 'none', maxWidth: 'none', maxHeight: 'none',
    minWidth: '0', minHeight: '0', boxSizing: 'border-box', pointerEvents: 'none', visibility: 'visible', zIndex: 'auto' });
  if (look) c.style.opacity = look;
  fx.append(c);
  replay(el, from, to);
  if (o.inner) o.inner(c);
  play(c, name, { keep: true, done: () => c.remove() });
  return c;
}

// A decoration of the caller's own (a page-coloured veil, a copy of a card in flight; made fresh, with no ids) in the fx
// layer, unheard and untouchable. o: doc; at (a rect: where it stands, absolutely); under (below what fades there
// already: a veil under the ghost of a dialog that just closed); name (an animation it plays, and it is removed after:
// else the caller removes it), duration, delay, done. Motion off: nothing (→ null, done at once).
export function overlay(node, o = {}) {
  const doc = o.doc || globalThis.document;
  if (!node || mode(doc) === 'off') { if (o.done) o.done(); return null; }
  node.setAttribute('aria-hidden', 'true'); node.setAttribute('inert', '');
  node.style.pointerEvents = 'none';
  const fx = fxLayer(doc);
  if (o.at) { const q = fx.getBoundingClientRect(); Object.assign(node.style, { position: 'absolute', left: o.at.left - q.left + 'px', top: o.at.top - q.top + 'px', width: o.at.width + 'px', margin: '0' }); }
  if (o.under) fx.prepend(node); else fx.append(node);
  if (o.name) play(node, o.name, { duration: o.duration, delay: o.delay, keep: true, done: () => { node.remove(); if (o.done) o.done(); } });
  return node;
}

/* ---------- decorative elements: fade and hide ---------- */
const hiding = new WeakMap();                            // el → its aria-hidden before fadeHide (put back once hidden)
function unhear(el, on) {
  if (on) { if (!hiding.has(el)) hiding.set(el, el.getAttribute('aria-hidden')); el.setAttribute('aria-hidden', 'true'); return; }
  if (!hiding.has(el)) return;
  const was = hiding.get(el);
  hiding.delete(el);
  if (was == null) el.removeAttribute('aria-hidden'); else el.setAttribute('aria-hidden', was);
}
export function fadeHide(el, o = {}) {
  const done = () => { if (o.done) o.done(); };
  if (!el || el.hidden) { done(); return Promise.resolve(false); }
  if (mode(el) === 'off' || !el.isConnected) { stop(el); unhear(el, false); el.hidden = true; done(); return Promise.resolve(false); }
  unhear(el, true);
  return play(el, 'ihk-fade-out', { keep: true, done: () => { el.hidden = true; stop(el); unhear(el, false); done(); } });
}

/* ---------- moves: glides (FLIP) and flights ---------- */
const glides = new WeakMap();                            // el → its glide, cancelled by the next one
export function flip(els, change) {
  els = [...els].filter(Boolean);
  if (!els.length || mode(els[0]) !== 'full') { change(); return; }
  const before = els.map(e => e.getBoundingClientRect());          // (all reads, then the change, then all writes)
  for (const e of els) { const g = glides.get(e); if (g) { g.cancel(); glides.delete(e); } }
  change();
  const after = els.map(e => e.isConnected ? e.getBoundingClientRect() : null);
  els.forEach((e, i) => {
    const a = before[i], b = after[i];
    if (!b || !a.width || !a.height || !b.width || !b.height) return;
    const dx = a.left - b.left, dy = a.top - b.top, sx = a.width / b.width, sy = a.height / b.height;
    const scaled = Math.abs(sx - 1) > .004 || Math.abs(sy - 1) > .004;
    if (Math.abs(dx) < .5 && Math.abs(dy) < .5 && !scaled) return;
    const t = 'translate(' + r2(dx) + 'px,' + r2(dy) + 'px)' + (scaled ? ' scale(' + r2(sx) + ',' + r2(sy) + ')' : '');
    try { glides.set(e, e.animate([{ transformOrigin: '0 0', transform: t }, { transformOrigin: '0 0', transform: 'none' }], { duration: DUR.move, easing: EASE.move[1] })); } catch (err) {}
  });
}
export function settle(els) {
  for (const e of els) {
    const g = e && glides.get(e);
    if (g) { glides.delete(e); try { g.finish(); } catch (err) {} }
  }
}
export function fly(el, from, to, o = {}) {
  const none = () => { if (o.done) o.done(); return null; };
  if (!el || !from || mode(el) !== 'full' || !el.isConnected) return none();
  const at = el.getBoundingClientRect();
  if (!at.width || !from.width) return none();
  const place = p => 'translate(' + r2(p.left - at.left) + 'px,' + r2(p.top - at.top) + 'px) scale(' + r2(p.width / at.width) + ')';
  let a = null;
  try {
    a = el.animate([{ transformOrigin: '0 0', transform: place(from) }, { transformOrigin: '0 0', transform: to ? place(to) : 'none' }],
      { duration: o.duration || DUR.move, easing: EASE.move[1], fill: to ? 'forwards' : 'none' });
  } catch (e) { return none(); }
  if (o.done && a.finished) a.finished.then(() => o.done(), () => o.done());
  return a;
}

/* ---------- colours and fonts ---------- */
export function tint(el, from, to, o = {}) {
  const m = el && mode(el);
  if (!m || m === 'off' || !el.animate) return null;
  try { return el.animate([{ backgroundColor: from }, { backgroundColor: to }], { duration: o.duration || DUR.quick, easing: m === 'reduced' ? 'step-end' : o.easing || 'linear' }); } catch (e) { return null; }
}
export function typeset(doc, ms, first = null) {
  let fonts = null;
  try {
    const fs = doc && doc.fonts;
    if (fs && fs.load) fonts = Promise.resolve(first).then(() => Promise.all([fs.load('500 16px "Inter Tight"'), fs.load('700 16px Oswald')]));
  } catch (e) {}
  return Promise.race([Promise.resolve(fonts).catch(() => {}), new Promise(done => setTimeout(done, ms))]);
}

/* ---------- a button that waits: in place, after 300 ms, for 500 ms at least ---------- */
const busies = new WeakMap();                            // button → { timer, shown, kept: its own children, leave, dones }
export function busy(btn, text) {
  if (!btn || mode(btn) === 'off') return;
  const st = busies.get(btn);
  if (st) {                                              // pressed again while its look was leaving: it stays
    if (st.leave) { clearTimeout(st.leave); st.leave = 0; for (const f of st.dones.splice(0)) f(); }
    return;
  }
  const s = { timer: 0, shown: 0, kept: null, leave: 0, dones: [] };
  s.timer = setTimeout(() => {
    s.timer = 0; s.shown = Date.now(); s.kept = [...btn.childNodes];
    const doc = btn.ownerDocument, ring = doc.createElement('span'), words = doc.createElement('span');
    ring.setAttribute('class', 'spin'); ring.setAttribute('aria-hidden', 'true');
    words.textContent = text || btn.textContent;
    btn.classList.add('is-busy'); btn.setAttribute('aria-busy', 'true');
    btn.replaceChildren(ring, words);
    play(words, 'ihk-fade', { duration: 'quick' });
  }, BUSY_AFTER);
  busies.set(btn, s);
}
export function free(btn, o = {}) {
  const s = btn && busies.get(btn);
  return new Promise(resolve => {
    const fin = () => { if (o.done) o.done(); resolve(); };
    if (!s) { fin(); return; }
    if (s.timer) { clearTimeout(s.timer); busies.delete(btn); fin(); return; }   // (an answer within 300 ms: no look at all)
    s.dones.push(fin);
    if (s.leave) return;
    const back = () => {
      busies.delete(btn);
      btn.classList.remove('is-busy'); btn.removeAttribute('aria-busy');
      btn.replaceChildren(...s.kept);
      for (const f of s.dones.splice(0)) f();
    };
    const left = s.shown + BUSY_MIN - Date.now();
    if (left > 0) s.leave = setTimeout(back, left); else back();
  });
}

export function later(ms, fn) {
  const t = setTimeout(fn, ms);
  return () => clearTimeout(t);
}

/* ---------- install: the vocabulary, the switch and the modality in a document ---------- */
const docs = new Set();                                  // the documents installed (the modality goes to each)
const KEYS = /^(Tab|Escape)$/, MOVES = /^(Enter| |Spacebar|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown)$/;
// a navigation key (Tab, Escape anywhere; Enter, Space, arrows outside a text field), not a shortcut
function navigates(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return false;
  const t = e.target, field = !!t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || !!t.isContentEditable);
  return KEYS.test(e.key) || (!field && MOVES.test(e.key));
}
function modality(v) {
  for (const d of docs) {
    const h = d.documentElement;
    if (!d.defaultView || !h) { docs.delete(d); continue; }   // (a closed game's)
    if (h.getAttribute('data-input') !== v) h.setAttribute('data-input', v);
  }
}
const switchedOff = win => { try { return win.__ihrotekaMotion === 'off' || (!!win.localStorage && win.localStorage.getItem('ihroteka-motion') === 'off'); } catch (e) { return false; } };
// the <html> of the library around a game's window (null: the library's own window, or another site around it)
const libraryHtml = win => { try { const p = win && win.parent; return p && p !== win && p.document ? p.document.documentElement : null; } catch (e) { return null; } };
export function install(doc = globalThis.document, win = doc && doc.defaultView) {
  const html = doc && doc.documentElement;
  if (!html) return;
  const head = doc.head || html, kids = [...head.children];
  if (!kids.some(n => n.hasAttribute && n.hasAttribute('data-ihroteka-motion'))) {
    const s = doc.createElement('style');
    s.setAttribute('data-ihroteka-motion', '');
    s.textContent = MOTION_CSS;
    const own = kids.find(n => n.localName === 'style' || (n.localName === 'link' && /(^|\s)stylesheet(\s|$)/i.test(n.getAttribute('rel') || '')));
    head.insertBefore(s, own || null);
  }
  html.setAttribute('data-ihroteka', '');
  const lib = libraryHtml(win);
  if ((win && switchedOff(win)) || (lib && lib.getAttribute('data-motion') === 'off')) html.setAttribute('data-motion', 'off');
  if (lib && lib.hasAttribute('data-input') && !html.hasAttribute('data-input')) html.setAttribute('data-input', lib.getAttribute('data-input'));
  if (docs.has(doc)) return;
  docs.add(doc);
  if (!win) return;
  win.addEventListener('pointerdown', () => modality('pointer'), true);
  win.addEventListener('keydown', e => { if (navigates(e)) modality('key'); }, true);
  doc.addEventListener('touchstart', () => {}, { passive: true });   // (as iPhones need it: on the document)
}
