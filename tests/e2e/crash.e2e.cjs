// tags: @ci @webkit
// crash: a game that throws while it starts (its page rewritten on the way: a script that throws, ahead of the game's
// own code) leaves no empty screen: «Гра зламалася» over it, the focus on «Скопіювати звіт», which copies the report
// (the site's version, the connection, the trace: the error's type and place, never its message). A game that
// started well and throws later shows no note, but the trace has it; so does the library page's own error. A browser's
// notice that comes as a window error with nothing thrown (a ResizeObserver loop, as a layout settles while the game
// starts) is no broken game: no note, a line in the trace; nor is a promise left rejected because the browser refused
// (NotAllowedError: a sound played before any tap). One left rejected with an error of the game's own is. Needs the dev
// server with the plaintext games (npm run unlock): it opens Two Dragons; or with the probe (npm run dev -- --probe,
// E2E_GAME=probe). First, a guard: a page's console.error is counted as an error (support/scenario.cjs watch).
'use strict';
const { U, w, launch, watch, errs, scenario, check, step, until, GAME } = require('./support/scenario.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const SECRET = 'Таємниця-7';
const note = p => p.evaluate(() => {
  const n = document.getElementById('stage-note'), r = n.getBoundingClientRect(), top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return { shown: !n.hidden, over: !n.hidden && n.contains(top), text: n.innerText.replace(/\s+/g, ' ').trim(), focus: document.activeElement?.id || '' };
});
const CARD = 'a.game[href*="/' + GAME + '/"]';
// the game's code has run (its modules, then the page loaded)
const started = () => !!window.ihroteka && document.readyState === 'complete';
const traced = (p, re) => p.evaluate(src => window.__ihroteka.trace().some(l => new RegExp(src).test(l)), re.source);

scenario('crash: a game that breaks as it starts', async () => {
  const ctx = await (await launch()).newContext();
  step('the guard: a watched page\'s console.error fails a scenario');
  const guard = watch(await ctx.newPage(), 'guard');
  await guard.addInitScript(fakeNet('bbbbbbbbbbbb'));
  await guard.goto(U);
  const e0 = errs.length;
  await guard.evaluate(() => console.error(new TypeError('probe')));
  await until(() => errs.length > e0, 3000, 50);
  check(/console\.error TypeError: probe/.test(errs[e0] || ''), 'counted as an error on the page', errs.slice(e0));
  errs.splice(e0, 1);                                     // (expected: the guard's own)
  await guard.close();

  step('a game that throws as it starts');
  const p = await ctx.newPage(), thrown = [];
  p.on('pageerror', e => thrown.push(e.message));        // (expected here: the scenario checks them itself)
  // what the game's page gets ahead of its own code: a script that throws, one whose ResizeObserver loops a while as
  // the page starts (each frame it resizes what it observes), one that leaves the browser's refusal uncaught (as
  // audio.play() before any tap), one that leaves its own error uncaught in a promise, or nothing
  const ADD = {
    throw: '<script>throw new TypeError("' + SECRET + '")</script>',
    loop: '<script>addEventListener("DOMContentLoaded", () => { const d = document.body.appendChild(document.createElement("i")); ' +
      'd.style.display = "block"; let n = 0; new ResizeObserver(() => { if (++n < 30) d.style.width = n + "px"; }).observe(d); })</script>',
    refused: '<script>Promise.reject(new DOMException("' + SECRET + '", "NotAllowedError"))</script>',
    rejected: '<script>Promise.reject(new TypeError("' + SECRET + '"))</script>'
  };
  let add = 'throw';
  await p.route('**/' + GAME + '/?frame', async route => {   // the game's page, as its frame asks for it
    const r = await route.fetch(), html = await r.text();
    await route.fulfill({ response: r, body: add ? html.replace('</head>', ADD[add] + '</head>') : html });
  });
  await p.addInitScript(fakeNet('aaaaaaaaaaaa'));
  await p.addInitScript(() => { navigator.clipboard.writeText = t => { window.__copied = t; return Promise.resolve(); }; });
  await p.goto(U);
  await p.waitForSelector('#shelf:not([hidden])');
  await p.click(CARD);
  const n = await until(async () => { const x = await note(p); return x.shown && /Гра зламалася/.test(x.text) && x; }, 15000);
  check(n && n.over, '«Гра зламалася» over the game', n);
  check(n && /Скопіювати звіт/.test(n.text) && /До бібліотеки/.test(n.text), 'with «Скопіювати звіт» and «До бібліотеки»', n);
  check(n && n.focus === 'stage-report', 'the focus on «Скопіювати звіт»', n && n.focus);
  await w(1500);
  check((await note(p)).over, 'and it stays once the game\'s page has loaded', await note(p));
  await p.click('#stage-report');
  const copied = await until(() => p.evaluate(() => window.__copied), 3000);
  check(/^Ігротека dev\nno room\ntrace:\n/.test(copied || ''), 'the report: the site\'s version, the connection, the trace', copied);
  check(new RegExp('game ' + GAME + ' open').test(copied || '') && new RegExp('error in the game: TypeError at ' + GAME + ':\\d+:\\d+').test(copied || ''), 'the trace: the game opened, the error\'s type and place', copied);
  check(!(copied || '').includes(SECRET), 'never the error\'s message', copied);
  check(await p.textContent('#stage-report') === 'Скопійовано ✓', 'the button says it copied');

  await p.click('#stage-back');
  await p.waitForSelector('#shelf:not([hidden])');
  add = null;
  await p.click(CARD);
  const f = await (await p.waitForSelector('iframe.frame')).contentFrame();
  await f.waitForFunction(started);
  await w(500);
  check(!(await note(p)).shown, 'opened again (no error): no note', await note(p));
  await w(5500);                                          // (started: an error now is the game's, not a broken start)
  await f.evaluate(s => { setTimeout(() => { throw new RangeError(s); }); }, SECRET);
  check(await until(() => traced(p, /error in the game: RangeError/), 3000), 'a later error goes into the trace');
  await w(300);
  check(!(await note(p)).shown, 'and shows no note', await note(p));
  await p.evaluate(() => { setTimeout(() => { throw new URIError('x'); }); });
  check(await until(() => traced(p, /error on the page: URIError/), 3000), 'the library page\'s own error too');
  check(!(await p.evaluate(() => window.__ihroteka.trace().join('\n'))).includes(SECRET), 'nowhere its message');
  check(thrown.length >= 2 && thrown.every(m => m.includes(SECRET) || m === 'x'), 'no other uncaught error', thrown);

  await p.evaluate(() => history.back());                // (the game runs: no note, no button; Back leads to the shelf)
  await p.waitForSelector('#shelf:not([hidden])');
  add = 'loop';
  await p.click(CARD);
  const g = await (await p.waitForSelector('iframe.frame')).contentFrame();
  await g.waitForFunction(started);
  check(await until(() => traced(p, /the game's ResizeObserver looped \(a notice\)/), 3000), 'a ResizeObserver loop as the game starts: a notice in the trace');
  await w(1000);
  check(!(await note(p)).shown, 'and no note: the game did not break', await note(p));
  check(!(await traced(p, /error in the game: null/)), 'not counted as the game\'s error');

  await p.evaluate(() => history.back());
  await p.waitForSelector('#shelf:not([hidden])');
  add = 'refused';
  await p.click(CARD);
  const h = await (await p.waitForSelector('iframe.frame')).contentFrame();
  await h.waitForFunction(started);
  check(await until(() => traced(p, /the browser refused the game: NotAllowedError.*\(a notice\)/), 3000), 'the browser\'s refusal left uncaught as the game starts: a notice in the trace');
  await w(1000);
  check(!(await note(p)).shown, 'and no note: the game plays on', await note(p));
  check(!(await traced(p, /error in the game: NotAllowedError/)), 'not counted as the game\'s error');

  await p.evaluate(() => history.back());
  await p.waitForSelector('#shelf:not([hidden])');
  add = 'rejected';
  await p.click(CARD);
  const r = await until(async () => { const x = await note(p); return x.shown && /Гра зламалася/.test(x.text) && x; }, 15000);
  check(r && r.over, 'its own error left rejected as it starts: «Гра зламалася»', r);
  check(await traced(p, /error in the game: TypeError/), 'the trace has its type', await p.evaluate(() => window.__ihroteka.trace()));
  check(!(await p.evaluate(() => window.__ihroteka.trace().join('\n'))).includes(SECRET), 'never its message (nor the refusal\'s)');
});
