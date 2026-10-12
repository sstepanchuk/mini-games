// The library page in a scenario: open it with the fake network, the "Грати разом" flows (a name, a link, nearby
// codes), and what each page shows. Names and flows are the library's own (library/app/invite.js).
'use strict';
const { fakeNet } = require('./fakenet.cjs');
const { U, w, launch, watch, until } = require('./scenario.cjs');

const SHELF = '#shelf:not([hidden])', NAME = '.dialog input.link';

// the name a player comes in with (the dialog a room link opens with, or the first screen of "Грати разом")
async function enterName(p, name) {
  await p.waitForSelector(NAME);
  await p.fill(NAME, name);
  await p.press(NAME, 'Enter');
}
// A library page (a tab) in ctx with the fake network; opened at url (a room link asks for the name: given here).
// net: fakeNet options.
async function openPage(ctx, pid, url = U, { name, label = name || pid, net } = {}) {
  const p = watch(await ctx.newPage(), label);
  await p.addInitScript(fakeNet(pid, net));
  await p.goto(url);
  await p.waitForSelector(SHELF);
  if (name) await enterName(p, name);
  return p;
}
// "Грати разом" → name → «Через посилання» → the room's link (as its QR code says)
async function createLink(p, name) {
  await p.click('#together');
  await enterName(p, name);
  await p.click('text=Через посилання');
  const h = await p.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code);
  return h.jsonValue();
}
// the open game's frame, once ready(window of the game) holds (by default: it has the library API)
async function frameOf(p, ready = () => !!window.ihroteka, timeout = 15000) {
  const f = await (await p.waitForSelector('iframe.frame', { timeout })).contentFrame();
  await f.waitForFunction(ready, null, { timeout });
  return f;
}
// the library's own view of the room (together.js state()); null for a closed page
const libState = p => p.isClosed() ? Promise.resolve(null) : p.evaluate(() => window.__ihroteka.state());
// the open dialog's text, or '' (whitespace collapsed)
const dialogText = async p => p.isClosed() ? '' : p.evaluate(() => document.querySelector('.dialog')?.innerText.replace(/\s+/g, ' ').trim() || '');
// one line of what a page shows (the library, then game(frame) → text if given)
async function short(p, game) {
  if (p.isClosed()) return 'closed';
  const s = await libState(p);
  let g = '';
  if (game) {
    const e = await p.$('iframe.frame'), f = e && await e.contentFrame();
    g = ' | ' + (f ? await game(f).catch(e => '? ' + e.message) : 'no game');
  }
  return (s.kind || '-') + '/' + (s.role || '-') + (s.linked ? ' linked' : '') + ' ' + (s.me || '-') + ' [' + s.players.map(n => n + (s.away.includes(n) ? '·away' : '')).join(',') + ']' +
    ' view=' + s.view + (s.game ? ' seats=' + s.game.players.join(',') + ' run=' + s.game.host : '') + g;
}

/* ---------- nearby: a phone is a browser of its own (no fake brokers in common with the others) ---------- */
// internet: false (default) = no internet at all, so the dialog goes straight to nearby; net: more fakeNet options
async function phone(pid, name, { internet = false, net = {}, viewport = { width: 420, height: 860 } } = {}) {
  const b = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport, permissions: ['camera'] });
  const p = await openPage(ctx, pid, U, { label: name, net: { brokers: internet, ...net } });
  const X = {
    b, p, name,
    state: () => libState(p),
    text: () => dialogText(p),
    // the QR code on screen (its text)
    code: () => p.waitForFunction(() => document.querySelector('canvas.qr')?.dataset.code, null, { timeout: 20000 }).then(h => h.jsonValue()),
    // a code "scanned" (pasted: the camera is fake)
    paste: async t => {
      if (await p.isVisible('text=Ввести код вручну')) await p.click('text=Ввести код вручну');
      await p.fill(NAME, t);
      await p.press(NAME, 'Enter');
    },
    // "Грати разом", with the name when it is asked for
    together: async () => {
      await p.click('#together');
      await w(200);
      if (await p.isVisible(NAME) && !(await p.isVisible('text=Ввести код вручну'))) { await enterName(p, name); await w(300); }
    },
    // from the menu (with internet) to the nearby screen
    nearby: async () => {
      await p.waitForFunction(() => /Показати код|Через посилання|Додати гравця/.test(document.querySelector('.dialog')?.innerText || ''));
      if (await p.isVisible('text=Через посилання')) await p.click('text=Поруч, без інтернету');
    }
  };
  return X;
}
// H shows its code, G scans it and shows its answer, H scans that (adding: H adds G to a room it already has)
async function pair(H, G, { adding = false } = {}) {
  await H.together();
  if (adding) await H.p.click('text=Додати гравця');
  else { await H.nearby(); await H.p.click('text=Показати код'); }
  const offer = await H.code();
  await G.together(); await G.nearby();
  await G.p.click('text=Сканувати код');
  await G.p.waitForSelector('video.scan');
  await G.paste(offer);
  const answer = await G.code();
  await H.p.click('text=Далі: сканувати код друга');
  await H.paste(answer);
}
// → true once every one of these phones (or pages) is linked
const allLinked = (xs, ms = 15000) => until(async () => (await Promise.all(xs.map(x => libState(x.p || x)))).every(s => s && s.linked), ms);

module.exports = { enterName, openPage, createLink, frameOf, libState, dialogText, short, phone, pair, allLinked };
