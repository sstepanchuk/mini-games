// tags: @ci @webkit
// nortc: a browser that cannot link directly (no WebRTC: Tor Browser, or WebRTC turned off). Nearby needs it, so the
// nearby screen says so at once (owner, decision 30): «Цей браузер не вміє з’єднуватися напряму: відкрий Ігротеку в
// Chrome, Safari чи Firefox», and offers neither «Показати код» nor «Сканувати код» (before: a code shown, then the
// network blamed, or «Це не той код» over and over). With internet, «Через посилання» still works (through the
// brokers): the screen leads back to it.
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { phone } = require('./support/pages.cjs');

const SAY = 'Цей браузер не вміє з’єднуватися напряму: відкрий Ігротеку в Chrome, Safari чи Firefox';

scenario('nortc: no WebRTC, nearby says so up front', async () => {
  step('no internet: straight to nearby');
  const X = await phone('xxxxxxxxxxxx', 'Ксеня', { net: { relayOnly: true } });
  check(await X.p.evaluate(() => typeof RTCPeerConnection !== 'function'), '(this browser has no WebRTC)');
  await X.p.click('#together');
  await X.p.fill('.dialog input.link', 'Ксеня');
  await X.p.press('.dialog input.link', 'Enter');
  let ok = await until(async () => /Поруч, без інтернету/.test(await X.text()), 10000);
  let t = await X.text();
  check(ok && t.includes(SAY), 'the nearby screen says: «' + SAY + '»', t);
  check(!/Показати код/.test(t) && !/Сканувати код/.test(t), 'no code to show, none to scan', t);
  await X.b.close();

  step('with internet: the link still works');
  const Y = await phone('yyyyyyyyyyyy', 'Ярема', { internet: true, net: { relayOnly: true } });
  await Y.together();
  await Y.p.waitForSelector('text=Через посилання');
  await Y.p.click('text=Поруч, без інтернету');
  ok = await until(async () => (await Y.text()).includes(SAY), 5000);
  t = await Y.text();
  check(ok && !/Показати код/.test(t) && !/Сканувати код/.test(t), 'nearby: the same words, nothing to show or scan', t);
  await Y.p.click('.dialog >> text=Назад');
  check(await until(async () => /Через посилання/.test(await Y.text()), 5000), '«Назад»: «Через посилання» again', await Y.text());
}, { timeout: 90000 });
