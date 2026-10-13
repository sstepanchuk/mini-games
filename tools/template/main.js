/* Гра на сторінці: екран, кнопки й гра разом через бібліотеку (window.ihroteka.round і .room; README, «Game API» і
   «The round»).
   Без бібліотеки (сторінку відкрито окремо) або поки з нами ніхто не грає — гра на одному пристрої: гравці ходять по
   черзі тут. Разом раунд веде одна копія гри (round.runs, «ведучий»): лише вона застосовує ходи (правила — rules.js),
   зберігає знімок (round.save) і розсилає стан; інші шлють їй свої ходи й показують те, що вона прислала. Хто яким
   місцем грає, бібліотека заморожує на старті раунду (round.seats, round.seatOf). Події раунду (кожна — раз на його
   id):
     start    раунд почався (натиснув будь-хто: round.start просить ту копію, що його починає)
     run      раунд ведемо ми: state — його знімок (гру відкрили знову, сторінку перезавантажили, раунд перейшов до
              нас), null — новий
     watch    його веде інша копія: показуємо лише те, що пришле вона
     rejoin   (ведучому) у гравця нова копія гри (вкладка, пристрій): шлемо йому стан
     end      раунду кінець: 'over' — хтось виграв (ведучий кличе round.over з останнім станом); інакше раунд перервано
              ('gone' — його гравця вже немає в кімнаті, 'quit', 'lost', 'closed'): лобі
   Правило, яке обирає ця гра (сама бібліотека жодних не нав'язує): гравця раунду вже немає в кімнаті — раунду кінець
   (policy.endWhenSeatGone), бо його черга не настала б ніколи. Решта — як дає бібліотека: почати можна й тоді, коли
   когось немає (його черга почекає), а гра, яку закрили посеред раунду, чекає й іде далі з його знімка.
   Повідомлення (room.send, надійні; стан несе id свого раунду: стан іншого раунду не рахується): інші шлють ведучому
   'move' (крок і номер ходу, на який він зроблений: подвійний клік — один хід) і 'newer' (нижче); ведучий — 'state' з
   раундом. Інші показують лише 'state' від ведучого (round.runner): стан від когось іншого — від колишнього ведучого,
   що надіслав його, поки раунд переїжджав, — не рахується.
   Знімки бібліотека розсилає не частіше ніж двічі на секунду (останній — одразу, коли гру закривають або сторінка
   йде), тож якщо сторінку ведучого вбито (без прощання), останній хід у знімок може не потрапити; але стан того ходу
   вже є в інших гравців: хто бачить, що ведучий продовжив старіший стан того самого раунду, відсилає йому свій
   ('newer').
   На кого чекаємо (і що ти чекаєш на місце), каже екран бібліотеки <ihroteka-wait> під заголовком: гра своїх таких
   написів не малює (README, «Waiting screens»). Свій напис про паузу чи очікування, якщо додаси, ховай, поки бібліотека
   щось каже (крім версії): document.querySelector('ihroteka-wait[showing]:not([showing=version])'); коли сказане
   змінюється, екран шле подію 'showing'. */
/* global document, window */
import { newRound, move, newer, valid, TARGET, STEPS } from './rules.js';

const lib = window.ihroteka, round = lib ? lib.round : null, room = round ? lib.room : null;
const $ = id => document.getElementById(id);
let G = null;            // раунд на екрані (rules.js) або null — лобі
let last = null;         // найновіший стан раунду разом, який ця копія бачила (і після того, як показала лобі)
let note = '';           // чому раунд разом перервано (не правилами): у лобі
let locals = 0;          // раунди на одному пристрої: їхні id — 'local-1', 'local-2'… (id раунду разом такого не має)

// граємо разом: з кимось (у нас місце, і ще хтось тут), або наш раунд іде (хтось лише закрив гру чи відкриває її знову)
const together = () => !!room && (room.linked || round.mySeat >= 0);
const isLocal = r => r.id.startsWith('local-');         // раунд на одному пристрої
// раунд на екрані — той, що йде разом (а не на одному пристрої чи вже скінчений)
const ours = () => !!G && !!round && round.active && G.id === round.id;
const runs = () => !ours() || round.runs;               // раунд ведемо ми (на одному пристрої — завжди)
// гравці на одному пристрої: стільки, скільки гра хоче щонайменше, але не менше двох
const local = () => Array.from({ length: Math.max(2, lib ? lib.game.players.min : 2) }, (_, i) => 'Гравець ' + (i + 1));
// чи можна нам ходити: разом — лише на своєму місці й у свою чергу; на одному пристрої — завжди
const myTurn = () => !!G && G.winner < 0 && (ours() ? G.seats[G.turn] === room.me : !together());
const name = i => G.seats[i] + (ours() && G.seats[i] === room.me ? ' (ти)' : '');

// показати раунд (null — лобі)
function show(r) {
  G = r;
  if (r && round && r.id === round.id) last = newer(last, r) || r;
  draw();
}
// ведучий: стан — усім, хто грає (або одному: to), знімок — бібліотеці; переможець — кінець раунду
function publish(to) {
  draw();
  if (!ours() || !round.runs) return;
  room.send({ t: 'state', round: G }, to ? { to } : undefined);
  if (to) return;
  if (G.winner >= 0) round.over(G); else round.save(G);
}
function start() {
  note = '';
  if (together()) { round.start(); draw(); return; }      // (ведучий почне, а всі почують run чи watch)
  show(newRound(local(), 'local-' + ++locals));
}
function play(n) {
  if (!myTurn()) return;
  if (!runs()) { room.send({ t: 'move', id: G.id, n, at: G.moves }); return; }   // at: на який стан цей хід (подвійний клік — один хід)
  const next = move(G, G.turn, n);
  if (next) { show(next); publish(); }
}

if (round) {
  round.policy.endWhenSeatGone = true;                  // правило цієї гри (див. угорі)
  round.on('start', () => { note = ''; });
  round.on('run', ({ id, seats, state }) => {
    // знімок цього раунду, або новіший стан того самого раунду, який ми бачили (вели його раніше чи дивились); інакше — новий
    const seen = last && last.id === id ? last : null, snap = valid(state) && state.id === id ? state : null;
    show(snap ? newer(snap, seen) || snap : seen || newRound(seats, id));
    publish();
  });
  round.on('watch', ({ id }) => { if (!G || G.id !== id) show(last && last.id === id ? last : null); });   // (стан пришле ведучий)
  round.on('rejoin', who => publish(who));
  round.on('end', ({ id, by, reason, result }) => {
    if (reason === 'over') { if (valid(result) && result.id === id) show(newer(result, last) || result); return; }   // (переможець — на екрані)
    note = reason === 'gone' && by ? 'Раунд перервано: ' + by + ' уже не в кімнаті.' : 'Раунд перервано.';
    if (G && G.id === id) show(null); else draw();
  });
  room.on('message', (m, from) => {
    if (ours() && round.runs) {
      if (m.t === 'move' && m.id === G.id && m.at === G.moves) {
        const next = move(G, round.seatOf(from), m.n);   // хід рахується тому, хто його надіслав
        if (next) { show(next); publish(); }
      } else if (m.t === 'newer' && newer(G, m.round) === m.round && m.round.moves > G.moves) { show(m.round); publish(); }   // хтось бачив новіший стан
      return;
    }
    if (m.t !== 'state' || from !== round.runner || !valid(m.round) || m.round.id !== round.id) return;   // лише від того, хто веде цей раунд
    const best = newer(m.round, last) || m.round;
    if (best !== m.round && best.moves > m.round.moves) room.send({ t: 'newer', round: best }, { to: from });   // (ми бачили новіший)
    show(best);
  });
  // граємо разом: раунд на одному пристрої разом не продовжуємо
  room.on('linked', () => { if (G && isLocal(G)) show(null); else draw(); });
  room.on('players', draw);
}

function draw() {
  $('lobby').hidden = !!G;
  $('play').hidden = !G;
  if (!G) {
    const waits = !!room && !room.seated && room.waiting.includes(room.me);
    $('lobby-text').textContent = !room ? 'Гра на одному пристрої: ходіть по черзі.'
      : waits ? ''                                       // (що ти чекаєш на місце і хто грає зараз, каже екран бібліотеки)
      : together() ? 'Грають: ' + room.players.join(', ') + (room.waiting.length ? '. Чекають на місце: ' + room.waiting.join(', ') : '') + '.'
      : 'Поки що ти сам: грайте по черзі на цьому пристрої або запроси друзів.';
    $('start').hidden = waits || (!!round && round.active);   // (раунд уже йде: його стан ось-ось прийде)
    $('invite').hidden = !room || together();
    $('say').textContent = note;
    return;
  }
  $('total').textContent = G.total;
  $('seats').replaceChildren(...G.seats.map((s, i) => {
    const li = document.createElement('li');
    li.textContent = name(i);
    if (i === (G.winner >= 0 ? G.winner : G.turn)) li.className = G.winner >= 0 ? 'won' : 'turn';
    return li;
  }));
  const over = G.winner >= 0, mine = !isLocal(G) && G.seats[over ? G.winner : G.turn] === room.me;
  $('say').textContent = over ? (mine ? 'Ти виграв!' : 'Виграв: ' + G.seats[G.winner] + '!') : mine ? 'Твій хід' : 'Хід: ' + G.seats[G.turn];
  for (const b of $('steps').children) b.disabled = !myTurn() || G.total + +b.dataset.n > TARGET;
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
