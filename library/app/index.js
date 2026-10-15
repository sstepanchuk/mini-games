/* =====================================================================
   The library page: the shelf and the open game (shell.js), the password for the games (lock.js),
   playing together (together.js), working offline as an app (install.js, sw.js).
   Built into site/lib/ihroteka.js; every page of the site starts it with boot().
   A library that did not open (no network and no offline copy, the site not answering, a page that is not a shelf)
   says why, with «Спробувати ще», and tries again in place (and by itself once the network is back). A new version
   that took over under the page (install.js) is reloaded into once that disturbs nobody: on the shelf, no dialog open,
   and no room or an internet one (back into it at once: together.js reloadHere); never nearby.
   Motion (motion.js, the UX spec L-T01…L-T03, L-T38): installed into this page first thing. The page as it starts is
   page.html's #boot («Ігротека» and «Відкриваю Ігротеку…» after 300 ms); the shelf shows once its fonts are in (200 ms
   at most). A library that did not open turns #boot into a card: why (an alert), then «Спробувати ще», which goes busy
   in place for 600 ms at least; a try that did not help says so under the message, «Ще не вийшло — спробую знову,
   щойно з’явиться інтернет.»; one that did shows the shelf instead (no «Відкриваю…» in between). A reload into a new
   version says «Оновлюю Ігротеку…» for 800 ms first.
   ===================================================================== */
import { $, btn, dialogOpen, el, root, toast } from './dom.js';
import { installHint, keepFiles, registerWorker } from './install.js';
import { MSG, askingPassword, openGame, openShelf, preloadGame, signOut, whenSignedIn } from './lock.js';
import { busy, free, install, later, mode, play, typeset } from './motion.js';
import { startShell } from './shell.js';
import { currentRoom, reloadHere } from './together.js';

/**
 * game  the game this page belongs to (its public page), if any
 * dev   { games }: `npm run dev` — plaintext games from disk, no password, no offline copy
 */
export async function boot({ game, dev } = {}) {
  window.__ihrotekaBooted = true;                      // the page's fallback (page.html ihrotekaStuck) checks this
  install(document, window);                           // (motion.js: before anything moves)
  opening();
  const typeset = fontsIn(200);
  try {
    if (dev) {
      if (typeset) await typeset;
      startShell({ games: dev.games, initial: game, loader: async g => ({ src: new URL(g.id + '/?frame', root).href }) });
      return;
    }
    registerWorker({ onUpdate: whenIdle });
    const games = await shelf(game);
    if (typeset) await typeset;
    startShell({ games, initial: game, loader: async g => ({ srcdoc: await openGame(g) }), signOut, whenSignedIn, busy: askingPassword });
    installHint();
    keepFiles();
  } catch (e) {
    console.error(e);
    // (a bug before the shelf showed: a reload, once the press has been seen)
    if (!$('busy').hidden) stuck(e.say || MSG.broken, () => later(600, () => location.reload()), false);
  }
}

// The shelf's first paint in its own fonts (Onest and Unbounded, which page.html loads without blocking), or after ms,
// whichever comes first (I14). Motion off (the tests): none, the page starts as it always did.
function fontsIn(ms) {
  if (mode() === 'off' || !document.fonts || !document.fonts.load) return null;
  const link = document.querySelector('link[rel=stylesheet][href*="fonts.googleapis.com"]');
  const sheet = !link || link.media !== 'print' ? null       // (its stylesheet, loaded without blocking: first)
    : new Promise(done => { link.addEventListener('load', done, { once: true }); link.addEventListener('error', done, { once: true }); });
  return typeset(document, ms, sheet);
}

// «Відкриваю Ігротеку…»: as the page starts (also over page.html's note when the library merely came late)
function opening() {
  const b = $('busy');
  $('boot')?.classList.remove('stuck');
  b.className = 'busy';
  b.removeAttribute('role');
  b.textContent = 'Відкриваю Ігротеку…';
  $('busy-again')?.remove();
  $('busy-retry')?.remove();
}
// What went wrong, in the card #boot turns into (told to a screen reader), and «Спробувати ще» under it (focused):
// again() tries in place (a reload with no network and no offline copy would show the browser's own error page
// instead of ours); online: also once the network comes back. A press shows the button busy (motion.js) and tries at
// once; a try that did not help comes back here: 600 ms at least after the press, the button is itself again and
// «Ще не вийшло — …» stands under the message (online: that is what happens next). Pressed again while it tries, or
// (online) the network back meanwhile, which no later 'online' would say again: once more right after. (A page
// reloaded by page.html's own «Спробувати ще» that still cannot open says it at once.)
const AGAIN = 'Ще не вийшло — спробую знову, щойно з’явиться інтернет.';
let pressed = 0, more = false;                           // when «Спробувати ще» was pressed (0: not since it said why); again since
const soon = () => { more = true; };                     // (while a try runs, and its button stays busy after it)
function stuck(say, again, online) {
  const b = $('busy');
  $('boot')?.classList.add('stuck');
  b.className = 'err';
  b.setAttribute('role', 'alert');
  if (b.textContent !== say) b.textContent = say;
  let line = $('busy-again'), retry = $('busy-retry');
  if (!line) { line = el('p', { className: 'fine', id: 'busy-again' }); line.setAttribute('role', 'status'); b.after(line); }
  const fresh = !retry;
  if (!retry) { retry = btn('Спробувати ще'); retry.id = 'busy-retry'; line.after(retry); }
  const go = () => {
    removeEventListener('online', go);
    retry.onclick = soon;
    if (online) addEventListener('online', soon);
    pressed = Date.now(); more = false;
    busy(retry);
    again();
  };
  const ready = () => { retry.onclick = go; if (online) addEventListener('online', go); };
  const tell = () => { if (online && line.textContent !== AGAIN) { line.textContent = AGAIN; play(line, 'ihk-in'); } };
  if (!pressed) {
    ready();
    if (fresh) { if (globalThis.ihrotekaTries > 0) tell(); retry.focus(); }
    return;
  }
  const wait = Math.max(0, pressed + 600 - Date.now());
  pressed = 0;
  later(wait, () => {
    removeEventListener('online', soon);
    if (more) { go(); return; }
    ready();
    free(retry, { done: tell });                         // (the line as the button is itself again)
  });
}
// the shelf (library.json), until it comes: each failure said (stuck), then tried again; the game this page belongs
// to starts downloading at once, on each try
async function shelf(game) {
  for (;;) {
    if (game) preloadGame(game);
    try { return await openShelf(); } catch (e) {
      if (!e.say) throw e;
      await new Promise(again => stuck(e.say, again, true));
    }
  }
}

// A new version took over under the page (install.js): reload into it once that disturbs nobody — the shelf shown, no
// dialog open (the password, «Грати разом»…: a .backdrop in #layer; the ghost of one that just closed is none), and no
// room or an internet one, which the page comes straight back into (the others see it «повертається» a moment); never
// a room nearby, which a reload would end. Checked again every 5 s until then (one wait, however many versions take
// over meanwhile). «Оновлюю Ігротеку…» for 800 ms first; idle no more by then, it waits again.
let waiting = null, going = false;
const idle = () => { const r = currentRoom(); return $('stage').hidden && !dialogOpen() && (!r || r.kind === 'internet'); };
function whenIdle() {
  const now = () => {
    if (going) return true;
    if (!idle()) return false;
    clearInterval(waiting); waiting = null;
    going = true;
    const said = toast('Оновлюю Ігротеку…');
    later(800, () => {
      going = false;
      if (idle()) { reloadHere(); return; }
      said();
      whenIdle();
    });
    return true;
  };
  if (!now() && !waiting) waiting = setInterval(now, 5000);
}
