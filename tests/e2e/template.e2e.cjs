// tags: @ci @webkit
// template: the template's page (tools/template/main.js, from `cli new demo1` in a scratch copy, on a dev server of its
// own) with a stand-in for ihroteka.room, so the room's events come in any order the library may tell them, at once:
// what the page shows and what it sends for each. (newgame and newgame3 play it on the real room.)
//   - 'resume' alone (a snapshot that came after we linked) goes on with the round; a 'linked' later, with no
//     'resume' just before it, starts afresh: no round from before, not one played on one device meanwhile
//   - 'role' → 'host' with no 'resume' right after it: no round to go on, the lobby; with one: that round
//   - a guest shows only what the runner (room.host) sends; 'state' null: the lobby
'use strict';
const { launch, scenario, check, step, watch } = require('./support/scenario.cjs');
const { newGame } = require('./support/newgame.cjs');

// (in the page, before its code) ihroteka with a stand-in room: its fields in window.__room, emit(event, …args) tells
// the page an event, sent and snaps keep what the page sent and snapshotted
function STUB() {
  const H = {}, R = window.__room = { me: 'Аня', players: ['Аня'], waiting: [], seated: true, linked: false, role: null, host: null, sent: [], snaps: [],
    emit: (ev, ...a) => { for (const f of H[ev] || []) f(...a); } };
  const room = { on(ev, f) { (H[ev] = H[ev] || []).push(f); return room; }, send(m, o) { R.sent.push([JSON.parse(JSON.stringify(m)), o || null]); return true; },
    snapshot(s) { R.snaps.push(s === null ? null : JSON.parse(JSON.stringify(s))); return true; } };
  for (const k of ['me', 'players', 'waiting', 'seated', 'linked', 'role', 'host']) Object.defineProperty(room, k, { get: () => R[k] });
  const lib = { version: 4, game: { id: 'demo1', players: { min: 2, max: 2 } }, room, invite() {}, home() {} };
  Object.defineProperty(window, 'ihroteka', { configurable: true, get: () => lib, set() {} });   // (the page's own prelude finds no library)
}
const view = p => p.evaluate(() => {
  const $ = id => document.getElementById(id);
  return { lobby: !$('lobby').hidden, play: !$('play').hidden, total: +$('total').textContent, seats: [...$('seats').children].map(li => li.textContent), say: $('say').textContent };
});
const R = (p, set) => p.evaluate(set => Object.assign(window.__room, set), set);
const emit = (p, ev, ...a) => p.evaluate(([ev, a]) => window.__room.emit(ev, ...a), [ev, a]);
// several events in one go, as the library tells them in one pass (role then resume, resume then linked)
const emits = (p, list) => p.evaluate(list => { for (const [ev, ...a] of list) window.__room.emit(ev, ...a); }, list);
const sent = p => p.evaluate(() => window.__room.sent.map(([m, o]) => [m.t, m.round === undefined ? undefined : m.round && m.round.seats.join(','), o && o.to]));
const round = (seats, o = {}) => ({ id: 'r1', seats, total: 3, turn: 1, winner: -1, moves: 2, ...o });

scenario('template: its page on the room\'s events in any order (a stand-in room)', async () => {
  const G = await newGame('demo1'), U2 = G.url;
  if (!check(G.made, 'cli new demo1', G.out)) return;
  if (!check(G.up, 'its dev server')) return;
  const ctx = await (await launch()).newContext();
  await ctx.addInitScript(STUB);
  const open = async () => { const p = watch(await ctx.newPage(), 'demo1'); await p.goto(U2 + 'demo1/?frame'); await p.waitForSelector('#lobby'); return p; };

  step('the runner: a snapshot that came after linked, then a new partner after a round on one device');
  let p = await open();
  await R(p, { linked: true, role: 'host', host: 'Аня', players: ['Аня', 'Богдан'] });
  await emit(p, 'linked');
  check((await view(p)).lobby, 'linked, no resume: the lobby', await view(p));
  await emit(p, 'resume', round(['Аня', 'Богдан']));
  let v = await view(p);
  check(v.play && v.total === 3 && v.say === 'Хід: Богдан', 'resume alone: the round goes on, Богдан\'s turn', v);
  check(JSON.stringify(await sent(p)) === JSON.stringify([['state', 'Аня,Богдан', null]]), 'and its state goes to the others', await sent(p));
  await R(p, { linked: false, players: ['Аня'] });
  await emit(p, 'peer-gone');
  check((await view(p)).lobby, 'peer-gone: the lobby', await view(p));
  await p.click('#start');
  v = await view(p);
  check(v.play && v.seats.join() === 'Гравець 1,Гравець 2', 'alone: a round on one device', v);
  await R(p, { linked: true, players: ['Аня', 'Сава'] });
  const n = (await sent(p)).length;
  await emit(p, 'linked');
  v = await view(p);
  check(v.lobby, 'Сава comes, no resume just before: the lobby (the resume long ago does not count)', v);
  check(!(await sent(p)).slice(n).some(([t, seats]) => t === 'state' && /Гравець/.test(seats)), 'and the round on one device is not sent to Сава', await sent(p));

  step('a guest whose copy now runs the round: role, with or without resume');
  p = await open();
  await R(p, { linked: true, role: 'guest', host: 'Богдан', players: ['Аня', 'Богдан'] });
  await emit(p, 'linked');
  await emit(p, 'message', { t: 'state', round: round(['Аня', 'Богдан'], { turn: 0 }) }, 'Богдан');
  check((await view(p)).play, 'a guest shows the runner\'s state', await view(p));
  await R(p, { role: 'host', host: 'Аня' });
  await emit(p, 'role', 'host');
  await p.evaluate(() => new Promise(r => setTimeout(r)));
  check((await view(p)).lobby, 'role host, no resume right after: no round to go on (the lobby)', await view(p));
  await R(p, { role: 'guest', host: 'Богдан' });
  await emit(p, 'role', 'guest');
  check((await sent(p)).at(-1)[0] === 'sync', 'role guest: it asks for the state', await sent(p));
  await emit(p, 'message', { t: 'state', round: round(['Аня', 'Богдан'], { moves: 4, total: 6, turn: 0 }) }, 'Богдан');
  await R(p, { role: 'host', host: 'Аня' });
  await emits(p, [['role', 'host'], ['resume', round(['Аня', 'Богдан'], { moves: 3, total: 5, turn: 1 })]]);
  await p.evaluate(() => new Promise(r => setTimeout(r)));
  v = await view(p);
  check(v.play && v.total === 6 && v.say === 'Твій хід', 'role host, then resume with an older snapshot of the round it saw: it goes on from the newer state it saw', v);

  step('a guest: only the runner\'s state counts; null is the lobby');
  p = await open();
  await R(p, { linked: true, role: 'guest', host: 'Богдан', players: ['Аня', 'Богдан', 'Сава'] });
  await emit(p, 'linked');
  await emit(p, 'message', { t: 'state', round: round(['Аня', 'Богдан', 'Сава']) }, 'Сава');
  check((await view(p)).lobby, 'a state from Сава (not the runner): nothing', await view(p));
  await emit(p, 'message', { t: 'state', round: round(['Аня', 'Богдан', 'Сава']) }, 'Богдан');
  check((await view(p)).play, 'from Богдан (the runner): shown', await view(p));
  await emit(p, 'message', { t: 'state', round: null }, 'Богдан');
  check((await view(p)).lobby, 'state null from the runner: the lobby', await view(p));
}, { timeout: 120000 });
