/* Гра на сторінці: екран, кнопки й гра разом через бібліотеку (window.ihroteka.room; README, «Game API»).
   Без бібліотеки (сторінку відкрито окремо) або поки з нами ніхто не грає — гра на одному пристрої: гравці ходять по
   черзі тут. Разом раунд веде одна копія гри (room.role === 'host', «ведучий»): лише вона застосовує ходи (правила —
   rules.js) і розсилає стан; інші шлють їй свої ходи й показують те, що вона прислала. На події кімнати:
     linked     граємо разом: ведучий шле стан (якщо раунд іде), інші просять його ('sync')
     resume     раунд тепер ведемо ми, з його останнього знімка: продовжуємо (приходить раніше за linked)
     role       раунд переїхав: 'guest' — просимо стан; 'host' без resume одразу за ним — раунду немає: лобі
     relinked   у гравця нова копія гри (вкладка, пристрій): ведучий шле йому стан
     peer-gone  раунд зупинився (хтось пішов або закрив гру): лобі; коли той повернеться, ведучий почує resume
     leave      (більше двох місць) гравця цього раунду більше немає (вийшов із кімнати, його місце скінчилося): ніхто
                не піде за нього, тож ведучий завершує раунд для всіх (з двома місцями це каже сама бібліотека: peer-gone)
     players    змінилося, хто грає і хто чекає на місце: перемалювати
   Повідомлення: інші шлють ведучому 'start', 'move', 'sync' (дай стан) і 'newer' (нижче); ведучий — 'state' з раундом
   (null — раунду немає: лобі). Інші показують лише 'state' від ведучого (room.host): стан від когось іншого — від
   колишнього ведучого, що надіслав його, поки раунд переїжджав, — не рахується.
   Знімок (room.snapshot) ведучий дає бібліотеці після кожного ходу: раунд гри, яку закрили посеред нього, іде далі з
   нього, навіть в іншій копії; null — раунд скінчився. Бібліотека розсилає знімки не частіше ніж двічі на секунду (а
   останній — одразу, коли гру закривають або сторінка йде), тож якщо сторінку ведучого вбито (без прощання), останній
   хід у знімок може не потрапити; але стан того ходу вже є в інших гравців: хто бачить, що ведучий продовжив старіший
   стан того самого раунду, відсилає йому свій ('newer').
   На кого чекаємо, каже картка бібліотеки над грою: гра своєї не малює. */
/* global document, window */
import { newRound, move, newer, valid, TARGET, STEPS } from './rules.js';

const lib = window.ihroteka, room = lib ? lib.room : null;
const $ = id => document.getElementById(id);
let round = null;        // раунд на екрані (rules.js) або null — лобі
let last = null;         // найновіший стан раунду, який ця копія бачила (і після того, як показала лобі)
let resumed = false;     // чи прийшов resume (після role → host і перед linked)

const together = () => !!room && room.linked;            // граємо з кимось: у нас місце, і ще хтось тут
const runs = () => !together() || room.role === 'host';  // раунд ведемо ми (на одному пристрої — завжди)
// гравці на одному пристрої: стільки, скільки гра хоче щонайменше, але не менше двох
const local = () => Array.from({ length: Math.max(2, lib ? lib.game.players.min : 2) }, (_, i) => 'Гравець ' + (i + 1));
// чи можна нам ходити: разом — лише на своєму місці й у свою чергу; на одному пристрої — завжди
const myTurn = () => !!round && round.winner < 0 && (!together() || round.seats[round.turn] === room.me);
const name = i => round.seats[i] + (together() && round.seats[i] === room.me ? ' (ти)' : '');

// показати раунд (null — лобі)
function show(r) {
  round = r;
  if (r) last = newer(last, r) || r;
  draw();
}
// ведучий: стан — усім, хто грає, знімок — бібліотеці
function publish() {
  draw();
  if (!together() || room.role !== 'host' || !round) return;
  room.send({ t: 'state', round });
  room.snapshot(round.winner >= 0 ? null : round);
}
function start() {
  if (!runs()) { room.send({ t: 'start' }); return; }
  show(newRound(together() ? room.players : local(), Date.now().toString(36) + Math.random().toString(36).slice(2, 6)));
  publish();
}
function play(n) {
  if (!myTurn()) return;
  if (!runs()) { room.send({ t: 'move', n, at: round.moves }); return; }   // at: на який стан цей хід (подвійний клік — один хід)
  const next = move(round, round.turn, n);
  if (next) { show(next); publish(); }
}

if (room) {
  room.on('message', (m, from) => {
    if (!runs()) {
      if (m.t !== 'state' || from !== room.host) return;    // лише від того, хто веде раунд
      if (m.round === null) { show(null); return; }
      if (!valid(m.round)) return;
      const best = newer(m.round, last) || m.round;
      if (best !== m.round && best.moves > m.round.moves) room.send({ t: 'newer', round: best }, { to: from });   // (ми бачили новіший)
      show(best);
      return;
    }
    if (m.t === 'start' && (!round || round.winner >= 0)) start();
    else if (m.t === 'move' && round && m.at === round.moves) {
      const next = move(round, round.seats.indexOf(from), m.n);   // хід рахується тому, хто його надіслав
      if (next) { show(next); publish(); }
    } else if (m.t === 'sync') room.send({ t: 'state', round }, { to: from });   // (null теж: раунду немає)
    else if (m.t === 'newer' && round && newer(round, m.round) === m.round) { show(m.round); publish(); }   // хтось бачив новіший стан
  });
  // (новіший стан того самого раунду, який ми бачили гостем, лишаємо)
  // (resumed: лише для linked чи role, що йдуть одразу за resume; потім — знову false)
  room.on('resume', snap => { if (valid(snap)) { show(newer(snap, last) || snap); resumed = true; queueMicrotask(() => { resumed = false; }); publish(); } });
  room.on('linked', () => {
    if (room.role === 'host') { if (!resumed) show(null); publish(); }   // (раунд на одному пристрої разом не продовжуємо)
    else { show(null); room.send({ t: 'sync' }); }
    resumed = false;
  });
  room.on('role', r => {
    if (r === 'guest') { room.send({ t: 'sync' }); return; }
    resumed = false;
    queueMicrotask(() => { if (!resumed) show(null); resumed = false; });
  });
  room.on('relinked', who => { if (runs()) room.send({ t: 'state', round }, { to: who }); });
  room.on('peer-gone', () => show(null));
  room.on('leave', who => {
    if (!round || round.winner >= 0 || !round.seats.includes(who) || !together() || !runs()) return;
    show(null);
    room.send({ t: 'state', round: null });
    room.snapshot(null);                                    // і назавжди: жодна копія його не поверне
  });
  room.on('players', draw);
}

function draw() {
  $('lobby').hidden = !!round;
  $('play').hidden = !round;
  if (!round) {
    const waits = !!room && !room.seated && room.waiting.includes(room.me);
    $('lobby-text').textContent = !room ? 'Гра на одному пристрої: ходіть по черзі.'
      : waits ? 'Ти чекаєш на місце. Грають: ' + room.players.join(', ') + '.'
      : together() ? 'Грають: ' + room.players.join(', ') + (room.waiting.length ? '. Чекають на місце: ' + room.waiting.join(', ') : '') + '.'
      : 'Поки що ти сам: грайте по черзі на цьому пристрої або запроси друзів.';
    $('start').hidden = waits;
    $('invite').hidden = !room || together();
    $('say').textContent = '';
    return;
  }
  $('total').textContent = round.total;
  $('seats').replaceChildren(...round.seats.map((s, i) => {
    const li = document.createElement('li');
    li.textContent = name(i);
    if (i === (round.winner >= 0 ? round.winner : round.turn)) li.className = round.winner >= 0 ? 'won' : 'turn';
    return li;
  }));
  const over = round.winner >= 0, mine = together() && round.seats[over ? round.winner : round.turn] === room.me;
  $('say').textContent = over ? (mine ? 'Ти виграв!' : 'Виграв: ' + round.seats[round.winner] + '!') : mine ? 'Твій хід' : 'Хід: ' + round.seats[round.turn];
  for (const b of $('steps').children) b.disabled = !myTurn() || round.total + +b.dataset.n > TARGET;
  $('again').hidden = !over;
}

$('target').textContent = TARGET;
$('steps').append(...STEPS.map(n => {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.n = n; b.textContent = '+' + n;
  b.addEventListener('click', () => play(n));
  return b;
}));
$('start').addEventListener('click', start);
$('again').addEventListener('click', start);
$('invite').addEventListener('click', () => lib.invite());
document.addEventListener('keydown', e => { if (STEPS.includes(+e.key) && !e.repeat) play(+e.key); });   // 1, 2 на клавіатурі
draw();
