// tags: @ci @webkit
// A player who opened a room link waits for a friend; every broker drops and none can be reached (the network
// itself is still up, as on a hotspot without mobile data): the chip and the room's status say so. The brokers
// come back: waiting again.
'use strict';
const { scenario, launch, check, step, until, U } = require('./support/scenario.cjs');
const { openPage, libState } = require('./support/pages.cjs');

scenario('nosig: the status while no broker answers', async () => {
  const ctx = await (await launch()).newContext();
  const p = await openPage(ctx, 'aaaaaaaaaaaa', U + '?room=abcdef', { name: 'Аня' });
  const seen = async () => ({ chip: (await p.textContent('#together')).trim(), status: (await libState(p)).status, online: await p.evaluate(() => navigator.onLine) });
  const is = (chip, status) => async () => { const s = await seen(); return s.chip === chip && s.status === status; };

  step('waiting for a friend');
  check(await until(is('Чекаю на друга…', 'waiting'), 10000), 'the chip: «Чекаю на друга…», status waiting', await seen());
  check(await p.evaluate(() => new URLSearchParams(location.search).get('room')) === 'abcdef', 'the room stays in the address');

  step('no broker answers');
  await p.evaluate(() => window.__brokers(false));
  check(await until(is('Немає інтернету', 'no-signal'), 10000), 'the chip: «Немає інтернету», status no-signal', await seen());
  check((await seen()).online, '(navigator.onLine still says yes)');

  step('the brokers are back');
  await p.evaluate(() => window.__brokers(true));
  check(await until(is('Чекаю на друга…', 'waiting'), 15000), 'waiting again', await seen());
}, { timeout: 90000 });
