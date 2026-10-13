// tags: @ci
// prod nearby: two phones with no internet, the library from its offline copy (sw.js) of the assembled site, no fake
// network. Each opens the site once, then reloads it offline (from the offline copy), then joins a Wi-Fi with no way
// out (a hotspot without data: the network is there, the site and the brokers are not; fully offline, as Chromium's
// offline mode, a phone has no network for WebRTC either). «Грати разом» goes straight to nearby; Ганна shows her
// code, Гліб scans it (the camera is fake: the code is typed, «Ввести код вручну», with the scanner from the offline
// copy) and shows his answer, which Ганна takes. They are together, nearby. No password needed. Chromium (a fake
// camera); needs the site: npm run site, then npm run dev -- site (E2E_SITE_URL); without it, it skips.
'use strict';
const { SITE, launch, watch, scenario, check, step, until, w, skip, CHROMIUM } = require('../support/scenario.cjs');

const SHELF = '#shelf:not([hidden])', NAME = '.dialog input.link';

(async () => {
  if (!CHROMIUM) skip('a fake camera is Chromium\'s');
  const up = await fetch(SITE, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) skip('nothing answers at ' + SITE + ': npm run site, then npm run dev -- site (or set E2E_SITE_URL)');

  scenario('prod nearby: two phones without internet, from the offline copy', async () => {
    // a phone: the site once, then offline from its offline copy, then on a Wi-Fi with no way out
    async function phone(name) {
      const b = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
      const ctx = await b.newContext({ viewport: { width: 420, height: 860 }, permissions: ['camera'] }), p = watch(await ctx.newPage(), name);
      await p.goto(SITE);
      await p.waitForSelector(SHELF, { timeout: 15000 });
      await p.waitForFunction(() => navigator.serviceWorker.controller, null, { timeout: 20000 });
      await w(1000);                                     // (the copy finishing)
      await ctx.setOffline(true);
      await p.reload();
      check(!!(await p.waitForSelector(SHELF, { timeout: 10000 }).catch(() => null)), name + ': the shelf offline, from the offline copy');
      await ctx.route('**/*', r => r.abort('internetdisconnected'));   // a Wi-Fi with no way out
      await ctx.routeWebSocket(/.*/, ws => ws.close());
      await ctx.setOffline(false);
      await p.click('#together');
      await w(300);
      if (await p.isVisible(NAME) && !(await p.isVisible('text=Ввести код вручну'))) { await p.fill(NAME, name); await p.press(NAME, 'Enter'); }
      check(!!(await p.waitForSelector('text=Показати код', { timeout: 15000 }).catch(() => null)), name + ': «Грати разом» offers nearby only');
      const code = () => p.evaluate(() => document.querySelector('canvas.qr')?.dataset.code || '');
      const paste = async t => {
        await p.waitForSelector('text=Ввести код вручну', { timeout: 10000 });
        await p.click('text=Ввести код вручну');
        await p.fill(NAME, t);
        await p.press(NAME, 'Enter');
      };
      return { p, code, paste, state: () => p.evaluate(() => window.__ihroteka.state()) };
    }

    const H = await phone('Ганна'), G = await phone('Гліб');
    step('Ганна shows her code; Гліб scans it');
    await H.p.click('text=Показати код');
    const offer = await until(H.code, 15000);
    check(!!offer, 'her QR code is on the screen');
    await G.p.click('text=Сканувати код');
    await G.p.waitForSelector('video.scan', { timeout: 10000 });
    check(await G.p.evaluate(() => performance.getEntriesByType('resource').some(e => /\/lib\/qr-scan\.js$/.test(e.name))), 'the scanner came from the offline copy');
    await G.paste(offer);
    const answer = await until(G.code, 15000);
    check(!!answer, 'Гліб shows his answer');

    step('Ганна takes it');
    await H.p.click('text=Далі: сканувати код друга');
    await H.paste(answer);
    const both = async () => { const s = [await H.state(), await G.state()]; return s.every(x => x.linked && x.kind === 'nearby' && x.players.length === 2) && s; };
    const s = await until(both, 20000);
    check(s, 'together, nearby, without internet', s || [await H.state(), await G.state()]);
  }, { timeout: 180000, at: SITE });
})();
