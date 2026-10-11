/* =====================================================================
   Playing together. The library holds one room for two players (over the internet: a link; nearby:
   QR codes, no internet) for as long as they play, whatever game is open:
   - the view is shared: whatever one opens (a game, or the shelf) opens for the other too;
   - each game gets the room as ihroteka.room: it is linked while both players have that game open.
   Messages on the room (besides the games' own, wrapped in 'lib-g'):
     lib       { v: game id | null, s: seq }   "this is what we look at"; the higher seq wins, the host breaks ties
     lib-here  { v: game id | null }           "my copy of this game is open and listening"
   ===================================================================== */
import { joinNearby, joinRoom, newRoomCode, preload, validRoomCode } from '../net/index.js';
import { $, el, root, safe } from './dom.js';
import { Camera, drawQr } from './qr.js';

const LIB = 'ihroteka';                                  // the room namespace of the whole library
const LAST = 'ihroteka-room';                            // the last internet room: the same link keeps working

let shell = null;                                        // { current() → id | null, follow(id) }
let room = null;                                         // the room (see ../net)
let seq = 0;                                             // version of the shared view
let peerHere = null, myHere = null;                      // which game each side has open and listening
let ch = null;                                           // the open game's channel (ihroteka.room)

export function initTogether(s) {
  shell = s;
  setTimeout(preload, 1500);                             // the internet transport, before anyone needs it
  const code = (new URLSearchParams(location.search).get('room') || '').toLowerCase();
  if (validRoomCode(code)) startInternet(code);         // opened from a friend's link
  chip();
}

/* ---------- the room ---------- */
const linked = () => !!room && room.linked;
const inGame = () => linked() && !!ch && myHere === ch.id && peerHere === ch.id;
const send = m => { if (linked()) room.send(m); };

function startInternet(code) {
  leave();
  try { localStorage.setItem(LAST, code); } catch (e) {}
  setQuery(code);
  wire(joinRoom({ game: LIB, code }), 'internet');
}
function startNearby() {
  leave();
  return wire(joinNearby({ game: LIB }), 'nearby');
}
export const together = () => !!room;
// for checks from the console and tests
export const state = () => ({ kind: room && room.kind, role: room && room.role, linked: linked(), status: room && room.lastStatus, seq, myHere, peerHere, inGame: inGame() });
export function leave() {
  const r = room;
  room = null; peerHere = null;
  if (r) { r.leave(); setQuery(null); }
  update(); chip();
}

function wire(r, kind) {
  room = r; r.kind = kind; seq = 0; peerHere = null;
  const policy = name => () => inGame() && !!ch.policy(name);
  r.keepSeat = policy('keepSeat'); r.patient = policy('patient'); r.streaming = policy('streaming');
  r.pulse = now => { const g = inGame() && ch.pulseOut(now); return g ? { v: ch.id, g } : null; };
  const on = (name, fn) => r.on(name, (...a) => { if (room === r) safe(fn, ...a); });
  on('linked', () => {
    seq = 0; peerHere = null;
    if (r.role === 'host') sendView(shell.current(), true);   // whoever invited shows the way
    send({ t: 'lib-here', v: myHere });
    toast(r.kind === 'nearby' ? 'Ви разом, поруч без інтернету' : 'Ви разом!');
    update(); chip(); dialogUpdate();
  });
  on('relinked', () => {                                 // the friend reopened the library in a new tab
    seq = 0; peerHere = null;
    if (ch) ch.relinking = true;
    if (r.role === 'host') sendView(shell.current(), true);
    send({ t: 'lib-here', v: myHere });
    update();
  });
  on('peer-gone', () => {
    peerHere = null; update(); chip(); dialogUpdate();
    toast(r.kind === 'nearby' ? 'Зв’язок із другом обірвався' : 'Друг вийшов');
    if (r.kind === 'nearby') leave();                    // a nearby link cannot come back without pairing again
  });
  on('replaced', () => { toast('Цю бібліотеку відкрито в іншій вкладці'); leave(); });
  on('status', st => { r.lastStatus = st; chip(); dialogUpdate(); });
  on('weak', v => { if (ch && (inGame() || ch.weak)) { ch.weak = v; ch.emit('weak', v); } chip(); });
  on('stats', s => { if (ch) ch.emit('stats', s); chip(); });
  on('tick', now => { if (inGame()) ch.emit('tick', now); });
  on('pulse', p => { if (p && inGame() && p.v === ch.id && p.g && typeof p.g === 'object') ch.emit('pulse', p.g); });
  on('message', onLibMessage);
  chip();
  return r;
}

function onLibMessage(m) {
  const id = v => v === null || (typeof v === 'string' && /^[a-z0-9-]{1,40}$/.test(v));
  if (m.t === 'lib' && id(m.v) && Number.isInteger(m.s)) {
    if (m.s > seq || (m.s === seq && room.role === 'guest')) {   // newer, or a tie the host wins
      seq = m.s;
      if (m.v !== shell.current()) shell.follow(m.v);
    } else if (m.s === seq && room.role === 'host') sendView(shell.current(), false);
  } else if (m.t === 'lib-here' && id(m.v)) {
    peerHere = m.v; update();
  } else if (m.t === 'lib-g' && ch && m.v === ch.id && myHere === ch.id) {
    ch.receive(m.m);
  }
}

function sendView(v, bump) {
  if (bump) seq++;
  send({ t: 'lib', v, s: seq });
}
// the shell switched to another view: on its own (tell the friend) or following the friend
export function viewChanged(id, byPeer) {
  if (!byPeer) sendView(id, true);
}

/* ---------- the room each game sees: ihroteka.room ---------- */
// attach: the game's page is loaded and about to run its code
export function attachGame(id) {
  detachGame();
  ch = channel(id);
  myHere = id;
  send({ t: 'lib-here', v: id });
  queueMicrotask(update);
  return ch.api;
}
export function detachGame() {
  if (!ch) return;
  ch.dispose();
  ch = null; myHere = null;
  send({ t: 'lib-here', v: null });
}

function channel(id) {
  const handlers = new Map(), inbox = [];
  const c = {
    id, was: false, relinking: false,
    emit(name, ...a) { for (const fn of handlers.get(name) || []) safe(fn, ...a); },
    policy: name => typeof api[name] === 'function' && safe(api[name]),
    pulseOut: now => typeof api.pulse === 'function' ? safe(api.pulse, now) : null,
    receive(m) {
      if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
      if (handlers.has('message')) c.emit('message', m);
      else if (inbox.length < 64) inbox.push(m);       // the game has not started listening yet
    },
    dispose() { handlers.clear(); inbox.length = 0; c.disposed = true; }
  };
  const api = {
    get role() { return room ? room.role : null; },    // 'host' or 'guest' (the host usually runs the game)
    get linked() { return inGame(); },                 // both players have this game open
    get weak() { return inGame() && room.weak; },      // the other player went quiet: pause and wait
    get leaving() { return inGame() && room.leaving; },
    get direct() { return !!room && room.direct; },
    get nearby() { return !!room && room.nearby; },
    // the game's policies (see ../net/room.js): keepSeat, patient, streaming, pulse
    keepSeat: null, patient: null, streaming: null, pulse: null,
    on(name, fn) {
      if (c.disposed) return api;
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(fn);
      // late listeners still learn the current state (a game often starts after the link is up)
      if (name === 'linked' && inGame()) queueMicrotask(() => { if (!c.disposed && inGame()) safe(fn); });
      if (name === 'message' && inbox.length) queueMicrotask(() => { for (const m of inbox.splice(0)) c.emit('message', m); });
      return api;
    },
    send(msg, opts) { if (inGame() && msg && typeof msg.t === 'string') room.send({ t: 'lib-g', v: id, m: msg }, opts); },
    lag: () => room ? room.lag() : 0,
    stats: () => room ? room.stats() : { rtt: null, peerRtt: null, direct: false, relayed: false, turn: null },
    diag: () => room ? room.diag() : 'no room',
    frame: now => { if (room) room.frame(now); },
    kick: () => { if (room) room.kick(); },
    invite: () => openDialog()
  };
  c.api = api;
  return c;
}

// tell the open game when the other player arrives in it or leaves it
function update() {
  if (!ch) return;
  const now = inGame();
  if (now === ch.was) return;
  ch.was = now;
  if (now) {
    const re = ch.relinking; ch.relinking = false;
    ch.emit(re ? 'relinked' : 'linked');
    if (ch.weak && !room.weak) { ch.weak = false; ch.emit('weak', false); }   // the silence ended while the game was not linked
  }
  else if (!ch.relinking) ch.emit('peer-gone');
}

/* ---------- the address bar: an internet room stays in the link (?room=), so a reload rejoins ---------- */
export const query = () => room && room.kind === 'internet' ? '?room=' + room.code : '';
function setQuery(code) {
  try { history.replaceState(history.state, '', location.pathname + (code ? '?room=' + code : '')); } catch (e) {}
}
const inviteLink = () => new URL((shell.current() ? shell.current() + '/' : '') + '?room=' + room.code, root).href;

/* ---------- the chip on the shelf ---------- */
function chip() {
  const b = $('together');
  if (!b) return;
  const s = room && room.stats();
  b.classList.toggle('on', linked());
  b.textContent = !room ? 'Грати разом'
    : linked() ? (room.weak ? 'Разом · зв’язок зник…' : 'Разом' + (s && s.rtt != null ? ' · ' + s.rtt + ' мс' : room.kind === 'nearby' ? ' · поруч' : ''))
    : room.kind === 'nearby' ? 'З’єднуюсь…'
    : /unavailable|no-signal/.test(room.lastStatus) ? 'Немає інтернету' : 'Чекаю на друга…';
}
export const chipClick = () => openDialog();

/* ---------- toasts ---------- */
export function toast(text) {
  const t = el('div', { className: 'toast', textContent: text, role: 'status' });
  $('layer').append(t);
  setTimeout(() => t.classList.add('out'), 2600);
  setTimeout(() => t.remove(), 3000);
}

/* ---------- the "play together" dialog ---------- */
const STATUS = {
  connecting: 'Під’єднуюсь…',
  unavailable: 'Не вдалося завантажити. Перевір інтернет.',
  'no-signal': 'Немає зв’язку із сервером. Перевір інтернет, я пробую далі…',
  waiting: 'Чекаю, поки друг відкриє посилання…',
  joining: 'З’єднуюсь із другом…',
  full: 'У цій кімнаті вже грають двоє.',
  'peer-left': 'Друг вийшов. Посилання діє далі — чекаю…'
};
let dlg = null;                                          // { screen, box, camera, … } while the dialog is open

export function openDialog(screen) {
  if (!dlg) {
    const box = el('div', { className: 'dialog card', role: 'dialog' });
    box.setAttribute('aria-modal', 'true');
    const back = el('div', { className: 'backdrop' }, box);
    back.addEventListener('click', e => { if (e.target === back) closeDialog(); });
    $('layer').append(back);
    dlg = { box, back, camera: null };
    addEventListener('keydown', onKey);
  }
  show(screen || (linked() ? 'together' : room && room.kind === 'internet' ? 'link' : 'menu'));
}
const onKey = e => { if (e.key === 'Escape') closeDialog(); };
export function closeDialog() {
  if (!dlg) return;
  if (dlg.camera) dlg.camera.stop();
  dlg.back.remove();
  removeEventListener('keydown', onKey);
  // a nearby pairing that never finished is dropped with the dialog
  if (room && room.kind === 'nearby' && !linked()) leave();
  dlg = null;
}
function dialogUpdate() {
  if (!dlg) return;
  if (linked() && dlg.screen !== 'together') { show('together'); setTimeout(() => { if (dlg && dlg.screen === 'together') closeDialog(); }, 900); return; }
  if (dlg.screen === 'link' || dlg.screen === 'together') show(dlg.screen);
}

const btn = (text, fn, cls = 'btn') => el('button', { className: cls, type: 'button', textContent: text, onclick: fn });
const p = (text, cls = '') => el('p', { className: cls, textContent: text });

function show(screen) {
  dlg.screen = screen;
  const b = dlg.box, put = (...nodes) => b.replaceChildren(...nodes);
  const close = btn('Закрити', closeDialog, 'btn ghost');
  if (screen === 'menu') {
    put(el('h2', { textContent: 'Грати разом' }),
      p('Ви будете разом у всій бібліотеці: що відкриє один, те відкриється й у другого.'),
      option('🌐', 'Через інтернет', 'Надішли другові посилання', () => { const last = safe(() => localStorage.getItem(LAST)); startInternet(validRoomCode(last) ? last : newRoomCode()); show('link'); }),
      option('📶', 'Поруч, без інтернету', 'Телефони в одній мережі Wi-Fi або точці доступу', () => show('nearby')),
      close);
  } else if (screen === 'link') {
    if (!room || room.kind !== 'internet') return show('menu');
    const link = inviteLink(), qr = el('canvas', { className: 'qr' });
    drawQr(qr, link, 200);
    const share = navigator.share ? btn('Поділитися', () => navigator.share({ title: 'Ігротека', text: 'Заходь, пограємо разом!', url: link }).catch(() => {})) : null;
    put(el('h2', { textContent: 'Через інтернет' }),
      p('Надішли другові це посилання. Щойно він відкриє його й увійде, ви будете разом.'),
      el('input', { className: 'link', readOnly: true, value: link, onfocus: e => e.target.select() }),
      el('div', { className: 'row' }, ...[share, btn('Скопіювати', e => copy(link, e.target))].filter(Boolean)),
      qr, p('Або хай друг наведе на цей код камеру свого телефона.', 'fine'),
      p(STATUS[statusOf()] || '', 'busy'),
      btn('Скасувати', () => { leave(); closeDialog(); }, 'btn ghost'));
  } else if (screen === 'nearby') {
    put(el('h2', { textContent: 'Поруч, без інтернету' }),
      p('Обидва телефони мають бути в одній мережі Wi-Fi (або один роздає точку доступу). Інтернет не потрібен.'),
      p('Один телефон показує код, другий його сканує, а потім навпаки.', 'fine'),
      option('1', 'Показати код', 'Я починаю', hostPairing),
      option('2', 'Сканувати код', 'Друг уже показує код', guestPairing),
      btn('Назад', () => show('menu'), 'btn ghost'));
  } else if (screen === 'together') {
    const s = room.stats();
    put(el('h2', { textContent: 'Ви граєте разом' }),
      p(room.kind === 'nearby' ? 'Поруч, без інтернету.' : 'Через інтернет.' + (s.direct ? ' Телефони з’єднані напряму.' : '')),
      p(room.weak ? 'Зв’язок зник, відновлюю…' : s.rtt != null ? 'Пінг: ' + s.rtt + ' мс' : '', 'fine'),
      btn('Від’єднатися', () => { leave(); closeDialog(); }),
      close);
  } else if (screen === 'failed') {
    put(el('h2', { textContent: 'Не вдалося з’єднатися' }),
      p('Перевір, що обидва телефони в одній мережі Wi-Fi або що один роздає точку доступу, а другий до неї під’єднаний.'),
      p('Якщо роздає iPhone, спробуй навпаки: нехай роздає інший телефон.', 'fine'),
      btn('Спробувати ще', () => show('nearby')), close);
  }
}

function option(icon, title, sub, fn) {
  return el('button', { className: 'option', type: 'button', onclick: fn },
    el('span', { className: 'option-icon', textContent: icon }),
    el('span', {}, el('b', { textContent: title }), el('span', { textContent: sub })));
}
const statusOf = () => !room ? '' : room.lastStatus || '';

/* ---------- nearby pairing ---------- */
function pairingRoom() {
  const r = startNearby();
  r.on('status', s => { if (s === 'failed' && dlg && room === r) { if (dlg.camera) dlg.camera.stop(); show('failed'); } });
  return r;
}
async function camera() {
  if (!dlg.camera) dlg.camera = new Camera(el('video', { className: 'scan' }));
  await dlg.camera.start();
  return dlg.camera;
}

// "1 · show the code": our offer, then scan the friend's answer
async function hostPairing() {
  busy('Готую код…');
  const cam = await camera();                            // switched on first: see Camera
  const r = pairingRoom();
  let code;
  try { code = await r.pair.offer(); } catch (e) { console.error(e); return show('failed'); }
  if (room !== r || !dlg) return;
  showCode('Крок 1 з 2', 'Друг сканує цей код своїм телефоном.', code,
    btn('Далі: сканувати код друга', () => scanCode('Крок 2 з 2', 'Наведи камеру на код на телефоні друга.', cam, async text => {
      await r.pair.finish(text);
      busy('З’єднуюсь…');
    })));
}

// "2 · scan the code": the friend's offer, then show our answer
async function guestPairing() {
  const cam = await camera();
  const r = pairingRoom();
  scanCode('Крок 1 з 2', 'Наведи камеру на код на телефоні друга.', cam, async text => {
    busy('Готую відповідь…');
    const answer = await r.pair.answer(text);
    if (room !== r || !dlg) return;
    cam.stop();
    showCode('Крок 2 з 2', 'Тепер покажи цей код другові: хай він його сканує.', answer, p('Чекаю на з’єднання…', 'busy'));
  });
}

function busy(text) { dlg.box.replaceChildren(el('h2', { textContent: 'Поруч, без інтернету' }), p(text, 'busy')); }

function showCode(step, text, code, ...more) {
  const qr = el('canvas', { className: 'qr' });
  drawQr(qr, code, 260);
  dlg.screen = 'code';
  dlg.box.replaceChildren(el('h2', { textContent: step }), p(text), qr,
    ...more, btn('Скопіювати код', e => copy(code, e.target), 'btn ghost'), btn('Скасувати', closeDialog, 'btn ghost'));
}

// camera (or a pasted code) → accept(text); a wrong code comes back here, says so and keeps scanning
function scanCode(step, text, cam, accept, error = '') {
  dlg.screen = 'scan';
  const id = dlg.scan = (dlg.scan || 0) + 1, live = () => dlg && dlg.scan === id && dlg.screen === 'scan';
  const input = el('input', { className: 'link', placeholder: 'або встав код сюди', autocomplete: 'off', spellcheck: false });
  const tryCode = async t => {
    t = String(t || '').trim();
    if (!t) return;
    dlg.screen = 'checking';
    try { await accept(t); }
    catch (e) { if (dlg) scanCode(step, text, cam, accept, 'Це не той код. Спробуй ще.'); }
  };
  const ok = btn('Готово', null);
  ok.type = 'submit';
  dlg.box.replaceChildren(el('h2', { textContent: step }), p(text),
    cam.stream ? cam.video : p('Камера недоступна: встав код, який показує телефон друга.', 'fine'),
    p(error, 'err'), el('form', { className: 'row', onsubmit: e => { e.preventDefault(); tryCode(input.value); } }, input, ok),
    btn('Скасувати', closeDialog, 'btn ghost'));
  (async () => {
    while (cam.stream && live()) {
      const t = await cam.read(s => /^[A-Z2-7]{40,400}$/.test(s));
      if (t && live()) return tryCode(t);
    }
  })();
}

async function copy(text, button) {
  try { await navigator.clipboard.writeText(text); button.textContent = 'Скопійовано ✓'; }
  catch (e) { prompt('Скопіюй:', text); }
}
