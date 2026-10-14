// tags: @ci @webkit
// proto: friends whose libraries speak different wire versions (net/config.js PROTO; owner, decisions 9 and 37). Аня's
// page runs the library with PROTO + 1 (its bundle rewritten on the way): the two rooms on one code do not link;
// Богдан's page, the older, reloads itself back into the room (no name asked), once only, and is still not linked; each
// page says its own part: Аня's chip «У друга старіша версія» and her dialog «У друга старіша версія — хай оновить
// сторінку» (never «онови сторінку» to her, nor «Оновити»), Богдан's chip «У друга новіша версія» and his dialog «У
// друга новіша версія — онови сторінку» with «Оновити».
'use strict';
const { U, w, launch, watch, scenario, check, until } = require('./support/scenario.cjs');
const { openPage, createLink, dialogText, libState } = require('./support/pages.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const OLDER = 'У друга новіша версія — онови сторінку.', NEWER = 'У друга старіша версія — хай оновить сторінку.';

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
  check(await chip(pa) === 'У друга старіша версія' && await chip(pb) === 'У друга новіша версія', 'each chip says its side', [await chip(pa), await chip(pb)]);
  const buttons = p => p.$$eval('.dialog button:not([hidden])', b => b.map(x => x.textContent));
  const da = await dialogText(pa);
  check(da.includes(NEWER) && !/онови сторінку/i.test(da) && !(await buttons(pa)).includes('Оновити'), 'Аня\'s open dialog: «' + NEWER + '», nothing to press', [da.slice(0, 300), await buttons(pa)]);
  await pb.click('#together');                           // (the link screen: the room is still waiting for its friend)
  await pb.waitForSelector('.dialog canvas.qr');
  const db = await dialogText(pb);
  check(db.includes(OLDER) && (await buttons(pb)).includes('Оновити'), 'Богдан\'s dialog: «' + OLDER + '» and «Оновити»', [db.slice(0, 300), await buttons(pb)]);
});
