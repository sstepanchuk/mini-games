// tags: @ci
// nearname: nearby, no internet. Ганна (who showed the code first: the phone that holds the room) and Гліб are
// together; a third phone comes in under the name Ганна. The host says no: the pairing ends at once, on both phones,
// with «Це ім’я вже в кімнаті» (net/nearby.js: status 'failed' with room.pair.reason 'name'; the dialog: invite.js),
// not after a long while with a reason that is not true. Ганна and Гліб stay together, and on the newcomer's phone
// «Спробувати ще» asks for another name. The same before Гліб, with Ганна alone: on her phone «Спробувати ще» goes back
// to showing a code (her name is not the one to change). Then the newcomer comes in under Гліб's name while Гліб's
// phone is still linked: it is asked first (owner, decision 44), «Гліб уже грає в кімнаті з іншого пристрою. Це ти?»;
// «Так, грати тут» takes his place, and his old phone says «Ти граєш деінде» with «Інше ім’я» (nearby: no «Повернути
// сюди»), which pairs it again as «Гліб Б», a third player.
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

  step('the newcomer comes in as Гліб, whose phone is still linked');
  await H.p.click('.dialog >> text=Спробувати ще');           // (Ганна shows a code again)
  const offer = await H.code();
  await X.p.fill('.dialog input.link', 'Гліб');
  await X.p.press('.dialog input.link', 'Enter');
  await X.p.click('text=Сканувати код');
  await X.p.waitForSelector('video.scan');
  await X.paste(offer);
  const reply = await X.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(reply);
  const ASK = /Гліб уже грає в кімнаті з іншого пристрою\. Це ти\?/;
  check(await until(async () => ASK.test(await X.text()), 15000, 300), 'the newcomer is asked: «Гліб уже грає в кімнаті з іншого пристрою. Це ти?»', await X.text());
  const two = async () => (await Promise.all([H, G].map(Y => libState(Y.p)))).every(s => s.linked && s.players.join() === 'Ганна,Гліб' && !s.away.length);
  check(await two(), 'nobody moved meanwhile: Гліб’s phone still holds his place', [await libState(H.p), await libState(G.p)]);
  await X.p.click('.dialog >> text=Так, грати тут');
  const moved = async () => (await libState(X.p)).linked && (await libState(X.p)).me === 'Гліб' && (await libState(H.p)).players.join() === 'Ганна,Гліб';
  check(await until(moved, 15000), '«Так, грати тут»: the newcomer is Гліб now, in his place', [await libState(H.p), await libState(X.p)]);
  check(await until(async () => /Ти граєш деінде/.test(await G.text()), 5000), 'Гліб’s old phone: «Ти граєш деінде»', await G.text());
  const said = await G.text();
  check(/Інше ім’я/.test(said) && !/Повернути сюди/.test(said), '… with «Інше ім’я» (nearby: no «Повернути сюди»)', said);

  step('the old phone: «Інше ім’я» → «Гліб Б», paired again');
  await G.p.click('.dialog >> text=Інше ім’я');
  await G.p.fill('.dialog input.link', 'Гліб Б');
  await G.p.press('.dialog input.link', 'Enter');
  await G.p.waitForSelector('video.scan');
  await until(async () => !(await H.p.$('.backdrop')), 5000);
  await H.together();
  await H.p.click('text=Додати гравця');
  const more = await H.code();
  await G.paste(more);
  const back = await G.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(back);
  const three = async () => (await Promise.all([H, X, G].map(Y => libState(Y.p)))).every(s => s.linked && s.players.join() === 'Ганна,Гліб,Гліб Б');
  check(await until(three, 20000), 'three players: Ганна, Гліб (the newcomer’s phone) and Гліб Б', await Promise.all([H, X, G].map(Y => libState(Y.p))));
}, { timeout: 180000 });
