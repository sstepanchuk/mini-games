// tags: @ci
// prod update: a new version of the site under open pages (owner, decision 38). The assembled site is served through
// a proxy of the scenario's own, which can make its sw.js a new version (another VERSION: the offline copy downloads
// it whole and takes over the pages); the pages run with the fake network. A page reloads into the new version by
// itself once that disturbs nobody: Аня and Богдан, in a room on the shelf, reload at once, each straight back into
// the room under the same name (no name asked). Дана, whose password dialog is up, and Еля, over the game Дана opened
// (Еля cancelled her password), stay as they are; once Дана cancels (she opened it: the room goes to the shelf), both
// reload, back into their room too. Chromium and WebKit alike in principle; @ci only (Chromium) for now. Needs the
// site: npm run site, then npm run dev -- site (E2E_SITE_URL); without it, it skips.
'use strict';
const http = require('node:http');
const { SITE, launch, scenario, check, step, until, w, skip } = require('../support/scenario.cjs');
const { createLink, libState, openPage, short } = require('../support/pages.cjs');

const PW = '.dialog input[type=password]', NAME = '.dialog input.link';
const NOTE = 'Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.';

// The site at SITE, served at the same path on another origin (localhost: a secure context, for the offline copy);
// bump(): from now on its sw.js says another version
async function proxy() {
  const up = new URL(SITE);
  let version = null;
  const server = http.createServer(async (req, res) => {
    try {
      const r = await fetch(new URL(req.url, up.origin), { cache: 'no-store' });
      let body = Buffer.from(await r.arrayBuffer());
      if (version && /\/sw\.js$/.test(req.url.split('?')[0])) body = Buffer.from(body.toString().replace(/const VERSION = '[0-9a-f]+';/, () => "const VERSION = '" + version + "';"));
      res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch (e) { res.writeHead(502).end(); }
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  process.on('exit', () => server.close());
  return { url: 'http://localhost:' + server.address().port + up.pathname, bump: () => { version = Date.now().toString(16).padStart(16, '0').slice(-16); } };
}

(async () => {
  const up = await fetch(SITE, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) skip('nothing answers at ' + SITE + ': npm run site, then npm run dev -- site (or set E2E_SITE_URL)');
  const G = (await (await fetch(SITE + 'library.json')).json())[0].id;

  scenario('prod update: a page reloads into a new version once that disturbs nobody, back into its room', async () => {
    const site = await proxy(), browser = await launch();
    // (a browser profile per room: one profile's pages share their storage, and «Грати разом» would offer the last room)
    const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } }), ctx2 = await browser.newContext({ viewport: { width: 420, height: 800 } });
    // a page marked now (a reload forgets the mark); whether it still has it (null: navigating)
    const mark = p => p.evaluate(() => { window.__mark = 1; });
    const marked = p => p.evaluate(() => window.__mark === 1).catch(() => null);
    const controlled = p => p.evaluate(() => !!navigator.serviceWorker.controller).catch(() => false);
    const together = (...ps) => until(async () => (await Promise.all(ps.map(p => libState(p).catch(() => null)))).every(s => s && s.linked), 30000);
    const quiet = async p => { await p.keyboard.press('Escape').catch(() => {}); await until(async () => !(await p.$('.backdrop')), 5000); };

    const A = await openPage(ctx, 'aaaaaaaaaaaa', site.url, { label: 'Аня' });
    check(await until(() => controlled(A), 30000), 'the offline copy takes charge');
    step('Аня and Богдан in a room, on the shelf');
    const link = await createLink(A, 'Аня');
    const B = await openPage(ctx, 'bbbbbbbbbbbb', link, { name: 'Богдан' });
    check(await together(A, B), 'together', [await short(A), await short(B)]);
    await quiet(A); await quiet(B);

    step('Дана and Еля in another room: Дана opens ' + G + ' (her password dialog stays up), Еля follows and cancels');
    const D = await openPage(ctx2, 'dddddddddddd', site.url, { label: 'Дана' });
    check(await until(() => controlled(D), 30000), 'the offline copy takes charge there too');
    const link2 = await createLink(D, 'Дана');
    const E = await openPage(ctx2, 'eeeeeeeeeeee', link2, { name: 'Еля' });
    check(await together(D, E), 'together', [await short(D), await short(E)]);
    await quiet(D); await quiet(E);
    await D.click('a.game[href*="/' + G + '/"]');
    check(!!(await D.waitForSelector(PW, { timeout: 30000 }).catch(() => null)), 'Дана: the password dialog');
    await E.waitForSelector(PW, { timeout: 30000 });
    await E.click('.dialog >> text=Скасувати');
    check(await until(() => E.evaluate(n => document.getElementById('stage-text').textContent === n, NOTE), 10000), 'Еля: over the game, «' + NOTE + '»');
    const pages = { Аня: A, Богдан: B, Дана: D, Еля: E };
    check((await Promise.all(Object.values(pages).map(controlled))).every(Boolean), 'every page is in the offline copy\'s charge');
    for (const p of Object.values(pages)) await mark(p);

    step('a new version of the site: its offline copy is downloaded and takes over');
    site.bump();
    for (const p of [A, D]) await p.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r.update()));
    for (const [who, p] of [['Аня', A], ['Богдан', B]]) {
      check(await until(async () => await marked(p) === false, 60000), who + ': the page reloads by itself');
      check(await until(async () => { const s = await libState(p).catch(() => null); return s && s.linked && s.me === who; }, 30000), '… back into the room, as ' + who, await short(p));
      check(!(await p.$(NAME)), '… no name asked');
    }
    check(await together(A, B), 'Аня and Богдан together again', [await short(A), await short(B)]);
    await w(7000);                                        // (more than one 5 s check of the waiting pages)
    check(await marked(D) === true && !!(await D.$(PW)), 'Дана, her password dialog up: not reloaded', await short(D));
    check(await marked(E) === true && !(await E.evaluate(() => document.getElementById('stage').hidden)), 'Еля, over the game: not reloaded', await short(E));

    step('Дана cancels: the room goes to the shelf, and both pages reload, back into it');
    await D.click('.dialog >> text=Скасувати');
    for (const [who, p] of [['Дана', D], ['Еля', E]]) {
      check(await until(async () => await marked(p) === false, 20000), who + ': the page reloads by itself');
      check(await until(async () => { const s = await libState(p).catch(() => null); return s && s.linked && s.me === who; }, 30000), '… back into the room, as ' + who, await short(p));
    }
  }, { timeout: 300000, at: SITE });
})();
