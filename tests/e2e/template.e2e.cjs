// tags: @ci @webkit
// template: the template's page (tools/template/main.js, from `cli new demo1` in a scratch copy, on a dev server of its
// own) with a stand-in for ihroteka.round and ihroteka.room, so the round's events come as the library tells them, at
// once: what the page shows, sends and saves for each. (newgame and newgame3 play it on the real library.)
//   - its rule: policy.endWhenSeatGone, nothing else
//   - 'run' fresh: a new round of the round's seats, its state to the others and saved; a move counts for the seat
//     of whoever sent it (round.seatOf), once (a double click is one move); 'rejoin': the state to that player; a
//     'newer' state of the same round goes on; the winner: round.over with the last state, and 'end' shows it
//   - a round on one device, then a partner: the lobby, nothing of it sent; Start asks round.start
//   - 'watch': only the runner's state of that round counts; the round moves here ('run' with an older snapshot):
//     it goes on from the newer state it saw; 'end' not by the rules: the lobby says why
'use strict';
const { launch, scenario, check, step, watch } = require('./support/scenario.cjs');
const { newGame } = require('./support/newgame.cjs');

// (in the page, before its code) ihroteka with a stand-in room and round: their fields in window.__lib (round: its
// getters), emit(event, …args) tells the page a room event, remit(event, arg) a round event; sent, saves, overs and
// starts keep what the page sent, saved, ended and started
function STUB() {
  const copy = v => JSON.parse(JSON.stringify(v));
  const H = {}, RH = {}, L = window.__lib = { me: 'Аня', players: ['Аня'], waiting: [], seated: true, linked: false, sent: [], saves: [], overs: [], starts: 0,
    round: { active: false, id: null, seats: null, runner: null, runs: false },
    emit: (ev, ...a) => { for (const f of H[ev] || []) f(...a); }, remit: (ev, a) => { for (const f of RH[ev] || []) f(a); } };
  const room = { on(ev, f) { (H[ev] = H[ev] || []).push(f); return room; }, send(m, o) { L.sent.push([copy(m), o || null]); return true; } };
  for (const k of ['me', 'players', 'waiting', 'seated', 'linked']) Object.defineProperty(room, k, { get: () => L[k] });
  const S = () => L.round, on = () => S().active;
  const round = { policy: { startNeedsEveryone: false, endWhenSeatGone: false },
    on(ev, f) { (RH[ev] = RH[ev] || []).push(f); return round; }, off() { return round; },
    get active() { return on(); }, get id() { return on() ? S().id : null; }, get seats() { return on() ? S().seats.slice() : null; },
    get mySeat() { return on() ? S().seats.indexOf(L.me) : -1; }, seatOf: n => on() ? S().seats.indexOf(n) : -1,
    get runner() { return S().runner; }, get runs() { return S().runs; },
    start() { L.starts++; return true; }, save(s) { L.saves.push(copy(s)); return true; }, over(r) { L.overs.push(copy(r)); return true; }, quit() { return true; } };
  const lib = { version: 4, game: { id: 'demo1', players: { min: 2, max: 2 }, wire: 1 }, room, round, invite() {}, home() {} };
  Object.defineProperty(window, 'ihroteka', { configurable: true, get: () => lib, set() {} });   // (the page's own prelude finds no library)
}
const view = p => p.evaluate(() => {
  const $ = id => document.getElementById(id);
  return { lobby: !$('lobby').hidden, text: $('lobby-text').textContent, start: !$('start').hidden, play: !$('play').hidden, total: +$('total').textContent,
    seats: [...$('seats').children].map(li => li.textContent), say: $('say').textContent, steps: [...$('steps').children].map(b => !b.disabled), again: !$('again').hidden };
});
const L = (p, set) => p.evaluate(set => { const { round, ...rest } = set; Object.assign(window.__lib, rest); if (round) Object.assign(window.__lib.round, round); }, set);
const emit = (p, ev, ...a) => p.evaluate(([ev, a]) => window.__lib.emit(ev, ...a), [ev, a]);
const remit = (p, ev, a) => p.evaluate(([ev, a]) => window.__lib.remit(ev, a), [ev, a]);
const got = p => p.evaluate(() => { const L = window.__lib; return { sent: L.sent, saves: L.saves, overs: L.overs, starts: L.starts }; });
// what went out: [type, total, to]
const sent = async p => (await got(p)).sent.map(([m, o]) => [m.t, m.round ? m.round.total : m.n, o && o.to]);
const ID = 'r1aaaaaa', ID2 = 'r2bbbbbb', AB = ['Аня', 'Богдан'];
const rnd = (o = {}) => ({ id: ID, seats: AB, total: 0, turn: 0, winner: -1, moves: 0, ...o });

scenario('template: its page on the round\'s events (a stand-in library)', async () => {
  const G = await newGame('demo1'), U2 = G.url;
  if (!check(G.made, 'cli new demo1', G.out)) return;
  if (!check(G.up, 'its dev server')) return;
  const ctx = await (await launch()).newContext();
  await ctx.addInitScript(STUB);
  const open = async () => { const p = watch(await ctx.newPage(), 'demo1'); await p.goto(U2 + 'demo1/?frame'); await p.waitForSelector('#lobby'); return p; };

  step('the runner: a fresh round, moves from both seats, a new copy, a newer state, the winner');
  let p = await open();
  check(JSON.stringify(await p.evaluate(() => window.ihroteka.round.policy)) === '{"startNeedsEveryone":false,"endWhenSeatGone":true}',
    'its one rule: endWhenSeatGone (the library imposes none)', await p.evaluate(() => window.ihroteka.round.policy));
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'start', { id: ID, seats: AB, setup: null, by: 'Богдан' });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  let v = await view(p), g = await got(p);
  check(v.play && v.total === 0 && v.say === 'Твій хід' && v.seats.join() === 'Аня (ти),Богдан', 'run, fresh: a new round of its seats, Аня first', v);
  check(JSON.stringify(await sent(p)) === '[["state",0,null]]' && g.saves.length === 1 && g.saves[0].id === ID, 'its state to the others, and saved', g);
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 0 }, 'Богдан');
  check((await view(p)).total === 0, 'a move from Богдан on Аня\'s turn: nothing', await view(p));
  await p.click('#steps button[data-n="1"]');
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 1 }, 'Богдан');
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 1 }, 'Богдан');
  v = await view(p);
  check(v.total === 3 && v.say === 'Твій хід', 'Аня +1, then Богдан +2 (his seat, round.seatOf), twice the same: once', v);
  check(JSON.stringify((await sent(p)).slice(1)) === '[["state",1,null],["state",3,null]]' && (await got(p)).saves.map(s => s.total).join() === '0,1,3', 'each state sent and saved', await got(p));
  await remit(p, 'rejoin', 'Богдан');
  check(JSON.stringify((await sent(p)).at(-1)) === '["state",3,"Богдан"]', 'rejoin: the state to Богдан', await sent(p));
  await emit(p, 'message', { t: 'newer', round: rnd({ total: 8, moves: 5, turn: 0 }) }, 'Богдан');
  v = await view(p);
  check(v.total === 8 && v.say === 'Твій хід' && (await got(p)).saves.at(-1).total === 8, 'a newer state of this round (Богдан saw it): it goes on, saved', v);
  await emit(p, 'message', { t: 'newer', round: rnd({ id: ID2, total: 9, moves: 6 }) }, 'Богдан');
  check((await view(p)).total === 8, 'one of another round: nothing', await view(p));
  await p.click('#steps button[data-n="2"]');
  g = await got(p);
  check(g.overs.length === 1 && g.overs[0].total === 10 && g.overs[0].winner === 0 && g.saves.at(-1).total === 8, 'Аня +2 = 10: round.over with that state (not saved)', g);
  await L(p, { round: { active: false } });
  await remit(p, 'end', { id: ID, by: 'Аня', reason: 'over', result: g.overs[0] });
  v = await view(p);
  check(v.play && v.say === 'Ти виграв!' && v.again && !v.steps.some(Boolean), 'end over: «Ти виграв!», «Ще раз», no more moves', v);
  await p.click('#again');
  check((await got(p)).starts === 1, '«Ще раз» asks round.start', await got(p));

  step('a round on one device, then a partner: the lobby, nothing of it sent');
  p = await open();
  check(/Поки що ти сам/.test((await view(p)).text), 'alone: the lobby says so', await view(p));
  await p.click('#start');
  v = await view(p);
  check(v.play && v.seats.join() === 'Гравець 1,Гравець 2' && (await got(p)).starts === 0, 'Start: a round on one device (no round.start)', [v, await got(p)]);
  await p.keyboard.press('2');
  check((await view(p)).total === 2 && (await got(p)).saves.length === 0, 'a key: +2, nothing saved', await view(p));
  await L(p, { linked: true, players: ['Аня', 'Сава'] });
  await emit(p, 'linked');
  v = await view(p);
  check(v.lobby && v.text === 'Грають: Аня, Сава.' && v.start, 'Сава comes: the lobby, «Грають: Аня, Сава.»', v);
  check((await got(p)).sent.length === 0, 'and nothing of the round on one device went to Сава', await got(p));
  await p.click('#start');
  check((await got(p)).starts === 1 && (await view(p)).lobby, 'Start together: round.start (the round begins when the runner says)', [await got(p), await view(p)]);

  step('a copy that watches: only the runner\'s state of that round; the round moves here; an end not by the rules');
  p = await open();
  await L(p, { linked: true, players: [...AB, 'Сава'], round: { active: true, id: ID, seats: [...AB, 'Сава'], runner: 'Богдан', runs: false } });
  await remit(p, 'watch', { id: ID, seats: [...AB, 'Сава'], runner: 'Богдан' });
  v = await view(p);
  check(v.lobby && !v.start, 'watch: the lobby until the runner\'s state comes, no Start (a round is on)', v);
  const r3 = o => rnd({ seats: [...AB, 'Сава'], ...o });
  await emit(p, 'message', { t: 'state', round: r3({ total: 6, moves: 4, turn: 0 }) }, 'Сава');
  await emit(p, 'message', { t: 'state', round: r3({ id: ID2, total: 6, moves: 4, turn: 0 }) }, 'Богдан');
  check((await view(p)).lobby, 'a state from Сава (not the runner), and one of another round from Богдан: nothing', await view(p));
  await emit(p, 'message', { t: 'state', round: r3({ total: 6, moves: 4, turn: 0 }) }, 'Богдан');
  v = await view(p);
  check(v.play && v.total === 6 && v.say === 'Твій хід', 'Богдан\'s state of the round: shown, Аня\'s turn', v);
  await p.click('#steps button[data-n="1"]');
  check((await view(p)).total === 6 && JSON.stringify((await got(p)).sent.at(-1)[0]) === JSON.stringify({ t: 'move', id: ID, n: 1, at: 4 }), '+1: a move to the runner (not shown until its state)', await got(p));
  await L(p, { round: { runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: [...AB, 'Сава'], setup: null, state: r3({ total: 5, moves: 3, turn: 1 }) });
  v = await view(p);
  check(v.total === 6 && v.say === 'Твій хід' && (await got(p)).saves.at(-1).total === 6, 'the round moves here with an older snapshot: it goes on from the newer state it saw', [v, await got(p)]);
  await L(p, { players: ['Аня', 'Сава'], round: { active: false } });
  await remit(p, 'end', { id: ID, by: 'Богдан', reason: 'gone', result: null });
  v = await view(p);
  check(v.lobby && v.say === 'Раунд перервано: Богдан уже не в кімнаті.' && v.start, 'end gone: the lobby, and why', v);
  await emit(p, 'message', { t: 'state', round: r3({ total: 7, moves: 5, turn: 2 }) }, 'Богдан');
  check((await view(p)).lobby, 'a state of the round after its end: nothing', await view(p));
}, { timeout: 120000 });
