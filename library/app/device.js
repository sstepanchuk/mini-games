/* =====================================================================
   REMEMBERING THIS DEVICE
   After sign-in the private key is kept in IndexedDB as a non-extractable CryptoKey: the page
   can use it, but nobody can read its bytes. The password is never stored.
   Without IndexedDB (some private windows) nothing is remembered between pages: the password
   is asked again on every page. Anything else served from the same origin could use the stored
   key too, so the site must not host or load untrusted code (see README, Security).
   Forgetting stays forgotten: a mark in localStorage, written first, makes the next page finish a
   delete that IndexedDB did not take (it fails, or never answers).
   ===================================================================== */
const DB = 'ihroteka', STORE = 'keys', SLOT = 'me', TIMEOUT = 3000, GONE = 'ihroteka-forgotten';
let memory = null;
let changes = 0;                                       // remember() and forget() calls: a read begun before one does not undo it
let seen = false;                                      // this page found or stored a key

// One request in its own transaction; rejects on any trouble, and after TIMEOUT: Safari sometimes leaves
// indexedDB.open without any answer (e.g. after the tab comes back). A write whose open answers only after
// that is not made (it would undo what came after it).
function request(mode, op) {
  let late = false, timer;
  const job = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = open.onblocked = () => reject(open.error || new Error('IndexedDB blocked'));
    open.onsuccess = () => {
      const db = open.result;
      if (late && mode === 'readwrite') { db.close(); return; }
      try {
        const tx = db.transaction(STORE, mode), req = op(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
    };
  });
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { late = true; reject(new Error('IndexedDB timeout')); }, TIMEOUT); });
  return Promise.race([job, timeout]).finally(() => clearTimeout(timer));
}

// the "forgotten" mark (localStorage: written at once, synchronously); false when the storage refuses
const mark = on => { try { if (on) localStorage.setItem(GONE, '1'); else localStorage.removeItem(GONE); return true; } catch (e) { return false; } };
const marked = () => { try { return localStorage.getItem(GONE) === '1'; } catch (e) { return false; } };
// delete the stored key → whether IndexedDB confirmed it; the mark goes with it (unless something changed meanwhile)
function erase() {
  const since = changes;
  return request('readwrite', s => s.delete(SLOT)).then(() => { if (since === changes) mark(false); return true; }, () => false);
}

// best effort: a key the storage does not take is remembered on this page only
export async function remember(id, priv) {
  const me = memory = { id, priv }, since = ++changes;
  seen = true;
  if (globalThis.indexedDB) await request('readwrite', s => s.put(me, SLOT)).then(() => { if (since === changes) mark(false); }, () => {});
}
// → { id, priv } or null; storage trouble = nothing remembered
export async function recall() {
  if (memory || !globalThis.indexedDB) return memory;
  const since = changes;
  if (marked()) { await erase(); return memory; }      // a forget the storage did not take: finish it
  const found = await request('readonly', s => s.get(SLOT)).catch(() => undefined);
  if (since === changes) { memory = found || null; seen ||= !!memory; }
  return memory;
}
// → false only when the key may still be on this device (neither the delete nor the mark got through)
export async function forget() {
  memory = null;
  changes++;
  if (!globalThis.indexedDB) return true;
  const noted = mark(true);
  return await erase() || noted || !seen;
}
