/* =====================================================================
   The games are encrypted; everything else is public. Here: downloading, the password (asked only when a game
   is opened, and only once per device: but a private window, a device whose storage does not answer, and Safari
   (for a site not added to the home screen, after 7 days of use without a visit) remember nothing, so it is asked
   again), and decrypting a game's page.
   ===================================================================== */
import * as vault from '../crypto.js';
import * as device from './device.js';
import { btn, el, modal, para, root } from './dom.js';

const MSG = {
  offline: 'Не вдалося завантажити. Перевір інтернет і спробуй ще.',
  broken: 'Не вдалося відкрити бібліотеку. Онови сторінку трохи згодом.',
  insecure: 'Ця сторінка працює лише через https. Відкрий її за звичайним посиланням.',
  failed: 'Щось пішло не так. Перевір інтернет і спробуй ще.',
  wrong: 'Не той пароль.',
  updating: 'Бібліотеку щойно оновили. Спробуй за кілька хвилин.',
  game: 'Не вдалося відкрити гру. Онови сторінку.'
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

// the shelf: which games there are
export const openShelf = () => fetchBytes('library.json').then(b => JSON.parse(vault.text(b)), e => { throw fail(offline(e) ? MSG.offline : MSG.broken, e); });

/* ---------- the key ---------- */
async function libraryKey(id, priv) {
  const raw = await vault.libraryKey(await keyring(), id, priv);
  return raw && vault.importKey(raw);
}
// key from what this device remembers; null → ask for the password
async function rememberedKey() {
  const me = await device.recall();
  if (!me) return null;
  await keyring();                                   // network errors and an unreadable keyring propagate: never forget a key for them
  const key = await libraryKey(me.id, me.priv).catch(() => null);
  if (!key) await device.forget();                   // removed from the library, or the stored key no longer fits
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
export const whenSignedIn = fn => { onKey = fn; device.recall().then(me => { if (me) fn(); }); };
// → false when the key may still be on this device (device.js forget)
export function signOut() { keyP = null; return device.forget(); }

async function askKey(game = {}) {
  if (!globalThis.crypto?.subtle) throw fail(MSG.insecure);
  try {
    const key = await rememberedKey();
    if (key) return key;
  } catch (e) { throw fail(offline(e) ? MSG.offline : MSG.broken, e); }
  return passwordDialog(game);
}

// "this game is locked": a password, or cancel (rejects with error.cancelled). Closed while «Відмикаю…» (Скасувати,
// Escape, a tap outside): the password checked after it is not remembered.
let dialogs = 0;
function passwordDialog(game) {
  return new Promise((resolve, reject) => {
    let done = false, closed = false;
    const m = modal(() => { closed = true; if (!done) { const e = new Error('cancelled'); e.cancelled = true; reject(e); } });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль', required: true });
    pw.setAttribute('aria-label', 'Пароль');
    const err = para('', 'err'), go = el('button', { className: 'btn', type: 'submit', textContent: 'Відкрити' });
    err.id = 'lock-err-' + ++dialogs;
    err.setAttribute('role', 'alert');                 // a screen reader says what goes wrong
    pw.setAttribute('aria-describedby', err.id);
    const form = el('form', {}, el('input', { type: 'text', name: 'username', value: 'Ігротека', autocomplete: 'username', hidden: true }), pw, go, err);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pw.value) return;
      err.textContent = ''; pw.removeAttribute('aria-invalid'); go.disabled = true; go.textContent = 'Відмикаю…';
      let found = null;
      try { found = await passwordKey(pw.value); } catch (x) { err.textContent = offline(x) ? MSG.failed : MSG.broken; }
      if (closed) return;
      go.disabled = false; go.textContent = 'Відкрити';
      if (found) {
        done = true;
        m.close();
        await device.remember(found.who.person.id, found.who.priv);
        resolve(found.key);
        return;
      }
      if (!err.textContent) { err.textContent = MSG.wrong; pw.setAttribute('aria-invalid', 'true'); }
      pw.select();
    });
    m.show(...(game.image ? [el('img', { className: 'cover', src: new URL(game.id + '/' + game.image, root).href, alt: '' })] : []),
      el('h2', { textContent: game.title || 'Ігротека' }),
      para('Ігри в Ігротеці відкриваються за паролем. Цей пристрій його запам’ятає.'),
      form, btn('Скасувати', () => m.close(), 'btn ghost'));
    pw.focus();
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
