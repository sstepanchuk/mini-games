/* =====================================================================
   REMEMBERING THIS DEVICE
   After sign-in the private key is kept in IndexedDB as a non-extractable CryptoKey: the page
   can use it, but nobody can read its bytes. The password is never stored.
   Without IndexedDB (some private windows) nothing is remembered between pages: the password
   is asked again on every page. Anything else served from the same origin could use the stored
   key too, so the site must not host or load untrusted code (see README, Security).
   Forgetting stays forgotten: a mark in localStorage, written first, makes the next page finish a
   delete that IndexedDB did not take (it fails, or never answers).
   Storage that does not answer (Safari leaves indexedDB.open without an answer now and then, e.g. after the tab
   comes back; or it fails) is not taken for «nothing remembered»: recall() says TROUBLE, and recallLater() keeps
   asking until it answers (lock.js: the password dialog then closes by itself when the key comes).
   A key the library no longer takes (the person was removed, or their password changed) is forgotten with why
   (forget(why)): the note stays in its place for the password dialog (note()) until a key is stored again or the
   player forgets the password.
   ===================================================================== */
const DB = 'ihroteka', STORE = 'keys', SLOT = 'me', TIMEOUT = 3000, GONE = 'ihroteka-forgotten';
const AGAIN = 1000, TRIES = 60;                        // recallLater: a new open each second, for about a minute
export const TROUBLE = Symbol('the storage did not answer');
let memory = null;                                     // { id, priv }: the sign-in; { why }: a note of why it went
let changes = 0;                                       // remember() and forget() calls: a read begun before one does not undo it
let seen = false;                                      // this page found or stored a key
let late = null;                                       // a read that did not answer in time: its answer may still come

// One request in its own transaction; rejects on any trouble, and after TIMEOUT: Safari sometimes leaves
// indexedDB.open without any answer (e.g. after the tab comes back). A write whose open answers only after
// that is not made (it would undo what came after it). (.job: the request itself, which a read may still answer
// after the timeout: see recallLater.)
function request(mode, op) {
  let tooLate = false, timer;
  const job = new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = open.onblocked = () => reject(open.error || new Error('IndexedDB blocked'));
    open.onsuccess = () => {
      const db = open.result;
      if (tooLate && mode === 'readwrite') { db.close(); return; }
      try {
        const tx = db.transaction(STORE, mode), req = op(tx.objectStore(STORE));
        tx.oncomplete = () => { db.close(); resolve(req.result); };
        tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
    };
  });
  job.catch(() => {});
  const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { tooLate = true; reject(new Error('IndexedDB timeout')); }, TIMEOUT); });
  return Object.assign(Promise.race([job, timeout]).finally(() => clearTimeout(timer)), { job });
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
const signIn = () => memory && memory.priv ? memory : null;
// what the storage answered (since: the changes then) → the sign-in or null
function heard(found, since) {
  if (since === changes) { memory = found || null; seen ||= !!signIn(); }
  return signIn();
}
// → { id, priv }, null (nothing remembered, or only a note: see note()), or TROUBLE (the storage did not answer in time,
// or failed: nothing is known; a later call asks again, and recallLater waits for the answer)
export async function recall() {
  if (memory || !globalThis.indexedDB) return signIn();
  const since = changes;
  if (marked()) { await erase(); return signIn(); }    // a forget the storage did not take: finish it
  const read = request('readonly', s => s.get(SLOT));
  try { return heard(await read, since); } catch (e) {
    if (since === changes) late = read.job;
    return since === changes ? TROUBLE : signIn();
  }
}
// After TROUBLE: the sign-in once the storage answers (null: it has none, or the wait ended) — the late answer of the
// read that did not answer in time, or a new one each AGAIN ms while signal is not aborted, for about a minute. On
// Safari each new open comes after indexedDB.databases() settles (asked now and every 100 ms: that wakes up an
// IndexedDB that stopped answering, the safari-14-idb-fix technique).
export function recallLater(signal) {
  return new Promise(resolve => {
    const since = changes;
    let over = false, timer = null, tries = 0;
    const end = v => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      resolve(v);
    };
    const stop = () => end(null);
    const answered = found => end(memory || since !== changes ? signIn() : heard(found, since));
    if (signal?.aborted) return end(null);
    signal?.addEventListener('abort', stop);
    if (memory || !globalThis.indexedDB) return end(signIn());
    late?.then(answered, () => {});
    const again = async () => {
      if (over) return;
      if (++tries > TRIES) return end(null);
      await wake(signal);
      if (over) return;
      const read = request('readonly', s => s.get(SLOT));
      read.catch(() => {});                            // (its answer counts whenever it comes: the job)
      read.job.then(answered, () => {});
      timer = setTimeout(again, AGAIN);
    };
    timer = setTimeout(again, AGAIN);
  });
}
// (Safari: indexedDB.databases() now and every 100 ms until it settles, or the wait is called off)
const safari = () => { const n = globalThis.navigator; return !!n && !n.userAgentData && /Safari\//.test(n.userAgent || '') && !/Chrom(e|ium)\//.test(n.userAgent || ''); };
function wake(signal) {
  if (!safari() || typeof indexedDB.databases !== 'function') return Promise.resolve();
  return new Promise(done => {
    let every = null;
    const settled = () => { clearInterval(every); signal?.removeEventListener('abort', settled); done(); };
    const poke = () => { try { indexedDB.databases().then(settled, settled); } catch (e) { settled(); } };
    signal?.addEventListener('abort', settled);
    every = setInterval(poke, 100);
    poke();
  });
}
// why the key went (forget(why): 'removed' | 'changed'), after recall(); null when nothing says so
export const note = () => memory && !memory.priv && memory.why || null;
// → false only when the key may still be on this device (neither the delete nor the mark got through). why: the key
// no longer opens the library ('removed': the person is no longer in it; 'changed': their password was): a note of it
// stays in the key's place (a later remember() or a plain forget() replaces it)
export async function forget(why) {
  memory = why ? { why } : null;
  changes++;
  if (!globalThis.indexedDB) return true;
  if (why) { const n = memory; return request('readwrite', s => s.put(n, SLOT)).then(() => true, () => false); }
  const noted = mark(true);
  return await erase() || noted || !seen;
}
