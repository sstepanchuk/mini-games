// tags: @ci @webkit
// Library level, one player in two tabs: Аня and Богдан are together (on the shelf); one of them (the host, then the
// guest) opens the room link again in a new tab of the same browser, with the same name. The new tab takes the
// place at once (the same browser: nobody is asked «Це ти?», tests/e2e/taken.e2e.cjs); the old one says «Ти граєш
// деінде» in words that fit anyone (owner, decision 41: «Під іменем «Аня» щойно увійшли…»), offers «Інше ім’я» and
// «Повернути сюди», which takes the place back. The friend stays with us all the time. Then the only friend's tab goes
// (its place kept): the shelf says whom we wait for, «Чекаємо, поки повернеться Богдан…», never «Друзі вийшли».
'use strict';
const { scenario, launch, check, step, until, w, U } = require('./support/scenario.cjs');
const { openPage, createLink, libState, dialogText, short } = require('./support/pages.cjs');

scenario('tabs: the same player in a new tab, and back', async () => {
  const b = await launch();
  for (const who of ['host', 'guest']) {
    const ctx = await b.newContext({ viewport: { width: 900, height: 650 } });
    const A = await openPage(ctx, 'aaaaaaaaaaaa', U, { label: 'Аня' });
    const link = await createLink(A, 'Аня');
    const B = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
    const pair = async (x, y) => { const s = [await libState(x), await libState(y)]; return s.every(v => v.linked && v.players.join() === 'Аня,Богдан' && !v.away.length); };
    check(await until(() => pair(A, B), 15000), 'Аня and Богдан together', [await short(A), await short(B)]);
    await A.keyboard.press('Escape').catch(() => {});

    const [old, friend, pid, name] = who === 'host' ? [A, B, 'aaaa2222aaaa', 'Аня'] : [B, A, 'bbbb2222bbbb', 'Богдан'];
    step(name + ' (the ' + who + ') opens the link in a new tab');
    const N2 = await openPage(ctx, pid, link, { name, label: name + ' (new tab)' });
    check(await until(() => pair(N2, friend), 15000), 'the new tab and the friend are together, nobody away', [await short(N2), await short(friend)]);
    check((await libState(N2)).me === name, 'the new tab is ' + name);
    check(await until(async () => /Ти граєш деінде/.test(await dialogText(old)), 5000), 'the old tab says «Ти граєш деінде»', await dialogText(old));
    const said = await dialogText(old);
    check(new RegExp('Під іменем «' + name + '» щойно увійшли з іншої вкладки або з іншого пристрою').test(said) && !/зайшов/.test(said),
      '«Під іменем «' + name + '» щойно увійшли…» (never «зайшов»)', said);
    check(/Інше ім’я.*Повернути сюди/.test(said), '… and offers «Інше ім’я» and «Повернути сюди»', said);
    const so = await libState(old);
    check(!so.linked && so.kind === null, 'the old tab left the room', await short(old));
    // (a host's new tab joins as a guest: the friend hosts the room meanwhile)
    check([(await libState(N2)).role, (await libState(friend)).role].sort().join() === 'guest,host', 'one of them hosts', [await short(N2), await short(friend)]);
    await w(2000);
    check(await pair(N2, friend), 'still together 2 s later', [await short(N2), await short(friend)]);

    step('«Повернути сюди» in the old tab');
    await old.click('text=Повернути сюди');
    check(await until(() => pair(old, friend), 15000), 'the old tab and the friend are together again', [await short(old), await short(friend)]);
    check(await until(async () => /Ти граєш деінде/.test(await dialogText(N2)), 5000), 'now the new tab says «Ти граєш деінде»', await dialogText(N2));
    check(!(await libState(N2)).linked, 'and is out of the room', await short(N2));
    check([(await libState(old)).role, (await libState(friend)).role].sort().join() === 'guest,host', 'one of them hosts', [await short(old), await short(friend)]);
    await w(2000);
    check(await pair(old, friend), 'still together 2 s later', [await short(old), await short(friend)]);
    await ctx.close();
  }

  step('the only friend’s tab goes, keeping his place');
  const ctx = await b.newContext({ viewport: { width: 900, height: 650 } });
  const A = await openPage(ctx, 'aaaaaaaaaaaa', U, { label: 'Аня' });
  const link = await createLink(A, 'Аня');
  const B = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
  check(await until(async () => (await libState(A)).linked && (await libState(B)).linked, 15000), 'Аня and Богдан together', [await short(A), await short(B)]);
  await A.keyboard.press('Escape').catch(() => {});
  await A.evaluate(() => {
    window.__said = [];
    new MutationObserver(() => { for (const t of document.querySelectorAll('.toast')) if (!window.__said.includes(t.textContent)) window.__said.push(t.textContent); })
      .observe(document.getElementById('layer'), { subtree: true, childList: true, characterData: true });
  });
  await B.goto('about:blank');                           // (pagehide: a goodbye that keeps his place)
  const said = () => A.evaluate(() => window.__said.map(t => t.replace(/[\u2066-\u2069]/g, '')));
  check(await until(async () => (await said()).includes('Чекаємо, поки повернеться Богдан…'), 10000), 'Аня’s shelf: «Чекаємо, поки повернеться Богдан…»', await said());
  const s = await libState(A);
  check(s.players.join() === 'Аня,Богдан' && s.away.join() === 'Богдан', '(his place is kept)', await short(A));
  check(!(await said()).some(t => /Друзі вийшли/.test(t)), 'never «Друзі вийшли»', await said());
}, { timeout: 180000 });
