// tags: @ci @webkit
// prod smoke: the assembled site, as players get it (no fake network, no dev server): the shelf opens and lists every
// game of library.json, the pages say the site's version, and the offline copy (sw.js) takes charge with every file of
// the site in it. Then fully offline: a reload opens the shelf from that copy, and so does a second one; a sealed game
// asks for its password over its cover (with VAULT_PASSWORD, from the environment only: it opens, offline); an unknown
// address leads to the library. Nothing the page's Content-Security-Policy refuses, all the way. And with no network
// and no offline copy (service workers blocked; library.json or the library's code cut off on the way): the page says
// why, with no spinner, told to a screen reader, with «Спробувати ще» (focused), which tries again in place (no reload),
// as does the network coming back; a site that answers with no shelf (503, a portal's page) says so too; the library's
// code not coming says the network's words at once, never that the browser is too old. Needs the site: npm run site,
// then npm run dev -- site (E2E_SITE_URL); without it, it skips.
'use strict';
const { SITE, CHROMIUM, BROWSER, launch, watch, scenario, check, step, until, w, skip } = require('../support/scenario.cjs');

const SHELF = '#shelf:not([hidden])', PW = '.dialog input[type=password]';

(async () => {
  const up = await fetch(SITE, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) skip('nothing answers at ' + SITE + ': npm run site, then npm run dev -- site (or set E2E_SITE_URL)');
  const games = await (await fetch(SITE + 'library.json')).json();
  const sw = await (await fetch(SITE + 'sw.js')).text(), files = JSON.parse(sw.match(/const FILES = (\[.*?\]);/)[1]);
  const pw = process.env.VAULT_PASSWORD;

  scenario('prod: the assembled site, online, then offline from its offline copy', async () => {
    const browser = await launch(), ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
    const refused = [];                                  // what the pages' policy refuses, on any page or frame, all along
    await ctx.exposeFunction('__refused', what => refused.push(what));
    await ctx.addInitScript(() => document.addEventListener('securitypolicyviolation', e => window.__refused(e.violatedDirective + ' ' + (e.blockedURI || 'inline'))));
    const p = watch(await ctx.newPage(), 'site');
    const titles = () => p.$$eval('.game b', a => a.map(x => x.textContent));
    const card = id => 'a.game[href*="/' + id + '/"]';

    step('online');
    await p.goto(SITE);
    await p.waitForSelector(SHELF, { timeout: 15000 });
    const listed = await titles();
    check(games.length > 0 && games.every(g => listed.includes(g.title)), 'the shelf lists every game of library.json (' + games.length + ')', { listed, games: games.map(g => g.title) });
    const version = await p.getAttribute('meta[name="ihroteka-version"]', 'content');
    check(/^([0-9a-f]{7,}|unknown) \d{4}-\d\d-\d\d$/.test(version || ''), 'the page says the site\'s version: «' + version + '»', version);
    check(await until(() => p.evaluate(() => !!navigator.serviceWorker.controller), 20000), 'the offline copy takes charge');
    const stored = await until(() => p.evaluate(async n => {
      const k = (await caches.keys()).find(c => /^ihroteka-[0-9a-f]{16}$/.test(c));
      return k && (await (await caches.open(k)).keys()).length >= n && k;
    }, files.length), 20000);
    check(stored, 'every file of the site is in it (' + files.length + ')', stored);

    await notOpened(browser);

    // Playwright's WebKit fails any load with the network off, even one its service worker would answer ("WebKit
    // encountered an internal error"): there the offline half is for a real iPhone (docs/ROADMAP.md)
    if (!CHROMIUM) {
      console.log('  · (' + BROWSER + ': the offline half is not run here)');
      check(!refused.length, 'nothing refused by the Content-Security-Policy', refused);
      return;
    }
    step('offline');
    await w(500);
    await ctx.setOffline(true);
    for (const n of [1, 2]) {
      await p.reload();
      check(!!(await p.waitForSelector(SHELF, { timeout: 10000 }).catch(() => null)) && (await titles()).length === listed.length, 'reload ' + n + ' offline: the shelf, from the offline copy', await titles().catch(e => e.message));
    }
    check(!(await p.evaluate(() => navigator.onLine)), '(offline indeed)');
    const g = games[0];
    await p.click(card(g.id));
    check(!!(await p.waitForSelector(PW, { timeout: 10000 }).catch(() => null)), g.title + ': the password, asked offline');
    const cover = await p.$eval('.dialog img.cover', i => i.complete && i.naturalWidth > 0).catch(() => false);
    check(cover, '… over its cover (from the offline copy)');
    if (pw) {
      await p.fill(PW, pw);
      await p.press(PW, 'Enter');
      const f = await (await p.waitForSelector('iframe.frame', { timeout: 60000 }).catch(() => null))?.contentFrame();
      check(!!f && await f.waitForFunction(() => !!window.ihroteka && document.readyState === 'complete', null, { timeout: 30000 }).then(() => true, () => false),
        'with the password (VAULT_PASSWORD): the game opens, offline');
    } else console.log('  · (no VAULT_PASSWORD: the game itself is not opened)');
    await p.goto(SITE + 'no-such-game/').catch(() => {});
    check(!!(await p.waitForSelector(SHELF, { timeout: 10000 }).catch(() => null)), 'an unknown address leads to the library, offline');
    check(!refused.length, 'nothing refused by the Content-Security-Policy', refused);
  }, { timeout: 240000, at: SITE });

  // No network and no offline copy (a context whose service workers are blocked; what is cut off is routed): the page
  // says why, and tries again. None of it reloads with the network off (Playwright's WebKit cannot).
  async function notOpened(browser) {
    const OFFLINE = 'Не вдалося завантажити. Перевір інтернет і спробуй ще.', BROKEN = 'Не вдалося відкрити бібліотеку. Онови сторінку трохи згодом.';
    // what #busy shows: its text, class, role, whether its spinner (::before) turns; the button under it and the focus
    const busy = p => p.evaluate(() => {
      const b = document.getElementById('busy'), before = getComputedStyle(b, '::before'), r = document.getElementById('busy-retry');
      return { text: b.textContent, cls: b.className, role: b.getAttribute('role'), shown: !b.hidden, spins: before.content !== 'none' && before.animationName !== 'none',
        retry: r ? r.textContent : null, focus: document.activeElement?.id || '', shelf: !document.getElementById('shelf').hidden };
    });
    const said = (p, text) => until(async () => { const x = await busy(p); return x.text === text && x.retry && x; }, 15000);
    const fresh = async label => { const c = await browser.newContext({ viewport: { width: 420, height: 800 }, serviceWorkers: 'block' }); return [c, watch(await c.newPage(), label)]; };
    const LIB = '**/library.json';

    step('no network, no offline copy: library.json does not come');
    let [c, p] = await fresh('no network');
    await c.route(LIB, r => r.abort('internetdisconnected'));
    await p.goto(SITE);
    let x = await said(p, OFFLINE);
    check(x && x.cls === 'err' && !x.spins && x.role === 'alert', 'it says why: «' + OFFLINE + '», no spinner, told to a screen reader', await busy(p));
    check(x && x.retry === 'Спробувати ще' && x.focus === 'busy-retry', '… «Спробувати ще», focused', x);
    await p.evaluate(() => { window.__marker = 1; });
    await p.click('#busy-retry');
    x = await said(p, OFFLINE);
    check(x && x.cls === 'err' && x.focus === 'busy-retry', 'pressed while still down: said again', await busy(p));
    await c.unroute(LIB);
    await p.click('#busy-retry');
    check(!!(await p.waitForSelector(SHELF, { timeout: 15000 }).catch(() => null)) && !(await busy(p)).shown, 'the network back, pressed: the shelf', await busy(p));
    check(await p.evaluate(() => window.__marker === 1), '… on the same page (tried again in place, no reload)');
    await c.close();

    step('… and the network coming back tries again by itself');
    [c, p] = await fresh('back online');
    await c.route(LIB, r => r.abort('internetdisconnected'));
    await p.goto(SITE);
    check(!!(await said(p, OFFLINE)), 'it says why', await busy(p));
    await c.unroute(LIB);
    await c.setOffline(true);
    await c.setOffline(false);
    check(!!(await p.waitForSelector(SHELF, { timeout: 15000 }).catch(() => null)), 'online again: the shelf, nothing pressed', await busy(p));
    await c.close();

    for (const [what, answer] of [['503', { status: 503, contentType: 'text/plain', body: 'Service Unavailable' }], ['a portal\'s page (200, text/html)', { status: 200, contentType: 'text/html', body: '<!doctype html><p>Увійдіть у мережу</p>' }]]) {
      step('the site answers library.json with ' + what);
      [c, p] = await fresh(what);
      await c.route(LIB, r => r.fulfill(answer));
      await p.goto(SITE);
      x = await said(p, BROKEN);
      check(x && x.cls === 'err' && !x.spins && x.retry === 'Спробувати ще', '«' + BROKEN + '», with «Спробувати ще», no spinner', await busy(p));
      await c.close();
    }

    step('the library\'s code does not come');
    [c, p] = await fresh('no code');
    await c.route('**/lib/ihroteka.js', r => r.abort('internetdisconnected'));
    await p.goto(SITE);
    x = await until(async () => { const y = await busy(p); return y.text === OFFLINE && y; }, 5000, 100);
    check(x && x.cls === 'err' && !x.spins && x.role === 'alert' && x.retry === 'Спробувати ще' && x.focus === 'busy-retry',
      'at once: «' + OFFLINE + '», no spinner, told to a screen reader, with «Спробувати ще» (focused)', await busy(p));
    await w(9000);
    check((await busy(p)).text === OFFLINE, 'still that after 9 s (not «застарий»)', await busy(p));
    await c.close();
  }
})();
