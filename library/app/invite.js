/* =====================================================================
   The screens of playing together (together.js holds the room): the chip on the shelf, notes at the
   bottom of the screen, the "Грати разом" dialog, the name a player comes in with, and the library's card over a game,
   for a game that shows none of its waiting screens (`<ihroteka-wait>`, screens.js: whom we wait for and why, a seat,
   the version; games say only their own reasons, such as a hidden tab or a countdown). The dialog asks for the name,
   then checks for internet by itself:
   with internet there are two ways (a link, or nearby with QR codes), without it only nearby (and only nearby on a page
   without Web Crypto, served over plain http: net/config.js secure; it says why). Once together,
   more players can be added the same way (up to the room's limit). A friend on another version of the library or of
   the game (together.js versionGap) is told everywhere it shows: «Онови сторінку — у друга інша версія».
   ===================================================================== */
import { CODE_LENGTH, hasInternet, newRoomCode, preload, secure } from '../net/index.js';
import { $, btn, copy, el, errLine, modal, para, safe, toast } from './dom.js';
import { Camera, drawQr } from './qr.js';
import { adopted, carry, focused, initScreens, paint, ready, show as showScreens } from './screens.js';
import { comeBack, currentRoom, elsewhere, lastInternetCode, lastName, leave, linked, onChange, release, startInternet, startNearby, updateNow, validName, versionGap,
  waitFacts } from './together.js';
import { placeLines, sayOf, screen, UPDATE } from './waiting.js';

// a page without Web Crypto (plain http: `npm run dev -- --lan`) has no internet rooms (net/config.js secure)
const INSECURE = 'Через посилання можна грати лише на сторінці, відкритій через https: на цій адресі браузер вимикає шифрування.';

let shell = null;                                        // { address() → this view's address, with the room }
let dlg = null;                                          // the open dialog: { screen, show, close, box, camera, scan, online, insecure, adding, name, tg }

export function initInvite(s) {
  shell = s;
  s.askName = askName;
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
    if (what === 'linked') toast(room.kind === 'nearby' ? 'Ви разом, поруч без інтернету' : 'Ви разом!');
    else if (what === 'join' && room && room.linked && room.players.length > 2) toast('До вас приєднався ще один гравець (' + room.players.length + ')');
    else if (what === 'leave' && room && room.linked) toast('Один гравець вийшов');
    // (a moment later: when the room's host changes, everyone is back together in a second)
    if (what === 'peer-gone') setTimeout(() => { if (!linked()) toast(room && room.kind === 'nearby' ? 'Зв’язок обірвався' : 'Друзі вийшли'); }, 3000);
    if (what === 'replaced') queueMicrotask(goneElsewhere);
    if (what === 'version' && versionGap() && $('stage').hidden) toast(UPDATE);   // (over a game, its screen or the card says it)
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

/* ---------- over a game: the card «Чекаємо на …», for a game that shows none of its waiting screens ---------- */
// What the library says while the open game waits, and its buttons, are waiting.js's (screen: the words; from
// together.js waitFacts: whom we wait for and why, our copy restoring its round, a seat, the version); where it shows
// is screens.js's: in a copy of the game's <ihroteka-wait> that the player sees, else in this card over the game (every
// row; for a game that never placed one, the card as it was: link and loading of whom we play with, and the version;
// before the game's page has parsed, the version only: waiting.js placeLines). Never both.
// The card is built once and stays (hidden while there is nothing to say): each second only the time changes. What a
// screen reader hears is one live region (.sr, in #layer: heard with a dialog open too), wherever the rows show, which
// changes only when who or why does; a row stays while its player, reason and buttons do, so a focused «Не чекати»
// keeps its focus, and when the rows move between a copy of the game's and the card, the focus goes with them.
let card = null;                                         // { box }
let say = null, said = '';                               // the live region, and what it says
const ACTS = { repair: () => repair(), release: name => notWaiting(name), update: () => updateNow() };
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
  const model = screen(stage.hidden ? null : waitFacts());
  const was = focused();                                 // (a button of the rows with the focus: it follows its row)
  const held = showScreens(model, ACTS);                 // one of the game's screens holds the rows, or none does
  const rows = placeLines(model.rows, { ready: ready(), adopted: adopted(), held });
  const had = card.box.contains(document.activeElement);
  paint(card.box, rows, ACTS);
  card.box.hidden = !rows.length;                        // (before any focus: a button in a hidden card takes none)
  // (a row that went held the focus: the player is back, whoever was about to press «Не чекати» goes on with the game)
  if (!carry(was, card.box) && had && !card.box.contains(document.activeElement)) safe(() => stage.querySelector('iframe')?.focus());
  const now = sayOf(held ? model.rows : rows);
  if (now !== said) { said = now; say.textContent = now; }
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

// the room changed: only what shows its state is updated (not the whole screen: focus and selection stay; «Ви
// граєте разом» is painted in place on every change); once linked, the dialog says so and goes
function refresh(what) {
  const room = currentRoom(), d = dlg;
  // together now (or one more, or back after pairing again): say so, and go
  if (what === 'linked' || (d.adding && (what === 'join' || (what === 'relinked' && !/^(together|link)$/.test(d.screen))))) {
    d.adding = false;
    show('together');
    setTimeout(() => { if (dlg === d && d.screen === 'together') closeDialog(); }, 900);
    return;
  }
  if (d.screen === 'together') { if (!linked()) closeDialog(); else paintTogether(); }
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
  if (screen === 'together' && dlg.screen === 'together' && dlg.tg) return paintTogether();   // (built once: see paintTogether)
  dlg.screen = screen;
  dlg.tg = null;
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
    const T = dlg.tg = { h2: el('h2'), list: el('ul', { className: 'players' }), items: new Map(), how: para(''), state: para('', 'fine'),
      broken: para('Зв’язок поруч перервався. Щоб продовжити, з’єднайтеся ще раз кодами.', 'fine'), repair: btn('З’єднатися знову', repair),
      more: el('p'), kind: '' };
    dlg.show(T.h2, T.list, T.how, T.state, T.broken, T.repair, T.more, btn('Від’єднатися', () => { leave(); closeDialog(); }), close);
    paintTogether();
  }
}
// «Ви граєте разом», built once (show) and painted in place on every change of the room (who is here, who dropped out,
// the ping, a direct link, a broken link nearby, room for more): a focused button keeps its focus. A focused node that
// goes (hidden, or another kind of 'more') leaves the focus on the dialog itself.
const put = (node, text) => { if (node.textContent !== text) node.textContent = text; };
function paintTogether() {
  const room = currentRoom(), T = dlg && dlg.tg;
  if (!room || !T) return;
  const box = dlg.box, a = document.activeElement, had = box.contains(a) && a !== box;
  const n = room.players.length;
  put(T.h2, n > 2 ? 'Вас ' + n : 'Ви граєте разом');
  for (const [p, li] of T.items) if (!room.players.includes(p)) { li.remove(); T.items.delete(p); }
  let at = T.list.firstChild;
  for (const p of room.players) {
    let li = T.items.get(p);
    if (!li) T.items.set(p, li = el('li'));
    if (li === at) at = at.nextSibling; else T.list.insertBefore(li, at);
    put(li, p + (p === room.me ? ' (ти)' : room.away(p) ? ' — відпав, місце чекає' : ''));
  }
  put(T.how, room.kind === 'nearby' ? 'Поруч, без інтернету.' : 'Через посилання.' + (room.stats().direct ? ' Пристрої з’єднані напряму.' : ''));
  put(T.state, stateText(room));
  T.broken.hidden = T.repair.hidden = !brokenNearby(room);
  const kind = n >= room.max ? 'full' : room.kind === 'internet' || room.role === 'host' ? 'add' : 'host';
  if (kind !== T.kind) {
    const node = kind === 'full' ? para('', 'fine') : kind === 'add' ? btn('Додати гравця', addPlayer, 'btn ghost') : para('Ще когось поруч додає той, хто показував код першим.', 'fine');
    T.more.replaceWith(node);
    Object.assign(T, { more: node, kind });
  }
  if (kind === 'full') put(T.more, 'Кімната повна: ' + room.max + ' гравців.');
  if (had && (!a.isConnected || a.hidden || !box.contains(document.activeElement))) box.focus();
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
    errLine(error), form, ...(cam.stream ? [manual] : []),
    btn('Скасувати', closeDialog, 'btn ghost'));
  (async () => {
    while (cam.stream && live()) {
      const t = await cam.read(s => /^[A-Z2-7]{40,400}$/.test(s));
      if (t && live()) return tryCode(t);
    }
  })();
}
