// proto: friends whose libraries speak different wire versions (net/config.js PROTO; owner, decision 9). Аня's page
// runs the library with PROTO + 1 (its bundle rewritten on the way): the two rooms on one code do not link; both pages
// say «Онови сторінку — у друга інша версія»; Богдан's page, the older, reloads itself back into the room (no name
// asked), once only, and is still not linked; «Оновити» is never offered on Аня's, the newer.
'use strict';
const { U, w, launch, watch, scenario, check, until } = require('./support/scenario.cjs');
const { openPage, createLink, libState } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const UPDATE = /Онови сторінку — у друга інша версія/;

scenario('proto: a friend\'s library is newer', async () => {
  const ctx = await (await launch()).newContext();       // (one context: the fake network is shared by its pages)
  const pa = watch(await ctx.newPage(), 'Аня');
  let proto = 0;
  await pa.route('**/lib/ihroteka.js*', async route => {   // this page's library says PROTO + 1
    const r = await route.fetch();
    const js = (await r.text()).replace(/\b(var|let|const) PROTO = (\d+);/, (_, k, n) => k + ' PROTO = ' + (proto = +n + 1) + ';');
    await route.fulfill({ response: r, body: js });
  });
  await pa.addInitScript(fakeNet('aaaaaaaaaaaa'));
  await pa.goto(U);
  await pa.waitForSelector('#shelf:not([hidden])');
  check(proto > 1, 'Аня\'s library runs with PROTO + 1', proto);
  const link = await createLink(pa, 'Аня');
  const pb = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  let loads = 0;
  pb.on('load', () => loads++);
  const back = await until(async () => loads >= 1 && await pb.evaluate(() => !!window.__ihroteka) && (await libState(pb)).version.gap?.older && loads, 20000);
  check(back, 'Богдан\'s page (the older) reloads itself, back in the room', { loads });
  check(!await pb.isVisible('.dialog input.link'), 'without being asked the name again');
  await w(3000);
  check(loads === 1, 'once: not again for the same version', loads);
  const [sa, sb] = [await libState(pa), await libState(pb)];
  check(!sa.linked && !sb.linked && sa.players.join() === 'Аня' && sb.players.join() === 'Богдан', 'not linked: each alone in a room of its own', [sa.players, sb.players]);
  check(sb.version.gap?.why === 'proto' && sb.version.gap.older && sb.version.gap.theirs === proto, 'Богдан\'s page knows it is the older', sb.version);
  check(sa.version.gap?.why === 'proto' && !sa.version.gap.older && sa.version.gap.theirs === proto - 1 && !sa.version.offer, 'Аня\'s knows it is the newer: no «Оновити»', sa.version);
  check(sa.status === 'version' && sb.status === 'version', 'both rooms say \'version\'', [sa.status, sb.status]);
  const chip = p => p.evaluate(() => document.getElementById('together').textContent);
  check(UPDATE.test(await chip(pa)) && UPDATE.test(await chip(pb)), 'both pages say it', [await chip(pa), await chip(pb)]);
  const dialog = await pa.evaluate(() => document.querySelector('.dialog')?.innerText || '');
  check(UPDATE.test(dialog), 'Аня\'s open dialog says it too', dialog.replace(/\s+/g, ' ').slice(0, 200));
});
