// tags: @ci
// prod cancel: «Скасувати» in the password dialog takes the room back to the shelf only from the player who opened the
// game; anyone else stays over it («Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.», with «Ввести пароль»,
// which asks again on that device only, and «До бібліотеки»), and the room stays in the game. On the assembled site
// (its games sealed: the password is asked, and none is needed to cancel it), with the fake network: Богдан follows
// Аня and cancels; his page reloads back into the room (as a version reload does: REJOIN) and he cancels; the same with
// what his reloaded page sends held 3 s (he cancels before the room's state reaches him); Кіра comes in by a room link
// made over the game and cancels; then Аня, who opened it, cancels: everyone goes to the shelf. With no room, a
// cancelled password leads to the shelf. Needs the site (npm run site, then npm run dev -- site; E2E_SITE_URL).
'use strict';
const { SITE, launch, watch, scenario, check, step, until, w, skip } = require('../support/scenario.cjs');
const { fakeNet } = require('../support/fakenet.cjs');
const { createLink, libState, openPage, short } = require('../support/pages.cjs');

const PW = '.dialog input[type=password]', NAME = '.dialog input.link', SHELF = '#shelf:not([hidden])';
const NOTE = 'Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.';

(async () => {
  const up = await fetch(SITE, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) skip('nothing answers at ' + SITE + ': npm run site, then npm run dev -- site (or set E2E_SITE_URL)');
  const G = (await (await fetch(SITE + 'library.json')).json())[0].id;

  scenario('prod cancel: a cancelled password takes the room away only from the game\'s opener', async () => {
    const ctx = await (await launch()).newContext({ viewport: { width: 420, height: 800 } });
    // what a page shows over the game: the note's text, its buttons on the screen, the focus; the dialog; the shelf
    const look = p => p.evaluate(() => ({
      text: document.getElementById('stage').hidden || document.getElementById('stage-note').hidden ? '' : document.getElementById('stage-text').textContent,
      buttons: [...document.querySelectorAll('#stage-note button')].filter(b => !b.hidden && b.getClientRects().length).map(b => b.textContent),
      focus: document.activeElement?.id || '', asked: !!document.querySelector('.dialog input[type=password]'), shelf: !document.getElementById('shelf').hidden
    }));
    const cancel = async p => { await p.waitForSelector(PW, { timeout: 30000 }); await p.click('.dialog >> text=Скасувати'); };
    const stays = (p, what) => until(async () => { const x = await look(p); return x.text === NOTE && x; }, 10000).then(async x => {
      check(x && !x.shelf && !x.asked, what + ': stays over the game, «' + NOTE + '»', await look(p));
      check(x && x.buttons.join() === 'Ввести пароль,До бібліотеки' && x.focus === 'stage-retry', '… with «Ввести пароль» (focused) and «До бібліотеки»', x);
    });

    const A = await openPage(ctx, 'aaaaaaaaaaaa', SITE, { label: 'Аня' });
    const link = await createLink(A, 'Аня'), code = new URL(link).searchParams.get('room');
    const B = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
    check(await until(async () => (await libState(A)).linked && (await libState(B)).linked, 20000), 'Аня and Богдан together', [await short(A), await short(B)]);
    for (const p of [A, B]) { await p.keyboard.press('Escape').catch(() => {}); await until(async () => !(await p.$('.backdrop')), 5000); }

    step('Аня opens ' + G + ' (her password dialog stays open); Богдан follows and cancels');
    await A.click('a.game[href*="/' + G + '/"]');
    check(!!(await A.waitForSelector(PW, { timeout: 30000 }).catch(() => null)), 'Аня: the password dialog');
    // (from now on: whether Аня's page ever leaves the game, sampled every 100 ms)
    await A.evaluate(g => { window.__left = false; setInterval(() => { if (window.__ihroteka.state().view !== g || !document.getElementById('shelf').hidden) window.__left = true; }, 100); }, G);
    await cancel(B);
    await stays(B, 'Богдан');
    await w(1500);
    check((await libState(A)).view === G && (await libState(B)).view === G, 'the room stays in the game', [await short(A), await short(B)]);

    step('«Ввести пароль»: the dialog again, on Богдан\'s page only; cancelled again, the note again');
    if (check(await B.isVisible('#stage-retry'), '«Ввести пароль» to press')) {
      await B.click('#stage-retry');
      check(!!(await B.waitForSelector(PW, { timeout: 30000 }).catch(() => null)), 'Богдан: the password dialog again');
      await cancel(B);
      await stays(B, 'Богдан');
    }

    step('Богдан\'s page reloads back into the room (REJOIN, as a version reload does) and he cancels');
    await B.evaluate(c => sessionStorage.setItem('ihroteka-rejoin', JSON.stringify({ code: c, name: 'Богдан', at: Date.now() })), code);
    await B.reload();
    check(!!(await B.waitForSelector(PW, { timeout: 30000 }).catch(() => null)), 'Богдан after the reload: the password dialog');
    check(await until(async () => (await libState(B)).linked, 20000), 'Богдан back in the room', await short(B));
    await w(1000);
    await cancel(B);
    await stays(B, 'Богдан');
    await w(2500);
    check((await libState(A)).view === G, 'Аня\'s view is still ' + G, await short(A));

    step('the same, with what Богдан\'s reloaded page sends held 3 s: he cancels before the room\'s state reaches him');
    await B.evaluate(c => sessionStorage.setItem('ihroteka-rejoin', JSON.stringify({ code: c, name: 'Богдан', at: Date.now() })), code);
    await B.addInitScript(() => { window.__imp = { lat: 3000 }; });
    await B.reload();
    await cancel(B);
    await stays(B, 'Богдан');
    check(await until(async () => (await libState(B)).linked, 30000), 'Богдан back in the room', await short(B));
    await w(4000);
    check((await libState(A)).view === G && (await libState(B)).view === G, 'the room stays in the game', [await short(A), await short(B)]);

    step('Кіра comes in by a room link made over the game, and cancels');
    const K = watch(await ctx.newPage(), 'Кіра');
    await K.addInitScript(fakeNet('cccccccccccc'));
    await K.goto(await A.evaluate(() => location.href));
    await K.waitForSelector(NAME, { timeout: 30000 });
    await K.evaluate(() => { const i = document.querySelector('.dialog input.link'); i.value = 'Кіра'; i.form.requestSubmit(); });
    check(await until(async () => (await libState(K)).linked, 20000), 'Кіра in the room', await short(K));
    await w(1000);
    await cancel(K);
    await stays(K, 'Кіра');
    await w(2500);
    check((await libState(A)).view === G, 'Аня\'s view is still ' + G, await short(A));
    check(!(await A.evaluate(() => window.__left)), 'Аня never left the game meanwhile');

    step('Аня, who opened the game, cancels: everyone goes to the shelf');
    await A.click('.dialog >> text=Скасувати');
    for (const [p, who] of [[A, 'Аня'], [B, 'Богдан'], [K, 'Кіра']])
      check(await until(async () => (await libState(p)).view === null && !!(await p.$(SHELF)), 15000), who + ': the shelf', await short(p));

    step('no room: a game\'s address, the password cancelled → the shelf');
    const D = watch(await ctx.newPage(), 'Дана');
    await D.addInitScript(fakeNet('dddddddddddd'));
    await D.goto(SITE + G + '/');
    await cancel(D);
    check(!!(await D.waitForSelector(SHELF, { timeout: 10000 }).catch(() => null)), 'the shelf', await look(D));
  }, { timeout: 240000, at: SITE });
})();
