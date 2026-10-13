// tags: @ci @webkit
// Net level, four players over the internet: one roster for everyone, the host passing messages on, a message to
// one player only, the host leaving (the first player still here takes over, the old host keeps its place), and a
// guest reloading (a new tab of the same player: back in their place, the others told 'relinked').
'use strict';
const { scenario, launch, check, step, until, w } = require('./support/scenario.cjs');
const { netPage, join, rooms, show } = require('./support/net.cjs');

scenario('multi: four players, forwarding, the host leaving, a reload', async () => {
  const ctx = await (await launch()).newContext();
  const open = async (pid, name) => { const p = await netPage(ctx, pid, name); await join(p, 'room42', name); return p; };
  const got = p => p.evaluate(() => window.got.slice());
  const ev = p => p.evaluate(() => window.ev.slice());
  const A = await open('aaaaaaaaaaaa', 'Аня');
  await w(1800);                                         // Аня hosts
  const B = await open('bbbbbbbbbbbb', 'Богдан'), C = await open('cccccccccccc', 'Сава'), D = await open('dddddddddddd', 'Дана');
  const NAMES = ['Аня', 'Богдан', 'Сава', 'Дана'];

  step('four players joined');
  const same = ps => async () => { const r = await rooms(ps); return r.every(x => x.linked && x.players.length === 4 && x.players.join() === r[0].players.join()); };
  check(await until(same([A, B, C, D]), 15000), 'everyone linked, with the same four players in the same order', (await rooms([A, B, C, D])).map(show));
  const r0 = await rooms([A, B, C, D]);
  check(r0[0].players[0] === 'Аня' && NAMES.every(n => r0[0].players.includes(n)), 'the roster: Аня first, then the others as they came', r0[0].players);
  check(r0.map(r => r.role).join() === 'host,guest,guest,guest', 'Аня hosts, the others are guests', r0.map(r => r.role));
  check((await ev(A)).filter(e => e.startsWith('join')).length === 3, 'the host saw three joins', await ev(A));

  step('messages');
  await C.evaluate(() => window.R.send({ t: 'hi', n: 1 }));                  // a guest to everyone (through the host)
  await B.evaluate(() => window.R.send({ t: 'dm', n: 2 }, { to: 'Дана' }));  // a guest to one other guest
  await A.evaluate(() => window.R.send({ t: 'all', n: 3 }));                 // the host to everyone
  const want = { A: ['Сава:hi1'], B: ['Сава:hi1', 'Аня:all3'], C: ['Аня:all3'], D: ['Сава:hi1', 'Богдан:dm2', 'Аня:all3'] };
  const sorted = a => a.slice().sort().join(' ');
  const all = { A, B, C, D };
  await until(async () => { for (const n in want) if (sorted(await got(all[n])) !== sorted(want[n])) return false; return true; }, 5000);
  await w(500);
  for (const n in want) check(sorted(await got(all[n])) === sorted(want[n]), n + ' got exactly ' + want[n].join(', '), await got(all[n]));

  step('the host (Аня) closes her tab');
  await A.close();
  const after = async () => { const r = await rooms([B, C, D]); return r.every(x => x.linked) && r.filter(x => x.role === 'host').length === 1 && r.every(x => x.players.join() === r[0].players.join()); };
  check(await until(after, 20000), 'the others are linked again, with one host', (await rooms([B, C, D])).map(show));
  const r1 = await rooms([B, C, D]), first = r0[0].players.find(n => n !== 'Аня'), idx = { Богдан: 0, Сава: 1, Дана: 2 }[first];
  check(r1[idx].role === 'host', 'the first player still here (' + first + ') took over', r1.map(show));
  check(r1[0].players.length === 4 && r1[0].players.includes('Аня') && r1[0].away.includes('Аня'), 'Аня keeps her place (away)', r1.map(show));

  step('Сава sends after the takeover');
  for (const p of [B, C, D]) await p.evaluate(() => { window.got.length = 0; });
  await C.evaluate(() => window.R.send({ t: 'after', n: 4 }));
  await until(async () => (await got(B)).length && (await got(D)).length, 5000);
  check((await got(B)).join() === 'Сава:after4' && (await got(D)).join() === 'Сава:after4', 'Богдан and Дана got it', [await got(B), await got(D)]);

  step('Дана reloads (a new tab of the same player)');
  await D.close();
  const D2 = await open('dddddddddddd', 'Дана');
  check(await until(async () => { const r = await rooms([B, C, D2]); return r.every(x => x.linked && x.players.length === 4) && !r[2].away.includes('Дана'); }, 15000),
    'Дана is back, linked, in the same room of four', (await rooms([B, C, D2])).map(show));
  const r2 = await rooms([B, C, D2]);
  check(r2[2].role === 'guest' && r2[2].players.join() === r1[0].players.join(), 'in her place (the roster unchanged), as a guest', r2.map(show));
  check((await until(async () => (await ev(C)).includes('relinked Дана true'), 5000)), 'the others were told: relinked Дана (a new tab)', await ev(C));
  await B.evaluate(() => window.R.send({ t: 'again', n: 5 }));
  check(await until(async () => (await got(D2)).includes('Богдан:again5'), 5000), 'and she gets messages again', await got(D2));
}, { timeout: 180000 });
