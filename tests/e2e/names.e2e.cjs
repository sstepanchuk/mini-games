// Net level, places by name: three players; messages by name; a new tab of the same name takes that place over (the
// old tab steps aside); the host offline long enough that another player takes over, then back as a guest; «Не
// чекати» (release) lets an away player's place go, and that player comes back as new; the host's name in yet
// another tab.
'use strict';
const { scenario, launch, check, step, until, w } = require('./support/scenario.cjs');
const { netPage, join, rooms, show } = require('./support/net.cjs');

scenario('names: places by name, takeover, the host away, «Не чекати», the host in another tab', async () => {
  const ctx = await (await launch()).newContext();
  const open = async (pid, name) => { const p = await netPage(ctx, pid, name); await join(p, 'names1', name); return p; };
  const got = p => p.evaluate(() => window.got.slice());
  const ev = p => p.evaluate(() => window.ev.slice());
  // all these pages linked, agreeing on the roster, exactly one of them hosting
  const settled = (ps, n) => async () => {
    const r = await rooms(ps);
    return r.every(x => x.linked && x.players.length === n && x.players.join() === r[0].players.join()) && r.filter(x => x.role === 'host').length === 1;
  };

  const A = await open('aaaa1111aaaa', 'Аня');
  await w(1500);
  const B = await open('bbbb2222bbbb', 'Богдан'), C = await open('cccc3333cccc', 'Сава');
  step('three players');
  check(await until(settled([A, B, C], 3), 15000), 'linked, one roster', (await rooms([A, B, C])).map(show));
  let r = await rooms([A, B, C]);
  check(r[0].role === 'host' && r[0].players[0] === 'Аня', 'Аня hosts and is first', r.map(show));

  await C.evaluate(() => window.R.send({ t: 'hey' }, { to: 'Богдан' }));
  await A.evaluate(() => window.R.send({ t: 'all' }));
  await until(async () => (await got(B)).length === 2 && (await got(C)).length === 1, 5000);
  await w(300);
  check((await got(B)).slice().sort().join() === 'Аня:all,Сава:hey', 'Богдан got the message to him by name, and the one to all', await got(B));
  check((await got(C)).join() === 'Аня:all' && !(await got(A)).length, 'nobody else got the one to Богдан', [await got(A), await got(C)]);

  step('Богдан opens another tab');
  const B2 = await open('bbbb9999bbbb', 'Богдан');
  check(await until(settled([A, B2, C], 3), 15000), 'the new tab is in, the roster still has three names', (await rooms([A, B2, C])).map(show));
  check(await until(async () => (await ev(B)).includes('replaced'), 5000), 'the old tab is told it was replaced', await ev(B));
  const old = (await rooms([B]))[0];
  check(old.role === 'out' && !old.linked, 'the old tab steps aside (out, not linked)', show(old));
  check((await ev(A)).includes('relinked Богдан true'), 'the host was told: relinked Богдан (a new tab)', await ev(A));
  check((await rooms([B2]))[0].role === 'guest', 'the new tab is a guest, like the old one');

  step('the host (Аня) offline 14 s');
  await A.evaluate(() => window.__net(false));
  await w(14000);
  r = await rooms([B2, C]);
  check(r.every(x => x.linked) && r.filter(x => x.role === 'host').length === 1, 'the others are linked, one of them hosts', r.map(show));
  check(r[0].role === 'host', 'Богдан (the first player still here) took over', r.map(show));
  check(r.every(x => x.players.length === 3 && x.away.join() === 'Аня'), 'Аня keeps her place (away)', r.map(show));

  step('Аня back');
  await A.evaluate(() => window.__net(true));
  check(await until(async () => (await settled([A, B2, C], 3)()) && !(await rooms([A, B2, C])).some(x => x.away.length), 20000),
    'all three linked, nobody away', (await rooms([A, B2, C])).map(show));
  r = await rooms([A, B2, C]);
  check(r[0].role === 'guest' && r[1].role === 'host', 'Аня joins as a guest; Богдан still hosts', r.map(show));

  step('Сава offline, then «Не чекати»');
  await C.evaluate(() => window.__net(false));
  check(await until(async () => (await rooms([A, B2])).every(x => x.away.includes('Сава')), 15000), 'Сава is away for the others', (await rooms([A, B2])).map(show));
  await B2.evaluate(() => window.R.release('Сава'));    // the host lets the place go
  check(await until(async () => (await rooms([A, B2])).every(x => x.players.join() === 'Аня,Богдан' && x.linked), 5000),
    'Сава is gone from the roster; Аня and Богдан still linked', (await rooms([A, B2])).map(show));

  step('Сава back (as new)');
  await C.evaluate(() => window.__net(true));
  check(await until(settled([A, B2, C], 3), 20000), 'all three linked again', (await rooms([A, B2, C])).map(show));
  r = await rooms([A, B2, C]);
  check(r[0].players[2] === 'Сава', 'Сава is at the end of the roster now', r.map(show));

  step('the host (Богдан) opens yet another tab');
  const H2 = await open('bbbb7777bbbb', 'Богдан');
  check(await until(settled([A, C, H2], 3), 20000), 'the new tab is in; three names, linked, one host', (await rooms([A, C, H2])).map(show));
  check(await until(async () => (await ev(B2)).includes('replaced'), 5000), 'the old host tab is told it was replaced', await ev(B2));
  const o = (await rooms([B2]))[0];
  check(o.role === 'out' && !o.linked, 'and steps aside', show(o));
  r = await rooms([A, C, H2]);
  check(r.every(x => !x.away.length), 'nobody away', r.map(show));
}, { timeout: 240000 });
