/* =====================================================================
   Sign-in and decryption: the lock card, remembering this device, downloading and opening sealed files.
   Page markup: #unlock (form), #pw (password), #err (error), #busy (progress).
   ===================================================================== */
import * as vault from '../vault/index.js';
import * as device from './device.js';
import { $, root } from './dom.js';

const MSG = {
  offline: 'Не вдалося завантажити. Перевір інтернет і онови сторінку.',
  broken: 'Не вдалося завантажити бібліотеку. Онови сторінку трохи згодом.',
  insecure: 'Ця сторінка працює лише через https. Відкрий її за звичайним посиланням.',
  failed: 'Щось пішло не так. Перевір інтернет і спробуй ще.',
  wrong: 'Не той пароль.',
  updating: 'Бібліотеку щойно оновили. Спробуй за кілька хвилин.',
  game: 'Не вдалося відкрити гру. Онови сторінку.',
  library: 'Не вдалося відкрити бібліотеку. Онови сторінку.'
};
// fetch() rejects with TypeError only when the network itself failed
const offline = e => e instanceof TypeError;

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

/* ---------- keys ---------- */
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

// Shows the lock until the library key is known; resolves with it.
let keyP = null;
export const unlock = () => keyP || (keyP = askKey());
async function askKey() {
  const form = $('unlock'), pw = $('pw'), err = $('err'), busy = $('busy');
  const show = state => { form.hidden = state !== 'form'; busy.hidden = state !== 'busy'; };
  show('busy');
  if (!globalThis.crypto?.subtle) { busy.textContent = MSG.insecure; throw new Error('no Web Crypto (insecure context?)'); }
  try {
    const key = await rememberedKey();
    if (key) return key;
  } catch (e) {
    busy.textContent = offline(e) ? MSG.offline : MSG.broken;
    throw e;
  }
  show('form');
  pw.focus();
  return new Promise(resolve => form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!pw.value) return;
    err.textContent = '';
    show('busy');
    let key = null;
    try { key = await passwordKey(pw.value); } catch (x) { err.textContent = offline(x) ? MSG.failed : MSG.broken; }
    if (key) { pw.value = ''; resolve(key); return; }
    if (!err.textContent) err.textContent = MSG.wrong;
    show('form');
    pw.select();
  }));
}

// Decrypt a file (its download starts at once, in parallel with the sign-in). Right after a key rotation the
// server may briefly hand out the new keyring with an old file (or the other way round): then both are
// fetched again past every cache, once. Failures carry a message for the player (error.say).
export async function openSealed(file, aad, failure) {
  let blob = prefetch(file);
  const fail = (say, e) => { e.say = say; return e; };
  for (let retry = false; ; retry = true) {
    const key = await unlock(), kr = await keyring();
    let data;
    try { data = await blob; } catch (e) { throw fail(offline(e) ? MSG.offline : failure, e); }
    if (vault.fileKid(data) === kr.kid) {
      try { return vault.text(await vault.openFile(key, data, aad)); }
      catch (e) { throw fail(failure, e); }
    }
    if (retry) throw fail(MSG.updating, new Error(file + ': key id differs from keyring.json'));
    blob = prefetch(file, 'reload');
    await keyring('reload').catch(() => {});
  }
}
// a game's page; preloadGame starts it early (the next openGame of that game takes that result)
const early = new Map();
export const preloadGame = id => { const p = openGame(id); p.catch(() => {}); early.set(id, p); };
export function openGame(id) {
  const p = early.get(id);
  if (p) { early.delete(id); return p; }
  return openSealed(id + '/game.bin', vault.label.game(id), MSG.game);
}
export const openShelf = () => openSealed('library.bin', vault.label.library(), MSG.library).then(JSON.parse);
export const signOut = () => device.forget();

