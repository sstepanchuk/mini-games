/* =====================================================================
   The library after sign-in: one page for everything. The shelf and the open game are views of it;
   the game runs in a frame, so leaving it never reloads the library, and the room with a friend
   (together.js) lives on from game to game. Addresses stay real: <root> is the shelf, <root><id>/ a game.
   A game that breaks while it starts (an error in its window or its listeners before START ms after its page loaded)
   leaves no empty screen: the stage says «Гра зламалася» and offers «Відкрити ще раз» and the report (together.js
   report) to copy.
   A game that did not open says why over it, with «Спробувати ще» (or «Ввести пароль» after a cancelled password):
   it opens that game again on this device only, without taking the room anywhere. A cancelled password takes the room
   back to the shelf only from the player who opened the game (together.js ownView); anyone else stays over it.
   A game's copy speaks the wire of its own code (api), which a page open since before a deploy may not have on its
   shelf; and the page reloads into a newer version only once its offline copy is in place (reload, update.js), never
   under the password dialog (busy).
   Motion (motion.js; the UX spec L-T05…L-T13, L-T25, L-T26, L-T38). State first: what shows, what is hidden, inert or
   heard, and the focus change in the same task as with no motion at all; motion only decorates it.
   - Opening a game: the stage shows the opening card (the game's cover and title, who opened it when we follow; after
     300 ms «Відкриваю гру…» and «До бібліотеки») in its note, over the frame. Over the shelf, the shelf is inert and
     unheard at once and hidden once the note's page-coloured layer has faded in over it (200 ms); meanwhile the card
     flies from the tapped one (hidden as it flies) and the frame is unseen (nothing shows through the layer). The game
     shows when it is ready (its page loaded, its fonts in, 150 ms at most, and one frame): the note goes at once, its
     ghost fades (a flight still under way goes on in it), and the game has the focus (not from a library dialog open
     then). The note is never blank: the opening card, a card that says what happened, or the game.
   - Back on the shelf: at once, with its scroll, under a page-coloured veil that fades off; a copy of the opening card
     flies back into the game's card, which lands, is marked for 900 ms and has the focus. Following the room there:
     «Аня повертає всіх до бібліотеки».
   - A game that broke as it starts stays in sight under a veil, under a card: «Гра зламалася», what can be done,
     «Відкрити ще раз» (focused), «Скопіювати звіт», «До бібліотеки».
   - Each game's window gets the motion vocabulary at attach (motion.js install, before its own styles: those win).
   Motion off (the tests' switch): no layer, flight, veil or mark; the shelf hidden and the game shown as they always
   were, at the same moment.
   ===================================================================== */
import { $, copy, copyLabels, dialogOpen, el, btn, iso, root, safe, toast } from './dom.js';
import { initInvite, openDialog } from './invite.js';
import { fly, ghost, install, later, mode, overlay, play, typeset } from './motion.js';
import { attachScreens, detachScreens, waitScreen, state as screens } from './screens.js';
import { attachGame, currentRoom, detachGame, gameError, initTogether, leave, openRound, ownView, pageError, query, report, state, viewChanged } from './together.js';
import * as trace from './trace.js';
import { newerThanPage, updateCopy } from './update.js';

let games = [], current, frame = null, load = null, loads = 0;   // current: the open game id, null on the shelf (undefined before the first view)
let again = null;                                       // the open that failed, to try again («Спробувати ще»); null: none
const START = 5000;                                      // an error this soon after the game's page loaded (or before) is a broken start
let loaded = 0, broke = false;                           // the open game's page: when it loaded (0: not yet); whether it broke starting
let opened = null;                                       // the open game's open: { g, byPeer } («Відкрити ще раз»)
// Going back to the shelf is history.back() when the shelf is the entry before (Back then works as expected);
// the view shows when popstate comes. Meanwhile: who asked (following, and their name: by), and a view asked for since (queued).
const DOC = Math.random().toString(36).slice(2);       // marks this page's own history entries (not those of a reload)
let backing = false, following = false, by = null, queued = null;
// the stage's look (motion): the shelf's cards; the note's parts (made at start from page.html's); the opening card
// (with its 300 ms: more); the stage coming in over the shelf until its layer is opaque (entry: { t, from: the tapped
// card }); the shelf's scroll as a game covered it; whether we made the shelf inert; the next way back has no flight
const cards = new Map();
let bg = null, box = null, line = null, card = null, more = null, entry = null, kept = 0, inerted = false, noFlight = false;
const marks = new WeakMap();                             // a card marked as the one the game came from → its timer

/**
 * games         [{ id, title, tagline, image, emoji, players, wire, camera, microphone }] (wire: game.json "wire"; 1 when
 *               not given; camera, microphone: true when its frame may use it, game.json "camera", "microphone")
 * initial       the game this page was opened at, if any
 * loader        game → Promise<{ srcdoc } | { src }>: its page (decrypted, or in dev from disk); rejects with
 *               error.cancelled when the player does not give the password, else with error.say (what to tell the
 *               player) and error.final (trying again cannot help)
 * signOut       () → Promise<boolean>: forget the password on this device (false: it may still be remembered)
 * whenSignedIn  (fn) → calls fn once this device knows the password
 * busy          () → whether the password dialog is open (the page then does not reload itself: together.js)
 * The views it gives together.js and invite.js: current(), follow(id, by) (by: the name of whoever chose it, if known),
 * invite(), address(), seats(id), wires(), reload(still, later), gameError(), busy(), newer() → Promise<boolean>
 * (whether the site has a newer version than this page: update.js newerThanPage; false with no offline copy: the dev
 * server).
 */
export function startShell({ games: list, initial, loader, signOut, whenSignedIn, busy }) {
  games = list; load = loader;
  // the game's page asks for the library API (see game-api.js), and says where its waiting screens are (<ihroteka-wait>:
  // screens.js); state, screens and trace: for checks from the console and tests
  window.__ihroteka = { attach: (win, info) => win === frame?.contentWindow ? api(info, win) : undefined,
    waitScreen: (el, on) => { if (frame && el && el.ownerDocument === frame.contentDocument) waitScreen(el, on); },
    screens, state, trace: trace.read };
  addEventListener('error', e => { if (notice(e)) trace.note('the page\'s ResizeObserver looped (a notice)'); else pageError(e.error, e); });
  addEventListener('unhandledrejection', e => pageError(e.reason));
  noteParts();
  $('stage-report').addEventListener('click', e => copy(report(), e.target));
  $('games').replaceChildren(...games.map(cardOf));
  $('stage-back').addEventListener('click', () => go(null));
  $('stage-retry').addEventListener('click', () => { const f = again; again = null; if (f) f(); });   // (this device only: no go())
  if (signOut) {
    // «Забути пароль на цьому пристрої»: gone once the device forgot; when it may still remember, it stays and says so
    const out = $('sign-out'), said = $('sign-out-err');
    out.addEventListener('click', async () => {
      out.disabled = true; said.textContent = '';
      leave();
      const ok = await signOut();
      out.disabled = false;
      if (ok === false) said.textContent = 'Не вдалося забути пароль. Закрий вкладку й спробуй ще раз.';
      else out.hidden = true;
    });
    whenSignedIn(() => { out.hidden = false; said.textContent = ''; });
  }
  addEventListener('popstate', () => {
    const byPeer = following || !!(queued && queued[1]);   // a friend's newer choice came meanwhile: the shelf on the way is not ours to announce
    const who = following && !queued ? by : null;
    backing = following = false; by = null;
    show(fromAddress(), byPeer, who);
    history.replaceState(history.state, '', address(current));   // the room in the address (?room=) is today's, not that entry's
    if (queued) { const [id, p, w] = queued; queued = null; go(id, p, w); }
  });
  $('busy').hidden = true;
  const views = { current: () => current ?? null, follow: (id, who) => go(id, true, typeof who === 'string' ? who : null), invite: openDialog, address: () => address(current),
    seats: id => find(id)?.players?.max || 2, wires: () => Object.fromEntries(games.map(g => [g.id, wireOf(g)])), reload,
    gameError: () => { if (frame && (!loaded || performance.now() - loaded < START)) broken(); }, busy: () => !!(busy && busy()), newer };
  initInvite(views);
  initTogether(views);
  show(initial && find(initial) ? initial : null);
}

const find = id => games.find(g => g.id === id);
// a game's wire number (game.json "wire", bumped by hand when its messages change): 1 when not given (an older shelf)
const wireOf = g => Number.isSafeInteger(g.wire) && g.wire > 0 ? g.wire : 1;

// A friend runs a newer version (together.js versionCheck), or the player asks («Оновити»): this page fetches it, its
// offline copy first (update.js, up to 30 s: a reload before the new copy is in place would open this version again),
// then reloads; unless still (when the page does it by itself) says by then that it is no longer the time. With no
// newer copy to reload into (the site has nothing newer yet, no room on the device, no network, still on its way) the
// page stays as it is and says why; later hears how an update that ran past its time ended. Before the reload, a note
// says «Оновлюю Ігротеку…» for 800 ms (the UX spec L-T38; still asked again after it).
// → 'reload' | 'stay' (still said no) | 'same' | 'storage' | 'failed' | 'timeout' (update.js)
async function reload(still, later) {
  let reg = null;
  try { reg = await navigator.serviceWorker?.getRegistration(root.href); } catch (e) {}
  const out = await updateCopy(reg, { later });
  if (out !== 'activated' && out !== 'none') return out;
  if (still && !still()) return 'stay';
  const said = toast('Оновлюю Ігротеку…');
  await new Promise(done => setTimeout(done, 800));
  if (still && !still()) { said(); return 'stay'; }
  location.reload();
  return 'reload';
}
// whether the site has a newer version than this page (update.js newerThanPage; no offline copy here: false)
async function newer() {
  let reg = null;
  try { reg = await navigator.serviceWorker?.getRegistration(root.href); } catch (e) {}
  return newerThanPage(reg);
}
const fromAddress = () => { const id = location.pathname.slice(root.pathname.length).split('/')[0]; return find(id) ? id : null; };
const address = id => new URL((id ? id + '/' : '') + query(), root).href;

// A game's card on the shelf. Its cover on the page's colour: the first four load at once, the rest as they come into
// view; one that comes after the shelf showed fades in as it is decoded (the UX spec I25)
function cardOf(g, i) {
  const img = el('img', { src: coverOf(g), alt: '', loading: i < 4 ? 'eager' : 'lazy' });
  if (!img.complete) img.addEventListener('load', () => { if (!$('shelf').hidden) play(img, 'ihk-fade', { duration: 'quick' }); }, { once: true });
  const a = el('a', { className: 'game', href: address(g.id), onclick: e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(g.id); } } },
    img, el('span', { className: 'game-body' }, el('b', { textContent: g.title }), el('span', { textContent: g.tagline })));
  cards.set(g.id, a);
  return a;
}
const coverOf = g => new URL(g.id + '/' + g.image, root).href;

// Go to a view. From the shelf into a game is a step in history (Back returns to the shelf); everything else
// replaces the current entry. byPeer: the friend went there (we follow, and do not tell them back); who: their name.
// A game this library does not have (the friend's library may be newer) means the shelf.
export function go(id, byPeer = false, who = null) {
  if (id && !find(id)) id = null;
  if (backing) { queued = [id, byPeer, who]; return; }
  if (id === current) return;
  if (!id && history.state?.doc === DOC) { backing = true; following = byPeer; by = who; history.back(); return; }
  if (id && !current) history.pushState({ doc: DOC }, '', address(id));
  else history.replaceState(history.state, '', address(id));
  show(id, byPeer, who);
}

// The view: the shelf or a game, in this task (state first); then what moves (see the top).
function show(id, byPeer = false, who = null) {
  if (id === current) return;
  const shelf = $('shelf'), stage = $('stage'), g = id && find(id), first = current === undefined, m = mode();
  const back = !g && !stage.hidden ? leaving() : null;  // (measured before anything goes)
  const from = g && !shelf.hidden && m !== 'off' ? cards.get(id) || null : null;   // a game over the shelf as it is seen: its layer fades in over it
  noFlight = false;
  closeFrame();
  current = id;
  document.title = g ? g.title : 'Ігротека';
  if (g) {
    if (!shelf.hidden) kept = scrollY;
    if (from) {
      shelf.setAttribute('aria-hidden', 'true');
      if (!shelf.inert) { shelf.inert = true; inerted = true; }
    } else shelf.hidden = true;
    stage.hidden = false;
  } else {
    shelf.hidden = false;
    shelf.removeAttribute('aria-hidden');
    if (inerted) { inerted = false; if (!dialogOpen()) shelf.inert = false; }
    stage.hidden = true;
    if (kept) { scrollTo(0, kept); kept = 0; }
  }
  viewChanged(id, byPeer);
  if (g) openFrame(g, byPeer, { from, who });
  else if (back) backTo(back, byPeer, who);
  else if (first) play(shelf, 'ihk-fade');              // (the page as it starts: the shelf comes in as one)
}

/* ---------- the note over the game: the opening card, or a card that says what happened ---------- */
// The note's parts, from page.html's: its layer (.note-bg: the page's colour, or a veil over a game that broke), and a
// card for what happened (#stage-text, a line under it, #stage-retry, #stage-report, #stage-back)
function noteParts() {
  const note = $('stage-note');
  bg = el('div', { className: 'note-bg' });
  line = el('p');
  $('stage-report').classList.add('second');           // (the other choice: «Відкрити ще раз» is the one that matters)
  box = el('div', { className: 'card note-card' }, $('stage-text'), line, $('stage-retry'), $('stage-report'), $('stage-back'));
  box.setAttribute('role', 'alert');
  box.hidden = true;
  note.classList.add('layered');
  note.replaceChildren(bg, box);
}
// what the card says: its first line (cls: 'err' something went wrong, '' a neutral note, 'head' its heading), and
// what can be done (more)
function say(text, cls, also = '') {
  const t = $('stage-text');
  t.textContent = text;
  t.className = cls;
  if (cls === 'head') { t.setAttribute('role', 'heading'); t.setAttribute('aria-level', '2'); } else { t.removeAttribute('role'); t.removeAttribute('aria-level'); }
  line.textContent = also;
  line.hidden = !also;
}
// The opening card: the game's cover and title; who opened it, when we follow them; then (rest) a status and «До
// бібліотеки», in their place from the start (the status empty, the button unseen: .wait) and said and seen after
// 300 ms (a live region there before it speaks). bare: a copy to fly (nothing to say, read or press).
function openCard(g, who, bare = false) {
  const body = el('div', { className: 'game-body' }, el('b', { textContent: g.title }));
  const c = el('div', { className: 'open-card' }, coverArt(g), body);
  if (bare) return { c };
  if (who) body.append(el('p', { className: 'who', textContent: iso(who) + ' відкриває «' + g.title + '»…' }));
  const status = el('p'), home = btn('До бібліотеки', () => go(null), 'btn ghost'), rest = el('div', { className: 'later wait' }, status, home);
  status.setAttribute('role', 'status');
  body.append(rest);
  return { c, status, home, rest };
}
// The cover as the shelf shows it, drawn from the shelf's own decoded picture: a new <img> of a large picture may paint
// blank for a frame or two while it is decoded again (as the card flies, as it is copied). Not decoded yet (a page
// opened at a game's address): the picture itself.
function coverArt(g) {
  const from = cards.get(g.id)?.querySelector('img');
  if (from && from.complete && from.naturalWidth) {
    try {
      const art = el('canvas'), w = Math.round(328 * Math.min(devicePixelRatio || 1, 3));
      art.width = w;
      art.height = Math.round(w * from.naturalHeight / from.naturalWidth);
      art.getContext('2d').drawImage(from, 0, 0, art.width, art.height);
      art.setAttribute('aria-hidden', 'true');
      return art;
    } catch (e) {}
  }
  return el('img', { src: coverOf(g), alt: '' });
}
// the note shows a card that says what happened instead of the opening card (which fades as it goes); veil: over a game
// that broke (its layer lets it show through)
function noteCard(veil) {
  const note = $('stage-note');
  stopMore();
  if (card) { if (!note.hidden) ghost(card.c); card.c.remove(); card = null; }
  bg.classList.toggle('veil', !!veil);
  box.hidden = false;
  if (note.hidden) { note.hidden = false; play(bg, 'ihk-fade'); }
  play(box, 'ihk-in');
}
const stopMore = () => { if (more) { more(); more = null; } };

// byPeer: the friend opened it (who: their name, if known). A cancelled password takes the room back to the shelf only
// from the one who opened the game (we followed, or the room's view is someone else's: a page that came back to the
// game's address in a room, or a room link made over a game; together.js ownView); anyone else stays over it, and the
// room stays in the game. A failure that trying again may mend offers «Спробувати ще» («Ввести пароль» after a
// cancelled password): the same game, opened again here only (the room's view is not said again). from: the card on
// the shelf to fly from (the stage comes in over the shelf).
async function openFrame(g, byPeer, { from = null, who = null } = {}) {
  const t = ++loads, note = $('stage-note'), retry = $('stage-retry'), me = currentRoom()?.me;
  loaded = 0; broke = false; opened = { g, byPeer };
  note.classList.remove('over');
  $('stage-report').hidden = true;
  again = null; retry.hidden = true;
  say('', '');
  stopMore();
  card = openCard(g, who && who !== me ? who : null);
  bg.className = 'note-bg';
  box.hidden = true;
  note.replaceChildren(bg, card.c, box);
  note.hidden = false;
  // after 300 ms (at once with motion off: as the note always said it), «Відкриваю гру…» and «До бібліотеки»
  const o = card, said = () => { if (t !== loads) return; o.status.className = 'busy'; o.status.textContent = 'Відкриваю гру…'; o.rest.classList.remove('wait'); play(o.rest, 'ihk-fade'); };
  if (mode() === 'off') said(); else more = later(300, said);
  if (from) enter(t, from, card.c); else play(card.c, 'ihk-fade');
  let page;
  try { page = await load(g); }
  catch (e) {
    if (t !== loads || current !== g.id) return;
    if (e.cancelled && !byPeer && ownView(g.id)) { noFlight = true; go(null); return; }   // no password: back to the shelf
    if (!e.cancelled) console.error(e);
    say(e.cancelled ? 'Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.' : e.say || 'Не вдалося відкрити гру. Онови сторінку.', e.cancelled ? '' : 'err');
    if (!e.final) {
      again = () => openFrame(g, byPeer);
      retry.textContent = e.cancelled ? 'Ввести пароль' : 'Спробувати ще';
      retry.hidden = false;
    }
    noteCard(false);
    if (!e.final) safe(() => retry.focus());
    return;
  }
  if (t !== loads || current !== g.id) return;          // switched elsewhere meanwhile (or reopened: a newer load is on its way)
  const f = frame = el('iframe', { className: 'frame', title: g.title });
  frame.allow = allowOf(g);
  frame.setAttribute('allowfullscreen', '');
  if (entry) frame.classList.add('covered');             // (unseen until the layer over it is opaque)
  if (page.srcdoc != null) frame.srcdoc = page.srcdoc; else frame.src = page.src;
  frame.addEventListener('load', () => {
    loaded = performance.now();
    if (broke) return;
    if (mode() === 'off') reveal(t, f);
    else ready(f).then(() => requestAnimationFrame(() => reveal(t, f)));
  }, { once: true });
  note.after(frame);                                     // (before the card over it: the game first, in Tab and reading order)
}

// The stage comes in over the shelf (it shows the shelf through while its layer fades in): the opening card flies
// from the tapped card (hidden meanwhile; «менше руху»: it fades in with the layer), and once the layer is opaque the
// shelf leaves the page (settle).
function enter(t, from, c) {
  const r = from.getBoundingClientRect();
  entry = { t, from };
  $('stage').classList.add('entering');
  from.classList.add('lifted');
  if (mode() !== 'full' || !fly(c, r)) play(c, 'ihk-fade');
  play(bg, 'ihk-fade', { done: () => { if (entry && entry.t === t) settle(); } });
}
// the layer is opaque (or the game shows before that): the shelf is hidden, the frame may be seen
function settle() {
  if (!entry) return;
  const { from } = entry;
  entry = null;
  $('stage').classList.remove('entering');
  if (frame) frame.classList.remove('covered');
  if (current) $('shelf').hidden = true;
  from.classList.remove('lifted');
}
// the game's page is ready to be seen: its fonts in (150 ms at most: a srcdoc frame may not ask for them before it
// paints), then a frame
function ready(f) {
  let doc = null;
  try { doc = f.contentDocument; } catch (e) {}
  return typeset(doc, 150);
}
// The game shows: the note goes at once, its ghost fades over the game (from where its layer and card were), and the
// game has the focus, unless a library dialog has it (a name being typed: its keys stay in its field)
function reveal(t, f) {
  if (t !== loads || f !== frame || broke) return;
  const note = $('stage-note');
  settle();
  stopMore();
  if (!note.hidden) {
    const look = [...note.children].map(n => getComputedStyle(n).opacity);
    ghost(note, 'ihk-fade-out', { inner: c => { c.style.zIndex = '0'; [...c.children].forEach((n, i) => { n.style.opacity = look[i]; }); } });
    note.hidden = true;
  }
  if (!dialogOpen()) safe(() => f.contentWindow.focus());
}

// Before the stage goes: the game's card on the shelf, and where the opening card stands (the note shown a moment,
// unpainted, to measure it; none after a cancelled password, or when the note says what happened instead)
function leaving() {
  const c = cards.get(current), note = $('stage-note');
  if (!c || mode() === 'off') return c ? { c } : null;
  let at = null;
  if (card && !noFlight && mode() === 'full') {
    const was = note.hidden;
    note.hidden = false;
    at = card.c.getBoundingClientRect();
    note.hidden = was;
  }
  return { c, at: at && at.width ? at : null, g: find(current) };
}
// Back on the shelf (shown in this task): the card the game came from has the focus (unless a dialog is open, or the
// focus is somewhere already); a page-coloured veil fades off the shelf; a copy of the opening card flies back into
// the card, which then lands; the card is marked for 900 ms. Following the room: «Аня повертає всіх до бібліотеки».
function backTo({ c, at, g }, byPeer, who) {
  const me = currentRoom()?.me;
  if (byPeer && who && who !== me) toast(iso(who) + ' повертає всіх до бібліотеки');
  const a = document.activeElement;
  if (c.isConnected && !dialogOpen() && (!a || a === document.body)) c.focus({ preventScroll: true });
  if (mode() === 'off' || !c.isConnected) return;
  overlay(el('div', { className: 'page-veil' }), { name: 'ihk-fade-out', duration: 'in', under: true });   // (a dialog that just closed fades over it)
  clearTimeout(marks.get(c));
  c.classList.add('came');
  marks.set(c, setTimeout(() => c.classList.remove('came'), 900));
  const to = c.getBoundingClientRect(), land = () => { c.classList.remove('lifted'); play(c, 'ihk-land'); };
  if (!at || !g || !to.width) { land(); return; }
  const copy = openCard(g, null, true).c;
  overlay(copy, { at });
  c.classList.add('lifted');
  fly(copy, at, to, { done: () => { copy.remove(); land(); } });   // (no flight: done at once)
}

// What the game's frame may use (its permissions policy; README: Trust): the camera and the microphone each only for a
// game whose game.json asks for it ("camera": true, "microphone": true, carried by its shelf entry). A frame of our own
// origin would have them unless told 'none'.
const ASKED = ['camera', 'microphone'];
const allowOf = g => ['fullscreen', 'screen-wake-lock', 'autoplay', 'gamepad', ...ASKED.map(f => g[f] === true ? f : f + " 'none'")].join('; ');

// The open game broke while it started: it stays in sight under a veil, and the card over it says so, with «Відкрити
// ще раз» (focused: this device only, as «Спробувати ще»), the report to copy and the way back (out of fullscreen: the
// game has nothing to show there, and its frame in the browser's top layer would cover the note).
function broken() {
  if (broke) return;
  broke = true;
  const report = $('stage-report'), retry = $('stage-retry'), t = loads, o = opened;
  settle();
  say('Гра зламалася', 'head', 'Можна відкрити її ще раз або повернутися до бібліотеки.');
  again = o ? () => { closeFrame(); openFrame(o.g, o.byPeer); } : null;
  retry.textContent = 'Відкрити ще раз';
  retry.hidden = !o;
  report.replaceChildren();
  copyLabels(report, 'Скопіювати звіт');
  report.hidden = false;
  $('stage-note').classList.add('over');
  noteCard(true);
  const first = o ? retry : report;
  // (the focus there; out of fullscreen, tried each frame until it lands: the page may stay inert a moment)
  const focus = (n = 10) => { if (t !== loads) return; safe(() => first.focus()); if (n && document.activeElement !== first) requestAnimationFrame(() => focus(n - 1)); };
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().then(() => focus(), () => {});
  focus(0);
}

function closeFrame() {
  loads++;                                               // a load still running is for nothing now
  again = null;                                          // (a retry never opens a game the room has left)
  stopMore();
  if (entry) { const { from } = entry; entry = null; $('stage').classList.remove('entering'); from.classList.remove('lifted'); }
  if (!frame) return;
  detachGame();
  detachScreens();
  frame.remove();
  frame = null;
}

// A window error with nothing thrown that the browser itself reports: a ResizeObserver whose callback changed the size
// of what it observes (the rest is delivered next frame; Chrome, Firefox and Safari word it so). A layout that settles
// as the game starts may cause it: no broken game, only a line in the trace.
const notice = e => e.error == null && /^ResizeObserver loop/.test(e.message || '');
// A promise the game left rejected because the browser refused or cut short what it asked (a DOMException
// NotAllowedError or AbortError: a sound played before any tap, which following a friend into the game never has; a
// wake lock or fullscreen refused; play() interrupted by pause()): the game plays on, so no broken game either. (From
// the game's window: no instance of ours, told by its tag.)
const refusal = r => Object.prototype.toString.call(r) === '[object DOMException]' && (r.name === 'NotAllowedError' || r.name === 'AbortError');

// What a game gets as window.ihroteka (contract version 4, see README "Game API"; ihroteka.round, phase 4, for every
// game). What its window throws (or rejects and nobody catches) goes into the trace, and may mean it broke
// (gameError); a browser's notice (notice) or refusal (refusal) does not. Its window gets the motion vocabulary first
// (motion.js install: its <head> is still being parsed, so the game's own styles come after it and win).
function api(info, win) {
  const g = find(current) || info;
  // the wire of the copy that runs: its own page says it (game-api.js GAME; a game.bin from before the numbers speaks
  // 1), which may not be the shelf's (a deploy while this page stayed open); the shelf's only for a page without one
  const wire = info && info.id === g.id ? wireOf(info) : wireOf(g);
  const room = attachGame(current, wire), round = openRound();
  win.addEventListener('error', e => { if (win === frame?.contentWindow) { if (notice(e)) trace.note('the game\'s ResizeObserver looped (a notice)'); else gameError(e.error, e); } });
  win.addEventListener('unhandledrejection', e => {
    if (win !== frame?.contentWindow) return;
    if (refusal(e.reason)) trace.note('the browser refused the game: ' + trace.error(e.reason) + ' (a notice)'); else gameError(e.reason);
  });
  safe(() => install(win.document, win));
  attachScreens(win);                                    // (its <ihroteka-wait>, as its page is parsed: screens.js)
  return Object.freeze({
    version: 4,
    game: Object.freeze({ id: g.id, title: g.title, players: Object.freeze({ ...(g.players || { min: 2, max: 2 }) }), wire }),
    libraryUrl: root.href,
    home: () => go(null),
    room,
    round,
    invite: room.invite
  });
}
