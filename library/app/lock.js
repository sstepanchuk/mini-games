/* =====================================================================
   The games are encrypted; everything else is public. Here: downloading, the password (asked only when a game
   is opened, and only once per device), and decrypting a game's page.
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
// fetch() rejects with TypeError only when the network itself failed
const offline = e => e instanceof TypeError;
const fail = (say, e = new Error(say)) => { e.say = say; return e; };

/* ---------- downloads ---------- */
// no-cache: ask the server every time (after a key rotation an old copy would not decrypt);
// reload: also skip any cache on the way, for the one retry after a mismatch
async function fetchBytes(path, cache = 'no-cache') {
  const r = await fetch(new URL(path, root), { cache });
  if (!r.ok) throw new Error(path + ': HTTP ' + r.status);
  return new Uint8Array(await r.arrayBuffer());
}
// start a download now, read it later (an early failure is not reported as unhandled)
function prefetch(path, cache) {
  const p = fetchBytes(path, cache);
  p.catch(() => {});
  return p;
}
let keyringP = null;
function keyring(cache) {
  if (!keyringP || cache) keyringP = fetchBytes('keyring.json', cache).then(b => JSON.parse(vault.text(b)));
  keyringP.catch(() => { keyringP = null; });         // a failed download is retried next time, not remembered
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
  await keyring();                                   // network errors propagate: never forget a key because we are offline
  const key = await libraryKey(me.id, me.priv).catch(() => null);
  if (!key) await device.forget();                   // removed from the library, or the stored key no longer fits
  return key;
}
async function passwordKey(password) {
  const who = await vault.signIn(await keyring(), password);
  if (!who) return null;
  await device.remember(who.person.id, who.priv);
  return libraryKey(who.person.id, who.priv);
}

let keyP = null, onKey = () => {};
// the library key: remembered, or asked for (game: { title, image } shown in the dialog)
export function unlock(game) {
  if (!keyP) {
    keyP = askKey(game);
    keyP.then(() => onKey(), () => { keyP = null; });   // cancelled or failed: ask again next time
  }
  return keyP;
}
export const whenSignedIn = fn => { onKey = fn; device.recall().then(me => { if (me) fn(); }); };
export async function signOut() { keyP = null; await device.forget(); }

async function askKey(game = {}) {
  if (!globalThis.crypto?.subtle) throw fail(MSG.insecure);
  try {
    const key = await rememberedKey();
    if (key) return key;
  } catch (e) { throw fail(offline(e) ? MSG.offline : MSG.broken, e); }
  return passwordDialog(game);
}

// "this game is locked": a password, or cancel (rejects with error.cancelled)
function passwordDialog(game) {
  return new Promise((resolve, reject) => {
    let done = false;
    const m = modal(() => { if (!done) { const e = new Error('cancelled'); e.cancelled = true; reject(e); } });
    const pw = el('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Пароль', required: true });
    pw.setAttribute('aria-label', 'Пароль');
    const err = para('', 'err'), go = el('button', { className: 'btn', type: 'submit', textContent: 'Відкрити' });
    const form = el('form', {}, el('input', { type: 'text', name: 'username', value: 'Ігротека', autocomplete: 'username', hidden: true }), pw, go, err);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!pw.value) return;
      err.textContent = ''; go.disabled = true; go.textContent = 'Відмикаю…';
      let key = null;
      try { key = await passwordKey(pw.value); } catch (x) { err.textContent = offline(x) ? MSG.failed : MSG.broken; }
      go.disabled = false; go.textContent = 'Відкрити';
      if (key) { done = true; m.close(); resolve(key); return; }
      if (!err.textContent) err.textContent = MSG.wrong;
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
// round): then both are fetched again past every cache, once. Failures carry a message for the player (error.say).
async function openSealed(file, aad, game, blob = prefetch(file)) {
  for (let retry = false; ; retry = true) {
    const key = await unlock(game), kr = await keyring();
    let data;
    try { data = await blob; } catch (e) { throw fail(offline(e) ? MSG.offline : MSG.game, e); }
    if (vault.fileKid(data) === kr.kid) {
      try { return vault.text(await vault.openFile(key, data, aad)); }
      catch (e) { throw fail(MSG.game, e); }
    }
    if (retry) throw fail(MSG.updating, new Error(file + ': key id differs from keyring.json'));
    blob = prefetch(file, 'reload');
    await keyring('reload').catch(() => {});
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
