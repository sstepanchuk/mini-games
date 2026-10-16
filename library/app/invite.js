/* =====================================================================
   The screens of playing together (together.js holds the room): the chip on the shelf, notes at the
   bottom of the screen, the "Грати разом" dialog, the name a player comes in with, and the library's card over a game,
   for a game that shows none of its waiting screens (`<ihroteka-wait>`, screens.js: whom we wait for and why, a seat,
   the version; games say only their own reasons, such as a hidden tab or a countdown). The dialog asks for the name,
   then checks for internet by itself:
   with internet there are two ways (a link, or nearby with QR codes), without it only nearby (and only nearby on a page
   without Web Crypto, served over plain http: net/config.js secure; it says why). Once together,
   more players can be added the same way (up to the room's limit). A friend on another version of the library or of
   a game, or who has open a game this shelf lacks (together.js gapFacts), is told so, each page its own part
   (waiting.js versionWords, owner decision 37: the older to update, the newer that the friend should; nearby, «…,
   коли буде інтернет»; why an update did not happen): on the shelf in a note once per gap («У кімнаті відкрили гру,
   якої тут немає» for such a game), on the chip while not together («Інша версія», decision 65), in «Грати разом»
   (the link screen's status, «Ви граєте разом») with «Оновити» on the older page (never nearby), or «Спробувати ще»
   after an update that did not happen; over a game, its screen or the card (only that game's version or the
   library's, decision 35).
   «З’єднатися знову» shows only where pairing again works (decision 31: the host, or a guest whose own link broke).
   What it says about players fits anyone (owner, decision 41; tests/texts.test.js), and a name in a sentence is
   isolated (dom.js iso: it never turns the line round). A typed name is cleaned first and refused, saying why, when
   nobody would see it (decision 43: together.js cleanName, validName). A name whose place a device still on the line
   holds is asked about first: «… уже грає в кімнаті з іншого пристрою. Це ти?» (decision 44: status 'taken'), and the
   device that loses its place says so and offers another name. Nearby: a browser without WebRTC is told at once, a
   guest whose code is not read yet hears why it still waits, a pairing the other phone gave up ends at once (decision
   30, 33), and the camera is explained and off while the page is hidden (decision 34). Notes at the bottom stack in a
   column (decision 40: dom.js toast); the dialogs leave a game's fullscreen (decision 51: dom.js modal).
   How it moves (the UX spec; motion.js: the state first, motion only decorates it, nothing waits for it):
   - each screen of the dialog is one step that enters from where it comes (view: forward, back, or a fade for another
     state of the same place); the dialog stands by its top edge, so only its bottom moves. A wait is in place: the
     pressed button's busy look («Далі»: «Перевіряю інтернет…»), a status line kept two lines high, a box of the QR's
     or the camera's size with a ring in it; never a screen of its own in between. A name's error has its slot between
     the field and its button (decision 40); a wrong code keeps the field, its text selected.
   - the link comes: «Ви граєте разом» stays 2.4 s with a bar that drains, a touch or a key in it keeps it open (owner,
     UX Q1); the chip says a word or two with a dot (UX Q3: waiting.js chipLook; the ping only in the dialog), its
     words cross-fading; a note never repeats what the dialog or the game already says (UX Q4: waiting.js noteOf).
   - one button that matters per screen (UX I11): what ends the room is a red ghost; nearby, the steps («● ○», whose
     turn) under the heading (I28).
   - the card over a game rises in, leaves as a ghost only when the rows end (never when they move to a copy), and
     after «Не чекати» says «Гаразд, не чекаємо.» for 1.2 s; one who dropped out less than 0.6 s ago is not named yet
     (a reload: UX Q1, waiting.js settled); our own internet gone, one line says so (UX Q2).
   ===================================================================== */
import { CODE_LENGTH, hasInternet, newRoomCode, preload, secure } from '../net/index.js';
import { $, btn, copyButton, el, errLine, iso, modal, para, safe, toast, toasts } from './dom.js';
import { busy as pending, fadeHide, flip, free, ghost, later, play, stop, tint } from './motion.js';
import { Camera, drawQr } from './qr.js';
import { canRepair } from './rules.js';
import { adopted, carry, focused, initScreens, paint, ready, show as showScreens } from './screens.js';
import { asking, cleanName, comeBack, currentRoom, elsewhere, gapFacts, lastInternetCode, lastName, leave, linked, nameInPlay, offerUpdate, onChange, rejoinAs, release,
  startInternet, startNearby, takePlace, updateNow, validName, waitFacts } from './together.js';
import { chipLook, GRACE, LABEL, names, noteOf, placeLines, sayOf, screen, settled, underway, versionAct, versionWords } from './waiting.js';

// a page without Web Crypto (plain http: `npm run dev -- --lan`) has no internet rooms (net/config.js secure)
const INSECURE = 'Через посилання можна грати лише на сторінці, відкритій через https: на цій адресі браузер вимикає шифрування.';

let shell = null;                                        // { address() → this view's address, with the room }
let dlg = null;                                          // the open dialog: { screen, show, close, focus, box, camera, scan, rescan, online, insecure,
                                                         //   adding, name, onName, tg, wait, state, update, hold }

export function initInvite(s) {
  shell = s;
  s.askName = askName;
  toasts();                                              // (the notes' live region: there before it speaks)
  $('together').addEventListener('click', () => openDialog());
  // the live region of the waiting rows: in #layer, which is never inert or hidden (a library dialog makes the stage
  // inert, and nothing in it is heard then), there before it speaks
  say = el('p', { className: 'sr', role: 'status' });
  $('layer').append(say);
  initScreens(waitNote);                                 // (the game's screens ask for a pass: a copy came, the page parsed…)
  waitNote();                                            // (the card, hidden)
  setInterval(waitNote, 1000);
  onChange(what => {
    const room = currentRoom();
    // a note, unless the dialog or the game says it already (owner, UX Q4: waiting.js noteOf)
    const note = room && noteOf(what, { kind: room.kind, players: room.players.length, linked: room.linked, dialog: dlg ? dlg.screen || 'open' : '',
      game: !$('stage').hidden && adopted(), known: what === 'linked' && known(room) });
    if (note) toast(note);
    if (room && room.linked) meet(room);
    // (a moment later: when the room's host changes, everyone is back together in a second)
    if (what === 'peer-gone') setTimeout(() => alone(room), 3000);
    if (what === 'replaced') queueMicrotask(goneElsewhere);
    // our name's place is held by a device still on the line: asked first, whether the dialog was open or not
    if (what === 'status' && room && room.status === 'taken' && !dlg) openDialog();
    if (what === 'version' && $('stage').hidden) sayVersion();   // (over a game, its screen or the card says it)
    if (what === 'status' && room && room.status === 'unavailable' && !secure()) toast(INSECURE);   // (opened from a link)
    if (/^(away|leave|left|peer-gone|version|waiting)$/.test(what)) waitNote();
    chip();
    if (dlg) refresh(what);
  });
  chip();
}
// Whom we were linked with in each room (those who left for good go): a 'linked' that brings back only them is a
// reload or a link that started over, not news (owner, UX Q4: no «Ви разом!» then)
const met = new WeakMap();                               // room → Set of names
const hereNow = room => room.players.filter(p => p !== room.me && !room.away(p));
function known(room) {
  const m = met.get(room), here = hereNow(room);
  return !!m && here.length > 0 && here.every(p => m.has(p));
}
function meet(room) {
  let m = met.get(room);
  if (!m) met.set(room, m = new Set());
  for (const p of m) if (!room.players.includes(p)) m.delete(p);
  for (const p of hereNow(room)) m.add(p);
}

// What a dialog shows now (m: a dom.js modal): its screen, entering from where it comes (dom.js modal show, o.dir):
// 'fwd' from the right, 'back' from the left (16 px, from .4 opacity: never an empty card), 'fade' another state of the
// same place; none: as it is (the dialog's own entry, or the same step again in place). The state is there at once;
// only its look enters. → the dialog's box
function view(m, dir, ...nodes) {
  if (m === dlg) endHold();
  m.show(nodes.filter(Boolean), dir ? { dir } : {});
  return m.box;
}

// The name a player comes in with (every time; the last one is filled in). onName(name), or onCancel().
function askName(onName, onCancel = () => {}) {
  let done = false;
  const m = modal(() => { if (!done) onCancel(); });
  const f = nameForm('Увійти', n => { done = true; m.close(); onName(n); });
  view(m, null, el('h2', { textContent: 'Як тебе звати?' }),
    para('Під цим іменем тебе бачитимуть друзі. Якщо відпадеш, зайди знову з тим самим іменем — і повернешся на своє місце.', 'fine'),
    f.form,
    btn('Скасувати', () => m.close(), 'btn ghost'));
  m.focus(f.input);
}
let forms = 0;                                           // (each form's line its own id)
// A name form (askName, the dialog's 'name' screen): { form, err, input, next }. The name is cleaned first (cleanName:
// one spelling for what devices type differently, such as ' and ’, «аня» and «Аня»), put back into the field, and taken
// (go(name, form)) if it may be one's own; if not, the line under the field says why (its slot, between the field and
// the button, kept: decision 40), the field keeps the focus, and the line goes as the player types. A name in play is
// taken as it is (together.js nameInPlay: a page reloaded in its room asks again, the name filled in; owner: a name
// already in play never changes).
function nameForm(label, go) {
  const input = el('input', { className: 'link', value: lastName(), maxLength: 24, placeholder: 'Твоє ім’я', autocomplete: 'nickname', spellcheck: false, enterKeyHint: 'go' });
  const err = errLine();
  err.id = 'name-err-' + ++forms;
  input.setAttribute('aria-describedby', err.id);
  const tell = text => tellField(err, input, text);
  input.addEventListener('input', () => tell(''));
  const next = Object.assign(btn(label, null), { type: 'submit' });
  const f = { input, err, next };
  const submit = e => {
    e.preventDefault();
    const kept = nameInPlay(input.value), n = kept ? input.value : cleanName(input.value);
    if (!input.value.trim()) tell('Напиши своє ім’я');
    else if (!kept && !validName(n)) tell('Ім’я має містити літери, цифри чи емодзі');
    else { tell(''); input.value = n; return go(n, f); }
    input.focus();
  };
  f.form = el('form', { className: 'stack', onsubmit: submit }, input, err, next);
  return f;
}
// a field's error (its line, kept under it): the words at once, then they fade in; '' takes them away
function tellField(err, input, text) {
  const was = err.textContent;
  err.textContent = text;
  if (text) input.setAttribute('aria-invalid', 'true'); else input.removeAttribute('aria-invalid');
  if (text && text !== was) play(err, 'ihk-fade', { duration: 'quick' });
}

// This player went on in another tab or on another device (the same name came in there): it may be someone else under
// that name, so the way back under another one comes first.
function goneElsewhere() {
  const r = elsewhere();
  if (!r) return;
  const m = modal(), back = r.kind === 'internet';
  // (one button that matters: «Повернути сюди» where there is one, «Інше ім’я» beside it on paper; UX I11)
  view(m, null, el('h2', { textContent: 'Ти граєш деінде' }),
    para('Під іменем «' + iso(r.name) + '» щойно увійшли з іншої вкладки або з іншого пристрою, тож гра продовжується там. Якщо це не ти — увійди під іншим ім’ям.'),
    btn('Інше ім’я', () => { m.close(); otherName(r.kind); }, back ? 'btn second' : 'btn'),
    back && btn('Повернути сюди', () => { m.close(); comeBack(); }),
    btn('Закрити', () => m.close(), 'btn ghost'));
}
// «Інше ім’я» (our name's place is played on another device): the name screen, then in under that name (together.js
// rejoinAs): over the internet the same room again; nearby, the pairing again (we were coming in: we scan the code of
// the phone that holds the room)
function otherName(kind) {
  if (!dlg) openDialog();
  dlg.onName = n => {
    dlg.onName = null;
    dlg.name = n;
    const r = rejoinAs(n);
    if (kind !== 'internet') guestPairing();
    else show(r ? 'link' : 'menu', 'fwd');
  };
  show('name', 'fade');
}

// Another version (together.js gapFacts), on the shelf: a note, once per gap and room on this page (each page its own
// part: waiting.js versionWords; a game the room opened that this shelf lacks: «У кімнаті відкрили гру, якої тут
// немає»). In another room, the same gap is news again.
let toasted = new Set(), toastedIn = null;
function sayVersion() {
  const gap = gapFacts(null), room = currentRoom();
  if (room !== toastedIn) { toasted = new Set(); toastedIn = room; }
  if (!gap || toasted.has(gap.key)) return;
  toasted.add(gap.key);
  toast(versionWords(gap, { nearby: !!room && room.kind === 'nearby' }));
}

// 3 s after the room went unlinked, still alone: nearby, the link broke; over the internet (on the shelf: over a game,
// its screen or the card says it), whom we wait for, or that nobody is left
function alone(was) {
  const room = currentRoom();
  if (!room || room !== was || linked()) return;
  if (room.kind === 'nearby') return toast('Зв’язок обірвався');
  if (!$('stage').hidden) return;
  const kept = room.players.filter(p => p !== room.me && room.away(p));
  toast(!kept.length ? 'У кімнаті більше нікого' : (kept.length > 1 ? 'Чекаємо, поки повернуться ' : 'Чекаємо, поки повернеться ') + names(kept.map(iso)) + '…');
}

/* ---------- over a game: the card «Чекаємо, поки повернеться …», for a game that shows none of its waiting screens ---------- */
// What the library says while the open game waits, and its buttons, are waiting.js's (screen: the words; from
// together.js waitFacts: whom we wait for and why, our copy restoring its round, a seat, the version); where it shows
// is screens.js's: in a copy of the game's <ihroteka-wait> that the player sees, else in this card over the game (every
// row; for a game that never placed one, the card as it was: link and loading of whom we play with, and the version;
// before the game's page has parsed, the version only: waiting.js placeLines). Never both.
// The card is built once and stays (hidden while there is nothing to say): each second only the time changes. What a
// screen reader hears is one live region (.sr, in #layer: heard with a dialog open too), wherever the rows show, which
// changes only when who or why does; a row stays while its player, reason and buttons do, so a focused «Не чекати»
// keeps its focus, and when the rows move between a copy of the game's and the card, the focus goes with them.
// The card rises in as it shows; it leaves as a ghost only when the rows end (rows that move to a copy just go: never
// two messages). After «Не чекати» on the card, it says «Гаразд, не чекаємо.» for 1.2 s, if there is nothing else to say
// (owner, UX Q2). Who dropped out less than GRACE ago is not named yet (a reload: back in a moment, UX Q1); our own
// internet gone (an internet room whose brokers we no longer reach), one line says so instead (UX Q2: waiting.js).
let card = null;                                         // { box, key: what its rows say now (their keys) }
let ack = null, graceAt = 0;                             // { name: whom «Не чекати» let go, cancel }; a pass asked when a grace ends
let say = null, said = '';                               // the live region, and what it says
const ACTS = { repair: () => repair(), release: name => notWaiting(name), update: () => updateNow(), retry: () => updateNow() };
// (once at a time: a game's 'showing' listener may change what is said, which asks for a pass again)
let noting = false, again = false;
function waitNote() {
  if (noting) { again = true; return; }
  noting = true;
  try { for (let n = 0; n < 4; n++) { again = false; noteOnce(); if (!again) break; } } finally { noting = false; }
}
function noteOnce() {
  const stage = $('stage');
  if (!card || !card.box.isConnected) {
    card = { box: el('div', { id: 'waiting', className: 'waiting card', hidden: true }) };
    stage.append(card.box);
  }
  const model = screen(stage.hidden ? null : facts());
  const was = focused();                                 // (a button of the rows with the focus: it follows its row)
  const held = showScreens(model, ACTS);                 // one of the game's screens holds the rows, or none does
  const rows = placeLines(model.rows, { ready: ready(), adopted: adopted(), held });
  const had = card.box.contains(document.activeElement), key = rows.map(r => r.key).join('|');
  if (ack && (rows.length || held || stage.hidden)) endAck();   // (something else to say now, or the card is gone)
  const shown = !card.box.hidden;
  // the rows ended (not moved to a copy, not the game closed): the card leaves as a ghost
  if (shown && !rows.length && !ack && !held && !stage.hidden) ghost(card.box, 'ihk-out');
  if (ack) { if (!card.box.querySelector('.ack')) { const a = el('div', { className: 'wait-row ack' }, el('p', { textContent: 'Гаразд, не чекаємо.' })); card.box.replaceChildren(a); play(a, 'ihk-fade', { duration: 'quick' }); } }
  else paint(card.box, rows, ACTS);
  card.box.hidden = !rows.length && !ack;                // (before any focus: a button in a hidden card takes none)
  if (!shown && !card.box.hidden) play(card.box, 'ihk-in');
  // A game on the whole screen covers the card, and one that shows none of its waiting screens says nothing itself:
  // something new to say leaves fullscreen (owner, decision 51; a player who goes back to it sees the game again)
  const fs = document.fullscreenElement;
  if (rows.length && key !== card.key && fs && fs === stage.querySelector('iframe') && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  card.key = rows.length ? key : '';
  // (a row that went held the focus: the player is back, whoever was about to press «Не чекати» goes on with the game)
  if (!carry(was, card.box) && had && !card.box.contains(document.activeElement)) safe(() => stage.querySelector('iframe')?.focus());
  const now = sayOf(held ? model.rows : rows);
  if (now !== said) { said = now; say.textContent = now; }
}
// What the screens say (together.js waitFacts), as the player sees it: our own internet gone (an internet room whose
// brokers we no longer reach, or no network at all), whoever dropped out is one line; one who dropped out less than
// GRACE ago is not named yet (a pass when that ends); whom «Не чекати» lets go, not while the card says so
function facts() {
  const f = waitFacts(), room = currentRoom();
  if (!room) return f;
  f.offline = room.kind === 'internet' && (navigator.onLine === false || !room.online);
  const away = p => room.away(p), s = settled(f, away);
  const wait = Math.min(Infinity, ...f.waits.filter(x => !s.waits.includes(x)).map(x => GRACE - away(x.name)));
  if (wait < Infinity && !graceAt) graceAt = setTimeout(() => { graceAt = 0; waitNote(); }, Math.max(0, wait) + 20);
  if (ack) s.waits = s.waits.filter(x => !(x.why === 'link' && x.name === ack.name));
  return s;
}
function endAck() { if (ack) { ack.cancel(); ack = null; } }
// «Не чекати»: their place goes. Nearby, for the phone that holds the room (we are a guest there): there is no room
// without it, so it ends here, saying why (owner, decision 5; the name in the nominative, decision 42).
function notWaiting(name) {
  const room = currentRoom();
  if (room && room.kind === 'nearby' && room.role === 'guest' && room.host === name) {
    leave();
    const m = modal();
    m.show(el('h2', { textContent: 'Кімнату поруч закрито' }), para('Кімнату поруч тримав телефон, на якому грає ' + iso(name) + ': без нього вона далі не може.'),
      btn('Закрити', () => m.close(), 'btn ghost'));
    return;
  }
  // (on the card: it says so for 1.2 s, owner UX Q2; a game's own screen just lets the row go)
  const onCard = !!card && !card.box.hidden && [...card.box.querySelectorAll('.wait-row')].some(r => r.dataset.name === name);
  if (onCard) { endAck(); ack = { name, cancel: later(1200, () => { ack = null; waitNote(); }) }; }   // (before: release may pass at once)
  release(name);
  waitNote();
}

// Nearby, a link broke: pair again (the host shows its code, a guest scans it); the player is back in their place.
// Only where it works (owner, decision 31: rules.canRepair): a guest whose own link to the host works cannot pair (the
// host's phone would answer «Це не той код»), nor the camera go on for it.
function repair() {
  const room = currentRoom();
  if (!room || room.kind !== 'nearby' || !repairs(room)) return;
  if (!dlg) openDialog();
  dlg.name = room.me; dlg.adding = true;
  if (room.role === 'host') hostPairing(); else guestPairing();
}
// whether this phone can pair again (rules.canRepair: the host, or a guest whose link to the host broke)
const repairs = room => canRepair({ nearby: room.kind === 'nearby', role: room.role, host: room.host, away: p => room.away(p) });
// a link in a nearby room broke that this phone can pair again (the host: anyone's; a guest: its own, to the host)
const brokenNearby = room => room.kind === 'nearby' && room.players.some(p => p !== room.me && room.away(p)) && repairs(room);

/* ---------- the chip on the shelf ---------- */
// An icon, a word or two (waiting.js chipLook: owner, UX Q3; the ping only in the dialog) and a dot for the state
// (page.html's markup). New words cross-fade in the same cell: the old ones, unheard at once, fade and go.
function chip() {
  const room = currentRoom(), b = $('together');
  const look = chipLook(room && { linked: linked(), weak: room.weak, players: room.players.length, nearby: room.kind === 'nearby', status: room.status, secure: secure(),
    gap: !!gapFacts(null) });
  b.classList.toggle('on', linked());
  let lbl = b.querySelector('.lbl'), dot = b.querySelector('.dot');
  if (!lbl) {                                            // (a page from before the markup: the words alone become it)
    lbl = el('span', { className: 'lbl' }); dot = el('i', { className: 'dot' });
    dot.setAttribute('aria-hidden', 'true');
    b.replaceChildren(lbl, dot);
  }
  const cls = 'dot' + (look.dot ? ' ' + look.dot : '');
  if (dot.className !== cls) dot.className = cls;
  const now = [...lbl.children].filter(x => !x.hasAttribute('aria-hidden')).pop();
  if (now && now.textContent === look.text) return;
  const words = el('span', { textContent: look.text });
  lbl.append(words);
  if (!now) return;
  fadeHide(now, { done: () => now.remove() });
  play(words, 'ihk-fade', { duration: 'quick' });
}

/* ---------- the dialog ---------- */
// (one for each status of the room: net/room.js STATUSES)
const STATUS = {
  connecting: 'Під’єднуюсь…',
  unavailable: 'Не вдалося завантажити. Перевір інтернет.',
  'no-signal': 'Немає зв’язку із сервером. Перевір інтернет, я пробую далі…',
  waiting: 'Чекаю, поки друг відкриє посилання…',
  joining: 'З’єднуюсь із другом…',
  taken: 'Під цим іменем уже грають з іншого пристрою.',
  full: 'У цій кімнаті вже немає місць.',
  'peer-left': 'Друг вийшов. Посилання діє далі — чекаю…',
  ready: 'Ви разом.',
  pairing: 'Поруч, без інтернету: з’єднайтеся кодами.',
  failed: 'Не вдалося з’єднатися.',
  version: 'У друга інша версія Ігротеки.'              // (said as each page's own part: statusText)
};
// (the version: each page its own part, waiting.js versionWords; owner, decision 37)
const statusText = room => room.status === 'unavailable' && !secure() ? INSECURE : room.status === 'version' ? versionLine(room) : STATUS[room.status] || '';
const versionLine = room => { const gap = gapFacts(); return gap ? versionWords(gap, { nearby: room.kind === 'nearby' }) + '.' : STATUS.version; };
// «Оновити» in the dialog (owner, decision 37: also on the shelf, where a game's note is not): on the older page only,
// never nearby (together.js offerUpdate); after an update that did not happen, «Спробувати ще» (the same call). Built
// once with its screen, shown and named in place (paintUpdate), so a focused button keeps its focus.
const updateBtn = () => Object.assign(btn('', () => updateNow()), { hidden: true });
function paintUpdate(b, on) {
  const gap = on && gapFacts(), show = !!gap && offerUpdate();
  b.hidden = !show;
  if (show) { const [text, cls] = LABEL[versionAct(gap)]; put(b, text); b.className = cls; }
}

export function openDialog() {
  if (dlg) return;
  if (secure()) preload();                               // the internet transport: likely needed soon
  dlg = modal(() => {
    endHold();
    document.removeEventListener('visibilitychange', camFollow);
    if (dlg.camera) dlg.camera.stop();
    const room = currentRoom();
    if (room && room.kind === 'nearby') { if (!room.linked) leave(); else room.pair.cancel(); }   // a pairing that never finished goes with the dialog
    else if (asking()) leave();                          // «Це ти?» not answered: we do not come in
    dlg = null;
  });
  document.addEventListener('visibilitychange', camFollow);
  const room = currentRoom();
  if (linked()) return show('together');
  if (asking()) return show('taken');
  if (room && room.kind === 'internet') return show('link');
  show('name');
}
// is there internet (see hasInternet)? with it: two ways; without it: straight to nearby (as on a page that cannot
// have internet rooms: menu). Meanwhile the name screen stays, «Далі» busy in place (motion.js busy: after 300 ms
// «Перевіряю інтернет…» in it, then for 500 ms at least); a second «Далі» meanwhile does nothing.
function check(f) {
  const d = dlg;
  if (!secure()) return show('menu', 'fwd');
  if (d.screen === 'check') return;
  d.screen = 'check';
  pending(f.next, 'Перевіряю інтернет…');
  hasInternet().then(online => free(f.next, { done: () => { if (dlg === d && d.screen === 'check') { d.online = online; show(online ? 'menu' : 'nearby', 'fwd'); } } }));
}
const closeDialog = () => { if (dlg) dlg.close(); };

// the room changed: only what shows its state is updated (not the whole screen: focus and selection stay; «Ви
// граєте разом» is painted in place on every change); once linked, the dialog says so for a moment and goes (holdOpen)
function refresh(what) {
  const room = currentRoom(), d = dlg;
  // together now (or one more, or back after pairing again): say so, and go
  if (what === 'linked' || (d.adding && (what === 'join' || (what === 'relinked' && !/^(together|link)$/.test(d.screen))))) {
    d.adding = false;
    show('together', 'fade');
    holdOpen();
    return;
  }
  // (asked again after a blip, net/room.js asked: the question stays as it is, and a name being typed for «Інше ім’я» too)
  if (what === 'status' && room && room.status === 'taken') return d.screen === 'taken' || d.onName ? undefined : show('taken', 'fade');
  // nearby, our code is not read yet, long after we showed it (net/nearby.js pair.slow): why we still wait
  if (what === 'pair' && room && room.kind === 'nearby' && room.pair.slow && d.wait) line(d.wait, SLOW, true);
  if (d.screen === 'together') { if (!linked()) closeDialog(); else paintTogether(); }
  else if (d.screen === 'link') {
    if (!room || room.kind !== 'internet') show('menu', 'back');
    else if (what === 'status' || what === 'version') { line(d.state, statusText(room), underway(room.status)); paintUpdate(d.update, room.status === 'version'); }
  }
  else if (room && room.kind === 'nearby' && room.status === 'failed' && what === 'status') failed(room.pair);
  else if (room && room.kind === 'nearby' && room.status === 'version' && what === 'status') otherVersion();
}
const stateText = room => { const s = room.stats(); return room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : ''; };
// one more player: the same link, or (nearby) a new pairing that only the room's host can make
function addPlayer() {
  const room = currentRoom();
  dlg.adding = true;
  if (room.kind === 'internet') show('link', 'fwd');
  else hostPairing();
}
// a room over the internet, under the same code as last time (the link sent earlier keeps working), if it is as long as a
// new room's: a shorter one (6 characters, from before the brokers' traffic was sealed: net/seal.js) is not used again
const viaLink = () => { const last = lastInternetCode(); startInternet(last && last.length >= CODE_LENGTH ? last : newRoomCode(), dlg.name); show('link', 'fwd'); };

// «Ви граєте разом» as the link comes (owner, UX Q1): it stays HOLD ms, a bar draining meanwhile (motion.js: a hold,
// the off switch does not shorten it; under «менше руху» the bar stays whole), then the dialog goes. A touch or a key
// in it keeps it open (the bar goes). No «Ви разом!» meanwhile: the dialog says it (waiting.js noteOf).
const HOLD = 2400;
function holdOpen() {
  const d = dlg, T = d.tg;
  if (!T) return;
  endHold(d);
  const keep = () => endHold(d);
  T.drain.hidden = false;
  play(T.drain, 'ihk-drain', { duration: HOLD, keep: true });
  d.box.addEventListener('pointerdown', keep, true);
  d.box.addEventListener('keydown', keep, true);
  const cancel = later(HOLD, () => { if (dlg === d && d.screen === 'together') closeDialog(); });
  d.hold = () => {
    cancel();
    d.box.removeEventListener('pointerdown', keep, true);
    d.box.removeEventListener('keydown', keep, true);
    stop(T.drain);
    T.drain.hidden = true;
  };
}
function endHold(d = dlg) { if (d && d.hold) { const h = d.hold; d.hold = null; h(); } }

// A status line (the link screen's, a pairing step's): kept two lines high, so nothing under it moves; a ring beside
// it only while something is under way (UX I22). New words fade in (the line is read as it changes: role status).
function statusLine(text = '', on = false) {
  const p = el('p', { className: 'status-line' });
  p.setAttribute('role', 'status');
  line(p, text, on);
  return p;
}
function line(p, text, on) {
  p.classList.toggle('busy', !!on && !!text);
  const was = p.firstElementChild;
  if (was && was.textContent === text) return;
  const words = el('span', { textContent: text });
  p.replaceChildren(words);
  if (was && text) play(words, 'ihk-fade', { duration: 'quick' });
}

// the icons of the ways to play together, and of nearby's two choices (one look on both screens: lines in ink)
const ICON = {
  link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1.2 1.2"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1.2-1.2"/></svg>',
  near: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="7" height="13" rx="1.6"/><rect x="14" y="5" width="7" height="13" rx="1.6"/><path d="M11.2 9.5h1.6M11.2 13.5h1.6"/></svg>',
  show: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2M20 14v.01M14 20h.01M17 17h3v3"/></svg>',
  scan: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><circle cx="12" cy="12" r="3.2"/></svg>'
};

// show(screen, dir): the dialog's screen, entering from where it comes (view: 'fwd', 'back', 'fade'; none at the start)
function show(screen, dir) {
  if (screen === 'together' && dlg.screen === 'together' && dlg.tg) return paintTogether();   // (built once: see paintTogether)
  endHold();
  dlg.screen = screen;
  dlg.tg = null;
  dlg.wait = null;
  const room = currentRoom(), close = btn('Закрити', closeDialog, 'btn ghost');
  if (screen === 'name') {
    // (then: what the screen was opened for, otherName; else on to the ways of playing together)
    const f = nameForm('Далі', (n, form) => { if (dlg.onName) return dlg.onName(n); dlg.name = n; check(form); });
    view(dlg, dir, el('h2', { textContent: 'Грати разом' }),
      para('Як тебе звати? Під цим іменем тебе бачитимуть друзі; якщо відпадеш, зайди знову з тим самим іменем — і повернешся на своє місце.'),
      f.form,
      close);
    dlg.focus(f.input);
  } else if (screen === 'taken') {
    // our name's place is held by a device still on the line (owner, decision 44): it may be us, or someone else
    // (nearby, the link comes in place: «З’єднуюсь…» in the pressed button, motion.js busy)
    const kind = room ? room.kind : 'internet';
    const yes = btn('Так, грати тут', () => {
      if (dlg.screen !== 'taken') return;
      takePlace();
      if (kind === 'internet') return show('link', 'fwd');
      dlg.screen = 'busy';
      pending(yes, 'З’єднуюсь…');
    });
    view(dlg, dir, el('h2', { textContent: 'Грати разом' }),
      para(iso(room ? room.me : dlg.name) + ' уже грає в кімнаті з іншого пристрою. Це ти?'),
      yes,
      btn('Інше ім’я', () => otherName(kind), 'btn second'),
      close);
  } else if (screen === 'menu') {
    if (!secure()) { Object.assign(dlg, { online: false, insecure: true }); return show('nearby', dir); }   // no link here: why, and nearby
    view(dlg, dir, el('h2', { textContent: 'Грати разом' }),
      para('Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.'),
      option(ICON.link, 'Через посилання', 'Друг може бути де завгодно: надішли посилання або покажи QR-код', viaLink),
      option(ICON.near, 'Поруч, без інтернету', 'Пристрої в одній мережі Wi-Fi або точці доступу', () => show('nearby', 'fwd')),
      close);
  } else if (screen === 'link') {
    if (!room || room.kind !== 'internet') return show('menu', 'back');
    const link = shell.address(), qr = el('canvas', { className: 'qr' });
    // (the status right under «Скопіювати», where it is seen on a small phone too)
    dlg.state = statusLine(statusText(room), underway(room.status));
    dlg.update = updateBtn();                            // (another version of the library: the older page's «Оновити»)
    paintUpdate(dlg.update, room.status === 'version');
    drawQr(qr, link, 200);
    const share = navigator.share && btn('Поділитися', () => navigator.share({ title: 'Ігротека', text: 'Заходь, пограємо разом!', url: link }).catch(() => {}));
    view(dlg, dir, el('h2', { textContent: 'Через посилання' }),
      para(room.linked ? 'Надішли це посилання ще комусь: щойно його відкриють, ви будете разом.' : 'Надішли другові це посилання. Щойно його відкриють, ви будете разом. Посилання можна дати й кільком друзям.'),
      el('input', { className: 'link', readOnly: true, value: link, onfocus: e => e.target.select() }),
      el('div', { className: 'row' }, ...[share, copyButton('Скопіювати', link)].filter(Boolean)),   // («Скопійовано» in the same width: dom.js)
      dlg.state, dlg.update,
      qr, para('Або хай друг наведе на цей код камеру свого телефона.', 'fine'),
      // («Скасувати» ends the room: a red ghost, UX I11)
      room.linked ? btn('Готово', closeDialog, 'btn ghost') : btn('Скасувати', () => { leave(); closeDialog(); }, 'btn ghost danger'));
  } else if (screen === 'nearby') {
    const back = dlg.online ? btn('Назад', () => show('menu', 'back'), 'btn ghost') : close;
    // a browser that cannot link directly (no WebRTC): said at once (owner, decision 30); with internet, the link works
    if (noRtc()) return view(dlg, dir, el('h2', { textContent: 'Поруч, без інтернету' }), para(WHY.nortc), back);
    view(dlg, dir, el('h2', { textContent: 'Поруч, без інтернету' }),
      ...(dlg.insecure ? [para(INSECURE + ' Поруч — можна.', 'fine')] : dlg.online ? [] : [para('Інтернету немає — з’єднаємося напряму.', 'fine')]),
      para('Обидва пристрої мають бути в одній мережі Wi-Fi (або один роздає точку доступу). Один показує код, другий його сканує, а потім навпаки.'),
      option(ICON.show, 'Показати код', 'Я починаю', () => hostPairing()),
      option(ICON.scan, 'Сканувати код', 'Друг уже показує код', () => guestPairing()),
      back);
  } else if (screen === 'together') {
    const T = dlg.tg = { h2: el('h2'), list: el('ul', { className: 'players people' }), items: new Map(), how: para(''), state: para('', 'fine ping'),
      version: para(''), update: updateBtn(),
      broken: para('Щоб продовжити, з’єднайтеся ще раз кодами.', 'fine'), repair: btn('З’єднатися знову', repair),
      more: el('p'), kind: '', painted: false, drain: el('div', { className: 'drain', hidden: true }) };
    T.drain.setAttribute('aria-hidden', 'true');
    view(dlg, dir, T.h2, T.list, T.how, T.state, T.version, T.update, T.broken, T.repair, T.more,
      btn('Від’єднатися', () => { leave(); closeDialog(); }, 'btn ghost danger'), close, T.drain);
    paintTogether();
  }
}
// «Ви граєте разом», built once (show) and painted in place on every change of the room (who is here, who dropped out,
// the ping, a direct link, another version and «Оновити», a broken link nearby that this phone can pair again, room
// for more): a focused button keeps its focus. A focused node that goes (hidden, or another kind of 'more') leaves the
// focus on the dialog itself. Players are chips (a dot: dashed while away, with the words; «ти» a tag); one who comes
// rises in, yellow for a moment; one who goes fades as a ghost, and the others glide (motion.js flip). A broken link
// nearby is said once: the heading «Зв’язок поруч перервався», one line, «З’єднатися знову» (UX I10), no ping.
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
function paintTogether() {
  const room = currentRoom(), T = dlg && dlg.tg;
  if (!room || !T) return;
  const box = dlg.box, a = document.activeElement, had = box.contains(a) && a !== box;
  const n = room.players.length, broken = brokenNearby(room), first = !T.painted;
  T.painted = true;
  put(T.h2, broken ? 'Зв’язок поруч перервався' : n > 2 ? 'Вас ' + n : 'Ви граєте разом');
  const gone = [...T.items].filter(([p]) => !room.players.includes(p)), came = [];
  if (!first) for (const [, li] of gone) ghost(li, 'ihk-fade-out');
  const change = () => {
    for (const [p, li] of gone) { li.remove(); T.items.delete(p); }
    let at = T.list.firstChild;
    for (const p of room.players) {
      let li = T.items.get(p);
      if (!li) { T.items.set(p, li = person(p, p === room.me)); came.push(li); }
      if (li === at) at = at.nextSibling; else T.list.insertBefore(li, at);
      const away = p !== room.me && room.away(p) > 0;
      li.classList.toggle('away', away);
      put(li.lastChild, away ? ' — зв’язок зник, місце чекає' : '');
    }
  };
  if (first || (!gone.length && !came.length && T.list.childElementCount === n)) change(); else flip([...T.items.values()], change);
  if (!first) for (const li of came) arrive(li);
  const internet = room.kind !== 'nearby';
  put(T.how, internet ? 'Через посилання.' + (room.stats().direct ? ' Пристрої з’єднані напряму.' : '') : 'Поруч, без інтернету.');
  T.how.classList.toggle('how', internet);               // (kept two lines high: «напряму» comes and goes)
  put(T.state, broken ? '' : stateText(room));
  const gap = gapFacts();
  put(T.version, gap ? versionWords(gap, { nearby: room.kind === 'nearby' }) + '.' : '');
  T.version.hidden = !gap;
  paintUpdate(T.update, true);
  T.broken.hidden = T.repair.hidden = !broken;
  const kind = n >= room.max ? 'full' : room.kind === 'internet' || room.role === 'host' ? 'add' : 'host';
  if (kind !== T.kind) {
    const node = kind === 'full' ? para('', 'fine') : kind === 'add' ? btn('Додати гравця', addPlayer, 'btn ghost') : para('Ще когось поруч додає пристрій, що показував код першим.', 'fine');
    T.more.replaceWith(node);
    Object.assign(T, { more: node, kind });
  }
  if (kind === 'full') put(T.more, 'Кімната повна: ' + room.max + ' гравців.');
  if (had && (!a.isConnected || a.hidden || !box.contains(document.activeElement))) box.focus();
}
// a player's chip: the dot, the name, «ти» (read «(ти)»), and the words while away (read with the name, as before)
function person(name, me) {
  const dot = el('i'), tag = me && el('em', { className: 'tag' }, el('span', { className: 'sr', textContent: ' (' }), 'ти', el('span', { className: 'sr', textContent: ')' }));
  dot.setAttribute('aria-hidden', 'true');
  return el('li', { className: 'person' }, dot, name, ...(tag ? [tag] : []), el('span', { className: 'state' }));
}
// one who came: rises in (ihk-keep), the house yellow («Разом») for 600 ms, back to the chip's white (a colour on a
// small chip: under «менше руху» a step, not a fade)
function arrive(li) {
  play(li, 'ihk-keep');
  tint(li, '#f2b91b', '#fffdf7', { duration: 600, easing: 'ease-in' });
}

// why a direct link did not work (see net/nearby.js), and what to do
const noNetwork = who => who + ' не бачить мережі, через яку можна з’єднатися напряму. Так буває з телефоном, що сам роздає точку доступу: його браузер цієї мережі не бачить. Нехай точку роздає інший пристрій, або під’єднайтеся обидва до одного роутера.';
const WHY = {
  here: noNetwork('Цей пристрій'),
  there: noNetwork('Пристрій друга'),
  vpn: 'На одному з пристроїв увімкнено VPN (наприклад Tailscale): він може пускати навіть зв’язок із сусіднім пристроєм через свій тунель. Вимкніть VPN на час гри (або дозвольте в ньому доступ до локальної мережі — у Tailscale це «Allow local network access») і спробуйте ще.',
  blocked: 'Пристрої в мережі, але вона не пускає їх одне до одного (так роблять деякі роутери, гостьові мережі та iPhone з iOS 18, що роздає точку доступу). Спробуйте іншу мережу Wi-Fi.',
  // the host said no (net/nearby.js): its own player has this name (one name, one place), or no place is left
  name: 'Це ім’я вже в кімнаті. Тому, хто приєднується, треба увійти під іншим ім’ям.',
  full: 'У цій кімнаті вже немає місць.',
  // the other phone gave up, or closed its page, before the phones said hello (owner, decision 33)
  closed: 'Друг скасував з’єднання або закрив сторінку. Спробуйте ще раз.',
  // no WebRTC in this browser (Tor Browser, or turned off): nearby cannot work here (owner, decision 30)
  nortc: 'Цей браузер не вміє з’єднуватися напряму: відкрий Ігротеку в Chrome, Safari чи Firefox'
};
const noRtc = () => typeof RTCPeerConnection !== 'function';
// what the guest's code screen says once its code has waited long (net/nearby.js pair.slow; owner, decision 30)
const SLOW = 'Друг ще не зчитав твій код — хай наведе на нього камеру';
// why the camera goes on before any code is scanned (owner, decision 34: see pairing)
const CAMERA = 'Браузер може спитати дозволу на камеру: вона знадобиться на кроці 2, і з нею пристрої поруч з’єднуються надійніше';

function failed(pair) {
  const why = pair.reason;
  dlg.screen = 'failed';
  if (dlg.camera) dlg.camera.stop();
  const report = pair.report(), room = currentRoom(), added = !!room && room.linked, joining = !room || room.role !== 'host';
  if (added) pair.cancel(); else leave();               // adding a player failed: those already here stay together
  // (one button that matters, «Спробувати ще»; the report for whoever debugs it a small link at the end: UX I11)
  view(dlg, 'fade', el('h2', { textContent: 'Не вдалося з’єднатися' }),
    para(why === 'blocked' && pair.vpn ? WHY.vpn : WHY[why] || WHY.blocked),
    // (again as before: the room's host shows a code, a guest pairing again scans one; the name taken, whoever was
    // coming in tries again under another one, and the phone that showed the code keeps its own)
    btn('Спробувати ще', () => added ? (joining ? guestPairing() : hostPairing()) : why === 'name' && joining ? show('name', 'back') : show('nearby', 'back')),
    dlg.online && !added && btn('Через посилання', viaLink, 'btn ghost'),
    btn('Закрити', closeDialog, 'btn ghost'),
    copyButton('Скопіювати звіт для розробника', report, 'btn ghost small'));
}

// nearby, the friend's phone runs another version of the library: the pairing ended (see net/nearby.js). Each phone
// says its own part (waiting.js versionWords, owner decision 37: «…, коли буде інтернет»): read before the room goes
// (leave forgets what it knew).
function otherVersion() {
  dlg.screen = 'version';
  if (dlg.camera) dlg.camera.stop();
  const room = currentRoom(), gap = gapFacts(null);
  if (room && room.linked) room.pair.cancel(); else leave();
  view(dlg, 'fade', el('h2', { textContent: 'Інша версія' }), para(gap ? versionWords(gap, { nearby: true }) + '.' : STATUS.version),
    btn('Закрити', closeDialog, 'btn ghost'));
}

function option(icon, title, sub, onclick) {
  const i = el('span', { className: 'option-icon' });
  i.innerHTML = icon;                                    // (ICON: the library's own markup)
  return el('button', { className: 'option', type: 'button', onclick }, i, el('span', {}, el('b', { textContent: title }), el('span', { textContent: sub })));
}

/* ---------- nearby pairing ---------- */
// The camera is switched on first, still hidden (see Camera): while it runs, the link is more likely to work. The host's
// dialog says why (CAMERA: the browser may ask for it before any code is scanned). It is off while the page is hidden
// (camFollow), and an onlost camera leaves the scan screen to a pasted code.
async function pairing() {
  const d = dlg;
  if (!d.camera || d.camera.stopped) {
    const c = d.camera = new Camera(el('video', { className: 'scan' }));
    c.onlost = () => { if (dlg === d && d.camera === c && d.screen === 'scan' && d.rescan) d.rescan(); };
  }
  await d.camera.start();
  return dlg === d ? { cam: d.camera, room: startNearby(d.name), live: () => dlg === d } : null;
}
// The camera is off while the page is hidden (another app in front: owner, decision 34) and on again when it is
// back. Off only while a code shows or the scan screen does: while a code is being made ('busy', 'checking') the camera
// must run (that is when the browser gathers this device's addresses).
function camFollow() {
  const c = dlg && dlg.camera;
  if (!c || c.stopped) return;
  if (!document.hidden) c.resume();
  else if (/^(code|scan)$/.test(dlg.screen)) c.pause();
}

// Each side has two steps: «Крок n з 2», and under it the dots and whose turn it is (UX I28); a step enters forward.
// What a step waits for is in place: a box of the code's or the camera's size with a ring in it, its words in the
// status line; then the code or the picture takes the box's place, and nothing else moves.
const SHOW = 'Покажи код другові', SCAN = 'Скануй код друга';
const QR = 260;                                          // a code's size on screen, px (its box's too)
function steps(n, role) {
  const dots = [el('i', { className: 'on' }), el('i', { className: n > 1 ? 'on' : '' })];
  for (const i of dots) i.setAttribute('aria-hidden', 'true');
  return el('p', { className: 'steps-dots' }, ...dots, el('span', { textContent: role }));
}
// (the second step comes: its dot fills, 140 ms: from the white to the ink of .steps-dots i.on)
const filled = s => tint(s.querySelector('.steps-dots i + i.on'), '#fffdf7', '#1b1a17');
const stepView = (dir, n, ...nodes) => { const s = view(dlg, dir, ...nodes); if (dir === 'fwd' && n > 1) filled(s); return s; };
const heading = n => el('h2', { textContent: 'Крок ' + n + ' з 2' });
function placeholder(camera) {
  const b = el('div', { className: 'placeholder' + (camera ? ' camera' : '') }, el('span', { className: 'spin' }));
  b.setAttribute('aria-hidden', 'true');
  return b;
}
const cancelBtn = () => btn('Скасувати', closeDialog, 'btn ghost');
const whoScans = room => (room && room.linked && !brokenNearby(room) ? 'Новий гравець' : 'Друг') + ' сканує цей код своїм пристроєм.';

// "1 · show the code": our offer, then scan the friend's answer
async function hostPairing() {
  dlg.screen = 'busy';
  stepView('fwd', 1, heading(1), steps(1, SHOW), para(whoScans(currentRoom())), placeholder(), para(CAMERA, 'fine'), statusLine('Готую код…', true), cancelBtn());
  const p = await pairing();
  if (!p) return;
  let code;
  try { code = await p.room.pair.offer(); } catch (e) { if (e.message !== 'nortc') console.error(e); return p.live() && failed(p.room.pair); }
  if (!p.live() || currentRoom() !== p.room) return;
  showCode(null, 1, SHOW, whoScans(p.room), code, p.room.pair.local ? null : para(WHY.here, 'err'),
    p.cam.running ? para(CAMERA, 'fine') : null,
    btn('Далі: сканувати код друга', () => scanCode('fwd', 2, SCAN, 'Наведи камеру на код на екрані друга.', p.cam, async (text, at) => {
      await p.room.pair.finish(text);
      at.wait('З’єднуюсь…');
    })));
}

// "2 · scan the code": the friend's offer, then show our answer. A code that does not read is «Це не той код»; a
// browser that cannot pair at all (no WebRTC) is told why.
async function guestPairing() {
  const text = 'Наведи камеру на код на екрані друга.';
  dlg.screen = 'busy';
  stepView('fwd', 1, heading(1), steps(1, SCAN), para(text), placeholder(true), statusLine('Вмикаю камеру…', true), cancelBtn());
  const p = await pairing();
  if (!p) return;
  scanCode(null, 1, SCAN, text, p.cam, async (t, at) => {
    at.wait('Готую відповідь…');
    let answer;
    try { answer = await p.room.pair.answer(t); } catch (e) { if (e.message !== 'nortc') throw e; return p.live() && failed(p.room.pair); }
    if (!p.live() || currentRoom() !== p.room) return;
    p.cam.stop();
    const wait = dlg.wait = statusLine(p.room.pair.slow ? SLOW : 'Чекаю на з’єднання…', true);
    showCode('fwd', 2, SHOW, 'Тепер покажи цей код: хай його відсканують.', answer, p.room.pair.local ? null : para(WHY.here, 'err'), wait);
  });
}

// the code to show, in its box (dir none: in place of its placeholder, fading in)
function showCode(dir, n, role, text, code, ...more) {
  const qr = el('canvas', { className: 'qr code' });
  drawQr(qr, code, QR);
  qr.style.width = qr.style.height = '';                 // (the box's size: style.css .qr.code, as its placeholder's)
  dlg.screen = 'code';
  stepView(dir, n, heading(n), steps(n, role), para(text), qr,
    ...more, copyButton('Скопіювати код', code, 'btn ghost'), cancelBtn());
  if (!dir) play(qr, 'ihk-fade');
  camFollow();                                           // (made while the page was hidden: the camera goes off now)
}

// camera (or a pasted code) → accept(text, at); at.wait(words): it is being checked (the words in the status line, the
// field away). A wrong code is said in place, in the field's error slot (the field open, a typed code selected), and
// the camera keeps reading (UX I09). A camera lost for good (Camera onlost) shows this step again without it, the field
// to paste the code into open.
function scanCode(dir, n, role, text, cam, accept) {
  const d = dlg, id = d.scan = (d.scan || 0) + 1, live = () => dlg === d && d.scan === id && d.screen === 'scan';
  d.screen = 'scan';
  d.rescan = () => scanCode(null, n, role, text, cam, accept);
  const input = el('input', { className: 'link', placeholder: 'або встав код сюди', autocomplete: 'off', spellcheck: false });
  const err = errLine();
  err.id = 'code-err-' + id;
  input.setAttribute('aria-describedby', err.id);
  input.addEventListener('input', () => tellField(err, input, ''));
  const ok = Object.assign(btn('Готово', null), { type: 'submit' });
  const form = el('form', { className: 'stack', hidden: cam.running, onsubmit: e => { e.preventDefault(); tryCode(input.value, true); } }, input, err, ok);
  const cancel = cancelBtn(), status = statusLine();
  status.hidden = true;
  // (the field opens: what is under it glides down)
  const open = () => { if (form.hidden) flip([cancel], () => { form.hidden = false; manual.remove(); }); };
  const manual = btn('Ввести код вручну', () => { open(); input.focus(); }, 'btn ghost');
  const at = { wait: words => { d.screen = 'busy'; form.hidden = true; manual.remove(); line(status, words, true); status.hidden = false; } };
  const wrong = typed => {
    d.screen = 'scan';
    status.hidden = true;
    open();
    tellField(err, input, 'Це не той код. Спробуй ще.');
    if (typed) { input.focus(); input.select(); }
    reading();
  };
  const tryCode = async (t, typed) => {
    t = String(t || '').trim();
    if (!t || !live()) return;                           // once only (a double tap, or the camera and a paste at once)
    d.screen = 'checking';
    try { await accept(t, at); }
    catch (e) { if (dlg === d && d.scan === id) wrong(typed); }
  };
  // (one reader at a time: a newer read() ends the one before with null, so a reader left from before a wrong typed
  // code goes, rather than read again and end the new one's, back and forth, with no frame ever looked at)
  let readers = 0;
  const reading = () => (async () => {
    const me = ++readers;
    while (cam.running && live() && me === readers) {
      const t = await cam.read(s => /^[A-Z2-7]{40,400}$/.test(s));
      if (t && live() && me === readers) return tryCode(t, false);
    }
  })();
  stepView(dir, n, heading(n), steps(n, role), para(text),
    cam.running ? cam.video : para('Камера недоступна: встав код, скопійований з іншого екрана.', 'fine'),
    status, form, cam.running && manual, cancel);
  if (!dir && cam.running) play(cam.video, 'ihk-fade');  // (in place of its box: the picture fades in)
  camFollow();
  reading();
}
