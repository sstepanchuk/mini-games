// tags: @ci
// nearname: nearby, no internet. Ганна (who showed the code first: the phone that holds the room) and Гліб are
// together; a third phone comes in under the name Ганна. The host says no: the pairing ends at once, on both phones,
// with «Це ім’я вже в кімнаті» (net/nearby.js: status 'failed' with room.pair.reason 'name'; the dialog: invite.js),
// not after a long while with a reason that is not true. Ганна and Гліб stay together, and on the newcomer's phone
// «Спробувати ще» asks for another name. The same before Гліб, with Ганна alone: on her phone «Спробувати ще» goes back
// to showing a code (her name is not the one to change). (A guest's name from another phone takes that place over:
// tests/net.)
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState } = require('./support/pages.cjs');

const TAKEN = /Це ім’я вже в кімнаті/;

scenario('nearname: a name already in a nearby room', async () => {
  const H = await phone('hhhhhhhhhhhh', 'Ганна'), G = await phone('gggggggggggg', 'Гліб'), X = await phone('xxxxxxxxxxxx', 'Ганна');

  step('another phone as Ганна pairs with Ганна, still alone');
  await pair(H, X);
  const first = await until(async () => TAKEN.test(await H.text()) && TAKEN.test(await X.text()), 15000, 300);
  check(first, 'the pairing ends at once, on both phones, with «Це ім’я вже в кімнаті»', { Ганна: await H.text(), newcomer: await X.text() });
  await H.p.click('.dialog >> text=Спробувати ще');
  check(await until(async () => /Показати код/.test(await H.text()) && !(await H.p.isVisible('.dialog input.link')), 5000),
    'on Ганна’s phone, «Спробувати ще» goes back to showing a code (no new name for her)', await H.text());
  await X.p.click('.dialog >> text=Спробувати ще');
  check(await until(async () => /Як тебе звати/.test(await X.text()), 5000), 'on the newcomer’s phone, it asks for another name', await X.text());
  for (const Y of [H, X]) { await Y.p.click('.dialog >> text=Закрити'); await until(async () => !(await Y.p.$('.backdrop')), 5000); }

  step('Ганна pairs with Гліб');
  await pair(H, G);
  check(await allLinked([H, G], 15000), 'linked', [await libState(H.p), await libState(G.p)]);
  await until(async () => !(await H.p.$('.backdrop')), 5000);   // (the dialog closes by itself)

  step('another phone comes in as Ганна');
  await pair(H, X, { adding: true });
  // (before phase 1b, C3, the host ignored such a hello and the pairing timed out, saying the network kept them apart)
  const told = await until(async () => TAKEN.test(await H.text()) && TAKEN.test(await X.text()), 15000, 300);
  if (!check(told, 'the pairing ends at once, on both phones, with «Це ім’я вже в кімнаті»', { Ганна: await H.text(), newcomer: await X.text() })) return;
  const st = [await libState(H.p), await libState(G.p)];
  check(st.every(s => s.linked && s.players.join() === 'Ганна,Гліб'), 'Ганна and Гліб stay together, the same two', st);
  check(!(await libState(X.p)).linked, 'the newcomer is not in the room', await libState(X.p));
  await X.p.click('.dialog >> text=Спробувати ще');
  check(await until(async () => /Як тебе звати/.test(await X.text()), 5000), 'on the newcomer’s phone, «Спробувати ще» asks for another name', await X.text());
}, { timeout: 120000 });
