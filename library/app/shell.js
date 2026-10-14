/* =====================================================================
   The library after sign-in: one page for everything. The shelf and the open game are views of it;
   the game runs in a frame, so leaving it never reloads the library, and the room with a friend
   (together.js) lives on from game to game. Addresses stay real: <root> is the shelf, <root><id>/ a game.
   A game that breaks while it starts (an error in its window or its listeners before START ms after its page loaded)
   leaves no empty screen: the stage says «Гра зламалася» and offers the report (together.js report) to copy.
   A game that did not open says why over it, with «Спробувати ще» (or «Ввести пароль» after a cancelled password):
   it opens that game again on this device only, without taking the room anywhere. A cancelled password takes the room
   back to the shelf only from the player who opened the game (together.js ownView); anyone else stays over it.
   A game's copy speaks the wire of its own code (api), which a page open since before a deploy may not have on its
   shelf; and the page reloads into a newer version only once its offline copy is in place (reload, update.js), never
   under the password dialog (busy).
   ===================================================================== */
import { $, copy, el, root, safe } from './dom.js';
import { initInvite, openDialog } from './invite.js';
import { attachScreens, detachScreens, waitScreen, state as screens } from './screens.js';
import { attachGame, detachGame, gameError, initTogether, leave, openRound, ownView, pageError, query, report, state, viewChanged } from './together.js';
import * as trace from './trace.js';
import { newerThanPage, updateCopy } from './update.js';

let games = [], current, frame = null, load = null, loads = 0;   // current: the open game id, null on the shelf (undefined before the first view)
let again = null;                                       // the open that failed, to try again («Спробувати ще»); null: none
const START = 5000;                                      // an error this soon after the game's page loaded (or before) is a broken start
let loaded = 0, broke = false;                           // the open game's page: when it loaded (0: not yet); whether it broke starting
// Going back to the shelf is history.back() when the shelf is the entry before (Back then works as expected);
// the view shows when popstate comes. Meanwhile: who asked (following), and a view asked for since (queued).
const DOC = Math.random().toString(36).slice(2);       // marks this page's own history entries (not those of a reload)
let backing = false, following = false, queued = null;

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
 * The views it gives together.js and invite.js: current(), follow(id), invite(), address(), seats(id), wires(),
 * reload(still, later), gameError(), busy(), newer() → Promise<boolean> (whether the site has a newer version than this
 * page: update.js newerThanPage; false with no offline copy: the dev server).
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
  $('stage-report').addEventListener('click', e => copy(report(), e.target));
  $('games').replaceChildren(...games.map(card));
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
    backing = following = false;
    show(fromAddress(), byPeer);
    history.replaceState(history.state, '', address(current));   // the room in the address (?room=) is today's, not that entry's
    if (queued) { const [id, p] = queued; queued = null; go(id, p); }
  });
  $('busy').hidden = true;
  const views = { current: () => current ?? null, follow: id => go(id, true), invite: openDialog, address: () => address(current), seats: id => find(id)?.players?.max || 2,
    wires: () => Object.fromEntries(games.map(g => [g.id, wireOf(g)])), reload, gameError: () => { if (frame && (!loaded || performance.now() - loaded < START)) broken(); },
    busy: () => !!(busy && busy()), newer };
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
// page stays as it is and says why; later hears how an update that ran past its time ended.
// → 'reload' | 'stay' (still said no) | 'same' | 'storage' | 'failed' | 'timeout' (update.js)
async function reload(still, later) {
  let reg = null;
  try { reg = await navigator.serviceWorker?.getRegistration(root.href); } catch (e) {}
  const out = await updateCopy(reg, { later });
  if (out !== 'activated' && out !== 'none') return out;
  if (still && !still()) return 'stay';
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

function card(g) {
  return el('a', { className: 'game', href: address(g.id), onclick: e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(g.id); } } },
    el('img', { src: new URL(g.id + '/' + g.image, root).href, alt: '', loading: 'lazy' }),
    el('span', { className: 'game-body' }, el('b', { textContent: g.title }), el('span', { textContent: g.tagline })));
}

// Go to a view. From the shelf into a game is a step in history (Back returns to the shelf); everything else
// replaces the current entry. byPeer: the friend went there (we follow, and do not tell them back).
// A game this library does not have (the friend's library may be newer) means the shelf.
export function go(id, byPeer = false) {
  if (id && !find(id)) id = null;
  if (backing) { queued = [id, byPeer]; return; }
  if (id === current) return;
  if (!id && history.state?.doc === DOC) { backing = true; following = byPeer; history.back(); return; }
  if (id && !current) history.pushState({ doc: DOC }, '', address(id));
  else history.replaceState(history.state, '', address(id));
  show(id, byPeer);
}

function show(id, byPeer = false) {
  if (id === current) return;
  closeFrame();
  current = id;
  const g = id && find(id);
  document.title = g ? g.title : 'Ігротека';
  $('shelf').hidden = !!g;
  $('stage').hidden = !g;
  viewChanged(id, byPeer);
  if (g) openFrame(g, byPeer);
}

// byPeer: the friend opened it. A cancelled password takes the room back to the shelf only from the one who opened
// the game (we followed, or the room's view is someone else's: a page that came back to the game's address in a room,
// or a room link made over a game; together.js ownView); anyone else stays over it, and the room stays in the game.
// A failure that trying again may mend offers «Спробувати ще» («Ввести пароль» after a cancelled password): the same
// game, opened again here only (the room's view is not said again).
async function openFrame(g, byPeer) {
  const t = ++loads, note = $('stage-note'), retry = $('stage-retry'), say = (text, cls) => { $('stage-text').textContent = text; $('stage-text').className = cls; };
  loaded = 0; broke = false; note.classList.remove('over'); $('stage-report').hidden = true;
  again = null; retry.hidden = true;
  say('Відкриваю гру…', 'busy'); note.hidden = false;
  let page;
  try { page = await load(g); }
  catch (e) {
    if (t !== loads || current !== g.id) return;
    if (e.cancelled && !byPeer && ownView(g.id)) { go(null); return; }   // no password: back to the shelf
    if (!e.cancelled) console.error(e);
    say(e.cancelled ? 'Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.' : e.say || 'Не вдалося відкрити гру. Онови сторінку.', 'err');
    if (e.final) return;
    again = () => openFrame(g, byPeer);
    retry.textContent = e.cancelled ? 'Ввести пароль' : 'Спробувати ще';
    retry.hidden = false;
    safe(() => retry.focus());
    return;
  }
  if (t !== loads || current !== g.id) return;          // switched elsewhere meanwhile (or reopened: a newer load is on its way)
  frame = el('iframe', { className: 'frame', title: g.title });
  frame.allow = allowOf(g);
  frame.setAttribute('allowfullscreen', '');
  if (page.srcdoc != null) frame.srcdoc = page.srcdoc; else frame.src = page.src;
  frame.addEventListener('load', () => { loaded = performance.now(); if (broke) return; note.hidden = true; safe(() => frame.contentWindow.focus()); }, { once: true });
  $('stage-note').after(frame);                         // (before the card over it: the game first, in Tab and reading order)
}

// What the game's frame may use (its permissions policy; README: Trust): the camera and the microphone each only for a
// game whose game.json asks for it ("camera": true, "microphone": true, carried by its shelf entry). A frame of our own
// origin would have them unless told 'none'.
const ASKED = ['camera', 'microphone'];
const allowOf = g => ['fullscreen', 'screen-wake-lock', 'autoplay', 'gamepad', ...ASKED.map(f => g[f] === true ? f : f + " 'none'")].join('; ');

// The open game broke while it started: the note over it says so, with the report to copy and the way back (out of
// fullscreen: the game has nothing to show there, and its frame in the browser's top layer would cover the note).
function broken() {
  if (broke) return;
  broke = true;
  const report = $('stage-report'), t = loads;
  again = null; $('stage-retry').hidden = true;
  $('stage-text').textContent = 'Гра зламалася'; $('stage-text').className = 'err';
  Object.assign(report, { hidden: false, textContent: 'Скопіювати звіт' });
  $('stage-note').classList.add('over');
  $('stage-note').hidden = false;
  // (the focus on the report; out of fullscreen, tried each frame until it lands: the page may stay inert a moment)
  const focus = (n = 10) => { if (t !== loads) return; safe(() => report.focus()); if (n && document.activeElement !== report) requestAnimationFrame(() => focus(n - 1)); };
  if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().then(() => focus(), () => {});
  focus(0);
}

function closeFrame() {
  loads++;                                               // a load still running is for nothing now
  again = null;                                          // (a retry never opens a game the room has left)
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
// (gameError); a browser's notice (notice) or refusal (refusal) does not.
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
