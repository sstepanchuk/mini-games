// tags: @ci
// nearbycam: the camera in nearby pairing (owner, decision 34; library/app/qr.js Camera, invite.js). It goes on as a
// code is first shown (while it runs, the browser gives WebRTC this device's real addresses, so phones nearby link
// more often), and the dialog says why under «Готую код…» and on step 1: «Браузер може спитати дозволу на камеру…».
// While the page is hidden (another app in front) it is off, and on again when the page is back: on a code shown and
// on the scan screen, where a pasted code still links; never while a code is being made (that is when it matters).
// A camera that ends by itself is asked for once more, then the code is pasted by hand. Every way out leaves it off:
// Escape, «Скасувати», linked, failed, another version. Chromium only (its fake camera; getUserMedia counted in the page).
'use strict';
const { scenario, check, step, until, skip, CHROMIUM } = require('./support/scenario.cjs');
const { phone, pair, allLinked, libState } = require('./support/pages.cjs');

if (!CHROMIUM) skip('the fake camera is Chromium’s');
const LINE = 'Браузер може спитати дозволу на камеру: вона знадобиться на кроці 2, і з нею пристрої поруч з’єднуються надійніше';

// in the page, before the library: every camera stream it gets, its tracks stopped (and whether a code showed then),
// and whether the dialog said the line while it made a code
function CAMS(line) {
  window.__cams = []; window.__stops = []; window.__busyLine = false;
  const md = navigator.mediaDevices, gum = md.getUserMedia.bind(md);
  md.getUserMedia = async c => { const s = await gum(c); window.__cams.push(s); return s; };
  const stop = MediaStreamTrack.prototype.stop;
  MediaStreamTrack.prototype.stop = function () { if (this.readyState === 'live') window.__stops.push({ code: !!document.querySelector('canvas.qr') }); return stop.call(this); };
  window.__live = () => window.__cams.reduce((n, s) => n + s.getTracks().filter(t => t.readyState === 'live').length, 0);
  new MutationObserver(() => {
    const t = document.querySelector('.dialog')?.textContent || '';
    if (/Готую код/.test(t) && t.includes(line)) window.__busyLine = true;
  }).observe(document, { subtree: true, childList: true, characterData: true });
}
const cam = X => X.p.evaluate(() => ({ asked: window.__cams.length, live: window.__live() }));
const liveIs = (X, n, ms = 5000) => until(async () => (await cam(X)).live === n, ms, 50);
const hide = (X, on) => X.p.evaluate(on => window.__hide(on), on);
const showCode = async X => { await X.together(); await X.nearby(); await X.p.click('text=Показати код'); return X.code(); };

scenario('nearbycam: the camera, said and off while the page is hidden', async () => {
  const H = await phone('hhhhhhhhhhhh', 'Ганна', { init: [[CAMS, LINE]] }), G = await phone('gggggggggggg', 'Гліб', { init: [[CAMS, LINE]] });

  step('«Показати код»: the camera, and why');
  await showCode(H);
  check(await H.p.evaluate(() => window.__busyLine), 'under «Готую код…»: «' + LINE + '»');
  check((await H.text()).includes(LINE) && /Крок 1 з 2/.test(await H.text()), '… and on step 1', await H.text());
  check(await liveIs(H, 1), 'the camera is on', await cam(H));

  step('the page hidden on step 1, then back');
  await hide(H, true);
  check(await liveIs(H, 0), 'hidden: the camera is off', await cam(H));
  await hide(H, false);
  check(await liveIs(H, 1), 'back: on again', await cam(H));

  step('Escape, and «Скасувати»');
  await H.p.keyboard.press('Escape');
  check(await liveIs(H, 0), 'Escape: off', await cam(H));
  await showCode(H);
  await H.p.click('.dialog >> text=Скасувати');
  check(await liveIs(H, 0), '«Скасувати»: off', await cam(H));

  step('hidden while the code is being made');
  await H.p.evaluate(() => { window.__stops = []; });
  await H.together(); await H.nearby();
  await H.p.click('text=Показати код');
  await hide(H, true);
  await H.code();
  check(await liveIs(H, 0), 'once the code shows (the page still hidden): off', await cam(H));
  const stops = await H.p.evaluate(() => window.__stops);
  check(stops.length && stops.every(s => s.code), 'never off while the code was being made', stops);
  await hide(H, false);
  check(await liveIs(H, 1), 'back: on again', await cam(H));
  const offer = await H.code();

  step('the scan screen hidden and back; the codes still link');
  await G.together(); await G.nearby();
  await G.p.click('text=Сканувати код');
  await G.p.waitForSelector('video.scan');
  check(await liveIs(G, 1), 'Гліб scans: the camera is on', await cam(G));
  await hide(G, true);
  check(await liveIs(G, 0), 'hidden: off', await cam(G));
  await hide(G, false);
  check(await liveIs(G, 1), 'back: on again', await cam(G));
  check(await until(() => G.p.evaluate(() => document.querySelector('video.scan')?.videoWidth > 0), 5000), '… and its picture plays', await cam(G));
  await G.paste(offer);
  const answer = await G.code();
  check(await liveIs(G, 0), 'Гліб shows his code: off', await cam(G));
  await H.p.click('text=Далі: сканувати код друга');
  await H.p.waitForSelector('video.scan');
  await hide(H, true);
  check(await liveIs(H, 0), 'Ганна’s scan screen hidden: off', await cam(H));
  await hide(H, false);
  check(await liveIs(H, 1), 'back: on again', await cam(H));
  check(await until(() => H.p.evaluate(() => document.querySelector('video.scan')?.videoWidth > 0), 5000), '… and its picture plays', await cam(H));
  await H.paste(answer);
  check(await allLinked([H, G], 20000), 'the pasted code links them', [await libState(H.p), await libState(G.p)]);
  check(await liveIs(H, 0) && await liveIs(G, 0), 'linked: both cameras off', [await cam(H), await cam(G)]);

  step('the camera ends by itself');
  await until(async () => !(await H.p.$('.backdrop')), 5000);
  await H.together();
  await H.p.click('text=Додати гравця');
  await H.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.p.waitForSelector('video.scan');
  check(await liveIs(H, 1), 'scanning: on', await cam(H));
  const end = () => H.p.evaluate(() => { const t = window.__cams[window.__cams.length - 1].getVideoTracks()[0]; t.stop(); t.dispatchEvent(new Event('ended')); });
  const asked = (await cam(H)).asked;
  await end();
  check(await until(async () => { const c = await cam(H); return c.asked === asked + 1 && c.live === 1; }, 5000), 'it is asked for once more, and runs', await cam(H));
  await end();
  const manual = async () => H.p.evaluate(() => { const i = document.querySelector('.dialog form:not([hidden]) input.link'); return !!i && i.getClientRects().length > 0; });
  check(await until(async () => await manual() && /Камера недоступна: встав код, скопійований з іншого екрана\./.test(await H.text()), 5000), 'ended again: the code is pasted by hand', await H.text());
  check((await cam(H)).asked === asked + 1 && (await cam(H)).live === 0, 'not asked for a third time; off', await cam(H));
  await H.p.keyboard.press('Escape');

  step('a pairing that fails: off');
  const X = await phone('xxxxxxxxxxxx', 'Ганна', { init: [[CAMS, LINE]] });   // (the host's own name: refused at once)
  await pair(H, X, { adding: true });
  check(await until(async () => /Не вдалося з’єднатися/.test(await H.text()), 15000, 300), 'the same name: it fails', await H.text());
  check(await liveIs(H, 0), 'failed: Ганна’s camera off', await cam(H));
  await H.p.click('.dialog >> text=Закрити');
  await X.b.close();

  step('another version: off');
  const Y = await phone('yyyyyyyyyyyy', 'Яна', { init: [[CAMS, LINE]] });
  await Y.p.context().route('**/lib/ihroteka.js*', async route => {   // (its library says PROTO + 1: as nearver)
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace(/\b(var|let|const) PROTO = (\d+);/, (_, k, n) => k + ' PROTO = ' + (+n + 1) + ';') });
  });
  await Y.p.reload();
  await Y.p.waitForSelector('#shelf:not([hidden])');
  await pair(H, Y, { adding: true });
  check(await until(async () => /Інша версія/.test(await H.text()), 15000, 300), '«Інша версія»', await H.text());
  check(await liveIs(H, 0), 'another version: Ганна’s camera off', await cam(H));
}, { timeout: 180000 });
