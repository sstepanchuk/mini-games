/* =====================================================================
   The library page: the shelf and the open game (shell.js), the password for the games (lock.js),
   playing together (together.js), working offline as an app (install.js, sw.js).
   Built into site/lib/ihroteka.js; every page of the site starts it with boot().
   A library that did not open (no network and no offline copy, the site not answering, a page that is not a shelf)
   says why, with «Спробувати ще», and tries again in place (and by itself once the network is back). A new version
   that took over under the page (install.js) is reloaded into once that disturbs nobody: on the shelf, no dialog open,
   and no room or an internet one (back into it at once: together.js reloadHere); never nearby.
   ===================================================================== */
import { $, btn, root } from './dom.js';
import { installHint, keepFiles, registerWorker } from './install.js';
import { MSG, askingPassword, openGame, openShelf, preloadGame, signOut, whenSignedIn } from './lock.js';
import { startShell } from './shell.js';
import { currentRoom, reloadHere } from './together.js';

/**
 * game  the game this page belongs to (its public page), if any
 * dev   { games }: `npm run dev` — plaintext games from disk, no password, no offline copy
 */
export async function boot({ game, dev } = {}) {
  window.__ihrotekaBooted = true;                      // the page's fallback (page.html ihrotekaStuck) checks this
  opening();
  try {
    if (dev) {
      startShell({ games: dev.games, initial: game, loader: async g => ({ src: new URL(g.id + '/?frame', root).href }) });
      return;
    }
    registerWorker({ onUpdate: whenIdle });
    const games = await shelf(game);
    startShell({ games, initial: game, loader: async g => ({ srcdoc: await openGame(g) }), signOut, whenSignedIn, busy: askingPassword });
    installHint();
    keepFiles();
  } catch (e) {
    console.error(e);
    if (!$('busy').hidden) stuck(e.say || MSG.broken, () => location.reload(), false);   // (a bug before the shelf showed)
  }
}

// «Відкриваю Ігротеку…»: as the page starts (also over page.html's note when the library merely came late), and on
// each new try
function opening() {
  const b = $('busy');
  b.className = 'busy';
  b.removeAttribute('role');
  b.textContent = 'Відкриваю Ігротеку…';
  $('busy-retry')?.remove();
}
// What went wrong instead of the spinner (told to a screen reader), and «Спробувати ще» under it (focused): again()
// tries in place (a reload with no network and no offline copy would show the browser's own error page instead of
// ours); online: also once the network comes back.
function stuck(say, again, online) {
  const b = $('busy');
  b.className = 'err';
  b.setAttribute('role', 'alert');
  b.textContent = say;
  $('busy-retry')?.remove();
  const go = () => { removeEventListener('online', go); retry.remove(); again(); };
  const retry = btn('Спробувати ще', go);
  retry.id = 'busy-retry';
  b.after(retry);
  if (online) addEventListener('online', go);
  retry.focus();
}
// the shelf (library.json), until it comes: each failure said (stuck), then tried again; the game this page belongs
// to starts downloading at once, on each try
async function shelf(game) {
  for (;;) {
    if (game) preloadGame(game);
    try { return await openShelf(); } catch (e) {
      if (!e.say) throw e;
      await new Promise(again => stuck(e.say, again, true));
      opening();
    }
  }
}

// A new version took over under the page (install.js): reload into it once that disturbs nobody — the shelf shown, no
// dialog open (the password, «Грати разом»…), and no room or an internet one, which the page comes straight back into
// (the others see it «повертається» a moment); never a room nearby, which a reload would end. Checked again every
// 5 s until then (one wait, however many versions take over meanwhile).
let waiting = null;
const idle = () => { const r = currentRoom(); return $('stage').hidden && !document.querySelector('.backdrop') && (!r || r.kind === 'internet'); };
function whenIdle() {
  const now = () => {
    if (!idle()) return false;
    clearInterval(waiting); waiting = null;
    reloadHere();
    return true;
  };
  if (!now() && !waiting) waiting = setInterval(now, 5000);
}
