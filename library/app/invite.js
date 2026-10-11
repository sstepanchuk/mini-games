/* =====================================================================
   The screens of playing together (together.js holds the room, pairing.js pairs two devices): the chip on
   the shelf, notes at the bottom of the screen, and the "Грати разом" dialog — one screen for everything:
   our code, the camera reading the friend's, and what is going on. Online or not, nearby or far: automatic.
   ===================================================================== */
import { $, btn, copy, el, modal, para, root, toast } from './dom.js';
import { codeInAddress, startPairing } from './pairing.js';
import { Camera, drawQr } from './qr.js';
import { current, leave, linked, onChange } from './together.js';

let shell = null;                                        // { current() → id | null }
let dlg = null;                                          // the open pairing dialog

export function initInvite(s) {
  shell = s;
  $('together').addEventListener('click', () => openDialog());
  onChange(what => {
    const room = current();
    if (what === 'linked') toast(room.kind === 'nearby' ? 'Ви разом, поруч' : 'Ви разом!');
    if (what === 'peer-gone') toast(room && room.kind === 'nearby' ? 'Зв’язок із другом обірвався' : 'Друг вийшов');
    if (what === 'replaced') toast('Цю бібліотеку відкрито в іншій вкладці');
    chip();
    if (dlg && linked()) dlg.close();                  // paired: the note at the bottom says so
  });
  chip();
  const code = codeInAddress();                          // the phone's own camera read a friend's code and opened us
  if (code) { history.replaceState(history.state, '', location.pathname + location.search); openDialog(code); }
}

/* ---------- the chip on the shelf ---------- */
function chip() {
  const room = current(), s = room && room.linked && room.stats(), b = $('together');
  b.classList.toggle('on', linked());
  b.textContent = !room ? 'Грати разом'
    : linked() ? (room.weak ? 'Разом · зв’язок зник…' : 'Разом' + (s.rtt != null ? ' · ' + s.rtt + ' мс' : room.kind === 'nearby' ? ' · поруч' : ''))
    : 'Чекаю на друга…';
}

/* ---------- the dialog ---------- */
// why a direct link did not work (see net/nearby.js), and what to do
const WHY = {
  here: 'Цей пристрій не бачить мережі, через яку можна з’єднатися напряму. Так буває з телефоном, що сам роздає точку доступу: браузер цієї мережі не бачить. Нехай точку роздає інший пристрій, або під’єднайтеся обидва до одного роутера.',
  there: 'Пристрій друга не бачить мережі, через яку можна з’єднатися напряму. Так буває з телефоном, що сам роздає точку доступу: браузер цієї мережі не бачить. Нехай точку роздає інший пристрій, або під’єднайтеся обидва до одного роутера.',
  blocked: 'Пристрої в мережі, але вона не пускає їх одне до одного (так роблять деякі роутери, гостьові мережі й iPhone з iOS 18, що роздає точку доступу). Спробуйте іншу мережу Wi-Fi.'
};

// code: a friend's code that is already known (read by the phone's own camera)
export function openDialog(code) {
  if (dlg) return;
  if (linked()) return together();
  const m = modal(() => { dlg.camera.stop(); dlg.pairing.stop(); dlg = null; });
  const d = dlg = { ...m, camera: newCamera() };
  const qr = el('canvas', { className: 'qr' }), step = para('', 'fine'), status = para('Готую код…', 'busy');
  const problem = el('div', { className: 'problem' }), view = el('div', { className: 'scanbox' });
  const input = el('input', { className: 'link', placeholder: 'або встав код друга', autocomplete: 'off', spellcheck: false });
  const ok = btn('Готово', null);
  ok.type = 'submit';
  const paste = el('form', { className: 'row', onsubmit: e => { e.preventDefault(); if (!d.pairing.read(input.value.trim())) status.textContent = 'Це не той код.'; input.value = ''; } }, input, ok);
  let link = '';
  m.show(el('h2', { textContent: 'Грати разом' }),
    para('Тримайте пристрої екранами один до одного: кожен прочитає код іншого, і ви з’єднаєтесь. Інтернет не обов’язковий.'),
    qr, step, view, status, problem,
    el('div', { className: 'row' }, btn('Скопіювати посилання', e => copy(link.split('#')[0], e.target), 'btn ghost'), btn('Інша камера', () => flip(d, view), 'btn ghost')),
    paste, btn('Скасувати', () => { leave(); m.close(); }, 'btn ghost'));

  d.pairing = startPairing({
    ready: cameraFirst(d),
    show(text, kind) {
      if (kind === 'offer') link = text;
      drawQr(qr, text, 250);
      step.textContent = kind === 'offer' ? 'Твій код. Друг відкриває «Грати разом» — або просто наводить на нього камеру телефона.' : 'Тепер друг читає цей код: тримай екран до його камери.';
      status.textContent = kind === 'offer' ? 'Шукаю код друга…' : 'Чекаю, поки друг прочитає цей код…';
    },
    note(event, info) {
      if (dlg !== d) return;
      if (event === 'connecting') status.textContent = 'З’єднуюсь…';
      if (event === 'no-network') problem.replaceChildren(para(WHY.here, 'err'));
      if (event === 'failed') {
        status.textContent = 'Напряму не вийшло. Якщо є інтернет, з’єднаюсь через нього сам.';
        problem.replaceChildren(para(WHY[info.reason] || WHY.blocked, 'err'), btn('Скопіювати звіт для розробника', e => copy(info.report, e.target), 'btn ghost'));
      }
    }
  });
  scan(d, view, 'user');
  if (code) d.pairing.read(code);
}
// the camera first (for up to 2.5 s): while it runs, the browser offers this device's real local addresses
const cameraFirst = d => Promise.race([d.camera.start('user'), new Promise(r => setTimeout(r, 2500))]);

const newCamera = () => new Camera(el('video', { className: 'scan', muted: true, playsInline: true }));

// the camera stays on and reads the whole time (the front one first: the devices face each other)
async function scan(d, view, facing) {
  const cam = d.camera;
  if (!(await cam.start(facing))) {
    if (dlg === d && d.camera === cam) view.replaceChildren(para('Камера недоступна: хай друг прочитає твій код, або встав його код нижче.', 'fine'));
    return;
  }
  view.replaceChildren(cam.video);
  while (dlg === d && d.camera === cam && cam.stream) if (!(await cam.read(t => d.pairing.read(t)))) break;
}
function flip(d, view) {
  const facing = d.camera.facing === 'user' ? 'environment' : 'user';
  d.camera.stop();
  d.camera = newCamera();
  scan(d, view, facing);
}

// already together: how, and a way out
function together() {
  const room = current(), s = room.stats(), m = modal();
  m.show(el('h2', { textContent: 'Ви граєте разом' }),
    para(room.kind === 'nearby' ? 'Поруч, напряму між пристроями.' : 'Через інтернет' + (s.direct ? ', напряму між пристроями.' : '.')),
    para(room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : '', 'fine'),
    ...(room.kind === 'internet' ? [btn('Скопіювати посилання', e => copy(new URL((shell.current() ? shell.current() + '/' : '') + '?room=' + room.code, root).href, e.target), 'btn ghost')] : []),
    btn('Від’єднатися', () => { leave(); m.close(); }),
    btn('Закрити', () => m.close(), 'btn ghost'));
}
