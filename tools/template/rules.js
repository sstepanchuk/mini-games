/* Правила гри — без сторінки й мережі, тож їх перевіряють у Node (test/rules.test.js; npm run test:games, і збірка
   не запечатує гру, чиї тести падають). Гра-заготовка: гравці по черзі додають 1 або 2 до спільного числа; хто
   доведе його рівно до TARGET, той виграв. Заміни її своєю: main.js бере звідси лише newRound, move, newer, valid,
   TARGET і STEPS.

   Раунд — звичайний об'єкт, що стає JSON (його шлють іншим і віддають бібліотеці як знімок):
     { id, seats: [ім'я, …], total, turn, winner, moves }
   id — який це раунд (новий щоразу); seats — хто грає, за місцями, записані на старті раунду й незмінні до його кінця
   (порядок гравців у кімнаті може змінитися, раунд — ні); turn — чиє місце ходить; winner — місце переможця або -1;
   moves — скільки ходів зроблено (з двох станів того самого раунду новіший той, де їх більше). */
export const TARGET = 10, STEPS = [1, 2];

export const newRound = (seats, id = '') => ({ id, seats: seats.slice(), total: 0, turn: 0, winner: -1, moves: 0 });
// з двох станів того самого раунду — новіший (null: це різні раунди)
export const newer = (a, b) => !valid(a) || !valid(b) || a.id !== b.id || a.seats.join() !== b.seats.join() ? null
  : b.moves > a.moves ? b : a;

// Хід місця seat: додати n → новий раунд, або null, коли так не можна (раунд скінчився, не його черга, такого кроку
// немає, перебір). Старий раунд не змінюється.
export function move(r, seat, n) {
  if (!valid(r) || r.winner >= 0 || seat !== r.turn || !STEPS.includes(n) || r.total + n > TARGET) return null;
  const total = r.total + n, won = total === TARGET;
  return { ...r, seats: r.seats.slice(), total, moves: r.moves + 1, winner: won ? seat : -1, turn: won ? r.turn : (r.turn + 1) % r.seats.length };
}

// Чи це раунд цієї гри (те, що прийшло мережею чи зі знімка, перевіряємо, перш ніж показати чи грати далі)
export const valid = r => !!r && typeof r.id === 'string' && Array.isArray(r.seats) && r.seats.length >= 1 &&
  r.seats.every(s => typeof s === 'string') && Number.isInteger(r.total) && r.total >= 0 && r.total <= TARGET && Number.isInteger(r.moves) && r.moves >= 0 &&
  Number.isInteger(r.turn) && r.turn >= 0 && r.turn < r.seats.length && Number.isInteger(r.winner) && r.winner >= -1 && r.winner < r.seats.length;
