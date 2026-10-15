// tags: @ci @webkit
// template: the template's page (tools/template/main.js, from `cli new demo1` in a scratch copy, on a dev server of its
// own) with a stand-in for ihroteka.round and ihroteka.room, so the round's events come as the library tells them, at
// once: what the page shows, sends and saves for each. (newgame and newgame3 play it on the real library.)
//   - its rule: policy.endWhenSeatGone, nothing else
//   - 'run' fresh: a new round of the round's seats, its state to the others and saved; a move counts for the seat
//     of whoever sent it (round.seatOf), once (a double click is one move); a screen reader hears who added what and
//     the total («Богдан: +2 — 3 з 10.»), the line stays «Твій хід»; 'rejoin': the state to that player; a 'newer'
//     state of the same round goes on; the winner: round.over with the last state, and 'end' shows it («Перемога
//     твоя!»)
//   - a round on one device, then a partner: the lobby, nothing of it sent; Start asks round.start
//   - the library's waiting screen (<ihroteka-wait>, README "Waiting screens") at the end of the page, under its
//     buttons (it never moves them), empty: outside the library (here) never defined and taking no room; waiting for a
//     seat, the lobby itself says nothing of it (the screen says it: screens and newgame3 on the real library)
//   - 'watch': only the runner's state of that round counts; the round moves here ('run' with an older snapshot):
//     it goes on from the newer state it saw; 'end' not by the rules: the lobby says why, «… уже не в кімнаті» only
//     while that player is not in the room (back, or waiting for a seat: «Раунд перервано.»)
//   - the keyboard's focus stays on what can be pressed now (Start, a step, «Ще раз»), also when the library's row
//     with a focused «Не чекати» goes ('showing'), and never taken while the player has not put it in the game
//   - «← Усі ігри» (ihroteka.home()) only in the library; «Вийти з раунду» asks once more, then round.quit(); on one
//     device «Почати заново»; «Почати» unavailable while the copy that starts rounds is away; a quit by another
//     player: the lobby says who
//   - a 24-letter name at 320 px: nothing wider than the screen
//   - the library's look (UX spec §5, S-I13): Onest and Unbounded, a paper card with a 3 px ink border and the pink and
//     blue shadows, «Почати» the one yellow button, «Запросити друзів» a paper one, «← Усі ігри» a finger's size (44
//     px), a press sinks 3 px; light only, also when the system is dark
//   - it fits (S-I15): a round on a phone lying down (844×390) shows its line and «Вийти з раунду»; on a small phone
//     (320×568) the library's waiting screen is in view, in a round and in the lobby
//   - while the library's screen says whom it waits for, the game's line is quiet (the chips still mark the turn; the
//     version is no wait); «(ти)» stays after the end; the chips are the same nodes from move to move, the winner's
//     mint with a ✓ (S-I14, S-T27)
//   - motion, in the library (its vocabulary at attach, README "Motion"): the round comes in forward and the lobby back
//     with the reason, the total rolls up, what the change pushed glides (glide); the state first, so a key works mid-
//     entry and every animation is over in 600 ms; motion off: nothing moves, nothing added to the page; «менше руху»:
//     nothing moves or scales; outside the library nothing moves by itself
'use strict';
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { launch, scenario, check, step, watch, w, CHROMIUM } = require('./support/scenario.cjs');
const { newGame } = require('./support/newgame.cjs');

// (in the page, before its code) ihroteka with a stand-in room and round: their fields in window.__lib (round: its
// getters; awayOf: for how long each player is away, room.away), emit(event, …args) tells the page a room event,
// remit(event, arg) a round event; sent, saves, overs, starts, quits and homes keep what the page sent, saved, ended,
// started, quit and asked of the shelf
function STUB() {
  const copy = v => JSON.parse(JSON.stringify(v));
  const H = {}, RH = {}, L = window.__lib = { me: 'Аня', players: ['Аня'], waiting: [], seated: true, linked: false, awayOf: {}, sent: [], saves: [], overs: [], starts: 0, quits: 0, homes: 0,
    round: { active: false, id: null, seats: null, runner: null, runs: false },
    emit: (ev, ...a) => { for (const f of H[ev] || []) f(...a); }, remit: (ev, a) => { for (const f of RH[ev] || []) f(a); } };
  const room = { on(ev, f) { (H[ev] = H[ev] || []).push(f); return room; }, send(m, o) { L.sent.push([copy(m), o || null]); return true; }, away: n => L.awayOf[n] || 0 };
  for (const k of ['me', 'players', 'waiting', 'seated', 'linked']) Object.defineProperty(room, k, { get: () => L[k] });
  const S = () => L.round, on = () => S().active;
  const round = { policy: { startNeedsEveryone: false, endWhenSeatGone: false },
    on(ev, f) { (RH[ev] = RH[ev] || []).push(f); return round; }, off() { return round; },
    get active() { return on(); }, get id() { return on() ? S().id : null; }, get seats() { return on() ? S().seats.slice() : null; },
    get mySeat() { return on() ? S().seats.indexOf(L.me) : -1; }, seatOf: n => on() ? S().seats.indexOf(n) : -1,
    get runner() { return S().runner; }, get runs() { return S().runs; },
    start() { L.starts++; return true; }, save(s) { L.saves.push(copy(s)); return true; }, over(r) { L.overs.push(copy(r)); return true; }, quit() { L.quits++; return true; } };
  const lib = { version: 4, game: { id: 'demo1', players: { min: 2, max: 2 }, wire: 1 }, room, round, invite() {}, home() { L.homes++; } };
  Object.defineProperty(window, 'ihroteka', { configurable: true, get: () => lib, set() {} });   // (the page's own prelude finds no library)
}
// what a player sees: say is the line («Твій хід»), heard what a screen reader hears of it (the move before it);
// steps: which can be pressed (aria-disabled ones keep their focus); startOff: «Почати» unavailable; quit: the text of
// «Вийти з раунду» (null: hidden); home: «← Усі ігри» shows
const view = p => p.evaluate(() => {
  const $ = id => document.getElementById(id), off = b => b.disabled || b.getAttribute('aria-disabled') === 'true';
  return { lobby: !$('lobby').hidden, text: $('lobby-text').textContent, start: !$('start').hidden, startOff: off($('start')), play: !$('play').hidden, total: +$('total').textContent,
    seats: [...$('seats').children].map(li => li.textContent), say: $('say-text').textContent, heard: $('say').textContent, steps: [...$('steps').children].map(b => !off(b)),
    again: !$('again').hidden, quit: $('quit').hidden ? null : $('quit').textContent, home: !$('home').hidden };
});
// where the keyboard's focus is: 'BODY', or the button's id or text (' off': aria-disabled); 'away': not in this page
const focusOn = p => p.evaluate(() => {
  const a = document.activeElement;
  return !document.hasFocus() ? 'away' : !a || a === document.body ? 'BODY' : (a.id || a.textContent) + (a.getAttribute('aria-disabled') === 'true' ? ' off' : '');
});
const L = (p, set) => p.evaluate(set => { const { round, ...rest } = set; Object.assign(window.__lib, rest); if (round) Object.assign(window.__lib.round, round); }, set);
const emit = (p, ev, ...a) => p.evaluate(([ev, a]) => window.__lib.emit(ev, ...a), [ev, a]);
const remit = (p, ev, a) => p.evaluate(([ev, a]) => window.__lib.remit(ev, a), [ev, a]);
const got = p => p.evaluate(() => { const L = window.__lib; return { sent: L.sent, saves: L.saves, overs: L.overs, starts: L.starts, quits: L.quits, homes: L.homes }; });
// a press as a script makes it (Playwright's click waits for a button that is not aria-disabled)
const press = (p, sel) => p.evaluate(sel => document.querySelector(sel).click(), sel);
// what went out: [type, total, to]
const sent = async p => (await got(p)).sent.map(([m, o]) => [m.t, m.round ? m.round.total : m.n, o && o.to]);
const ID = 'r1aaaaaa', ID2 = 'r2bbbbbb', AB = ['Аня', 'Богдан'];
const rnd = (o = {}) => ({ id: ID, seats: AB, total: 0, turn: 0, winner: -1, moves: 0, ...o });

// where sel is on the screen, with the screen's size (null: it takes no room); inView: all of it on the screen
const box = (p, sel) => p.evaluate(sel => {
  const e = document.querySelector(sel);
  if (!e || !e.getClientRects().length) return null;
  const r = e.getBoundingClientRect();
  return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vh: innerHeight, vw: innerWidth };
}, sel);
const inView = b => !!b && b.top >= 0 && b.bottom <= b.vh && b.left >= 0 && b.right <= b.vw;
const wideOf = p => p.evaluate(() => document.documentElement.scrollWidth);
// (in the page) the library's waiting screen as screens.js paints it into the game's copy: its default style, one row,
// the attribute and the event `showing`. 'link': a player dropped out (the line, the time, «Не чекати»); 'seat': we
// wait for a seat (the line, the small line); 'version'; null: empty again
function COPY(kind) {
  const e = document.querySelector('ihroteka-wait');
  if (!document.querySelector('style[data-ihroteka-wait]')) {
    const s = document.createElement('style');
    s.setAttribute('data-ihroteka-wait', '');
    s.textContent = 'ihroteka-wait:empty{display:none!important}:where(ihroteka-wait){display:block}' +
      ':where(ihroteka-wait:not(:empty)){position:relative;z-index:1;animation:ihk-keep var(--m-in,200ms) var(--m-ease-out,ease-out) both}' +
      ':where(ihroteka-wait .wait-row){display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:4px 12px}' +
      ':where(ihroteka-wait p){margin:0;overflow-wrap:anywhere}:where(ihroteka-wait .wait-time){font-variant-numeric:tabular-nums;white-space:nowrap}' +
      ':where(ihroteka-wait .fine){flex-basis:100%}';
    document.head.append(s);
  }
  const row = document.createElement('div');
  row.className = 'wait-row';
  row.dataset.kind = kind;
  if (kind === 'link') row.innerHTML = '<p>Чекаємо, поки повернеться <bdi>Богдан</bdi>… <span class="wait-time">2:43</span></p><button type="button" class="btn ghost">Не чекати</button>';
  else if (kind === 'seat') row.innerHTML = '<p>Ти чекаєш на місце</p><p class="fine">Грають зараз: <bdi>Богдан</bdi> і <bdi>Сава</bdi>.</p>';
  else row.innerHTML = '<p>У когось із вас інша версія Ігротеки.</p><button type="button" class="btn">Оновити</button>';
  if (kind) { e.replaceChildren(row); e.setAttribute('showing', kind); } else { e.replaceChildren(); e.removeAttribute('showing'); }
  e.dispatchEvent(new Event('showing'));
}
const says = (p, kind = null) => p.evaluate(COPY, kind);
// the library's motion vocabulary as its attach puts it into a game's page (README "Motion": MOTION_CSS of
// library/app/motion.js, data-ihroteka on <html>; data-motion=off with motion off)
let motionCss = null;
const inLibrary = async (p, off = false) => {
  motionCss = motionCss || (await import(pathToFileURL(path.join(__dirname, '..', '..', 'library', 'app', 'motion.js')).href)).MOTION_CSS;
  await p.evaluate(([css, off]) => {
    const s = document.createElement('style');
    s.setAttribute('data-ihroteka-motion', '');
    s.textContent = css;
    document.head.prepend(s);
    document.documentElement.setAttribute('data-ihroteka', '');
    if (off) document.documentElement.setAttribute('data-motion', 'off');
  }, [motionCss, off]);
  await p.evaluate(RECORD);
};
// (in the page) every animation that starts from now on, in window.__moved: { on (the element's id, or its tag), name
// (a keyframe's; 'glide': one of the page's script, element.animate), moves (its keyframes move or scale) }. Kept as
// they start, so a slow machine that reads late still sees what ran (not what still runs)
function RECORD() {
  const M = window.__moved = [], moves = k => k.some(f => f.transform && f.transform !== 'none');
  document.addEventListener('animationstart', e => {
    const a = e.target.getAnimations().find(x => x.animationName === e.animationName);
    M.push({ on: e.target.id || e.target.localName, name: e.animationName, moves: !!a && moves(a.effect.getKeyframes()) });
  }, true);
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { M.push({ on: this.id || this.localName, name: 'glide', moves: moves(Array.isArray(k) ? k : []) }); return animate.call(this, k, o); };
}
// what started since the last call (after two frames: animationstart comes with the next one)
const moved = p => p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(window.__moved.splice(0))))));
// what still moves now, a transition (a press, a hover) aside
const running = p => p.evaluate(() => document.getAnimations().filter(a => !a.transitionProperty && a.playState !== 'finished').map(a => a.animationName || 'glide'));
const named = (list, on, name) => list.some(a => a.on === on && a.name === name);

scenario('template: its page on the round\'s events (a stand-in library)', async () => {
  const G = await newGame('demo1'), U2 = G.url;
  if (!check(G.made, 'cli new demo1', G.out)) return;
  if (!check(G.up, 'its dev server at ' + U2, G.log)) return;
  const browser = await launch(), ctx = await browser.newContext();
  await ctx.addInitScript(STUB);
  let shown = null;                                       // (one page at a time, in front: it has the focus to keep)
  const open = async () => {
    if (shown) await shown.close();
    const p = shown = watch(await ctx.newPage(), 'demo1');
    await p.goto(U2 + 'demo1/?frame');
    await p.waitForSelector('#lobby');
    await p.bringToFront();
    return p;
  };

  step('the runner: a fresh round, moves from both seats, a new copy, a newer state, the winner');
  let p = await open();
  check(JSON.stringify(await p.evaluate(() => window.ihroteka.round.policy)) === '{"startNeedsEveryone":false,"endWhenSeatGone":true}',
    'its one rule: endWhenSeatGone (the library imposes none)', await p.evaluate(() => window.ihroteka.round.policy));
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'start', { id: ID, seats: AB, setup: null, by: 'Богдан' });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  let v = await view(p), g = await got(p);
  check(v.play && v.total === 0 && v.say === 'Твій хід' && v.heard === 'Твій хід' && v.seats.join() === 'Аня (ти),Богдан', 'run, fresh: a new round of its seats, Аня first', v);
  check(JSON.stringify(await sent(p)) === '[["state",0,null]]' && g.saves.length === 1 && g.saves[0].id === ID, 'its state to the others, and saved', g);
  const group = await p.locator('#steps').ariaSnapshot();
  check(/^- group "Додати"/.test(group), 'the steps: a group «Додати» for a screen reader', group);
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 0 }, 'Богдан');
  check((await view(p)).total === 0, 'a move from Богдан on Аня\'s turn: nothing', await view(p));
  await p.click('#steps button[data-n="1"]');
  v = await view(p);
  check(v.say === 'Хід: Богдан' && v.heard === 'Ти: +1 — 1 з 10. Хід: Богдан', 'Аня +1: «Хід: Богдан»; a screen reader hears her move and the total first', v);
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 1 }, 'Богдан');
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 1 }, 'Богдан');
  v = await view(p);
  check(v.total === 3 && v.say === 'Твій хід', 'Аня +1, then Богдан +2 (his seat, round.seatOf), twice the same: once', v);
  check(v.heard === 'Богдан: +2 — 3 з 10. Твій хід', '… and a screen reader hears «Богдан: +2 — 3 з 10. Твій хід»', v);
  check(JSON.stringify((await sent(p)).slice(1)) === '[["state",1,null],["state",3,null]]' && (await got(p)).saves.map(s => s.total).join() === '0,1,3', 'each state sent and saved', await got(p));
  await remit(p, 'rejoin', 'Богдан');
  check(JSON.stringify((await sent(p)).at(-1)) === '["state",3,"Богдан"]', 'rejoin: the state to Богдан', await sent(p));
  await emit(p, 'message', { t: 'newer', round: rnd({ total: 8, moves: 5, turn: 0 }) }, 'Богдан');
  v = await view(p);
  check(v.total === 8 && v.say === 'Твій хід' && v.heard === 'Твій хід' && (await got(p)).saves.at(-1).total === 8, 'a newer state of this round (Богдан saw it): it goes on, saved (no move to say: it is not the next one)', v);
  await emit(p, 'message', { t: 'newer', round: rnd({ id: ID2, total: 9, moves: 6 }) }, 'Богдан');
  check((await view(p)).total === 8, 'one of another round: nothing', await view(p));
  await p.click('#steps button[data-n="2"]');
  g = await got(p);
  check(g.overs.length === 1 && g.overs[0].total === 10 && g.overs[0].winner === 0 && g.saves.at(-1).total === 8, 'Аня +2 = 10: round.over with that state (not saved)', g);
  await L(p, { round: { active: false } });
  await remit(p, 'end', { id: ID, by: 'Аня', reason: 'over', result: g.overs[0] });
  v = await view(p);
  check(v.play && v.say === 'Перемога твоя!' && v.again && !v.steps.some(Boolean) && v.quit === null, 'end over: «Перемога твоя!», «Ще раз», no more moves, no way out of a round that is over', v);
  await p.click('#again');
  check((await got(p)).starts === 1, '«Ще раз» asks round.start', await got(p));

  step('a round on one device, then a partner: the lobby, nothing of it sent');
  p = await open();
  check(/Поки що тут лише ти/.test((await view(p)).text), 'alone: the lobby says so', await view(p));
  await p.click('#start');
  v = await view(p);
  check(v.play && v.seats.join() === 'Гравець 1,Гравець 2' && (await got(p)).starts === 0, 'Start: a round on one device (no round.start)', [v, await got(p)]);
  await p.keyboard.press('2');
  v = await view(p);
  check(v.total === 2 && (await got(p)).saves.length === 0, 'a key: +2, nothing saved', v);
  check(v.heard === 'Гравець 1: +2 — 2 з 10. Хід: Гравець 2', '… a screen reader hears who added it and the total', v);
  await L(p, { linked: true, players: ['Аня', 'Сава'] });
  await emit(p, 'linked');
  v = await view(p);
  check(v.lobby && v.text === 'Грають: Аня, Сава.' && v.start, 'Сава comes: the lobby, «Грають: Аня, Сава.»', v);
  check((await got(p)).sent.length === 0, 'and nothing of the round on one device went to Сава', await got(p));
  await p.click('#start');
  check((await got(p)).starts === 1 && (await view(p)).lobby, 'Start together: round.start (the round begins when the runner says)', [await got(p), await view(p)]);

  step('the library\'s waiting screen: in its place, empty; waiting for a seat, the lobby says nothing of it');
  p = await open();
  const screen = await p.evaluate(() => {
    const e = document.querySelector('ihroteka-wait');
    return e && { count: document.querySelectorAll('ihroteka-wait').length, in: e.parentElement.tagName, after: e.previousElementSibling?.id, next: e.nextElementSibling?.tagName ?? null,
      defined: !!customElements.get('ihroteka-wait'), empty: !e.firstChild, room: e.getClientRects().length, showing: e.hasAttribute('showing') };
  });
  check(screen && screen.count === 1 && screen.in === 'MAIN' && screen.after === 'say' && screen.next === null, 'one <ihroteka-wait>, at the end of the page, under its buttons and its line', screen);
  check(screen && !screen.defined && screen.empty && !screen.room && !screen.showing, 'outside the library: never defined, empty, takes no room, no `showing`', screen);
  await L(p, { linked: false, players: ['Богдан', 'Сава'], waiting: ['Аня'], seated: false });
  await emit(p, 'players', ['Богдан', 'Сава']);
  v = await view(p);
  check(v.lobby && v.text === '' && !v.start, 'Аня waits for a seat: the lobby says nothing of it (the library\'s screen does), no Start', v);
  await L(p, { linked: true, players: ['Богдан', 'Аня'], waiting: [], seated: true });
  await emit(p, 'players', ['Богдан', 'Аня']);
  v = await view(p);
  check(v.lobby && v.text === 'Грають: Богдан, Аня.' && v.start, 'Сава leaves, Аня has his seat: «Грають: Богдан, Аня.», Start', v);

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
  await L(p, { players: ['Аня', 'Сава', 'Богдан'] });
  await emit(p, 'players', ['Аня', 'Сава', 'Богдан']);
  check((await view(p)).say === 'Раунд перервано.', 'Богдан back in the room: «Раунд перервано.» (he is in the room again)', await view(p));
  await L(p, { players: ['Аня', 'Сава'], waiting: ['Богдан'] });
  await emit(p, 'players', ['Аня', 'Сава']);
  check((await view(p)).say === 'Раунд перервано.', 'Богдан waits for a seat: still «Раунд перервано.»', await view(p));
  await L(p, { waiting: [] });
  await emit(p, 'players', ['Аня', 'Сава']);
  check((await view(p)).say === 'Раунд перервано: Богдан уже не в кімнаті.', 'gone again: «… уже не в кімнаті» again', await view(p));

  step('the focus with the keyboard: on what can be pressed now');
  p = await open();
  await emit(p, 'players', ['Аня']);
  check(await focusOn(p) === 'BODY', 'opened: nothing focused (the game takes no focus by itself)', await focusOn(p));
  await p.focus('#start');
  await p.keyboard.press('Enter');
  check(await focusOn(p) === '+1', '«Почати» with Enter (a round on one device): the focus on +1', await focusOn(p));
  await p.focus('#steps button[data-n="2"]');
  for (let i = 0; i < 5; i++) await p.keyboard.press('Enter');
  v = await view(p);
  check(v.total === 10 && v.say === 'Перемога: Гравець 1!' && await focusOn(p) === '+2 off', '+2 five times with Enter: «Перемога: Гравець 1!», the focus stays on +2 (no more moves)', [v, await focusOn(p)]);
  await p.focus('#again');
  await p.keyboard.press('Enter');
  check((await view(p)).total === 0 && await focusOn(p) === '+1', '«Ще раз» with Enter: a new round, the focus on +1', [await view(p), await focusOn(p)]);
  await p.keyboard.press('Enter');
  await p.focus('#steps button[data-n="2"]');
  for (let i = 0; i < 5; i++) await p.keyboard.press('Enter');
  check((await view(p)).total === 9 && await focusOn(p) === '+2 off', '+1, then +2 until it would overshoot (9): +2 can no longer be pressed, and keeps the focus', [await view(p), await focusOn(p)]);
  p = await open();
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  await p.focus('#steps button[data-n="1"]');
  await p.keyboard.press('Enter');
  check((await view(p)).total === 1 && await focusOn(p) === '+1 off', 'together: Аня\'s +1 with Enter, Богдан\'s turn: the focus stays on +1', [await view(p), await focusOn(p)]);
  p = await open();
  await p.evaluate(() => { const b = document.createElement('button'); b.textContent = 'Не чекати'; document.querySelector('ihroteka-wait').append(b); b.focus(); });
  check(await focusOn(p) === 'Не чекати', 'a row of the library\'s screen with a focused «Не чекати»', await focusOn(p));
  await p.evaluate(() => { const e = document.querySelector('ihroteka-wait'); e.replaceChildren(); e.dispatchEvent(new Event('showing')); });
  check(await focusOn(p) === 'start', 'the row goes (`showing`): the focus on «Почати», not lost', await focusOn(p));

  step('a way back to the shelf, and out of a round');
  p = await open();
  v = await view(p);
  const first = await p.evaluate(() => { const b = document.getElementById('home'); return b.parentElement.firstElementChild === b && b.nextElementSibling.tagName; });
  check(v.home && first === 'H1', 'in the library: «← Усі ігри», first, before the title', [v, first]);
  await p.click('#home');
  check((await got(p)).homes === 1, 'pressed: ihroteka.home(), once', await got(p));
  const alone = watch(await (await browser.newContext()).newPage(), 'demo1 alone');
  await alone.goto(U2 + 'demo1/?frame');
  await alone.waitForSelector('#lobby');
  check(await alone.evaluate(() => !window.ihroteka && document.getElementById('home').getClientRects().length === 0), 'outside the library: no «← Усі ігри» (it takes no room)');
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  check((await view(p)).quit === 'Вийти з раунду', 'a round together, with a seat: «Вийти з раунду»', await view(p));
  await p.click('#quit');
  check((await view(p)).quit === 'Точно вийти?' && (await got(p)).quits === 0, 'pressed once: «Точно вийти?», nothing more', [await view(p), await got(p)]);
  await w(2800);
  check((await view(p)).quit === 'Вийти з раунду' && (await got(p)).quits === 0, '2.5 s later: «Вийти з раунду» again', [await view(p), await got(p)]);
  await p.click('#quit');
  await p.click('#quit');
  check((await got(p)).quits === 1, 'pressed twice: round.quit(), once (the end for everyone)', await got(p));
  await L(p, { round: { active: false } });
  await remit(p, 'end', { id: ID, by: 'Аня', reason: 'quit', result: null });
  check((await view(p)).lobby && (await view(p)).say === 'Раунд перервано.', 'her own quit: the lobby, «Раунд перервано.»', await view(p));
  await L(p, { round: { active: true, id: ID2, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID2, seats: AB, setup: null, state: null });
  await L(p, { round: { active: false } });
  await remit(p, 'end', { id: ID2, by: 'Богдан', reason: 'quit', result: null });
  check((await view(p)).say === 'Раунд перервано. Вийти вирішує: Богдан.', 'Богдан quits: «Раунд перервано. Вийти вирішує: Богдан.»', await view(p));
  p = await open();
  await L(p, { linked: true, players: ['Богдан', 'Сава', 'Аня'], round: { active: true, id: ID, seats: ['Богдан', 'Сава'], runner: 'Богдан', runs: false } });
  await remit(p, 'watch', { id: ID, seats: ['Богдан', 'Сава'], runner: 'Богдан' });
  await emit(p, 'message', { t: 'state', round: rnd({ seats: ['Богдан', 'Сава'], total: 3, moves: 2 }) }, 'Богдан');
  v = await view(p);
  check(v.play && v.total === 3 && v.quit === null, 'a round she has no seat in (she watches): no «Вийти з раунду»', v);
  p = await open();
  await p.click('#start');
  await p.keyboard.press('2');
  check((await view(p)).quit === 'Почати заново', 'on one device: «Почати заново»', await view(p));
  await p.click('#quit');
  v = await view(p);
  g = await got(p);
  check(v.play && v.total === 0 && g.starts === 0 && g.quits === 0, '… pressed: a fresh round here at once (0), nothing asked of the library', [v, g]);
  p = await open();
  await L(p, { linked: true, players: AB, awayOf: { Богдан: 3000 }, round: { runner: 'Богдан', runs: false } });
  await emit(p, 'weak', true);
  check((await view(p)).start && (await view(p)).startOff, 'between rounds, the copy that starts rounds (Богдан\'s) away: «Почати» unavailable', await view(p));
  await press(p, '#start');
  check((await got(p)).starts === 0, '… pressing it asks nothing', await got(p));
  await L(p, { awayOf: {} });
  await emit(p, 'weak', false);
  check(!(await view(p)).startOff, 'Богдан back: «Почати»', await view(p));
  await L(p, { awayOf: { Богдан: 11000 } });
  await emit(p, 'tick', 0);
  check((await view(p)).startOff, 'away again, with no word of it but the room\'s tick: unavailable again', await view(p));
  await L(p, { round: { runner: 'Аня', runs: true } });
  await emit(p, 'tick', 0);
  check(!(await view(p)).startOff, 'the rounds start in Аня\'s copy now, Богдан still away: «Почати» (one may start while someone is away)', await view(p));
  await press(p, '#start');
  check((await got(p)).starts === 1, '… round.start', await got(p));

  step('a 24-letter name at 320 px');
  p = await open();
  await p.setViewportSize({ width: 320, height: 568 });
  const LONG = 'Ш'.repeat(24), wide = () => p.evaluate(() => document.documentElement.scrollWidth);
  await L(p, { linked: true, players: ['Аня', LONG] });
  await emit(p, 'players', ['Аня', LONG]);
  check((await view(p)).text === 'Грають: Аня, ' + LONG + '.' && await wide() === 320, 'the lobby «Грають: Аня, ШШШ…»: the page 320 px wide', [await view(p), await wide()]);
  await L(p, { round: { active: true, id: ID, seats: ['Аня', LONG], runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: ['Аня', LONG], setup: null, state: null });
  await p.click('#steps button[data-n="1"]');
  check((await view(p)).say === 'Хід: ' + LONG && await wide() === 320, 'a round, «Хід: ШШШ…»: the page 320 px wide', [await view(p), await wide()]);

  step('the library\'s look, light only');
  p = await open();
  const INK = 'rgb(35, 32, 74)', PAGE = 'rgb(228, 226, 240)', PAPER = 'rgb(246, 245, 251)', YELLOW = 'rgb(255, 217, 26)';
  const look = () => p.evaluate(() => {
    const css = s => getComputedStyle(document.querySelector(s)), b = s => { const c = css(s); return c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor; };
    const h = s => document.querySelector(s).getBoundingClientRect().height;
    return { scheme: getComputedStyle(document.documentElement).colorScheme, page: css('body').backgroundColor, ink: css('body').color, text: css('body').fontFamily,
      title: css('h1').fontFamily, card: { bg: css('main').backgroundColor, border: b('main'), radius: css('main').borderTopLeftRadius, shadow: css('main').boxShadow },
      start: { bg: css('#start').backgroundColor, border: b('#start'), h: h('#start') }, invite: { bg: css('#invite').backgroundColor, border: b('#invite'), h: h('#invite') },
      home: h('#home') };
  });
  let lk = await look();
  check(/^Onest\b/.test(lk.text.replace(/["']/g, '')) && /^Unbounded\b/.test(lk.title.replace(/["']/g, '')), 'Onest for its words, Unbounded for its title', [lk.text, lk.title]);
  check(lk.card.bg === PAPER && lk.card.border === '3px solid ' + INK && lk.card.radius === '18px' && /^rgb\(255, 79, 163\) 6px 6px 0px\b.*, rgb\(43, 108, 240\) -6px -6px 0px\b/.test(lk.card.shadow),
    'a paper card: a 3 px ink border, 18 px corners, the pink and blue shadows', lk.card);
  check(lk.start.bg === YELLOW && lk.start.border === '3px solid ' + INK && lk.start.h >= 44, '«Почати»: the yellow one, an ink border', lk.start);
  check(lk.invite.bg !== YELLOW && [PAPER, 'rgb(255, 255, 255)'].includes(lk.invite.bg) && lk.invite.border === '3px solid ' + INK && lk.invite.h >= 44, '«Запросити друзів»: a paper one', lk.invite);
  check(lk.home >= 44, '«← Усі ігри»: 44 px at least, for a finger', lk.home);
  if (CHROMIUM) {                                         // (:active under Playwright's mouse: checked where it is sure)
    await p.hover('#start');
    await p.mouse.down();
    await w(300);
    const sunk = await p.evaluate(() => getComputedStyle(document.getElementById('start')).transform);
    await p.mouse.move(0, 0);
    await p.mouse.up();
    check(sunk === 'matrix(1, 0, 0, 1, 3, 3)', 'pressed, «Почати» sinks 3 px', sunk);
  }
  check(lk.scheme === 'light' && lk.page === PAGE && lk.ink === INK, 'light: the library\'s page and ink', lk);
  await p.emulateMedia({ colorScheme: 'dark' });
  lk = await look();
  check(lk.scheme === 'light' && lk.page === PAGE && lk.ink === INK && lk.card.bg === PAPER && lk.start.bg === YELLOW, '… and the same when the system is dark (light only)', lk);

  step('a round on a phone lying down (844×390), the waiting screen on a small phone (320×568)');
  p = await open();
  await p.setViewportSize({ width: 844, height: 390 });
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  let at = { say: await box(p, '#say-text'), steps: await box(p, '#steps'), quit: await box(p, '#quit'), wide: await wideOf(p) };
  check((await view(p)).say === 'Твій хід' && inView(at.say) && inView(at.steps) && inView(at.quit) && at.wide === 844,
    '844×390, a round: «Твій хід», the steps and «Вийти з раунду» all in view, nothing wider', at);
  await p.setViewportSize({ width: 320, height: 568 });
  await says(p, 'link');
  at = { wait: await box(p, 'ihroteka-wait'), steps: await box(p, '#steps'), quit: await box(p, '#quit'), wide: await wideOf(p) };
  check(inView(at.wait) && inView(at.steps) && inView(at.quit) && at.wide === 320,
    '320×568, a round, the library\'s screen says whom it waits for («Чекаємо, поки повернеться Богдан…», «Не чекати»): in view, with the steps and «Вийти з раунду»', at);
  p = await open();
  await p.setViewportSize({ width: 320, height: 568 });
  await L(p, { linked: false, players: ['Богдан', 'Сава'], waiting: ['Аня'], seated: false });
  await emit(p, 'players', ['Богдан', 'Сава']);
  await says(p, 'seat');
  at = await box(p, 'ihroteka-wait');
  check((await view(p)).lobby && inView(at), '320×568, the lobby, «Ти чекаєш на місце» / «Грають зараз: …»: in view', at);

  step('the line quiet while the library says whom it waits for; «(ти)» after the end; the chips in place');
  p = await open();
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  await p.evaluate(() => { for (const li of document.querySelectorAll('#seats li')) li.dataset.was = li.textContent; });
  const chips = () => p.evaluate(() => [...document.querySelectorAll('#seats li')].map(li => ({ text: li.textContent, was: li.dataset.was || null, cls: li.className })));
  await p.click('#steps button[data-n="1"]');
  let ch = await chips();
  check((await view(p)).say === 'Хід: Богдан' && ch.length === 2 && ch.every(c => c.was === c.text) && ch[1].cls === 'turn', 'Аня +1: the same two chips (updated in place, not made anew), Богдан\'s marks the turn', ch);
  await says(p, 'link');
  v = await view(p);
  ch = await chips();
  check(v.say === '' && ch[1].cls === 'turn', 'the library\'s screen says whom it waits for: the line is quiet (the chip still marks whose turn it is)', [v, ch]);
  await says(p, 'version');
  check((await view(p)).say === 'Хід: Богдан', 'it says another version (no wait): the line again', await view(p));
  await says(p);
  check((await view(p)).say === 'Хід: Богдан', 'it says nothing: the line', await view(p));
  await emit(p, 'message', { t: 'move', id: ID, n: 2, at: 1 }, 'Богдан');
  await emit(p, 'message', { t: 'newer', round: rnd({ total: 8, moves: 5, turn: 0 }) }, 'Богдан');
  await p.click('#steps button[data-n="2"]');
  await L(p, { round: { active: false } });
  await remit(p, 'end', { id: ID, by: 'Аня', reason: 'over', result: (await got(p)).overs[0] });
  await says(p, 'link');
  await w(300);
  v = await view(p);
  ch = await chips();
  const won = await p.evaluate(() => {
    const li = document.querySelector('#seats li.won'), mark = ['::before', '::after'].map(x => getComputedStyle(li, x)).find(s => s.content !== 'none' && s.content !== 'normal' && parseFloat(s.width) > 0);
    return li && { bg: getComputedStyle(li).backgroundColor, mark: !!mark };
  });
  check(v.say === 'Перемога твоя!' && v.seats.join() === 'Аня (ти),Богдан' && ch.every(c => c.was === c.text), 'the end: «Перемога твоя!» (said, whoever is waited for), «Аня (ти)» kept, the same chips', [v, ch]);
  check(won && won.bg === 'rgb(201, 242, 212)' && won.mark, 'the winner\'s chip: mint, with a ✓', won);

  step('motion in the library: forward into the round, back with the reason, the total rolls up, what moved glides');
  p = await open();
  await inLibrary(p);
  const line = await box(p, '#say');
  await p.click('#start');
  await p.keyboard.press('2');
  v = await view(p);
  let mv = await moved(p);
  check(v.play && v.total === 2 && v.say === 'Хід: Гравець 2', 'the state first: Start, then a key mid-entry: the round on, +2 at once', v);
  check(named(mv, 'play', 'ihk-fwd') && named(mv, 'total', 'ihk-up'), 'the round comes in forward (ihk-fwd), its total rolls up (ihk-up)', mv);
  check(JSON.stringify(await box(p, '#say')) === JSON.stringify(line), 'the card keeps its height: the line under the round stays where it was in the lobby', [line, await box(p, '#say')]);
  await w(600);
  check(!(await running(p)).length, 'all over within 0.6 s', await running(p));
  p = await open();
  await inLibrary(p);
  const was = await box(p, '#start');
  await L(p, { linked: true, players: ['Аня', 'Сава'] });
  await emit(p, 'linked');
  v = await view(p);
  mv = await moved(p);
  await w(400);
  const now = await box(p, '#start');
  check(v.text === 'Грають: Аня, Сава.' && now.top < was.top && mv.some(a => a.on === 'start' && a.name === 'glide' && a.moves),
    'Сава comes: the lobby says less at once, and «Почати», moved up, glides there (glide)', [v.text, was, now, mv]);
  p = await open();
  await inLibrary(p);
  await L(p, { linked: true, players: AB, round: { active: true, id: ID, seats: AB, runner: 'Аня', runs: true } });
  await remit(p, 'run', { id: ID, seats: AB, setup: null, state: null });
  await moved(p);
  await L(p, { round: { active: false } });
  await remit(p, 'end', { id: ID, by: 'Богдан', reason: 'quit', result: null });
  v = await view(p);
  mv = await moved(p);
  check(v.lobby && v.say === 'Раунд перервано. Вийти вирішує: Богдан.' && named(mv, 'lobby', 'ihk-back'), 'Богдан quits: the lobby comes back (ihk-back), with the reason at once', [v, mv]);

  step('motion off, «менше руху», outside the library');
  p = await open();
  await inLibrary(p, true);
  await p.click('#start');
  await p.keyboard.press('2');
  mv = await moved(p);
  const added = await p.evaluate(() => [...document.querySelectorAll('[class*="ihk-"], [style*="animation"], [style*="transform"]')].map(e => e.id || e.localName));
  check((await view(p)).total === 2 && !mv.length && !added.length, 'motion off (html[data-motion=off]): the same state, nothing moves, nothing added to the page', [mv, added]);
  p = await open();
  await p.emulateMedia({ reducedMotion: 'reduce' });
  await inLibrary(p);
  await p.click('#start');
  await p.keyboard.press('2');
  mv = await moved(p);
  check((await view(p)).total === 2 && mv.length && !mv.some(a => a.moves || a.name === 'glide'), '«менше руху»: fades only (nothing moves or scales, nothing glides)', mv);
  p = await open();
  await p.evaluate(RECORD);
  await p.click('#start');
  await p.keyboard.press('2');
  mv = await moved(p);
  check((await view(p)).total === 2 && !mv.length, 'outside the library: nothing moves by itself', mv);
}, { timeout: 120000 });
