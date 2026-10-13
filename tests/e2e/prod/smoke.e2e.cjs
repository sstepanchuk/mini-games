// tags: @ci @webkit
// prod smoke: the assembled site, as players get it (no fake network, no dev server): the shelf opens and lists every
// game of library.json, the pages say the site's version, and the offline copy (sw.js) takes charge with every file of
// the site in it. Then fully offline: a reload opens the shelf from that copy, and so does a second one; a sealed game
// asks for its password over its cover (with VAULT_PASSWORD, from the environment only: it opens, offline); an unknown
// address leads to the library. Nothing the page's Content-Security-Policy refuses, all the way. Needs the site:
// npm run site, then npm run dev -- site (E2E_SITE_URL); without it, it skips.
'use strict';
const { SITE, launch, watch, scenario, check, step, until, w, skip } = require('../support/scenario.cjs');

const SHELF = '#shelf:not([hidden])', PW = '.dialog input[type=password]';

(async () => {
  const up = await fetch(SITE, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) skip('nothing answers at ' + SITE + ': npm run site, then npm run dev -- site (or set E2E_SITE_URL)');
  const games = await (await fetch(SITE + 'library.json')).json();
  const sw = await (await fetch(SITE + 'sw.js')).text(), files = JSON.parse(sw.match(/const FILES = (\[.*?\]);/)[1]);
  const pw = process.env.VAULT_PASSWORD;

  scenario('prod: the assembled site, online, then offline from its offline copy', async () => {
    const ctx = await (await launch()).newContext({ viewport: { width: 420, height: 800 } });
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
  }, { timeout: 180000, at: SITE });
})();
