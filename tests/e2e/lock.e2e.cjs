// tags: @ci @webkit
// lock: the password of the games, on a library of its own (support/newgame.cjs scratchLibrary: cli init alice carol,
// new demo, build and site in a scratch copy, served with its offline copy; its tools at hand: user remove, user
// passwd). A wrong password says
// «Не той пароль.» in an element a screen reader reads out (role=alert; the field is described by it, and marked
// invalid). Escape while «Відмикаю…» leaves nothing remembered: the next visit asks again. The right password opens the
// game; the next visit opens it with no password (offline too, from the offline copy: Chromium only, as a reload with
// the network off fails in Playwright's WebKit). «Забути пароль на цьому пристрої»: asked again, on this visit and the
// next. While a password is checked (Web Crypto slowed down here: a cheap phone takes seconds), the line under the
// button says «Відмикаю…» at once, told to a screen reader, and after a second that it may take a few seconds. A
// person removed from the library is told so over the field; one whose password changed, too, and the new one opens
// the game. «Забути пароль» that cannot forget (IndexedDB and localStorage both failing) says so and stays. The
// passwords come from what the tools printed and are never printed. Runs on its own server: E2E_URL is only checked to
// be up, by run.cjs.
'use strict';
const { CHROMIUM, BROWSER, launch, watch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { scratchLibrary } = require('./support/newgame.cjs');

const SHELF = '#shelf:not([hidden])', PW = '.dialog input[type=password]', CARD = 'a.game[href*="/demo/"]';
const BUSY = '.dialog .busy[role=status]', INTRO = '.dialog h2 + p';
const SAY = {
  unlocking: 'Відмикаю…', slow: 'Відмикаю… Це може тривати кілька секунд.',
  removed: 'Доступ до ігор із цим паролем закрили. Якщо тобі дали новий пароль — введи його.',
  changed: 'Твій пароль змінили. Введи новий.',
  notForgotten: 'Не вдалося забути пароль. Закрий вкладку й спробуй ще раз.'
};

// (init scripts) Web Crypto's password derivation (PBKDF2) answers 1500 ms late, as on a cheap phone (CDP's CPU
// throttling does not slow Web Crypto)
function SLOW_PBKDF2() {
  const derive = SubtleCrypto.prototype.deriveKey;
  SubtleCrypto.prototype.deriveKey = function (algo, ...rest) {
    const p = derive.call(this, algo, ...rest);
    return algo && algo.name === 'PBKDF2' ? new Promise(r => setTimeout(r, 1500)).then(() => p) : p;
  };
}
// IndexedDB and localStorage fail from the moment window.__broken is set (an iPhone's storage after the tab came back)
function BREAKABLE() {
  const open = IDBFactory.prototype.open;
  IDBFactory.prototype.open = function (...a) {
    if (!window.__broken) return open.apply(this, a);
    const req = {};
    setTimeout(() => { req.error = new DOMException('Connection to Indexed Database server lost', 'UnknownError'); if (req.onerror) req.onerror(); });
    return req;
  };
  for (const m of ['setItem', 'removeItem']) {
    const f = Storage.prototype[m];
    Storage.prototype[m] = function (...a) { if (window.__broken && this === window.localStorage) throw new DOMException('The operation is insecure.', 'SecurityError'); return f.apply(this, a); };
  }
}

scenario('lock: the password, Escape while it is checked, a remembered device, «Забути пароль», removed and changed, a slow check', async () => {
  const L = await scratchLibrary('demo', ['alice', 'carol']);
  if (!check(L.made, 'a library of its own: cli init, new demo, build, site', L.out)) return;
  if (!check(L.up, 'its site, served at ' + L.url, L.log)) return;
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 420, height: 800 } });
  // a device of its own (no offline copy: each visit asks the site, as after a deploy), with these init scripts
  const device = async (label, ...init) => {
    const c = await browser.newContext({ viewport: { width: 420, height: 800 }, serviceWorkers: 'block' });
    for (const f of init) await c.addInitScript(f);
    return watch(await c.newPage(), label);
  };
  // the password typed into the dialog (a failure says so, never what was typed)
  const type = async (p, value) => { try { await p.fill(PW, value); } catch (e) { throw new Error('could not type into the password field'); } };
  // a visit: the shelf, then the game → 'asked' (the password dialog) or 'opened' (its frame)
  const visit = async p => {
    await p.goto(L.url);
    await p.waitForSelector(SHELF, { timeout: 15000 });
    await p.click(CARD);
    return Promise.race([p.waitForSelector(PW, { timeout: 30000 }).then(() => 'asked'), p.waitForSelector('iframe.frame', { timeout: 30000 }).then(() => 'opened')]).catch(() => 'neither');
  };
  const opened = async p => {
    const f = await (await p.waitForSelector('iframe.frame', { timeout: 60000 }).catch(() => null))?.contentFrame();
    return !!f && await f.waitForSelector('#lobby', { timeout: 30000 }).then(() => true, () => false);
  };
  // signed in on this page: asked, the password typed, the game opens
  const signIn = async (p, who) => {
    if (await visit(p) !== 'asked') return false;
    await type(p, L.passwords[who]);
    await p.press(PW, 'Enter');
    return opened(p);
  };
  const intro = p => p.textContent(INTRO).catch(() => null);

  const p = watch(await ctx.newPage(), 'alice');
  step('a wrong password');
  check(await visit(p) === 'asked', 'the game asks for the password');
  await type(p, 'not-' + Math.random().toString(36).slice(2));
  await p.press(PW, 'Enter');
  const told = () => p.evaluate(() => [...document.querySelectorAll('.dialog [role=alert]')].map(x => x.textContent).join(' | ')).catch(e => e.message);
  check(await until(async () => await told() === 'Не той пароль.', 20000), '«Не той пароль.», in an element with role=alert', { alert: await told(), err: await p.textContent('.dialog .err').catch(() => null) });
  const marks = await p.$eval(PW, i => ({ invalid: i.getAttribute('aria-invalid'), describedBy: !!i.getAttribute('aria-describedby') && i.getAttribute('aria-describedby') === document.querySelector('.dialog [role=alert]')?.id }));
  check(marks.invalid === 'true' && marks.describedBy, 'the field: aria-invalid, and described by that line', marks);

  step('Escape while «Відмикаю…»');
  await type(p, L.passwords.alice);
  await p.press(PW, 'Enter');
  const busy = await p.textContent(BUSY).catch(() => null);
  await p.keyboard.press('Escape');
  check(busy === SAY.unlocking, 'Escape pressed while the line under the button says «Відмикаю…»', busy);
  check(await until(async () => !(await p.$('.dialog')), 5000), 'the dialog closes');
  await w(3000);                                        // (the password checked meanwhile, to its end)
  check(!(await p.$('iframe.frame')), 'the game does not open');
  check(await visit(p) === 'asked', 'the next visit asks for the password again: nothing was remembered');

  step('the right password');
  await type(p, L.passwords.alice);
  await p.press(PW, 'Enter');
  check(await opened(p), 'the game opens');
  check(await visit(p) === 'opened', 'the next visit opens the game with no password');
  check(await opened(p), '… all of it');

  if (CHROMIUM) {
    step('offline, from the offline copy');
    const stored = await until(() => p.evaluate(async at => {
      if (!navigator.serviceWorker.controller) return false;
      const k = (await caches.keys()).find(c => /^ihroteka-[0-9a-f]{16}$/.test(c));
      return !!k && !!(await (await caches.open(k)).match(at + 'demo/game.bin'));
    }, L.url), 30000);
    check(stored, 'the offline copy is in charge, the game in it');
    await ctx.setOffline(true);
    check(await visit(p) === 'opened' && await opened(p), 'offline: the game opens with no password');
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
  check(await visit(p) === 'asked', '… and so does the next visit');
  await p.keyboard.press('Escape');

  step('a slow check (Web Crypto 1.5 s late): the line under the button');
  const s = await device('alice, slow', SLOW_PBKDF2);
  check(await visit(s) === 'asked', 'asked');
  const quiet = await s.$eval(BUSY, n => ({ text: n.textContent, h: n.getBoundingClientRect().height })).catch(e => e.message);
  check(quiet.text === '' && quiet.h <= 1, 'nothing under the button before the password is sent (the line is there, empty and out of sight: a live region before it speaks)', quiet);
  await type(s, L.passwords.alice);
  await s.press(PW, 'Enter');
  const t0 = Date.now();
  const first = await until(async () => await s.isVisible(BUSY) && await s.textContent(BUSY), 200, 20);
  check(first === SAY.unlocking, '«' + SAY.unlocking + '» within 200 ms, in a role=status line', { first, after: Date.now() - t0 });
  const slow = await until(async () => await s.textContent(BUSY).catch(() => null) === SAY.slow, 3000, 50);
  check(slow && Date.now() - t0 >= 900, 'after about a second: «' + SAY.slow + '» (' + (Date.now() - t0) + ' ms)', await s.textContent(BUSY).catch(e => e.message));
  check(await opened(s), 'then the game opens');
  check(!(await s.isVisible(BUSY)), '… and the line is gone');

  step('a person removed from the library (cli user remove, a new site)');
  const c = await device('carol');
  check(await signIn(c, 'carol'), 'carol signed in on her device');
  check(L.cli(['user', 'remove', 'carol'], L.passwords.alice), 'cli user remove carol', L.out);
  check(await visit(c) === 'asked', 'carol\'s device asks for a password', L.log);
  check(await intro(c) === SAY.removed, 'it says «' + SAY.removed + '»', await intro(c));
  await c.keyboard.press('Escape');
  check(await visit(c) === 'asked' && await intro(c) === SAY.removed, '… and again on the next visit', await intro(c));

  step('a password changed (cli user passwd, a new site)');
  const a = await device('alice, before passwd');
  check(await signIn(a, 'alice'), 'alice signed in on this device');
  const before = L.passwords.alice;
  check(L.cli(['user', 'passwd'], before, '\n') && L.passwords.alice !== before, 'cli user passwd (a new password, generated)', L.out);
  check(await visit(a) === 'asked', 'this device asks for the password');
  check(await intro(a) === SAY.changed, 'it says «' + SAY.changed + '»', await intro(a));
  await type(a, L.passwords.alice);
  await a.press(PW, 'Enter');
  check(await opened(a), 'the new password opens the game');

  step('«Забути пароль» when the device cannot forget (IndexedDB and localStorage failing)');
  const b = await device('alice, broken storage', BREAKABLE);
  check(await signIn(b, 'alice'), 'alice signed in on this device');
  await b.goto(L.url);
  await b.waitForSelector(SHELF, { timeout: 15000 });
  const forget = b.locator('#sign-out');
  check(await until(() => forget.isVisible(), 10000), 'the shelf offers «Забути пароль»');
  await b.evaluate(() => { window.__broken = true; });
  await forget.click();
  const line = () => b.textContent('#sign-out-err').catch(() => null);
  check(await until(async () => await line() === SAY.notForgotten, 10000), 'it says «' + SAY.notForgotten + '»', await line());
  check(await forget.isVisible() && await forget.isEnabled(), '… and the button stays');
  check(await b.getAttribute('#sign-out-err', 'role') === 'alert', '… told to a screen reader');
}, { timeout: 300000 });
