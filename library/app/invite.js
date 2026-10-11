/* =====================================================================
   The screens of playing together (together.js holds the room): the chip on the shelf, notes at the
   bottom of the screen, and the "Грати разом" dialog — an internet link, or nearby pairing with QR codes.
   ===================================================================== */
import { newRoomCode } from '../net/index.js';
import { $, btn, copy, el, modal, para, root, toast } from './dom.js';
import { Camera, drawQr } from './qr.js';
import { current, lastInternetCode, leave, linked, onChange, startInternet, startNearby } from './together.js';

let shell = null;                                        // { current() → id | null }
let dlg = null;                                          // the open dialog: { screen, show, close, camera, scan }

export function initInvite(s) {
  shell = s;
  $('together').addEventListener('click', () => openDialog());
  onChange(what => {
    const room = current();
    if (what === 'linked') toast(room.kind === 'nearby' ? 'Ви разом, поруч без інтернету' : 'Ви разом!');
    if (what === 'peer-gone') toast(room && room.kind === 'nearby' ? 'Зв’язок із другом обірвався' : 'Друг вийшов');
    if (what === 'replaced') toast('Цю бібліотеку відкрито в іншій вкладці');
    chip();
    if (dlg) refresh();
  });
  chip();
}

/* ---------- the chip on the shelf ---------- */
function chip() {
  const room = current(), s = room && room.linked && room.stats(), b = $('together');
  b.classList.toggle('on', linked());
  b.textContent = !room ? 'Грати разом'
    : linked() ? (room.weak ? 'Разом · зв’язок зник…' : 'Разом' + (s.rtt != null ? ' · ' + s.rtt + ' мс' : room.kind === 'nearby' ? ' · поруч' : ''))
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
  full: 'У цій кімнаті вже грають двоє.',
  'peer-left': 'Друг вийшов. Посилання діє далі — чекаю…'
};

export function openDialog() {
  if (!dlg) {
    dlg = modal(() => {
      if (dlg.camera) dlg.camera.stop();
      const room = current();
      if (room && room.kind === 'nearby' && !room.linked) leave();   // a pairing that never finished goes with the dialog
      dlg = null;
    });
  }
  const room = current();
  show(linked() ? 'together' : room && room.kind === 'internet' ? 'link' : 'menu');
}
const closeDialog = () => { if (dlg) dlg.close(); };

// the room changed: the screens that show its state are drawn again; once linked, the dialog says so and goes
function refresh() {
  if (linked() && dlg.screen !== 'together') { show('together'); setTimeout(() => { if (dlg && dlg.screen === 'together') closeDialog(); }, 900); return; }
  if (dlg.screen === 'link' || dlg.screen === 'together') show(dlg.screen);
  else if (dlg.screen !== 'menu' && dlg.screen !== 'nearby' && current()?.lastStatus === 'failed') failed();
}

function show(screen) {
  dlg.screen = screen;
  const room = current(), close = btn('Закрити', closeDialog, 'btn ghost');
  if (screen === 'menu') {
    dlg.show(el('h2', { textContent: 'Грати разом' }),
      para('Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.'),
      option('🌐', 'Через інтернет', 'Надішли другові посилання', () => { startInternet(lastInternetCode() || newRoomCode()); show('link'); }),
      option('📶', 'Поруч, без інтернету', 'Телефони в одній мережі Wi-Fi або точці доступу', () => show('nearby')),
      close);
  } else if (screen === 'link') {
    if (!room || room.kind !== 'internet') return show('menu');
    const link = new URL((shell.current() ? shell.current() + '/' : '') + '?room=' + room.code, root).href, qr = el('canvas', { className: 'qr' });
    drawQr(qr, link, 200);
    const share = navigator.share && btn('Поділитися', () => navigator.share({ title: 'Ігротека', text: 'Заходь, пограємо разом!', url: link }).catch(() => {}));
    dlg.show(el('h2', { textContent: 'Через інтернет' }),
      para('Надішли другові це посилання. Щойно він відкриє його й увійде, ви будете разом.'),
      el('input', { className: 'link', readOnly: true, value: link, onfocus: e => e.target.select() }),
      el('div', { className: 'row' }, ...[share, btn('Скопіювати', e => copy(link, e.target))].filter(Boolean)),
      qr, para('Або хай друг наведе на цей код камеру свого телефона.', 'fine'),
      para(STATUS[room.lastStatus] || '', 'busy'),
      btn('Скасувати', () => { leave(); closeDialog(); }, 'btn ghost'));
  } else if (screen === 'nearby') {
    dlg.show(el('h2', { textContent: 'Поруч, без інтернету' }),
      para('Обидва телефони мають бути в одній мережі Wi-Fi (або один роздає точку доступу). Інтернет не потрібен.'),
      para('Один телефон показує код, другий його сканує, а потім навпаки.', 'fine'),
      option('1', 'Показати код', 'Я починаю', hostPairing),
      option('2', 'Сканувати код', 'Друг уже показує код', guestPairing),
      btn('Назад', () => show('menu'), 'btn ghost'));
  } else if (screen === 'together') {
    const s = room.stats();
    dlg.show(el('h2', { textContent: 'Ви граєте разом' }),
      para(room.kind === 'nearby' ? 'Поруч, без інтернету.' : 'Через інтернет.' + (s.direct ? ' Телефони з’єднані напряму.' : '')),
      para(room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : '', 'fine'),
      btn('Від’єднатися', () => { leave(); closeDialog(); }),
      close);
  }
}

function failed() {
  dlg.screen = 'failed';
  if (dlg.camera) dlg.camera.stop();
  dlg.show(el('h2', { textContent: 'Не вдалося з’єднатися' }),
    para('Перевір, що обидва телефони в одній мережі Wi-Fi або що один роздає точку доступу, а другий до неї під’єднаний.'),
    para('Якщо роздає iPhone, спробуй навпаки: нехай роздає інший телефон.', 'fine'),
    btn('Спробувати ще', () => show('nearby')), btn('Закрити', closeDialog, 'btn ghost'));
}

function option(icon, title, sub, onclick) {
  return el('button', { className: 'option', type: 'button', onclick },
    el('span', { className: 'option-icon', textContent: icon }),
    el('span', {}, el('b', { textContent: title }), el('span', { textContent: sub })));
}

/* ---------- nearby pairing ---------- */
// The camera is switched on first (see Camera): while it runs, the link between the phones is more likely to work.
async function pairing() {
  const d = dlg;
  if (!d.camera || d.camera.stopped) d.camera = new Camera(el('video', { className: 'scan' }));
  await d.camera.start();
  return dlg === d ? { cam: d.camera, room: startNearby(), live: () => dlg === d } : null;
}

// "1 · show the code": our offer, then scan the friend's answer
async function hostPairing() {
  busy('Готую код…');
  const p = await pairing();
  if (!p) return;
  let code;
  try { code = await p.room.pair.offer(); } catch (e) { console.error(e); return p.live() && failed(); }
  if (!p.live() || current() !== p.room) return;
  showCode('Крок 1 з 2', 'Друг сканує цей код своїм телефоном.', code,
    btn('Далі: сканувати код друга', () => scanCode('Крок 2 з 2', 'Наведи камеру на код на телефоні друга.', p.cam, async text => {
      await p.room.pair.finish(text);
      busy('З’єднуюсь…');
    })));
}

// "2 · scan the code": the friend's offer, then show our answer
async function guestPairing() {
  busy('Вмикаю камеру…');
  const p = await pairing();
  if (!p) return;
  scanCode('Крок 1 з 2', 'Наведи камеру на код на телефоні друга.', p.cam, async text => {
    busy('Готую відповідь…');
    const answer = await p.room.pair.answer(text);
    if (!p.live() || current() !== p.room) return;
    p.cam.stop();
    showCode('Крок 2 з 2', 'Тепер покажи цей код другові: хай він його сканує.', answer, para('Чекаю на з’єднання…', 'busy'));
  });
}

function busy(text) { dlg.screen = 'busy'; dlg.show(el('h2', { textContent: 'Поруч, без інтернету' }), para(text, 'busy')); }

function showCode(step, text, code, ...more) {
  const qr = el('canvas', { className: 'qr' });
  drawQr(qr, code, 260);
  dlg.screen = 'code';
  dlg.show(el('h2', { textContent: step }), para(text), qr,
    ...more, btn('Скопіювати код', e => copy(code, e.target), 'btn ghost'), btn('Скасувати', closeDialog, 'btn ghost'));
}

// camera (or a pasted code) → accept(text); a wrong code comes back here, says so and keeps scanning
function scanCode(step, text, cam, accept, error = '') {
  dlg.screen = 'scan';
  const d = dlg, id = d.scan = (d.scan || 0) + 1, live = () => dlg === d && d.scan === id && d.screen === 'scan';
  const input = el('input', { className: 'link', placeholder: 'або встав код сюди', autocomplete: 'off', spellcheck: false });
  const tryCode = async t => {
    t = String(t || '').trim();
    if (!t) return;
    d.screen = 'checking';
    try { await accept(t); }
    catch (e) { if (dlg === d) scanCode(step, text, cam, accept, 'Це не той код. Спробуй ще.'); }
  };
  const ok = btn('Готово', null);
  ok.type = 'submit';
  d.show(el('h2', { textContent: step }), para(text),
    cam.stream ? cam.video : para('Камера недоступна: встав код, який показує телефон друга.', 'fine'),
    para(error, 'err'), el('form', { className: 'row', onsubmit: e => { e.preventDefault(); tryCode(input.value); } }, input, ok),
    btn('Скасувати', closeDialog, 'btn ghost'));
  (async () => {
    while (cam.stream && live()) {
      const t = await cam.read(s => /^[A-Z2-7]{40,400}$/.test(s));
      if (t && live()) return tryCode(t);
    }
  })();
}
