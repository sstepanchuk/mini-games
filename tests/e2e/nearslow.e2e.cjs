// tags: @ci
// nearslow: nearby, a friend slow to read the guest's code (owner, decision 30). Гліб shows his code (step 2) and
// Ганна does not scan it for longer than the guest waits (TIMING.PAIR_WAIT: 90 s, here 5 s on Гліб's phone). His
// phone and hers already reach each other (only the scan is missing), so the pairing does not end: «Чекаю на
// з’єднання…» becomes «Друг ще не зчитав твій код — хай наведе на нього камеру», never «Не вдалося з’єднатися», and
// «Скасувати» stays. Then she scans it, late, and they are together. (net/nearby.js: pair.slow, event 'pair'.)
'use strict';
const { scenario, check, step, until, w } = require('./support/scenario.cjs');
const { phone, allLinked, libState } = require('./support/pages.cjs');

const WAIT = 5000, HINT = 'Друг ще не зчитав твій код — хай наведе на нього камеру';
// (before the library: config.js takes __timing only with a __timeScale, so one that changes nothing else)
function SHORT(ms) { window.__timeScale = 1 + 1e-9; window.__timing = { PAIR_WAIT: ms }; }

scenario('nearslow: a code read late still links, saying why it waits', async () => {
  const H = await phone('hhhhhhhhhhhh', 'Ганна'), G = await phone('gggggggggggg', 'Гліб', { init: [[SHORT, WAIT]] });

  step('Ганна shows her code, Гліб scans it and shows his');
  await H.together(); await H.nearby();
  await H.p.click('text=Показати код');
  const offer = await H.code();
  await G.together(); await G.nearby();
  await G.p.click('text=Сканувати код');
  await G.p.waitForSelector('video.scan');
  await G.paste(offer);
  const answer = await G.code();
  check(/Чекаю на з’єднання…/.test(await G.text()), 'Гліб: «Чекаю на з’єднання…»', await G.text());

  step('nobody scans it for longer than Гліб waits');
  const said = await until(async () => (await G.text()).includes(HINT), WAIT + 15000, 200);
  let t = await G.text();
  check(said, 'then: «' + HINT + '»', t);
  check(!/Чекаю на з’єднання…/.test(t) && /Скасувати/.test(t), '… instead of «Чекаю на з’єднання…»; «Скасувати» stays', t);
  await w(WAIT + 1000);
  t = await G.text();
  check(t.includes(HINT) && !/Не вдалося з’єднатися/.test(t), 'a while later: still waiting, never «Не вдалося з’єднатися»', t);
  check((await libState(G.p)).kind === 'nearby', 'his pairing is still on', await libState(G.p));

  step('Ганна scans it, late');
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(answer);
  check(await allLinked([H, G], 20000), 'together', [await libState(H.p), await libState(G.p)]);
}, { timeout: 120000 });
