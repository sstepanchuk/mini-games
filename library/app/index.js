/* =====================================================================
   The library page: the shelf and the open game (shell.js), the password for the games (lock.js),
   playing together (together.js), working offline as an app (install.js, sw.js).
   Built into docs/lib/ihroteka.js; every page of the site starts it with boot().
   ===================================================================== */
import { $, root } from './dom.js';
import { installHint, keepFiles, registerWorker } from './install.js';
import { openGame, openShelf, preloadGame, signOut, whenSignedIn } from './lock.js';
import { startShell } from './shell.js';
import { together } from './together.js';

/**
 * game  the game this page belongs to (its public page), if any
 * dev   { games }: `npm run dev` — plaintext games from disk, no password, no offline copy
 */
export async function boot({ game, dev } = {}) {
  window.__ihrotekaBooted = true;                      // the page's fallback timer checks this
  try {
    if (dev) {
      startShell({ games: dev.games, initial: game, loader: async g => ({ src: new URL(g.id + '/?frame', root).href }) });
      return;
    }
    // a new version of the library arrived: reload when it disturbs nobody (on the shelf, alone, no dialog)
    registerWorker({ onUpdate: () => { if (!document.querySelector('.frame, .backdrop') && !together()) location.reload(); } });
    if (game) preloadGame(game);                       // the game starts downloading at once
    const games = await openShelf();
    startShell({ games, initial: game, loader: async g => ({ srcdoc: await openGame(g) }), signOut, whenSignedIn });
    installHint();
    keepFiles();
  } catch (e) {
    if (e.say) $('busy').textContent = e.say;
    console.error(e);
  }
}
