/* The offline copy brought up to date, before the page reloads into a newer version (shell.js reload: a friend runs
   one, together.js versionCheck; or the player asks, «Оновити»); and whether the site has a newer version than the
   page at all (newerThanPage). The service worker (sw.js) looks for a newer version of the site and installs it
   whole, or keeps the copy it has. A reload is worth it only once a newer copy is in place (or there is no offline
   copy: the network serves the page): one before it would open this version again, and an update that cannot happen
   (no room on the device, no network) would reload for nothing, each time. tests/update.test.js pins it. */

// the worker that served this page (null: the network did); another one active means the copy is newer than the page
// (an update in the background took over meanwhile: sw.js claims the pages). A page the network served (the first
// visit, before any offline copy) takes the first worker that claims it as its own: that one stored the version the
// page came with (install.js counts it so too); one after it is newer. (A browser that blocks site data may throw as
// the page asks: no worker, then.)
let SERVED = null;
try {
  const sw = globalThis.navigator?.serviceWorker;
  SERVED = sw?.controller || null;
  if (sw && !SERVED) sw.addEventListener('controllerchange', function first() { sw.removeEventListener('controllerchange', first); SERVED = sw.controller || null; });
} catch (e) {}

/**
 * reg     the service worker's registration (none: no offline copy here)
 * ms      how long to wait for it (the update check, then the new version's install: a whole copy)
 * served  the worker that served this page (default: the one at load, or the first to claim a page the network served)
 * later   (out) once an update that ran past ms settles after all: 'activated', 'same', 'failed' or 'storage'
 * → 'activated' (a newer copy is in place: reload), 'none' (no offline copy: reload), 'same' (the site has nothing
 *   newer yet), 'failed' (the new version did not install, or the check failed), 'storage' (it did not fit on the
 *   device: the offline copy's note says so), 'timeout'
 */
export function updateCopy(reg, { ms = 30000, served = SERVED, later } = {}) {
  if (!reg) return Promise.resolve('none');
  const was = reg.active, since = Date.now();
  // (why it did not happen: 'storage' when the offline copy noted, during this check, that it had no room)
  const why = async (or = 'failed') => await noRoom(reg, since) ? 'storage' : or;
  const work = (async () => {
    try { await reg.update(); } catch (e) { return why(); }
    const w = reg.installing || reg.waiting;
    if (w) return await settle(w) === 'activated' ? 'activated' : why();
    if (reg.active !== was || (!!served && !!reg.active && reg.active !== served)) return 'activated';
    // (nothing installing: nothing newer, or a new version that failed before we looked, and noted why)
    return why('same');
  })();
  let timer = null;
  const deadline = new Promise(done => { timer = setTimeout(done, ms, 'timeout'); });
  return Promise.race([work, deadline]).then(out => {
    clearTimeout(timer);
    if (out === 'timeout' && later) work.then(later);   // (it goes on: a worker that finishes later still counts)
    return out;
  });
}

// Whether the site has a newer version than this page (shell.js newer: which of two pages is the older when a game is
// on one shelf and not the other, owner decision 36): a newer copy took over since the page loaded (another worker
// active than the one that served it, see SERVED), or an update check finds a new version installing or waiting (or
// already in charge). No offline copy (reg null: the dev server, a browser without service workers), or the check
// failed: false (nothing tells). A page the network served whose first offline copy is still on its way (none active
// yet: the first visit) has nothing newer in it: that first worker stores the page's own version (see SERVED).
export async function newerThanPage(reg, { served = SERVED } = {}) {
  if (!reg) return false;
  const tookOver = () => !!served && !!reg.active && reg.active !== served;
  if (tookOver()) return true;
  try { await reg.update(); } catch (e) { return false; }
  return (!!(reg.installing || reg.waiting) && (!!served || !!reg.active)) || tookOver();
}

// a new worker activated, or went redundant (its install failed): its state now, or as it changes
const settle = w => new Promise(done => {
  const look = () => { if (w.state === 'activated' || w.state === 'redundant') { w.removeEventListener('statechange', look); done(w.state); } };
  w.addEventListener('statechange', look);
  look();
});

// Whether the offline copy noted, during this check (since), that the new version had no room on the device (sw.js:
// Cache 'ihroteka-meta', '__failed', { version, why: 'storage', at }; cleared when a version activates). An older
// note is of a try before this one: what failed now (no network, say) is not told by it.
async function noRoom(reg, since) {
  try {
    const hit = await (await caches.open('ihroteka-meta')).match(new URL('__failed', reg.scope).href), n = hit && await hit.json();
    return !!n && n.why === 'storage' && n.at >= since;
  } catch (e) { return false; }
}
