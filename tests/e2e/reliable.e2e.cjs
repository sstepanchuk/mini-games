// Net level, three players over the internet (fake brokers, real direct links): reliable messages sent while a
// player is offline, switches networks, or while the room's host itself is offline all arrive afterwards, in
// order, exactly once; nobody loses their place.
'use strict';
const { scenario, launch, check, step, until, w } = require('./support/scenario.cjs');
const { netPage, join, rooms, show } = require('./support/net.cjs');

scenario('reliable: delivery across an outage, a network switch and the host offline', async () => {
  const ctx = await (await launch()).newContext();
  const open = async (pid, name) => { const p = await netPage(ctx, pid, name); await join(p, 'rel42', name); return p; };
  const A = await open('aaaaaaaaaaaa', 'Аня');
  await w(1500);                                         // Аня hosts
  const B = await open('bbbbbbbbbbbb', 'Богдан'), C = await open('cccccccccccc', 'Сава');
  const all = { A, B, C };
  const three = async () => (await rooms([A, B, C])).every(r => r.linked && r.players.length === 3 && !r.away.length);
  check(await until(three, 15000), 'three players linked', (await rooms([A, B, C])).map(show));
  check((await rooms([A]))[0].role === 'host', 'Аня hosts');

  const seq = from => Array.from({ length: 20 }, (_, i) => from + i + 1);
  for (const [label, victim, ms] of [['Богдан offline 6 s', B, 6000], ['Богдан switches networks', B, 0], ['the host (Аня) offline 6 s', A, 6000]]) {
    step(label);
    for (const p of [A, B, C]) await p.evaluate(() => { window.got.length = 0; });
    if (ms) await victim.evaluate(() => window.__net(false)); else await victim.evaluate(() => window.__switch(4000));
    for (let i = 1; i <= 20; i++) {                    // Аня sends 1…20, Сава 101…120, one by one, during the outage
      await A.evaluate(n => window.R.send({ t: 'x', n }), i);
      await C.evaluate(n => window.R.send({ t: 'x', n }), 100 + i);
      await w(Math.max(ms, 3000) / 20);
    }
    if (ms) await victim.evaluate(() => window.__net(true));
    // what each player must get: everything from each other sender
    const want = { A: { 'Сава': seq(100) }, B: { 'Аня': seq(0), 'Сава': seq(100) }, C: { 'Аня': seq(0) } };
    const got = async n => { const g = await all[n].evaluate(() => window.got.slice()); return Object.fromEntries(Object.keys(want[n]).map(f => [f, g.filter(x => x.startsWith(f + ':')).map(x => +x.slice(f.length + 2))])); };
    const done = async () => { for (const n of Object.keys(want)) if (JSON.stringify(await got(n)) !== JSON.stringify(want[n])) return false; return true; };
    await until(done, 20000, 500);
    await w(1000);                                       // (anything twice would come by now)
    for (const n of Object.keys(want)) {
      const g = await got(n);
      for (const f of Object.keys(want[n])) check(JSON.stringify(g[f]) === JSON.stringify(want[n][f]), n + ' got all 20 from ' + f + ', in order, once', g[f]);
    }
    check(await until(three, 15000), 'still three players, all linked, nobody away', (await rooms([A, B, C])).map(show));
  }
}, { timeout: 240000 });
