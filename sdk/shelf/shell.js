/* =====================================================================
   The library after sign-in: one page for everything. The shelf and the open game are views of it;
   the game runs in a frame, so leaving it never reloads the library, and the room with a friend
   (together.js) lives on from game to game. Addresses stay real: <root> is the shelf, <root><id>/ a game.
   ===================================================================== */
import { $, el, root, safe } from './dom.js';
import { attachGame, chipClick, detachGame, initTogether, leave, query, state, viewChanged } from './together.js';

let games = [], current, frame = null, load = null, following = false;   // current: the open game id, null on the shelf (undefined before the first view)

/**
 * games    [{ id, title, tagline, image, emoji }]
 * initial  the game this page was opened at, if any
 * loader   id → Promise<{ srcdoc } | { src }>: how a game's page is obtained (decrypted, or in dev from disk)
 * signOut  () → Promise
 */
export function startShell({ games: list, initial, loader, signOut }) {
  games = list; load = loader;
  // the game's page asks for the library API (see @ihroteka/api)
  window.__ihroteka = { attach: (win, info) => win === frame?.contentWindow ? api(info) : undefined, state };
  $('games').replaceChildren(...games.map(card));
  $('together').addEventListener('click', chipClick);
  $('stage-back').addEventListener('click', () => go(null));
  $('sign-out').addEventListener('click', async () => { leave(); await signOut(); location.replace(root.href); });
  addEventListener('popstate', () => { const byPeer = following; following = false; show(fromAddress(), true, byPeer); });
  $('lock').hidden = true;
  initTogether({ current: () => current ?? null, follow: id => go(id, true) });
  show(initial && find(initial) ? initial : null, true);
}

const find = id => games.find(g => g.id === id);
const fromAddress = () => { const id = location.pathname.slice(root.pathname.length).split('/')[0]; return find(id) ? id : null; };
const address = id => new URL((id ? id + '/' : '') + query(), root).href;

function card(g) {
  return el('a', { className: 'game', href: address(g.id), onclick: e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(g.id); } } },
    el('img', { src: new URL(g.id + '/' + g.image, root).href, alt: '', loading: 'lazy' }),
    el('span', { className: 'game-body' }, el('b', { textContent: g.title }), el('span', { textContent: g.tagline })));
}

// Go to a view. From the shelf into a game is a step in history (Back returns to the shelf); everything else
// replaces the current entry. byPeer: the friend went there (we follow, and do not tell them back).
export function go(id, byPeer = false) {
  if (id === current) return;
  if (!id && history.state && history.state.ihroteka === 'game') { following = byPeer; history.back(); return; }   // popstate shows the shelf
  if (id && !current) history.pushState({ ihroteka: 'game' }, '', address(id));
  else history.replaceState(null, '', address(id));
  show(id, false, byPeer);
}

function show(id, fromHistory, byPeer = false) {
  if (id === current) return;
  closeFrame();
  current = id;
  const g = id && find(id);
  document.title = g ? g.title : 'Ігротека';
  $('shelf').hidden = !!g;
  $('stage').hidden = !g;
  viewChanged(id, byPeer);
  if (g) openFrame(g);
}

async function openFrame(g) {
  const note = $('stage-note'), say = (text, cls) => { $('stage-text').textContent = text; $('stage-text').className = cls; $('stage-back').hidden = cls !== 'err'; };
  say('Відкриваю гру…', 'busy'); note.hidden = false;
  let page;
  try { page = await load(g.id); }
  catch (e) { console.error(e); if (current === g.id) say(e.say || 'Не вдалося відкрити гру. Онови сторінку.', 'err'); return; }
  if (current !== g.id) return;                          // switched elsewhere meanwhile
  frame = el('iframe', { className: 'frame', title: g.title });
  frame.allow = 'fullscreen; screen-wake-lock; autoplay; gamepad; camera';
  frame.setAttribute('allowfullscreen', '');
  if (page.srcdoc != null) frame.srcdoc = page.srcdoc; else frame.src = page.src;
  frame.addEventListener('load', () => { note.hidden = true; safe(() => frame.contentWindow.focus()); }, { once: true });
  $('stage').append(frame);
}

function closeFrame() {
  if (!frame) return;
  detachGame();
  frame.remove();
  frame = null;
}

// what a game gets as window.ihroteka (contract version 2, see README "Game API")
function api(info) {
  const g = find(current) || info;
  const room = attachGame(current);
  return Object.freeze({
    version: 2,
    game: Object.freeze({ id: g.id, title: g.title }),
    libraryUrl: root.href,
    home: () => go(null),
    room,
    invite: room.invite
  });
}
