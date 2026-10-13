/* =====================================================================
   The library after sign-in: one page for everything. The shelf and the open game are views of it;
   the game runs in a frame, so leaving it never reloads the library, and the room with a friend
   (together.js) lives on from game to game. Addresses stay real: <root> is the shelf, <root><id>/ a game.
   A game that breaks while it starts (an error in its window or its listeners before START ms after its page loaded)
   leaves no empty screen: the stage says «Гра зламалася» and offers the report (together.js report) to copy.
   ===================================================================== */
import { $, copy, el, root, safe } from './dom.js';
import { initInvite, openDialog } from './invite.js';
import { attachGame, detachGame, gameError, initTogether, leave, openRound, pageError, query, report, state, viewChanged } from './together.js';
import * as trace from './trace.js';

let games = [], current, frame = null, load = null, loads = 0;   // current: the open game id, null on the shelf (undefined before the first view)
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
 *               error.cancelled when the player does not give the password
 * signOut       () → Promise: forget the password on this device
 * whenSignedIn  (fn) → calls fn once this device knows the password
 */
export function startShell({ games: list, initial, loader, signOut, whenSignedIn }) {
  games = list; load = loader;
  // the game's page asks for the library API (see game-api.js); state and trace: for checks from the console and tests
  window.__ihroteka = { attach: (win, info) => win === frame?.contentWindow ? api(info, win) : undefined, state, trace: trace.read };
  addEventListener('error', e => { if (notice(e)) trace.note('the page\'s ResizeObserver looped (a notice)'); else pageError(e.error, e); });
  addEventListener('unhandledrejection', e => pageError(e.reason));
  $('stage-report').addEventListener('click', e => copy(report(), e.target));
  $('games').replaceChildren(...games.map(card));
  $('stage-back').addEventListener('click', () => go(null));
  if (signOut) {
    $('sign-out').addEventListener('click', async () => { leave(); await signOut(); $('sign-out').hidden = true; });
    whenSignedIn(() => { $('sign-out').hidden = false; });
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
    wires: () => Object.fromEntries(games.map(g => [g.id, wireOf(g)])), reload, gameError: () => { if (frame && (!loaded || performance.now() - loaded < START)) broken(); } };
  initInvite(views);
  initTogether(views);
  show(initial && find(initial) ? initial : null);
}

const find = id => games.find(g => g.id === id);
// a game's wire number (game.json "wire", bumped by hand when its messages change): 1 when not given (an older shelf)
const wireOf = g => Number.isSafeInteger(g.wire) && g.wire > 0 ? g.wire : 1;

// A friend runs a newer version (together.js versionCheck): this page fetches it, its offline copy first (the service
// worker, up to 30 s: a reload before the new copy is in place would open this version again), then reloads; unless
// still (when the page does it by itself) says by then that it is no longer the time.
async function reload(still) {
  try {
    const reg = await navigator.serviceWorker?.getRegistration(root.href);
    if (reg) {
      await reg.update();
      const w = reg.installing || reg.waiting;
      if (w) await new Promise(done => {
        const t = setTimeout(done, 30000);
        w.addEventListener('statechange', () => { if (w.state === 'activated' || w.state === 'redundant') { clearTimeout(t); done(); } });
      });
    }
  } catch (e) {}
  if (!still || still()) location.reload();
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

// byPeer: the friend opened it (then a cancelled password keeps us here, instead of taking the friend away too)
async function openFrame(g, byPeer) {
  const t = ++loads, note = $('stage-note'), say = (text, cls) => { $('stage-text').textContent = text; $('stage-text').className = cls; };
  loaded = 0; broke = false; note.classList.remove('over'); $('stage-report').hidden = true;
  say('Відкриваю гру…', 'busy'); note.hidden = false;
  let page;
  try { page = await load(g); }
  catch (e) {
    if (t !== loads || current !== g.id) return;
    if (e.cancelled && !byPeer) { go(null); return; }  // no password: back to the shelf
    if (!e.cancelled) console.error(e);
    say(e.cancelled ? 'Друг відкрив цю гру. Щоб грати, потрібен пароль.' : e.say || 'Не вдалося відкрити гру. Онови сторінку.', 'err');
    return;
  }
  if (t !== loads || current !== g.id) return;          // switched elsewhere meanwhile (or reopened: a newer load is on its way)
  frame = el('iframe', { className: 'frame', title: g.title });
  frame.allow = allowOf(g);
  frame.setAttribute('allowfullscreen', '');
  if (page.srcdoc != null) frame.srcdoc = page.srcdoc; else frame.src = page.src;
  frame.addEventListener('load', () => { loaded = performance.now(); if (broke) return; note.hidden = true; safe(() => frame.contentWindow.focus()); }, { once: true });
  $('stage').append(frame);
}

// What the game's frame may use (its permissions policy; README: Trust): the camera and the microphone each only for a
// game whose game.json asks for it ("camera": true, "microphone": true, carried by its shelf entry). A frame of our own
// origin would have them unless told 'none'.
const ASKED = ['camera', 'microphone'];
const allowOf = g => ['fullscreen', 'screen-wake-lock', 'autoplay', 'gamepad', ...ASKED.map(f => g[f] === true ? f : f + " 'none'")].join('; ');

// The open game broke while it started: the note over it says so, with the report to copy and the way back.
function broken() {
  if (broke) return;
  broke = true;
  $('stage-text').textContent = 'Гра зламалася'; $('stage-text').className = 'err';
  Object.assign($('stage-report'), { hidden: false, textContent: 'Скопіювати звіт' });
  $('stage-note').classList.add('over');
  $('stage-note').hidden = false;
  safe(() => $('stage-report').focus());
}

function closeFrame() {
  loads++;                                               // a load still running is for nothing now
  if (!frame) return;
  detachGame();
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
  const room = attachGame(current), round = openRound();
  win.addEventListener('error', e => { if (win === frame?.contentWindow) { if (notice(e)) trace.note('the game\'s ResizeObserver looped (a notice)'); else gameError(e.error, e); } });
  win.addEventListener('unhandledrejection', e => {
    if (win !== frame?.contentWindow) return;
    if (refusal(e.reason)) trace.note('the browser refused the game: ' + trace.error(e.reason) + ' (a notice)'); else gameError(e.reason);
  });
  return Object.freeze({
    version: 4,
    game: Object.freeze({ id: g.id, title: g.title, players: Object.freeze({ ...(g.players || { min: 2, max: 2 }) }), wire: wireOf(g) }),
    libraryUrl: root.href,
    home: () => go(null),
    room,
    round,
    invite: room.invite
  });
}
