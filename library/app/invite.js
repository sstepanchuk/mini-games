/* =====================================================================
   The screens of playing together (together.js holds the room): the chip on the shelf, notes at the
   bottom of the screen, the "Грати разом" dialog, the name a player comes in with, and the card over a game
   while it waits for a player (the only «Чекаємо на …»: games say only their own reasons, such as a hidden tab or
   a countdown). The dialog asks for the name, then checks for internet by itself:
   with internet there are two ways (a link, or nearby with QR codes), without it only nearby (and only nearby on a page
   without Web Crypto, served over plain http: net/config.js secure; it says why). Once together,
   more players can be added the same way (up to the room's limit). A friend on another version of the library or of
   the game (together.js versionGap) is told everywhere it shows: «Онови сторінку — у друга інша версія».
   ===================================================================== */
import { CODE_LENGTH, hasInternet, newRoomCode, preload, secure } from '../net/index.js';
import { $, btn, copy, el, modal, para, safe, toast } from './dom.js';
import { Camera, drawQr } from './qr.js';
import { comeBack, currentRoom, elsewhere, lastInternetCode, lastName, leave, linked, offerUpdate, onChange, release, startInternet, startNearby, updateNow, validName, versionGap,
  waitingFor } from './together.js';

const UPDATE = 'Онови сторінку — у друга інша версія';   // (owner, decision 9)
// a page without Web Crypto (plain http: `npm run dev -- --lan`) has no internet rooms (net/config.js secure)
const INSECURE = 'Через посилання можна грати лише на сторінці, відкритій через https: на цій адресі браузер вимикає шифрування.';

let shell = null;                                        // { address() → this view's address, with the room }
let dlg = null;                                          // the open dialog: { screen, show, close, camera, scan, online, insecure, adding, name }

export function initInvite(s) {
  shell = s;
  s.askName = askName;
  $('together').addEventListener('click', () => openDialog());
  waitNote();                                            // (the card, hidden: its live region is there before it speaks)
  setInterval(waitNote, 1000);
  onChange(what => {
    const room = currentRoom();
    if (what === 'linked') toast(room.kind === 'nearby' ? 'Ви разом, поруч без інтернету' : 'Ви разом!');
    else if (what === 'join' && room && room.linked && room.players.length > 2) toast('До вас приєднався ще один гравець (' + room.players.length + ')');
    else if (what === 'leave' && room && room.linked) toast('Один гравець вийшов');
    // (a moment later: when the room's host changes, everyone is back together in a second)
    if (what === 'peer-gone') setTimeout(() => { if (!linked()) toast(room && room.kind === 'nearby' ? 'Зв’язок обірвався' : 'Друзі вийшли'); }, 3000);
    if (what === 'replaced') queueMicrotask(goneElsewhere);
    if (what === 'version' && versionGap()) toast(UPDATE);
    if (what === 'status' && room && room.status === 'unavailable' && !secure()) toast(INSECURE);   // (opened from a link)
    if (/^(away|leave|left|peer-gone|version|waiting)$/.test(what)) waitNote();
    chip();
    if (dlg) refresh(what);
  });
  chip();
}

// The name a player comes in with (every time; the last one is filled in). onName(name), or onCancel().
function askName(onName, onCancel = () => {}) {
  let done = false;
  const m = modal(() => { if (!done) onCancel(); });
  const input = nameInput(), go = e => { e.preventDefault(); if (!validName(input.value.trim())) return input.focus(); done = true; m.close(); onName(input.value.trim()); };
  m.show(el('h2', { textContent: 'Як тебе звати?' }),
    para('Під цим іменем тебе бачитимуть друзі. Якщо відпадеш, зайди знову з тим самим іменем — і повернешся на своє місце.', 'fine'),
    el('form', { className: 'row', onsubmit: go }, input, Object.assign(btn('Увійти', null), { type: 'submit' })),
    btn('Скасувати', () => m.close(), 'btn ghost'));
  queueMicrotask(() => input.select());
}
const nameInput = () => el('input', { className: 'link', value: lastName(), maxLength: 24, placeholder: 'Твоє ім’я', autocomplete: 'nickname', spellcheck: false, enterKeyHint: 'go' });

// This player went on in another tab or on another device (the same name came in there).
function goneElsewhere() {
  const r = elsewhere();
  if (!r) return;
  const m = modal();
  m.show(el('h2', { textContent: 'Ти граєш деінде' }),
    para('«' + r.name + '» щойно зайшов у кімнату з іншої вкладки або з іншого пристрою, тож гра продовжується там.'),
    ...(r.kind === 'internet' ? [btn('Повернути сюди', () => { m.close(); comeBack(); })] : []),
    btn('Закрити', () => m.close(), 'btn ghost'));
}

/* ---------- over a game: the card «Чекаємо на …» ---------- */
// Whom the open game waits for, and why (together.js waitingFor, rules.absence):
//   'link'     dropped out, their seat kept: «Чекаємо на X… 2:45» (the time their place is kept) and «Не чекати» (their
//              place goes: the game goes on without them, if it can), where it works (rules.canRelease: not for others
//              while we are cut off from the room's host). Nearby, a broken link does not come back by itself:
//              «З’єднатися знову» (pairing again); and when X is the phone that holds the room (its host, the one who
//              showed the code first), nothing here can go on without it: «Не чекати» ends the room on this device,
//              saying so (owner, decision 5).
//   'loading'  back, their game opening in a new tab or device: «Чекаємо на X — повертається в гру», with nothing to
//              press (they did not drop out; owner, decision 4).
// A friend on another version: «Онови сторінку — у друга інша версія», with «Оновити» on the older page.
// The card is built once and stays (hidden while there is nothing to say): each second only the time changes. What a
// screen reader hears is a live region of its own beside it (.sr), which changes only when who or why does; a row
// stays while its player, reason and buttons do, so a focused «Не чекати» keeps its focus.
let card = null;                                         // { box, say, said, rows: Map(name → { row, why, release, left }), gap, gapKey }
const mmss = ms => { const s = Math.ceil(ms / 1000); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
const waitText = ({ name, why }) => 'Чекаємо на ' + name + (why === 'loading' ? ' — повертається в гру' : '…');
function waitNote() {
  const stage = $('stage'), gap = versionGap(), list = stage.hidden ? [] : waitingFor();
  if (!card || !card.box.isConnected) {
    card = { box: el('div', { id: 'waiting', className: 'waiting card', hidden: true }), say: el('p', { className: 'sr', role: 'status' }), said: '', rows: new Map(), gap: null, gapKey: '' };
    stage.append(card.box, card.say);
  }
  const shown = !stage.hidden && (list.length > 0 || !!gap);
  for (const [name, r] of card.rows) if (!shown || !list.some(x => x.name === name && x.why === r.why && x.release === r.release)) dropRow(name);
  for (const x of shown ? list : []) {
    let r = card.rows.get(x.name);
    if (!r) { r = waitRow(x); card.rows.set(x.name, r); card.box.insertBefore(r.row, card.gap); }
    if (r.left) r.left.textContent = mmss(x.left);
  }
  const gk = shown && gap ? gap.key + (offerUpdate() ? '+' : '') : '';
  if (gk !== card.gapKey) {
    card.gapKey = gk;
    if (card.gap) card.gap.remove();
    card.gap = gk ? el('div', { className: 'wait-row' }, para(UPDATE), ...(offerUpdate() ? [btn('Оновити', updateNow, 'btn ghost')] : [])) : null;
    if (card.gap) card.box.append(card.gap);
  }
  card.box.hidden = !shown;
  const said = shown ? [...list.map(waitText), ...(gap ? [UPDATE] : [])].join('. ') : '';
  if (said !== card.said) { card.said = said; card.say.textContent = said; }
}
// one waited player's row: the line (with the time, for a place that is kept) and what can be done
function waitRow(x) {
  const left = x.why === 'link' ? el('span', { className: 'left' }) : null;
  const near = currentRoom() && currentRoom().kind === 'nearby';
  const row = el('div', { className: 'wait-row' }, el('p', {}, waitText(x), ...(left ? [' ', left] : [])),
    ...(x.why !== 'link' ? [] : [
      ...(near ? [para('Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.', 'fine'), btn('З’єднатися знову', repair)] : []),
      ...(x.release ? [btn('Не чекати', () => notWaiting(x.name), 'btn ghost')] : [])]));
  return { row, why: x.why, release: x.release, left };
}
function dropRow(name) {
  const r = card.rows.get(name);
  card.rows.delete(name);
  // (the player is back: whoever was about to press «Не чекати» goes on with the game)
  if (r.row.contains(document.activeElement)) safe(() => $('stage').querySelector('iframe')?.focus());
  r.row.remove();
}
// «Не чекати»: their place goes. Nearby, for the phone that holds the room (we are a guest there): there is no room
// without it, so it ends here, saying why.
function notWaiting(name) {
  const room = currentRoom();
  if (room && room.kind === 'nearby' && room.role === 'guest' && room.host === name) {
    leave();
    const m = modal();
    m.show(el('h2', { textContent: 'Кімнату поруч закрито' }), para('Без телефона ' + name + ' кімната поруч далі не може.'),
      btn('Закрити', () => m.close(), 'btn ghost'));
    return;
  }
  release(name);
  waitNote();
}

// Nearby, a link broke: pair again (the host shows its code, a guest scans it); the player is back in their place.
function repair() {
  const room = currentRoom();
  if (!room || room.kind !== 'nearby') return;
  if (!dlg) openDialog();
  dlg.name = room.me; dlg.adding = true;
  if (room.role === 'host') hostPairing(); else guestPairing();
}
// someone in a nearby room is away (their link broke)
const brokenNearby = room => room.kind === 'nearby' && room.players.some(p => p !== room.me && room.away(p));

/* ---------- the chip on the shelf ---------- */
function chip() {
  const room = currentRoom(), s = room && room.linked && room.stats(), b = $('together');
  b.classList.toggle('on', linked());
  b.textContent = !room ? 'Грати разом'
    : versionGap() && !linked() ? UPDATE
    : linked() ? (room.weak ? 'Разом · зв’язок зник…' : 'Разом' + (room.players.length > 2 ? ' ' + room.players.length : '') + (s.rtt != null ? ' · ' + s.rtt + ' мс' : room.kind === 'nearby' ? ' · поруч' : ''))
    : room.kind === 'nearby' ? 'З’єднуюсь…'
    : room.status === 'unavailable' && !secure() ? 'Лише через https'
    : /unavailable|no-signal/.test(room.status) ? 'Немає інтернету' : 'Чекаю на друга…';
}

/* ---------- the dialog ---------- */
// (one for each status of the room: net/room.js STATUSES)
const STATUS = {
  connecting: 'Під’єднуюсь…',
  unavailable: 'Не вдалося завантажити. Перевір інтернет.',
  'no-signal': 'Немає зв’язку із сервером. Перевір інтернет, я пробую далі…',
  waiting: 'Чекаю, поки друг відкриє посилання…',
  joining: 'З’єднуюсь із другом…',
  full: 'У цій кімнаті вже немає місць.',
  'peer-left': 'Друг вийшов. Посилання діє далі — чекаю…',
  ready: 'Ви разом.',
  pairing: 'Поруч, без інтернету: з’єднайтеся кодами.',
  failed: 'Не вдалося з’єднатися.',
  version: UPDATE + '.'
};
const statusText = room => room.status === 'unavailable' && !secure() ? INSECURE : STATUS[room.status] || '';

export function openDialog() {
  if (dlg) return;
  if (secure()) preload();                               // the internet transport: likely needed soon
  dlg = modal(() => {
    if (dlg.camera) dlg.camera.stop();
    const room = currentRoom();
    if (room && room.kind === 'nearby') { if (!room.linked) leave(); else room.pair.cancel(); }   // a pairing that never finished goes with the dialog
    dlg = null;
  });
  if (linked()) return show('together');
  if (currentRoom() && currentRoom().kind === 'internet') return show('link');
  show('name');
}
// is there internet (see hasInternet)? with it: two ways; without it: straight to nearby (as on a page that cannot
// have internet rooms: menu)
function check() {
  const d = dlg;
  if (!secure()) return show('menu');
  d.screen = 'check';
  d.show(el('h2', { textContent: 'Грати разом' }), para('Перевіряю інтернет…', 'busy'), btn('Скасувати', closeDialog, 'btn ghost'));
  hasInternet().then(online => { if (dlg === d && d.screen === 'check') { d.online = online; show(online ? 'menu' : 'nearby'); } });
}
const closeDialog = () => { if (dlg) dlg.close(); };

// the room changed: only what shows its state is updated (not the whole screen: focus and selection stay);
// once linked, the dialog says so and goes
function refresh(what) {
  const room = currentRoom(), d = dlg;
  // together now (or one more, or back after pairing again): say so, and go
  if (what === 'linked' || (d.adding && (what === 'join' || (what === 'relinked' && !/^(together|link)$/.test(d.screen))))) {
    d.adding = false;
    show('together');
    setTimeout(() => { if (dlg === d && d.screen === 'together') closeDialog(); }, 900);
    return;
  }
  if (d.screen === 'together') { if (!linked()) closeDialog(); else if (what === 'join' || what === 'leave' || what === 'away') show('together'); else d.state.textContent = stateText(room); }
  else if (d.screen === 'link') { if (!room || room.kind !== 'internet') show('menu'); else if (what === 'status') d.state.textContent = statusText(room); }
  else if (room && room.kind === 'nearby' && room.status === 'failed' && what === 'status') failed(room.pair);
  else if (room && room.kind === 'nearby' && room.status === 'version' && what === 'status') otherVersion();
}
const stateText = room => { const s = room.stats(); return room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : ''; };
// one more player: the same link, or (nearby) a new pairing that only the room's host can make
function addPlayer() {
  const room = currentRoom();
  dlg.adding = true;
  if (room.kind === 'internet') show('link');
  else hostPairing();
}
// a room over the internet, under the same code as last time (the link sent earlier keeps working), if it is as long as a
// new room's: a shorter one (6 characters, from before the brokers' traffic was sealed: net/seal.js) is not used again
const viaLink = () => { const last = lastInternetCode(); startInternet(last && last.length >= CODE_LENGTH ? last : newRoomCode(), dlg.name); show('link'); };

function show(screen) {
  dlg.screen = screen;
  const room = currentRoom(), close = btn('Закрити', closeDialog, 'btn ghost');
  if (screen === 'name') {
    const input = nameInput(), go = e => { e.preventDefault(); const n = input.value.trim(); if (!validName(n)) return input.focus(); dlg.name = n; check(); };
    dlg.show(el('h2', { textContent: 'Грати разом' }),
      para('Як тебе звати? Під цим іменем тебе бачитимуть друзі; якщо відпадеш, зайди знову з тим самим іменем — і повернешся на своє місце.'),
      el('form', { className: 'row', onsubmit: go }, input, Object.assign(btn('Далі', null), { type: 'submit' })),
      close);
    queueMicrotask(() => input.select());
  } else if (screen === 'menu') {
    if (!secure()) { Object.assign(dlg, { online: false, insecure: true }); return show('nearby'); }   // no link here: why, and nearby
    dlg.show(el('h2', { textContent: 'Грати разом' }),
      para('Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.'),
      option('1', 'Через посилання', 'Друг може бути де завгодно: надішли посилання або покажи QR-код', viaLink),
      option('2', 'Поруч, без інтернету', 'Пристрої в одній мережі Wi-Fi або точці доступу', () => show('nearby')),
      close);
  } else if (screen === 'link') {
    if (!room || room.kind !== 'internet') return show('menu');
    const link = shell.address(), qr = el('canvas', { className: 'qr' });
    dlg.state = para(statusText(room), 'busy');
    drawQr(qr, link, 200);
    const share = navigator.share && btn('Поділитися', () => navigator.share({ title: 'Ігротека', text: 'Заходь, пограємо разом!', url: link }).catch(() => {}));
    dlg.show(el('h2', { textContent: 'Через посилання' }),
      para(room.linked ? 'Надішли це посилання ще комусь: щойно він його відкриє, приєднається до вас.' : 'Надішли другові це посилання. Щойно він відкриє його й увійде, ви будете разом. Посилання можна дати й кільком друзям.'),
      el('input', { className: 'link', readOnly: true, value: link, onfocus: e => e.target.select() }),
      el('div', { className: 'row' }, ...[share, btn('Скопіювати', e => copy(link, e.target))].filter(Boolean)),
      qr, para('Або хай друг наведе на цей код камеру свого телефона.', 'fine'),
      dlg.state,
      room.linked ? btn('Готово', closeDialog, 'btn ghost') : btn('Скасувати', () => { leave(); closeDialog(); }, 'btn ghost'));
  } else if (screen === 'nearby') {
    dlg.show(el('h2', { textContent: 'Поруч, без інтернету' }),
      ...(dlg.insecure ? [para(INSECURE + ' Поруч — можна.', 'fine')] : dlg.online ? [] : [para('Інтернету немає — з’єднаємося напряму.', 'fine')]),
      para('Обидва пристрої мають бути в одній мережі Wi-Fi (або один роздає точку доступу). Один показує код, другий його сканує, а потім навпаки.'),
      option('📱', 'Показати код', 'Я починаю', hostPairing),
      option('📷', 'Сканувати код', 'Друг уже показує код', guestPairing),
      dlg.online ? btn('Назад', () => show('menu'), 'btn ghost') : close);
  } else if (screen === 'together') {
    const n = room.players.length, space = n < room.max;
    dlg.state = para(stateText(room), 'fine');
    dlg.show(el('h2', { textContent: n > 2 ? 'Вас ' + n : 'Ви граєте разом' }),
      el('ul', { className: 'players' }, ...room.players.map(p => el('li', { textContent: p + (p === room.me ? ' (ти)' : room.away(p) ? ' — відпав, місце чекає' : '') }))),
      para(room.kind === 'nearby' ? 'Поруч, без інтернету.' : 'Через посилання.' + (room.stats().direct ? ' Пристрої з’єднані напряму.' : '')),
      dlg.state,
      ...(brokenNearby(room) ? [para('Зв’язок поруч перервався. Щоб продовжити, з’єднайтеся ще раз кодами.', 'fine'), btn('З’єднатися знову', repair)] : []),
      ...(!space ? [para('Кімната повна: ' + room.max + ' гравців.', 'fine')]
        : room.kind === 'internet' || room.role === 'host' ? [btn('Додати гравця', addPlayer, 'btn ghost')]
        : [para('Ще когось поруч додає той, хто показував код першим.', 'fine')]),
      btn('Від’єднатися', () => { leave(); closeDialog(); }),
      close);
  }
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
  full: 'У цій кімнаті вже немає місць.'
};

function failed(pair) {
  const why = pair.reason;
  dlg.screen = 'failed';
  if (dlg.camera) dlg.camera.stop();
  const report = pair.report(), room = currentRoom(), added = !!room && room.linked, joining = !room || room.role !== 'host';
  if (added) pair.cancel(); else leave();               // adding a player failed: those already here stay together
  dlg.show(el('h2', { textContent: 'Не вдалося з’єднатися' }),
    para(why === 'blocked' && pair.vpn ? WHY.vpn : WHY[why] || WHY.blocked),
    // (again as before: the room's host shows a code, a guest pairing again scans one; the name taken, whoever was
    // coming in tries again under another one, and the phone that showed the code keeps its own)
    btn('Спробувати ще', () => added ? (joining ? guestPairing() : hostPairing()) : why === 'name' && joining ? show('name') : show('nearby')),
    ...(dlg.online && !added ? [btn('Через посилання', viaLink, 'btn ghost')] : []),
    btn('Скопіювати звіт для розробника', e => copy(report, e.target), 'btn ghost'),
    btn('Закрити', closeDialog, 'btn ghost'));
}

// nearby, the friend's phone runs another version of the library: the pairing ended (see net/nearby.js)
function otherVersion() {
  dlg.screen = 'version';
  if (dlg.camera) dlg.camera.stop();
  const room = currentRoom();
  if (room && room.linked) room.pair.cancel(); else leave();
  dlg.show(el('h2', { textContent: 'Інша версія' }), para(UPDATE + '.'),
    para('Онови сторінку на тому пристрої, де Ігротека старіша (або на обох), і з’єднайтеся знову.', 'fine'),
    btn('Закрити', closeDialog, 'btn ghost'));
}

function option(icon, title, sub, onclick) {
  return el('button', { className: 'option', type: 'button', onclick },
    el('span', { className: 'option-icon', textContent: icon }),
    el('span', {}, el('b', { textContent: title }), el('span', { textContent: sub })));
}

/* ---------- nearby pairing ---------- */
// The camera is switched on first, still hidden (see Camera): while it runs, the link is more likely to work.
async function pairing() {
  const d = dlg;
  if (!d.camera || d.camera.stopped) d.camera = new Camera(el('video', { className: 'scan' }));
  await d.camera.start();
  return dlg === d ? { cam: d.camera, room: startNearby(d.name), live: () => dlg === d } : null;
}

// "1 · show the code": our offer, then scan the friend's answer
async function hostPairing() {
  busy('Поруч, без інтернету', 'Готую код…');
  const p = await pairing();
  if (!p) return;
  let code;
  try { code = await p.room.pair.offer(); } catch (e) { console.error(e); return p.live() && failed(p.room.pair); }
  if (!p.live() || currentRoom() !== p.room) return;
  showCode('Крок 1 з 2', (p.room.linked && !brokenNearby(p.room) ? 'Новий гравець' : 'Друг') + ' сканує цей код своїм пристроєм.', code, p.room.pair.local ? null : para(WHY.here, 'err'),
    btn('Далі: сканувати код друга', () => scanCode('Крок 2 з 2', 'Наведи камеру на код на екрані друга.', p.cam, async text => {
      await p.room.pair.finish(text);
      busy('Поруч, без інтернету', 'З’єднуюсь…');
    })));
}

// "2 · scan the code": the friend's offer, then show our answer
async function guestPairing() {
  busy('Поруч, без інтернету', 'Вмикаю камеру…');
  const p = await pairing();
  if (!p) return;
  scanCode('Крок 1 з 2', 'Наведи камеру на код на екрані друга.', p.cam, async text => {
    busy('Поруч, без інтернету', 'Готую відповідь…');
    const answer = await p.room.pair.answer(text);
    if (!p.live() || currentRoom() !== p.room) return;
    p.cam.stop();
    showCode('Крок 2 з 2', 'Тепер покажи цей код другові: хай він його сканує.', answer, p.room.pair.local ? null : para(WHY.here, 'err'), para('Чекаю на з’єднання…', 'busy'));
  });
}

function busy(title, text) { dlg.screen = 'busy'; dlg.show(el('h2', { textContent: title }), para(text, 'busy'), btn('Скасувати', closeDialog, 'btn ghost')); }

function showCode(step, text, code, ...more) {
  const qr = el('canvas', { className: 'qr' });
  drawQr(qr, code, 260);
  dlg.screen = 'code';
  dlg.show(el('h2', { textContent: step }), para(text), qr,
    ...more.filter(Boolean), btn('Скопіювати код', e => copy(code, e.target), 'btn ghost'), btn('Скасувати', closeDialog, 'btn ghost'));
}

// camera (or a pasted code) → accept(text); a wrong code comes back here, says so and keeps scanning
function scanCode(step, text, cam, accept, error = '') {
  dlg.screen = 'scan';
  const d = dlg, id = d.scan = (d.scan || 0) + 1, live = () => dlg === d && d.scan === id && d.screen === 'scan';
  const input = el('input', { className: 'link', placeholder: 'або встав код сюди', autocomplete: 'off', spellcheck: false });
  const tryCode = async t => {
    t = String(t || '').trim();
    if (!t || !live()) return;                           // once only (a double tap, or the camera and a paste at once)
    d.screen = 'checking';
    try { await accept(t); }
    catch (e) { if (dlg === d && d.scan === id) scanCode(step, text, cam, accept, 'Це не той код. Спробуй ще.'); }
  };
  const ok = btn('Готово', null);
  ok.type = 'submit';
  const form = el('form', { className: 'row', hidden: !!cam.stream, onsubmit: e => { e.preventDefault(); tryCode(input.value); } }, input, ok);
  const manual = btn('Ввести код вручну', () => { form.hidden = false; manual.remove(); input.focus(); }, 'btn ghost');
  d.show(el('h2', { textContent: step }), para(text),
    cam.stream ? cam.video : para('Камера недоступна: встав код, який друг скопіював зі свого екрана.', 'fine'),
    para(error, 'err'), form, ...(cam.stream ? [manual] : []),
    btn('Скасувати', closeDialog, 'btn ghost'));
  (async () => {
    while (cam.stream && live()) {
      const t = await cam.read(s => /^[A-Z2-7]{40,400}$/.test(s));
      if (t && live()) return tryCode(t);
    }
  })();
}
