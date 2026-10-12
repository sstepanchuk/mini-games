/* =====================================================================
   The screens of playing together (together.js holds the room): the chip on the shelf, notes at the
   bottom of the screen, the "Грати разом" dialog, the name a player comes in with, and the note over a game
   while it waits for a player who dropped out. The dialog asks for the name, then checks for internet by itself:
   with internet there are two ways (a link, or nearby with QR codes), without it only nearby. Once together,
   more players can be added the same way (up to the room's limit). A friend on another version of the library or of
   the game (together.js versionGap) is told everywhere it shows: «Онови сторінку — у друга інша версія».
   ===================================================================== */
import { hasInternet, newRoomCode, preload } from '../net/index.js';
import { $, btn, copy, el, modal, para, toast } from './dom.js';
import { Camera, drawQr } from './qr.js';
import { comeBack, currentRoom, elsewhere, lastInternetCode, lastName, leave, linked, offerUpdate, onChange, release, startInternet, startNearby, updateNow, validName, versionGap,
  waitingFor } from './together.js';

const UPDATE = 'Онови сторінку — у друга інша версія';   // (owner, decision 9)

let shell = null;                                        // { address() → this view's address, with the room }
let dlg = null;                                          // the open dialog: { screen, show, close, camera, scan, online, adding, name }

export function initInvite(s) {
  shell = s;
  s.askName = askName;
  $('together').addEventListener('click', () => openDialog());
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
    if (what === 'away' || what === 'leave' || what === 'left' || what === 'peer-gone' || what === 'version') waitNote();
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

/* ---------- over a game: who we wait for ---------- */
// A player who dropped out keeps their seat for a while: the game pauses, and this says who we wait for and how
// much longer, with a way to stop waiting (their seat goes; the game goes on without them, if it can). A friend on
// another version: that it takes a newer page (the older one reloads by itself when it can, or when its player asks).
function waitNote() {
  const list = waitingFor(), stage = $('stage'), gap = versionGap();
  let box = $('waiting');
  if ((!list.length && !gap) || stage.hidden) { if (box) box.remove(); return; }
  if (!box) { box = el('div', { id: 'waiting', className: 'waiting card', role: 'status' }); stage.append(box); }
  const mmss = ms => { const s = Math.ceil(ms / 1000); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
  // nearby, a broken link does not come back by itself: show the way back (pairing again)
  const near = currentRoom() && currentRoom().kind === 'nearby';
  box.replaceChildren(...list.flatMap(({ name, left }) => [
    para('Чекаємо на ' + name + '… ' + mmss(left)),
    ...(near ? [para('Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.', 'fine'), btn('З’єднатися знову', repair)] : []),
    btn('Не чекати', () => { release(name); box.remove(); }, 'btn ghost')]),
    ...(gap ? [para(UPDATE), ...(offerUpdate() ? [btn('Оновити', updateNow, 'btn ghost')] : [])] : []));
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
    : /unavailable|no-signal/.test(room.lastStatus) ? 'Немає інтернету' : 'Чекаю на друга…';
}

/* ---------- the dialog ---------- */
const STATUS = {
  connecting: 'Під’єднуюсь…',
  unavailable: 'Не вдалося завантажити. Перевір інтернет.',
  'no-signal': 'Немає зв’язку із сервером. Перевір інтернет, я пробую далі…',
  waiting: 'Чекаю, поки друг відкриє посилання…',
  joining: 'З’єднуюсь із другом…',
  full: 'У цій кімнаті вже немає місць.',
  'peer-left': 'Друг вийшов. Посилання діє далі — чекаю…',
  version: UPDATE + '.'
};

export function openDialog() {
  if (dlg) return;
  preload();                                             // the internet transport: likely needed soon
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
// is there internet (see hasInternet)? with it: two ways; without it: straight to nearby
function check() {
  const d = dlg;
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
  else if (d.screen === 'link') { if (!room || room.kind !== 'internet') show('menu'); else if (what === 'status') d.state.textContent = STATUS[room.lastStatus] || ''; }
  else if (room && room.kind === 'nearby' && room.lastStatus === 'failed' && what === 'status') failed(room.pair);
  else if (room && room.kind === 'nearby' && room.lastStatus === 'version' && what === 'status') otherVersion();
}
const stateText = room => { const s = room.stats(); return room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : ''; };
// one more player: the same link, or (nearby) a new pairing that only the room's host can make
function addPlayer() {
  const room = currentRoom();
  dlg.adding = true;
  if (room.kind === 'internet') show('link');
  else hostPairing();
}
// a room over the internet, under the same code as last time (the link sent earlier keeps working)
const viaLink = () => { startInternet(lastInternetCode() || newRoomCode(), dlg.name); show('link'); };

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
    dlg.show(el('h2', { textContent: 'Грати разом' }),
      para('Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.'),
      option('1', 'Через посилання', 'Друг може бути де завгодно: надішли посилання або покажи QR-код', viaLink),
      option('2', 'Поруч, без інтернету', 'Пристрої в одній мережі Wi-Fi або точці доступу', () => show('nearby')),
      close);
  } else if (screen === 'link') {
    if (!room || room.kind !== 'internet') return show('menu');
    const link = shell.address(), qr = el('canvas', { className: 'qr' });
    dlg.state = para(STATUS[room.lastStatus] || '', 'busy');
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
      ...(dlg.online ? [] : [para('Інтернету немає — з’єднаємося напряму.', 'fine')]),
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
  blocked: 'Пристрої в мережі, але вона не пускає їх одне до одного (так роблять деякі роутери, гостьові мережі та iPhone з iOS 18, що роздає точку доступу). Спробуйте іншу мережу Wi-Fi.'
};

function failed(pair) {
  dlg.screen = 'failed';
  if (dlg.camera) dlg.camera.stop();
  const report = pair.report(), room = currentRoom();
  if (room && room.linked) pair.cancel(); else leave();  // adding a player failed: those already here stay together
  dlg.show(el('h2', { textContent: 'Не вдалося з’єднатися' }),
    para(pair.reason === 'blocked' && pair.vpn ? WHY.vpn : WHY[pair.reason] || WHY.blocked),
    btn('Спробувати ще', () => room && room.linked ? hostPairing() : show('nearby')),
    ...(dlg.online && !(room && room.linked) ? [btn('Через посилання', viaLink, 'btn ghost')] : []),
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
