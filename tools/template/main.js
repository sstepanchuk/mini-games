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
     end      раунду кінець: 'over' — є переможець (ведучий кличе round.over з останнім станом); інакше раунд перервано
              ('quit' — хтось із гравців вийшов, by — хто; 'gone' — його гравця вже немає в кімнаті; 'lost', 'closed'):
              лобі каже чому
   Правила, які обирає ця гра (сама бібліотека жодних не нав'язує): гравця раунду вже немає в кімнаті — раунду кінець
   (policy.endWhenSeatGone), бо його черга не настала б ніколи; будь-хто з гравців раунду може його скінчити для всіх
   («Вийти з раунду», round.quit). Решта — як дає бібліотека: почати можна й тоді, коли когось немає (його черга
   почекає), а гра, яку закрили посеред раунду, чекає й іде далі з його знімка.
   Повідомлення (room.send, надійні; стан несе id свого раунду: стан іншого раунду не рахується): інші шлють ведучому
   'move' (крок і номер ходу, на який він зроблений: подвійний клік — один хід) і 'newer' (нижче); ведучий — 'state' з
   раундом. Інші показують лише 'state' від ведучого (round.runner): стан від когось іншого — від колишнього ведучого,
   що надіслав його, поки раунд переїжджав, — не рахується.
   Знімки бібліотека розсилає не частіше ніж двічі на секунду (останній — одразу, коли гру закривають або сторінка
   йде), тож якщо сторінку ведучого вбито (без прощання), останній хід у знімок може не потрапити; але стан того ходу
   вже є в інших гравців: хто бачить, що ведучий продовжив старіший стан того самого раунду, відсилає йому свій
   ('newer').
   Кнопки. «← Усі ігри» (ihroteka.home()): бібліотека над грою своєї кнопки «назад» не малює, а встановлена програма на
   iPhone не має «Назад»; сам — виходиш і з раунду на цьому пристрої, разом — уся кімната йде на полицю, а раунд чекає й
   іде далі, коли гру відкриють знову. «Вийти з раунду» — з підтвердженням другим натисканням (кінець для всіх); на
   одному пристрої — «Почати заново». «Почати» недоступна, поки копії, що починає раунди (round.runner), немає (відпала
   чи ще відкриває гру): бібліотека такий старт відкинула б.
   На кого чекаємо (і що ти чекаєш на місце), каже екран бібліотеки <ihroteka-wait> у кінці сторінки, під кнопками: гра
   своїх таких написів не малює (README, «Waiting screens»). Свій напис про паузу чи очікування, якщо додаси, ховай,
   поки бібліотека щось каже (крім версії): document.querySelector('ihroteka-wait[showing]:not([showing=version])');
   коли сказане змінюється, екран шле подію 'showing'. Шаблон слухає її заради фокуса: рядок із «Не чекати», що пішов,
   забирає фокус клавіатури із собою, і keepFocus ставить його на те, що тепер можна натиснути.
   Читач екрана чує й хід, якого не бачить: хто скільки додав і скільки разом («Богдан: +2 — 7 з 10. Твій хід»). */
import { newRound, move, newer, valid, TARGET, STEPS } from './rules.js';

const lib = window.ihroteka, round = lib ? lib.round : null, room = round ? lib.room : null;
const $ = id => document.getElementById(id);
let G = null;            // раунд на екрані (rules.js) або null — лобі
let last = null;         // найновіший стан раунду разом, який ця копія бачила (і після того, як показала лобі)
let cut = null;          // як раунд разом перервано (не правилами): { reason, by } — у лобі це каже why()
let said = '';           // що читач екрана чує перед рядком стану: хто скільки додав і скільки разом
let quitAsk = null;      // «Вийти з раунду» натиснуто раз: чекаємо на друге натискання
let focused = false;     // гравець сам поставив фокус у гру: доти фокус не чіпаємо (гра відкривається без нього)
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
// почати (і «Ще раз») не можна, поки копії, що починає раунди, немає: бібліотека відкинула б старт. Інших не чекаємо
// (правило вгорі): ведучий починає й тоді, коли когось немає
const startOff = () => together() && !round.runs && !!round.runner && room.away(round.runner) > 0;
// недоступна кнопка — aria-disabled, не disabled: та, що має фокус, лишає його собі (а її натискання нічого не робить)
const off = (b, v) => b.setAttribute('aria-disabled', String(v));
const isOff = b => b.getAttribute('aria-disabled') === 'true';

// показати раунд (null — лобі)
function show(r) {
  // читачеві екрана — хід, якого він не бачить: хто скільки додав і скільки тепер (і свій: кнопка з фокусом суми не
  // каже)
  said = r && G && r.id === G.id && r.moves === G.moves + 1
    ? (!isLocal(r) && r.seats[G.turn] === room.me ? 'Ти' : r.seats[G.turn]) + ': +' + (r.total - G.total) + ' — ' + r.total + ' з ' + TARGET + '. ' : '';
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
  cut = null;
  if (together()) { round.start(); draw(); return; }      // (ведучий почне, а всі почують run чи watch)
  show(newRound(local(), 'local-' + ++locals));
}
function play(n) {
  if (!myTurn()) return;
  if (!runs()) { room.send({ t: 'move', id: G.id, n, at: G.moves }); return; }   // at: на який стан цей хід (подвійний клік — один хід)
  const next = move(G, G.turn, n);
  if (next) { show(next); publish(); }
}
// «Вийти з раунду» разом — з підтвердженням (друге натискання за 2,5 с), щоб не вийти випадковим дотиком: кінець для
// всіх; на одному пристрої — «Почати заново», одразу
function unask() { if (quitAsk) { clearTimeout(quitAsk); quitAsk = null; } }
function quit() {
  if (!G) return;
  if (isLocal(G)) { show(newRound(local(), 'local-' + ++locals)); return; }
  if (!quitAsk) { quitAsk = setTimeout(() => { quitAsk = null; draw(); }, 2500); draw(); return; }
  unask();
  round.quit();                                         // (кінець прийде як 'end' 'quit')
  draw();
}

// чому раунд перервано (не правилами); «… уже не в кімнаті» — лише поки це правда (той гравець не грає з нами й не
// чекає на місце: повернувся — просто «Раунд перервано.»)
function why() {
  if (!cut) return '';
  const { reason, by } = cut, other = !!by && by !== room.me;
  if (reason === 'quit' && other) return 'Раунд перервано. Вийти вирішує: ' + by + '.';
  if (reason === 'gone' && other && !room.players.includes(by) && !room.waiting.includes(by)) return 'Раунд перервано: ' + by + ' уже не в кімнаті.';
  return 'Раунд перервано.';
}

if (round) {
  round.policy.endWhenSeatGone = true;                  // правило цієї гри (див. угорі)
  round.on('start', () => { cut = null; });
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
    cut = { reason, by };
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
  // хтось відпав чи повернувся; а копія, що починає раунди, може змінитися чи відпасти й без 'weak' (він уже стоїть,
  // коли когось немає): «Почати» — за тим, що є зараз
  room.on('weak', draw);
  room.on('tick', () => { if (String(startOff()) !== $('start').getAttribute('aria-disabled')) draw(); });
}

// Рядок стану — він же живий регіон: міняємо лише те, що змінилось (інакше читач екрана перечитує його знову)
function say(text) {
  if ($('said').textContent !== said) $('said').textContent = said;
  if ($('say-text').textContent !== text) $('say-text').textContent = text;
}

function draw() {
  $('lobby').hidden = !!G;
  $('play').hidden = !G;
  const no = startOff();
  off($('start'), no);
  off($('again'), no);
  if (!G) {
    const waits = !!room && !room.seated && room.waiting.includes(room.me);
    $('lobby-text').textContent = !room ? 'Гра на одному пристрої: ходіть по черзі.'
      : waits ? ''                                       // (що ти чекаєш на місце і хто грає зараз, каже екран бібліотеки)
      : together() ? 'Грають: ' + room.players.join(', ') + (room.waiting.length ? '. Чекають на місце: ' + room.waiting.join(', ') : '') + '.'
      : 'Поки що тут лише ти: грайте по черзі на цьому пристрої або запросіть друзів.';
    $('start').hidden = waits || (!!round && round.active);   // (раунд уже йде: його стан ось-ось прийде)
    $('invite').hidden = !room || together();
    unask();
    say(why());
    keepFocus();
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
  say(over ? (mine ? 'Перемога твоя!' : 'Перемога: ' + G.seats[G.winner] + '!') : mine ? 'Твій хід' : 'Хід: ' + G.seats[G.turn]);
  for (const b of $('steps').children) off(b, !myTurn() || G.total + +b.dataset.n > TARGET);
  $('again').hidden = !over;
  // вийти: лише з раунду, що йде, і лише тому, хто в ньому грає (хто лише дивиться, не виходить)
  const q = $('quit');
  q.hidden = over || (!isLocal(G) && !(ours() && round.mySeat >= 0));
  if (q.hidden) unask();
  q.textContent = quitAsk ? 'Точно вийти?' : isLocal(G) ? 'Почати заново' : 'Вийти з раунду';
  keepFocus();
}

// Кнопка з фокусом зникла чи сховалась (раунд почався чи скінчився; рядок екрана бібліотеки з «Не чекати» пішов і
// забрав фокус із собою): фокус — на те, що тепер натискають (лобі — «Почати» чи «Запросити друзів», переможець —
// «Ще раз», раунд — перша кнопка ходу; «Вийти з раунду» — ніколи), а не на <body>. Лише коли гравець сам поставив
// фокус у гру (focused), і лише поки фокус у сторінці гри (document.hasFocus()): у бібліотеки (її діалог над грою, її
// картка) його не забираємо — focus() з кадру гри забрав би його.
function keepFocus() {
  const a = document.activeElement;
  if (!focused || !document.hasFocus() || (a && a !== document.body && a.getClientRects().length)) return;
  const to = !G ? [$('start'), $('invite')].find(b => !b.hidden) : G.winner >= 0 ? $('again') : $('steps').firstElementChild;
  if (to) to.focus({ preventScroll: true });
}

$('target').textContent = TARGET;
$('steps').append(...STEPS.map(n => {
  const b = document.createElement('button');
  b.type = 'button'; b.dataset.n = n; b.textContent = '+' + n;
  b.addEventListener('click', () => { if (!isOff(b)) play(n); });
  return b;
}));
$('start').addEventListener('click', () => { if (!isOff($('start'))) start(); });
$('again').addEventListener('click', () => { if (!isOff($('again'))) start(); });
$('quit').addEventListener('click', quit);
$('invite').addEventListener('click', () => lib.invite());
$('home').hidden = !lib;
$('home').addEventListener('click', () => lib.home());
document.addEventListener('keydown', e => { if (STEPS.includes(+e.key) && !e.repeat) play(+e.key); });   // 1, 2 на клавіатурі
document.addEventListener('focusin', () => { focused = true; });
// екран бібліотеки сказав інше (рядок, що пішов, забрав фокус із собою): 'showing' кожної копії <ihroteka-wait>, і
// тієї, що з'явиться пізніше (подія не спливає, тож ловимо її на шляху вниз, у capture); бібліотека віддала фокус
// кадрові гри (гра відкрилась, діалог закрився) — після того, як Tab у кадр уже поставив його, куди треба
document.addEventListener('showing', draw, true);
window.addEventListener('focus', () => setTimeout(keepFocus));
draw();
