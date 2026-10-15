/* =====================================================================
   The games are encrypted; everything else is public. Here: downloading, the password (asked only when a game
   is opened, and only once per device — except where the device remembers nothing: a private window, storage that
   failed, and Safari for a site not added to the home screen after 7 days of use without a visit; and after the
   library stopped taking the remembered key: the person was removed, or their password changed, which the dialog
   then says), and decrypting a game's page. Storage that does not answer in time is not «nothing remembered»: the
   dialog shows, and closes by itself when the key comes after all (device.js recallLater).
   ===================================================================== */
import * as vault from '../crypto.js';
import * as device from './device.js';
import { btn, el, modal, para, root } from './dom.js';
import { busy as pending, free, play } from './motion.js';

export const MSG = {
  offline: 'Не вдалося завантажити. Перевір інтернет і спробуй ще.',
  broken: 'Не вдалося відкрити бібліотеку. Онови сторінку трохи згодом.',
  insecure: 'Ця сторінка працює лише через https. Відкрий її за звичайним посиланням.',
  failed: 'Щось пішло не так. Перевір інтернет і спробуй ще.',
  wrong: 'Не той пароль.',
  updating: 'Бібліотеку щойно оновили. Спробуй за кілька хвилин.',
  game: 'Не вдалося відкрити гру. Онови сторінку.',
  // the password dialog's first line: as usual, or why the device no longer has the key (device.js note)
  intro: 'Ігри в Ігротеці відкриваються за паролем. Цей пристрій його запам’ятає.',
  removed: 'Доступ до ігор із цим паролем закрили. Якщо тобі дали новий пароль — введи його.',
  changed: 'Твій пароль змінили. Введи новий.',
  // while the password is checked (one key derivation per person: a cheap phone may take seconds): «Відкрити» says the
  // first after 300 ms; the line under it, for a screen reader, both
  unlocking: 'Відмикаю…',
  slow: 'Відмикаю… Це може тривати кілька секунд.'
};
// the network itself failed (fetchBytes marks it): not an HTTP error, an odd body or a bug
const offline = e => e?.offline === true;
const fail = (say, e = new Error(say)) => { e.say = say; return e; };

/* ---------- downloads ---------- */
const lost = e => { e.offline = true; throw e; };     // (see offline)
// no-cache: ask the server every time (after a key rotation an old copy would not decrypt);
// reload: also skip any cache on the way, for the one retry after a mismatch
async function fetchBytes(path, cache = 'no-cache') {
  const r = await fetch(new URL(path, root), { cache }).catch(lost);
  if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer().catch(lost));
}
// start a download now, read it later (an early failure is not reported as unhandled)
function prefetch(path, cache) {
  const p = fetchBytes(path, cache);
  p.catch(() => {});
  return p;
}
let keyringP = null;
function keyring(cache) {
  // anything but a keyring this page can read (a portal's JSON, a newer format) fails as a broken download does
  if (!keyringP || cache) {
    const p = keyringP = fetchBytes('keyring.json', cache).then(b => {
      const kr = JSON.parse(vault.text(b));
      if (!vault.isKeyring(kr)) throw new Error('keyring.json: not a v' + vault.KEYRING_V + ' keyring');
      return kr;
    });
    p.catch(() => { if (keyringP === p) keyringP = null; });   // a failed download is retried next time, not remembered
  }
  return keyringP;
}

// the shelf: which games there are (anything but a list of them, as a portal's page, is a broken download)
export const openShelf = () => fetchBytes('library.json').then(b => {
  const games = JSON.parse(vault.text(b));
  if (!Array.isArray(games)) throw new Error('library.json: not a list of games');
  return games;
}).catch(e => { throw fail(offline(e) ? MSG.offline : MSG.broken, e); });

/* ---------- the key ---------- */
async function libraryKey(id, priv) {
  const raw = await vault.libraryKey(await keyring(), id, priv);
  return raw && vault.importKey(raw);
}
// key from what this device remembers → the key, null (ask for the password) or device.TROUBLE (the storage did not
// answer: ask, and take the key if it comes meanwhile)
async function rememberedKey() {
  const me = await device.recall();
  return me && me !== device.TROUBLE ? keyOf(me) : me;
}
// the library key from a remembered sign-in, or null. Network errors and an unreadable keyring propagate: never forget
// a key for them. One the library no longer takes is forgotten, with why (for the dialog): the person is not in the
// keyring (asked once more past every cache first: a copy from before they were added is not a removal), or their box
// does not open with it (their password changed).
async function keyOf(me) {
  let kr = await keyring();
  let key = await libraryKey(me.id, me.priv).catch(() => null);
  const there = () => kr.people.some(p => p.id === me.id);
  if (!key && !there()) {
    kr = await keyring('reload');
    key = await libraryKey(me.id, me.priv).catch(() => null);
  }
  if (!key) await device.forget(there() ? 'changed' : 'removed');
  return key;
}
// the password → { who, key } (who: { person, priv }), or null: nobody's password. Remembers nothing: the dialog
// does, once the player still wants it (not after «Скасувати»)
async function passwordKey(password) {
  const who = await vault.signIn(await keyring(), password);
  const key = who && await libraryKey(who.person.id, who.priv);
  return key ? { who, key } : null;
}

let keyP = null, onKey = () => {};
// the library key: remembered, or asked for (game: { title, image } shown in the dialog). A key asked for before a
// sign-out (or before openSealed let it go) is not the page's any more: it shows no «Забути пароль», and, failing,
// does not drop a newer one.
export function unlock(game) {
  if (!keyP) {
    const p = keyP = askKey(game);
    p.then(() => { if (keyP === p) onKey(); }, () => { if (keyP === p) keyP = null; });   // cancelled or failed: ask again next time
  }
  return keyP;
}
export const whenSignedIn = fn => {
  onKey = fn;
  device.recall().then(me => me === device.TROUBLE ? device.recallLater() : me).then(me => { if (me) fn(); });
};
// → false when the key may still be on this device (device.js forget)
export function signOut() { keyP = null; return device.forget(); }

async function askKey(game = {}) {
  if (!globalThis.crypto?.subtle) throw Object.assign(fail(MSG.insecure), { final: true });   // (trying again cannot help)
  let key;
  try { key = await rememberedKey(); } catch (e) { throw fail(offline(e) ? MSG.offline : MSG.broken, e); }
  if (key && key !== device.TROUBLE) return key;
  return passwordDialog(game, device.note(), key === device.TROUBLE ? laterKey : null);
}
// the key, once the storage that did not answer does (null: it has none, it no longer fits, or the wait ended)
async function laterKey(signal) {
  const me = await device.recallLater(signal);
  return me && !signal.aborted ? keyOf(me) : null;
}

// A password dialog is open (a password being checked in it too): the page does not reload itself under it (shell.js
// busy, together.js versionCheck: what was typed would be lost).
let asking = 0;
export const askingPassword = () => asking > 0;

// "this game is locked": a password, or cancel (rejects with error.cancelled). Closed while «Відмикаю…» (Скасувати,
// Escape, a tap outside): the password checked after it is not remembered. why: the device's note of why its key went
// (device.js note), said first. later(signal) → the key, when the device's storage did not answer: if it comes before
// a password was sent, the dialog closes by itself and opens with it (Cancel, a password sent or the dialog closing
// stop the wait).
// What it shows (the UX spec L-T08, rule 5): the error's slot kept under the field (style.css .stack: nothing moves
// when it is said; it fades in). While the password is checked «Відкрити» is unavailable, as it was for 300 ms, then it
// says «Відмикаю…» in itself (motion.js busy: a ring, aria-busy; then for 500 ms at least): nothing is added, nothing
// moves. The line under it is a screen reader's («Відмикаю…», after a second MSG.slow): with motion on out of sight
// (style.css), motion off it shows, as the only sign.
let dialogs = 0;
function passwordDialog(game, why, later) {
  return new Promise((resolve, reject) => {
    let done = false, closed = false;
    const wait = new AbortController();
    asking++;
    const m = modal(() => {
      closed = true; asking--; wait.abort();
      if (!done) { const e = new Error('cancelled'); e.cancelled = true; reject(e); }
    });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль', required: true });
    pw.setAttribute('aria-label', 'Пароль');
    const err = para('', 'err'), go = el('button', { className: 'btn', type: 'submit', textContent: 'Відкрити' });
    err.id = 'lock-err-' + ++dialogs;
    err.setAttribute('role', 'alert');                 // a screen reader says what goes wrong
    pw.setAttribute('aria-describedby', err.id);
    // (while the password is checked: told to a screen reader as it changes; empty, not hidden, until then, so that
    // the first words are heard too: a live region must be there before it speaks. style.css keeps it out of sight)
    const busy = el('p', { className: 'busy' });
    busy.setAttribute('role', 'status');
    const intro = para(MSG[why] || MSG.intro);
    const form = el('form', { className: 'stack' }, el('input', { type: 'text', name: 'username', value: 'Ігротека', autocomplete: 'username', hidden: true }), pw, err, go, busy);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pw.value) return;
      wait.abort();                                    // (a password sent: no key from the storage any more)
      err.textContent = ''; pw.removeAttribute('aria-invalid'); go.disabled = true;
      busy.textContent = MSG.unlocking;
      pending(go, MSG.unlocking);
      const slow = setTimeout(() => { busy.textContent = MSG.slow; }, 1000);
      let found = null;
      try { found = await passwordKey(pw.value); } catch (x) { err.textContent = offline(x) ? MSG.failed : MSG.broken; }
      finally { clearTimeout(slow); busy.textContent = ''; free(go); }
      if (closed) return;
      go.disabled = false;
      if (found) {
        done = true;
        m.close();
        await device.remember(found.who.person.id, found.who.priv);
        resolve(found.key);
        return;
      }
      if (!err.textContent) { err.textContent = MSG.wrong; pw.setAttribute('aria-invalid', 'true'); }
      play(err, 'ihk-fade', { duration: 'quick' });
      pw.select();
    });
    m.show(...(game.image ? [el('img', { className: 'cover', src: new URL(game.id + '/' + game.image, root).href, alt: '' })] : []),
      el('h2', { textContent: game.title || 'Ігротека' }),
      intro,
      form, btn('Скасувати', () => m.close(), 'btn ghost'));
    pw.focus();
    if (later) later(wait.signal).then(key => {
      if (closed || done) return;
      if (!key) { const now = device.note(); if (now) intro.textContent = MSG[now]; return; }   // (one that no longer fits went: why)
      done = true;
      m.close();
      resolve(key);
    }, () => {});
  });
}

/* ---------- a game's page ---------- */
// Right after a key rotation the server may briefly hand out the new keyring with an old file (or the other way
// round): then both are fetched again past every cache, once, and the library key is opened again from the new
// keyring (the device remembers what it needs: no password). With the offline copy in charge, sw.js answers
// from one consistent version (it does not install a copy that mixes two), so this happens only when a new version
// took over while this page was open. Failures carry a message for the player (error.say).
// A browser without DecompressionStream (Safari before 16.4: iOS 15–16.3) gunzips a game with lib/inflate.js (fflate),
// loaded only there, by its URL (as qr.js loads lib/qr-scan.js: the build bundles without splitting, and would put it
// in the library's own file); else the browser's own (undefined: crypto.js gameText).
const gunzip = async () => typeof globalThis.DecompressionStream === 'undefined' ? (await import(new URL('lib/inflate.js', root).href)).gunzip : undefined;
async function openSealed(file, aad, game, blob = prefetch(file)) {
  for (let retry = false; ; retry = true) {
    const p = unlock(game), key = await p, kr = await keyring();
    let data;
    try { data = await blob; } catch (e) { throw fail(offline(e) ? MSG.offline : MSG.game, e); }
    if (vault.fileKid(data) === kr.kid) {
      try { return await vault.gameText(await vault.openFile(key, data, aad), await gunzip()); }
      catch (e) { throw fail(MSG.game, e); }
    }
    if (retry) throw fail(MSG.updating, new Error(file + ': key id differs from keyring.json'));
    blob = prefetch(file, 'reload');
    await keyring('reload').catch(() => {});
    if (keyP === p) keyP = null;                       // (a newer key, after a sign-out, stays)
  }
}
const early = new Map();
// start downloading a game now (e.g. while the page is still starting); openGame takes it from there
export const preloadGame = id => { early.set(id, prefetch(id + '/game.bin')); };
export function openGame(game) {
  const blob = early.get(game.id);
  early.delete(game.id);
  return openSealed(game.id + '/game.bin', vault.label.game(game.id), game, blob);
}
