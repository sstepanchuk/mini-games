// tags: @ci @webkit
// taken: two people with one name (owner, decision 44). Аня and Богдан are together over a link on one device (a
// browser context); someone opens the same link on another device (another context: its own storage, the same
// network) and comes in as «Богдан» while Богдан's page is still on the line. Before anyone's place moves, the new
// device asks: «Богдан уже грає в кімнаті з іншого пристрою. Це ти?». «Так, грати тут» takes the place over: the old
// page says «Ти граєш деінде» and offers «Інше ім’я» first, which brings it back as «Богдан Б», a third player. From
// the start again, «Інше ім’я» on the new device: it comes in as «Богдан Б» while the first Богдан keeps his place.
// (The same browser moving to a new tab is not asked: tests/e2e/tabs.e2e.cjs.)
'use strict';
const { scenario, launch, check, step, until, U } = require('./support/scenario.cjs');
const { openPage, createLink, enterName, libState, dialogText, oneNetwork, short } = require('./support/pages.cjs');

const ASK = /Богдан уже грає в кімнаті з іншого пристрою\. Це ти\?/;

scenario('taken: the same name from another device while its place is live: asked first', async () => {
  const b = await launch();
  for (const answer of ['Так, грати тут', 'Інше ім’я']) {
    step('Аня and Богдан together on one device; «Богдан» opens the link on another (then: «' + answer + '»)');
    const one = await b.newContext({ viewport: { width: 800, height: 650 } }), two = await b.newContext({ viewport: { width: 800, height: 650 } });
    await oneNetwork(one, two);
    const A = await openPage(one, 'aaaaaaaaaaaa', U, { label: 'Аня' });
    const link = await createLink(A, 'Аня');
    const B = await openPage(one, 'bbbbbbbbbbbb', link, { name: 'Богдан', label: 'Богдан' });
    const together = (ps, names) => async () => { const s = await Promise.all(ps.map(libState)); return s.every(x => x.linked && x.players.join() === names && !x.away.length); };
    check(await until(together([A, B], 'Аня,Богдан'), 15000), 'Аня and Богдан together', [await short(A), await short(B)]);
    await A.keyboard.press('Escape').catch(() => {});

    const N = await openPage(two, 'nnnnnnnnnnnn', link, { name: 'Богдан', label: 'Богдан (another device)' });
    check(await until(async () => ASK.test(await dialogText(N)), 10000), 'the new device asks: «Богдан уже грає в кімнаті з іншого пристрою. Це ти?»', await dialogText(N));
    const t = await dialogText(N);
    check(/Так, грати тут/.test(t) && /Інше ім’я/.test(t), '… with «Так, грати тут» and «Інше ім’я»', t);
    const n = await libState(N);
    check(!n.linked && n.status === 'taken', 'the new device is not in the room meanwhile (status taken)', await short(N));
    check(await together([A, B], 'Аня,Богдан')(), 'nobody moved: Богдан’s page still holds his place', [await short(A), await short(B)]);

    if (answer === 'Так, грати тут') {
      await N.click('.dialog >> text=Так, грати тут');
      check(await until(together([A, N], 'Аня,Богдан'), 15000), 'the new device takes Богдан’s place', [await short(A), await short(N)]);
      check(await until(async () => /Ти граєш деінде/.test(await dialogText(B)), 5000), 'the old page says «Ти граєш деінде»', await dialogText(B));
      const o = await dialogText(B);
      check(/Під іменем «Богдан» щойно увійшли з іншої вкладки або з іншого пристрою, тож гра продовжується там\. Якщо це не ти — увійди під іншим ім’ям\./.test(o), '… says what happened, without saying who it was', o);
      check(/Інше ім’я.*Повернути сюди.*Закрити/.test(o), '… «Інше ім’я» first, then «Повернути сюди» and «Закрити»', o);
      step('the old page: «Інше ім’я» → «Богдан Б»');
      await B.click('.dialog >> text=Інше ім’я');
      await enterName(B, 'Богдан Б');
      check(await until(together([A, N, B], 'Аня,Богдан,Богдан Б'), 15000), 'three players: Аня, Богдан (the new device) and Богдан Б', [await short(A), await short(N), await short(B)]);
      check((await libState(B)).me === 'Богдан Б' && (await libState(N)).me === 'Богдан', 'each under its own name', [await short(B), await short(N)]);
    } else {
      await N.click('.dialog >> text=Інше ім’я');
      await enterName(N, 'Богдан Б');
      check(await until(together([A, B, N], 'Аня,Богдан,Богдан Б'), 15000), 'the new device comes in as Богдан Б, a third player', [await short(A), await short(B), await short(N)]);
      check((await libState(B)).me === 'Богдан' && !/Ти граєш деінде/.test(await dialogText(B)), 'the first Богдан keeps his place, told nothing', [await short(B), await dialogText(B)]);
    }
    await one.close(); await two.close();
  }
}, { timeout: 180000 });
