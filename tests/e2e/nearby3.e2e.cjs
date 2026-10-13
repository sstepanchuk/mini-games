// tags: @ci
// Nearby, three devices with no internet (three browsers, real WebRTC, no brokers): the host pairs with one guest,
// then adds another; the guests hear each other through the host; a game one guest opens is followed by everyone,
// its seats going to the first players in the room's order (the rest wait). Then the host's phone is gone: the
// guests keep the room and wait for it (its place is kept). The one who played with it sees the card «Чекаємо на
// Ганна…» with «З’єднатися знову» and «Не чекати»; nothing goes on without the phone that holds the room, so «Не
// чекати» ends the room on that phone, saying so (owner, decision 5).
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState, frameOf, waitCard } = require('./support/pages.cjs');

scenario('nearby3: three phones without internet', async () => {
  const H = await phone('hhhhhhhhhhhh', 'Ганна'), G1 = await phone('gggggggggggg', 'Гліб'), G2 = await phone('kkkkkkkkkkkk', 'Кіра');
  const ALL = [H, G1, G2], ROSTER = 'Ганна,Гліб,Кіра';

  step('Ганна pairs with Гліб');
  await pair(H, G1);
  check(await allLinked([H, G1], 15000), 'linked', [await libState(H.p), await libState(G1.p)]);
  check((await libState(H.p)).players.join() === 'Ганна,Гліб' && (await libState(G1.p)).kind === 'nearby', 'a nearby room of two');

  step('Ганна adds Кіра');
  await until(async () => !(await H.p.$('.backdrop')), 5000);   // (the dialog closes by itself)
  await pair(H, G2, { adding: true });
  const three = async () => (await Promise.all(ALL.map(x => libState(x.p)))).every(s => s.linked && s.players.join() === ROSTER);
  check(await until(three, 20000), 'all three linked, the same roster: ' + ROSTER, await Promise.all(ALL.map(x => libState(x.p))));
  for (const X of ALL) check(/^Разом 3/.test(await X.p.textContent('#together')), X.name + '’s chip: «Разом 3 …»', await X.p.textContent('#together'));

  step('Кіра opens a game; everyone follows');
  if (!(await G2.p.$('.game'))) { check(false, 'a game on the shelf (the dev server serves games/)'); return; }
  await G2.p.click('.game');
  const frames = [];
  for (const X of ALL) frames.push(await frameOf(X.p).catch(() => null));
  if (!check(frames.every(Boolean), 'the game is open on all three (a locked game, as on the assembled site, cannot)')) return;
  const id = (await libState(G2.p)).view, max = await frames[2].evaluate(() => window.ihroteka.game.players.max);
  const st = await Promise.all(ALL.map(x => libState(x.p)));
  check(st.every(s => s.view === id && s.myHere === id), 'everyone’s view: ' + id, st.map(s => [s.view, s.myHere]));
  check(await until(async () => (await libState(G1.p)).here['Кіра'] === id, 5000), 'Гліб knows that Кіра has it open (through the host)', (await libState(G1.p)).here);
  const seated = ROSTER.split(',').slice(0, max), waiting = ROSTER.split(',').slice(max);
  const seats = async () => (await Promise.all(ALL.map(x => libState(x.p)))).every(s => s.game && s.game.players.join() === seated.join() && s.game.waiting.join() === waiting.join());
  check(await until(seats, 10000), 'its ' + max + ' seats: ' + seated.join(', ') + (waiting.length ? '; waiting: ' + waiting.join(', ') : ''), (await Promise.all(ALL.map(x => libState(x.p)))).map(s => s.game));
  const g = (await Promise.all(ALL.map(x => libState(x.p)))).map(s => s.game);
  check(g.every((x, i) => x.linked === (i < max)), 'linked in the game: those with a seat', g);

  step('Ганна’s phone is gone');
  await H.b.close();
  // (cut off from the phone that holds the room, a guest cannot vouch for anyone else either: since phase 1b the others
  // count as away too, net/room.js presence)
  const kept = async () => (await Promise.all([G1, G2].map(x => libState(x.p)))).every(s => s.kind === 'nearby' && s.players.join() === ROSTER && s.away.includes('Ганна'));
  check(await until(kept, 15000), 'the guests keep the room; Ганна is away (her place kept)', await Promise.all([G1, G2].map(x => libState(x.p))));
  for (const X of [G1, G2]) check(/зв’язок зник/.test(await X.p.textContent('#together')), X.name + '’s chip: «Разом · зв’язок зник…»', await X.p.textContent('#together'));

  step('Гліб, who played with Ганна, does not wait for her phone');
  const c = await until(async () => { const x = await waitCard(G1.p); return x.shown && /^Чекаємо на Ганна… \d+:\d\d/.test(x.text) && x; }, 10000);
  check(c, 'Гліб’s card: «Чекаємо на Ганна… m:ss»', await waitCard(G1.p));
  check(c && c.buttons.join() === 'З’єднатися знову,Не чекати', '… with «З’єднатися знову» and «Не чекати»', c && c.buttons);
  if (max < 3) check(!(await waitCard(G2.p)).shown, 'Кіра, waiting for a seat, has no card', await waitCard(G2.p));
  await G1.p.click('#waiting >> text=Не чекати');
  check(await until(async () => !(await libState(G1.p)).kind, 5000), 'the nearby room ends on Гліб’s phone', await libState(G1.p));
  check(await until(async () => /Без телефона Ганна кімната поруч далі не може/.test(await G1.text()), 5000), 'saying «Без телефона Ганна кімната поруч далі не може»', await G1.text());
  check(!(await waitCard(G1.p)).shown, 'no card any more', await waitCard(G1.p));
}, { timeout: 150000 });
