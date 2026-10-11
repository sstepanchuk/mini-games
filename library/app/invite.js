/* =====================================================================
   The screens of playing together (together.js holds the room): the chip on the shelf, notes at the
   bottom of the screen, and the "Грати разом" dialog. It first checks for internet by itself: with internet
   there are two ways (a link, or nearby with QR codes), without it only nearby.
   ===================================================================== */
import { hasInternet, newRoomCode } from '../net/index.js';
import { $, btn, copy, el, modal, para, root, toast } from './dom.js';
import { Camera, drawQr } from './qr.js';
import { current, lastInternetCode, leave, linked, onChange, startInternet, startNearby } from './together.js';

let shell = null;                                        // { current() → id | null }
let dlg = null;                                          // the open dialog: { screen, show, close, camera, scan, online }

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
  if (dlg) return;
  dlg = modal(() => {
    if (dlg.camera) dlg.camera.stop();
    const room = current();
    if (room && room.kind === 'nearby' && !room.linked) leave();   // a pairing that never finished goes with the dialog
    dlg = null;
  });
  if (linked()) return show('together');
  if (current() && current().kind === 'internet') return show('link');
  // is there internet (see hasInternet)? with it: two ways; without it: straight to nearby
  const d = dlg;
  d.screen = 'check';
  d.show(el('h2', { textContent: 'Грати разом' }), para('Перевіряю інтернет…', 'busy'), btn('Скасувати', closeDialog, 'btn ghost'));
  hasInternet().then(online => { if (dlg === d && d.screen === 'check') { d.online = online; show(online ? 'menu' : 'nearby'); } });
}
const closeDialog = () => { if (dlg) dlg.close(); };

// the room changed: the screens that show its state are drawn again; once linked, the dialog says so and goes
function refresh() {
  if (linked() && dlg.screen !== 'together') { show('together'); setTimeout(() => { if (dlg && dlg.screen === 'together') closeDialog(); }, 900); return; }
  if (dlg.screen === 'link' || dlg.screen === 'together') show(dlg.screen);
  else if (current() && current().kind === 'nearby' && current().lastStatus === 'failed') failed(current().pair);
}

function show(screen) {
  dlg.screen = screen;
  const room = current(), close = btn('Закрити', closeDialog, 'btn ghost');
  if (screen === 'menu') {
    dlg.show(el('h2', { textContent: 'Грати разом' }),
      para('Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.'),
      option('1', 'Через посилання', 'Друг може бути де завгодно: надішли посилання або покажи QR-код', () => { startInternet(lastInternetCode() || newRoomCode()); show('link'); }),
      option('2', 'Поруч, без інтернету', 'Пристрої в одній мережі Wi-Fi або точці доступу', () => show('nearby')),
      close);
  } else if (screen === 'link') {
    if (!room || room.kind !== 'internet') return show('menu');
    const link = new URL((shell.current() ? shell.current() + '/' : '') + '?room=' + room.code, root).href, qr = el('canvas', { className: 'qr' });
    drawQr(qr, link, 200);
    const share = navigator.share && btn('Поділитися', () => navigator.share({ title: 'Ігротека', text: 'Заходь, пограємо разом!', url: link }).catch(() => {}));
    dlg.show(el('h2', { textContent: 'Через посилання' }),
      para('Надішли другові це посилання. Щойно він відкриє його й увійде, ви будете разом.'),
      el('input', { className: 'link', readOnly: true, value: link, onfocus: e => e.target.select() }),
      el('div', { className: 'row' }, ...[share, btn('Скопіювати', e => copy(link, e.target))].filter(Boolean)),
      qr, para('Або хай друг наведе на цей код камеру свого телефона.', 'fine'),
      para(STATUS[room.lastStatus] || '', 'busy'),
      btn('Скасувати', () => { leave(); closeDialog(); }, 'btn ghost'));
  } else if (screen === 'nearby') {
    dlg.show(el('h2', { textContent: 'Поруч, без інтернету' }),
      ...(dlg.online ? [] : [para('Інтернету немає — з’єднаємося напряму.', 'fine')]),
      para('Обидва пристрої мають бути в одній мережі Wi-Fi (або один роздає точку доступу). Один показує код, другий його сканує, а потім навпаки.'),
      option('📱', 'Показати код', 'Я починаю', hostPairing),
      option('📷', 'Сканувати код', 'Друг уже показує код', guestPairing),
      dlg.online ? btn('Назад', () => show('menu'), 'btn ghost') : close);
  } else if (screen === 'together') {
    const s = room.stats();
    dlg.show(el('h2', { textContent: 'Ви граєте разом' }),
      para(room.kind === 'nearby' ? 'Поруч, без інтернету.' : 'Через посилання.' + (s.direct ? ' Пристрої з’єднані напряму.' : '')),
      para(room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : '', 'fine'),
      btn('Від’єднатися', () => { leave(); closeDialog(); }),
      close);
  }
}

// why a direct link did not work (see net/nearby.js), and what to do
const WHY = {
  here: 'Цей пристрій не бачить мережі, через яку можна з’єднатися напряму. Так буває з телефоном, що сам роздає точку доступу: його браузер цієї мережі не бачить. Нехай точку роздає інший пристрій, або під’єднайтеся обидва до одного роутера.',
  there: 'Пристрій друга не бачить мережі, через яку можна з’єднатися напряму. Так буває з телефоном, що сам роздає точку доступу: його браузер цієї мережі не бачить. Нехай точку роздає інший пристрій, або під’єднайтеся обидва до одного роутера.',
  blocked: 'Пристрої в мережі, але вона не пускає їх одне до одного (так роблять деякі роутери, гостьові мережі та iPhone з iOS 18, що роздає точку доступу). Спробуйте іншу мережу Wi-Fi.'
};

function failed(pair) {
  dlg.screen = 'failed';
  if (dlg.camera) dlg.camera.stop();
  const report = pair.report();
  leave();
  dlg.show(el('h2', { textContent: 'Не вдалося з’єднатися' }),
    para(WHY[pair.reason] || WHY.blocked),
    btn('Спробувати ще', () => show('nearby')),
    ...(dlg.online ? [btn('Через посилання', () => { startInternet(lastInternetCode() || newRoomCode()); show('link'); }, 'btn ghost')] : []),
    btn('Скопіювати звіт для розробника', e => copy(report, e.target), 'btn ghost'),
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
  return dlg === d ? { cam: d.camera, room: startNearby(), live: () => dlg === d } : null;
}

// "1 · show the code": our offer, then scan the friend's answer
async function hostPairing() {
  busy('Поруч, без інтернету', 'Готую код…');
  const p = await pairing();
  if (!p) return;
  let code;
  try { code = await p.room.pair.offer(); } catch (e) { console.error(e); return p.live() && failed(p.room.pair); }
  if (!p.live() || current() !== p.room) return;
  showCode('Крок 1 з 2', 'Друг сканує цей код своїм пристроєм.', code, p.room.pair.local ? null : para(WHY.here, 'err'),
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
    if (!p.live() || current() !== p.room) return;
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
    if (!t) return;
    d.screen = 'checking';
    try { await accept(t); }
    catch (e) { if (dlg === d) scanCode(step, text, cam, accept, 'Це не той код. Спробуй ще.'); }
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
