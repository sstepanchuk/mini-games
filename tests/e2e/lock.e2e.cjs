// tags: @ci @webkit
// lock: the password of the games, on a library of its own (support/newgame.cjs scratchLibrary: cli init, new demo,
// build and site in a scratch copy, served with its offline copy). A wrong password says «Не той пароль.» in an
// element a screen reader reads out (role=alert; the field is described by it, and marked invalid). Escape while
// «Відмикаю…» leaves nothing remembered: the next visit asks again. The right password opens the game; the next
// visit opens it with no password (offline too, from the offline copy: Chromium only, as a reload with the network off
// fails in Playwright's WebKit). «Забути пароль на цьому пристрої»: asked again, on this visit and the next. The
// password comes from what cli init printed and is never printed. Runs on its own server: E2E_URL is only checked to
// be up, by run.cjs.
'use strict';
const { CHROMIUM, BROWSER, launch, watch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { scratchLibrary } = require('./support/newgame.cjs');

const SHELF = '#shelf:not([hidden])', PW = '.dialog input[type=password]', GO = '.dialog button[type=submit]', CARD = 'a.game[href*="/demo/"]';

scenario('lock: the password, Escape while it is checked, a remembered device, «Забути пароль»', async () => {
  const L = await scratchLibrary('demo', ['alice']);
  if (!check(L.made, 'a library of its own: cli init, new demo, build, site', L.out)) return;
  if (!check(L.up, 'its site, served at ' + L.url, L.log)) return;
  const password = L.passwords.alice;

  const ctx = await (await launch()).newContext({ viewport: { width: 420, height: 800 } });
  const p = watch(await ctx.newPage(), 'alice');
  // the password typed into the dialog (a failure says so, never what was typed)
  const type = async value => { try { await p.fill(PW, value); } catch (e) { throw new Error('could not type into the password field'); } };
  // a visit: the shelf, then the game → 'asked' (the password dialog) or 'opened' (its frame)
  const visit = async () => {
    await p.goto(L.url);
    await p.waitForSelector(SHELF, { timeout: 15000 });
    await p.click(CARD);
    return Promise.race([p.waitForSelector(PW, { timeout: 30000 }).then(() => 'asked'), p.waitForSelector('iframe.frame', { timeout: 30000 }).then(() => 'opened')]).catch(() => 'neither');
  };
  const opened = async () => {
    const f = await (await p.waitForSelector('iframe.frame', { timeout: 60000 }).catch(() => null))?.contentFrame();
    return !!f && await f.waitForSelector('#lobby', { timeout: 30000 }).then(() => true, () => false);
  };

  step('a wrong password');
  check(await visit() === 'asked', 'the game asks for the password');
  await type('not-' + Math.random().toString(36).slice(2));
  await p.press(PW, 'Enter');
  const told = () => p.evaluate(() => [...document.querySelectorAll('.dialog [role=alert]')].map(x => x.textContent).join(' | ')).catch(e => e.message);
  check(await until(async () => await told() === 'Не той пароль.', 20000), '«Не той пароль.», in an element with role=alert', { alert: await told(), err: await p.textContent('.dialog .err').catch(() => null) });
  const marks = await p.$eval(PW, i => ({ invalid: i.getAttribute('aria-invalid'), describedBy: !!i.getAttribute('aria-describedby') && i.getAttribute('aria-describedby') === document.querySelector('.dialog [role=alert]')?.id }));
  check(marks.invalid === 'true' && marks.describedBy, 'the field: aria-invalid, and described by that line', marks);

  step('Escape while «Відмикаю…»');
  await type(password);
  await p.press(PW, 'Enter');
  const busy = await p.textContent(GO);
  await p.keyboard.press('Escape');
  check(busy === 'Відмикаю…', 'Escape pressed while the button says «Відмикаю…»', busy);
  check(await until(async () => !(await p.$('.dialog')), 5000), 'the dialog closes');
  await w(3000);                                        // (the password checked meanwhile, to its end)
  check(!(await p.$('iframe.frame')), 'the game does not open');
  check(await visit() === 'asked', 'the next visit asks for the password again: nothing was remembered');

  step('the right password');
  await type(password);
  await p.press(PW, 'Enter');
  check(await opened(), 'the game opens');
  check(await visit() === 'opened', 'the next visit opens the game with no password');
  check(await opened(), '… all of it');

  if (CHROMIUM) {
    step('offline, from the offline copy');
    const stored = await until(() => p.evaluate(async at => {
      if (!navigator.serviceWorker.controller) return false;
      const k = (await caches.keys()).find(c => /^ihroteka-[0-9a-f]{16}$/.test(c));
      return !!k && !!(await (await caches.open(k)).match(at + 'demo/game.bin'));
    }, L.url), 30000);
    check(stored, 'the offline copy is in charge, the game in it');
    await ctx.setOffline(true);
    check(await visit() === 'opened' && await opened(), 'offline: the game opens with no password');
    await ctx.setOffline(false);
  } else console.log('  · (' + BROWSER + ': the offline half is not run here)');

  step('«Забути пароль на цьому пристрої»');
  await p.goto(L.url);
  await p.waitForSelector(SHELF, { timeout: 15000 });
  const out = p.locator('#sign-out');
  check(await until(() => out.isVisible(), 10000), 'the shelf offers it');
  await out.click();
  check(await until(async () => !(await out.isVisible()), 10000), 'pressed: it goes');
  await p.click(CARD);
  check(!!(await p.waitForSelector(PW, { timeout: 30000 }).catch(() => null)), 'the game asks for the password again');
  check(await visit() === 'asked', '… and so does the next visit');
  await p.keyboard.press('Escape');
}, { timeout: 240000 });
