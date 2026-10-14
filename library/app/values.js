// What the library's app modules share (together.js, legacy.js, round.js): the app's own waits, a game's
// value as JSON and its size, the copy of it a game is handed, a game's id, the site's version, and what the tab or the
// browser keeps for the next page.
import { SCALE } from '../net/index.js';

// a string's size in bytes, UTF-8 (what a game hands the library is counted so: rules.js CAP). It lives in trace.js,
// which loads in Node's main thread too (tests/app/trace.test.js); this module does not: net/config.js needs a window.
export { bytes } from './trace.js';

// The app's own waits, ms: scaled as the room's TIMING is (net/config.js SCALE: tests set window.__timeScale), but not
// part of it (nothing orders them against the room's)
export const CLOSED_GRACE = 2000 * SCALE;                // a round's player out of the game this long before the screens name
                                                         //   them (following the room into a game takes a moment: together.js)
export const LOST_WAIT = 15000 * SCALE;                  // a round whose snapshot is on no device ends this long after (owner;
                                                         //   round.js)
export const RESTORE_SHOW = 1000 * SCALE;                // a copy waits this long for its round's snapshot before the screens
                                                         //   say so (round.js restoring; together.js restorer)
export const ASK_TTL = 5000 * SCALE;                     // a start asked of the runner: taken only this soon after asking (round.js)
export const QUIT_AGAIN = 2000 * SCALE;                  // a quit of ours whose round is on: said again this often while its
                                                         //   runner is here (round.js)
export const NEWS_WAIT = 1000 * SCALE;                   // a late end waits this long for its game to play with someone
                                                         //   ('linked'), then is told anyway (round.js)
export const SAME_AGAIN = 60000 * SCALE;                 // an update that found nothing newer is tried again after this, quietly
                                                         //   (together.js attempt)
export const HELD_EVERY = 5000 * SCALE, HELD_FOR = 15000 * SCALE;   // the place this browser holds: its mark renewed this
                                                         //   often; one older than HELD_FOR does not count (together.js hold)

// A game's value as JSON (undefined: 'null'); one that cannot be (a cycle, a BigInt) is a mistake in the game: a
// TypeError, at the call (call: what the game called, 'room.send', 'round.save' …)
export function json(v, call) {
  try { const x = JSON.stringify(v); return x === undefined ? 'null' : x; } catch (e) { throw new TypeError('ihroteka.' + call + ': not JSON (' + e.message + ')'); }
}
// What the library hands a game (a round to resume, a shared value) is a copy of what it keeps: a game that keeps its
// state in it and changes it must not change the round's snapshot or the room's state (which greet passes on).
export const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
// a game's id (game.json, a folder of games/; the room's view, here:, round:<game> …)
export const GAME_ID = /^[a-z0-9-]{1,40}$/;

// The site's version, first in room.diag() and state() (the build writes it into the page, tools/build.js siteVersion;
// 'dev' on the dev server, '?' where the page has none: an old page, a worker tab). DEV: the dev server, where a call
// the library refuses, or a game's mistake it can see, says why in the console (once). (Read through globalThis: a
// module of the library may load where there is no document.)
const VERSION = globalThis.document?.querySelector?.('meta[name="ihroteka-version"]')?.content;
export const SITE = 'Ігротека ' + (VERSION || '?'), DEV = VERSION === 'dev';

// What the tab (sessionStorage) or the browser, every tab of it (localStorage), keeps for the next page, as JSON, as
// the browser lets us: site data may be blocked (it throws) or gone (empty); what cannot be kept, the page still holds
// as long as it lives. get(k) → the value, or null; set(k, v) → whether it was kept (null: the key goes).
export const store = area => ({
  get(k) { try { return JSON.parse(globalThis[area].getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { if (v == null) globalThis[area].removeItem(k); else globalThis[area].setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
});
export const session = store('sessionStorage'), local = store('localStorage');
