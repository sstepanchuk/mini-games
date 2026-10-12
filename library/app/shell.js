/* =====================================================================
   The library after sign-in: one page for everything. The shelf and the open game are views of it;
   the game runs in a frame, so leaving it never reloads the library, and the room with a friend
   (together.js) lives on from game to game. Addresses stay real: <root> is the shelf, <root><id>/ a game.
   ===================================================================== */
import { $, el, root, safe } from './dom.js';
import { initInvite, openDialog } from './invite.js';
import { attachGame, detachGame, initTogether, leave, query, state, viewChanged } from './together.js';

let games = [], current, frame = null, load = null, loads = 0;   // current: the open game id, null on the shelf (undefined before the first view)
// Going back to the shelf is history.back() when the shelf is the entry before (Back then works as expected);
// the view shows when popstate comes. Meanwhile: who asked (following), and a view asked for since (queued).
const DOC = Math.random().toString(36).slice(2);       // marks this page's own history entries (not those of a reload)
let backing = false, following = false, queued = null;

/**
 * games         [{ id, title, tagline, image, emoji, players, wire }] (wire: game.json "wire"; 1 when not given)
 * initial       the game this page was opened at, if any
 * loader        game → Promise<{ srcdoc } | { src }>: its page (decrypted, or in dev from disk); rejects with
 *               error.cancelled when the player does not give the password
 * signOut       () → Promise: forget the password on this device
 * whenSignedIn  (fn) → calls fn once this device knows the password
 */
export function startShell({ games: list, initial, loader, signOut, whenSignedIn }) {
  games = list; load = loader;
  // the game's page asks for the library API (see game-api.js)
  window.__ihroteka = { attach: (win, info) => win === frame?.contentWindow ? api(info) : undefined, state };
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
    wires: () => Object.fromEntries(games.map(g => [g.id, wireOf(g)])), reload };
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
  frame.allow = 'fullscreen; screen-wake-lock; autoplay; gamepad; camera';
  frame.setAttribute('allowfullscreen', '');
  if (page.srcdoc != null) frame.srcdoc = page.srcdoc; else frame.src = page.src;
  frame.addEventListener('load', () => { note.hidden = true; safe(() => frame.contentWindow.focus()); }, { once: true });
  $('stage').append(frame);
}

function closeFrame() {
  loads++;                                               // a load still running is for nothing now
  if (!frame) return;
  detachGame();
  frame.remove();
  frame = null;
}

// what a game gets as window.ihroteka (contract version 4, see README "Game API")
function api(info) {
  const g = find(current) || info;
  const room = attachGame(current);
  return Object.freeze({
    version: 4,
    game: Object.freeze({ id: g.id, title: g.title, players: Object.freeze({ ...(g.players || { min: 2, max: 2 }) }), wire: wireOf(g) }),
    libraryUrl: root.href,
    home: () => go(null),
    room,
    invite: room.invite
  });
}
