/* =====================================================================
   @ihroteka/shelf — the library page: sign-in (lock.js), the shelf and the open game (shell.js),
   playing together (together.js), working offline as an app (install.js, sw.js).
   Built into docs/lib/ihroteka.js; every page of the site starts it with boot().
   ===================================================================== */
import { $, root } from './dom.js';
import { installHint, keepFiles, registerWorker } from './install.js';
import { openGame, openShelf, preloadGame, signOut, unlock } from './lock.js';
import { startShell } from './shell.js';
import { together } from './together.js';

/**
 * game  the game this page belongs to (its public page), if any
 * dev   { games }: `npm run dev` — plaintext games from disk, no sign-in, no offline copy
 */
export async function boot({ game, dev } = {}) {
  window.__ihrotekaBooted = true;                      // the page's fallback timer checks this
  try {
    if (dev) {
      startShell({ games: dev.games, initial: game, loader: async id => ({ src: new URL(id + '/?frame', root).href }), signOut: async () => {} });
      return;
    }
    // a new version of the library arrived: reload when it disturbs nobody (on the shelf, alone, no dialog)
    registerWorker({ onUpdate: () => { if (!document.querySelector('.frame, .backdrop') && !together()) location.reload(); } });
    if (game) preloadGame(game);                       // start downloading the game while the password is typed
    await unlock();
    const games = await openShelf();
    keepFiles();
    installHint();
    startShell({ games, initial: game, loader: async id => ({ srcdoc: await openGame(id) }), signOut });
  } catch (e) {
    const busy = $('busy');
    if (busy) { if (e.say) busy.textContent = e.say; busy.hidden = false; }
    console.error(e);
  }
}
