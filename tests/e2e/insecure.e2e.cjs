// tags: @ci @webkit
// insecure: a page without Web Crypto, as one served over plain http to another device (`npm run dev -- --lan`; here
// its crypto.subtle taken away before the library runs). «Грати разом» offers nearby only and says why (a link needs
// https), and nearby still starts (a code to show). A room link opened there makes no internet room: status
// 'unavailable', the chip «Лише через https», a note and the dialog say why; nothing goes to the brokers (not the
// room's code either), and the friend who sent the link keeps waiting (phase 3, L4; net/config.js secure).
'use strict';
const { scenario, launch, watch, check, step, until, w, U } = require('./support/scenario.cjs');
const { fakeNet } = require('./support/fakenet.cjs');
const { enterName, openPage, createLink, libState, chipText, dialogText } = require('./support/pages.cjs');

// before the library's code (after the fake network's): no Web Crypto, and every broker connection counted
function PLAIN() {
  Object.defineProperty(Crypto.prototype, 'subtle', { configurable: true, get: () => undefined });
  const connect = window.mqtt.connect;
  window.__connects = 0;
  window.mqtt.connect = function (...a) { window.__connects++; return connect.apply(this, a); };
}

scenario('insecure: no Web Crypto (plain http): nearby only, saying why; a room link opened there stays off the brokers', async () => {
  const ctx = await (await launch()).newContext();
  const plain = async (pid, url, label) => {
    const p = watch(await ctx.newPage(), label);
    await p.addInitScript(fakeNet(pid));
    await p.addInitScript(PLAIN);
    await p.goto(url);
    await p.waitForSelector('#shelf:not([hidden])');
    return p;
  };
  // what the page sent to the brokers: connections, and paths with anything on them
  const sent = p => p.evaluate(() => ({ subtle: !!crypto.subtle, connects: window.__connects, paths: Object.keys(window.__wire).filter(k => k.startsWith('mqtt')) }));
  const quiet = s => !s.subtle && s.connects === 0 && !s.paths.length;

  step('«Грати разом»');
  const P = await plain('pppppppppppp', U, 'plain');
  await P.click('#together');
  await enterName(P, 'Аня');
  await P.waitForSelector('text=Показати код');
  const t = await dialogText(P);
  check(/лише на сторінці, відкритій через https/.test(t) && /Поруч — можна/.test(t), 'it says why: a link needs https; nearby works', t);
  check(/Поруч, без інтернету/.test(t) && /Показати код/.test(t) && /Сканувати код/.test(t), 'nearby: show a code, or scan one', t);
  check(!/Друг може бути де завгодно/.test(t) && !/Інтернету немає/.test(t), 'no link offered, and no false «no internet»', t);
  await P.click('text=Показати код');
  const code = await P.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code, null, { timeout: 20000 }).then(h => h.jsonValue()).catch(() => null);
  const s = await libState(P);
  check(!!code && s.kind === 'nearby' && s.status === 'pairing', 'nearby starts: a code to show', { code: !!code, kind: s.kind, status: s.status });
  await P.keyboard.press('Escape');
  check(quiet(await sent(P)), 'nothing went to the brokers', await sent(P));

  step('a room link opened there');
  const H = await openPage(ctx, 'hhhhhhhhhhhh', U, { label: 'Богдан' });
  const link = await createLink(H, 'Богдан');
  const Q = await plain('qqqqqqqqqqqq', link, 'plain link');
  await enterName(Q, 'Зоя');
  const note = await until(() => Q.evaluate(() => [...document.querySelectorAll('.toast')].map(x => x.textContent).join(' ')), 3000, 50);
  check(/через https/.test(note), 'a note says why', note);
  check(await until(async () => (await libState(Q)).status === 'unavailable', 5000), 'no internet room: unavailable', await libState(Q));
  check(await chipText(Q) === 'Лише через https', 'the chip: «Лише через https»', await chipText(Q));
  await Q.click('#together');
  await Q.waitForSelector('.dialog');
  const d = await dialogText(Q);
  check(/лише на сторінці, відкритій через https/.test(d), 'the dialog says why', d);
  await w(2000);
  const [q, h] = [await libState(Q), await libState(H)];
  check(!q.linked && !h.linked && h.players.join() === 'Богдан', 'the friend keeps waiting: they never meet', { q: [q.status, q.linked], h: [h.status, h.players] });
  check(quiet(await sent(Q)), 'nothing went to the brokers, not the room\'s code either', await sent(Q));
}, { timeout: 90000 });
