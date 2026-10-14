// The library page in a scenario: open it with the fake network, the "Грати разом" flows (a name, a link, nearby
// codes), and what each page shows. Names and flows are the library's own (library/app/invite.js).
'use strict';
const { fakeNet } = require('./fakenet.cjs');
const { U, w, launch, watch, until, CHROMIUM } = require('./scenario.cjs');

const SHELF = '#shelf:not([hidden])', NAME = '.dialog input.link';

// the name a player comes in with (the dialog a room link opens with, or the first screen of "Грати разом")
async function enterName(p, name) {
  await p.waitForSelector(NAME);
  await p.fill(NAME, name);
  await p.press(NAME, 'Enter');
}
// A library page (a tab) in ctx with the fake network; opened at url (a room link asks for the name: given here).
// net: fakeNet options; false: no fake network (the page's own: the real one, or the dev server's devnet).
async function openPage(ctx, pid, url = U, { name, label = name || pid, net } = {}) {
  const p = watch(await ctx.newPage(), label);
  if (net !== false) await p.addInitScript(fakeNet(pid, net));
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
// the open dialog's text, or '' (whitespace collapsed; without the marks that keep a name from turning the line round,
// U+2066–U+2069: invite.js iso, which a reader never sees)
const dialogText = async p => p.isClosed() ? '' : p.evaluate(() => document.querySelector('.dialog')?.innerText.replace(/[\u2066-\u2069]/g, '').replace(/\s+/g, ' ').trim() || '');
// the card over the game («Чекаємо, поки повернеться …», invite.js; only the card: see waitShown): whether it shows, its text
// (whitespace collapsed), its buttons, and what its live region says to a screen reader (say)
const waitCard = p => p.evaluate(() => {
  const c = document.getElementById('waiting'), say = document.querySelector('#layer .sr[role=status]'), shown = !!c && !c.hidden;
  return { shown, text: shown ? c.innerText.replace(/\s+/g, ' ').trim() : '', buttons: shown ? [...c.querySelectorAll('button')].map(b => b.textContent) : [], say: say ? say.textContent : null };
});
// The waiting message wherever it is (owner, decision 6 (c)): the library's card over the game (#waiting, invite.js),
// or the copy of the game's own <ihroteka-wait> that holds the rows (library/app/screens.js: one at a time, rendered).
// → { where: 'card' | 'screen' | 'both' (never: two messages) | null, text (whitespace collapsed), buttons, say (the
// live region), showing (the first copy's attribute: the kinds said now, null: none), copies (how many the game has) }
const waitShown = p => p.evaluate(() => {
  const norm = t => t.replace(/\s+/g, ' ').trim(), c = document.getElementById('waiting'), say = document.querySelector('#layer .sr[role=status]');
  const card = !!c && !c.hidden && !!c.firstElementChild;
  let doc = null;
  try { doc = document.querySelector('iframe.frame')?.contentDocument || null; } catch (e) {}
  const all = doc ? [...doc.querySelectorAll('ihroteka-wait')] : [];
  const held = all.find(x => x.firstElementChild && x.getClientRects().length > 0);
  const box = held || (card ? c : null);
  return { where: card && held ? 'both' : held ? 'screen' : card ? 'card' : null, text: box ? norm(box.innerText) : '',
    buttons: box ? [...box.querySelectorAll('button')].map(b => b.textContent) : [], say: say ? say.textContent : null,
    showing: all.length ? all[0].getAttribute('showing') : null, copies: all.length };
});
// whatever holds the rows: the card (in the page) or the game's copy that holds them (in its frame), as an
// ElementHandle (its evaluate runs in its own document), or null
async function waitBox(p) {
  const card = await p.$('#waiting:not([hidden])');
  if (card) return card;
  const e = await p.$('iframe.frame'), f = e && await e.contentFrame();
  if (!f) return null;
  return (await f.evaluateHandle(() => [...document.querySelectorAll('ihroteka-wait')].find(x => x.firstElementChild && x.getClientRects().length > 0) || null)).asElement();
}
// press a button of the waiting message, wherever it is (the card's, else the game's screen's)
async function clickWait(p, text) {
  if (await p.isVisible('#waiting:not([hidden])')) return p.click('#waiting >> text=' + text);
  const f = await (await p.$('iframe.frame')).contentFrame();
  return f.click('ihroteka-wait:not(:empty) >> text=' + text);
}
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
// (relayOnly: a browser without WebRTC); init: scripts that run in the phone's pages before the library (functions,
// as context.addInitScript takes them: [fn] or [[fn, arg]]); url: the library it opens (default: E2E_URL's; a dev server
// of the scenario's own, support/newgame.cjs)
async function phone(pid, name, { internet = false, net = {}, viewport = { width: 420, height: 860 }, init = [], url = U } = {}) {
  const b = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext({ viewport, ...(CHROMIUM && { permissions: ['camera'] }) });
  for (const x of init) await (Array.isArray(x) ? ctx.addInitScript(...x) : ctx.addInitScript(x));
  const p = await openPage(ctx, pid, url, { label: name, net: { brokers: internet, ...net } });
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
// Browser contexts of one browser as devices on one network: each context is a device of its own (its own storage:
// what one tab keeps, another device does not see), and the fake brokers (support/fakenet.cjs: a BroadcastChannel,
// which never leaves its context) carry between them too. Call it before any of their pages opens.
async function oneNetwork(...ctxs) {
  const others = c => ctxs.filter(x => x !== c);
  let queue = Promise.resolve();                         // (in the order they were sent, as a broker does)
  const pass = (o, d) => {
    const p = o.pages().find(x => !x.isClosed() && /^https?:/.test(x.url()));   // (one page of that device passes it on)
    return p ? p.evaluate(d => { const bc = new BroadcastChannel('fake-mqtt'); bc.postMessage({ ...d, bridged: 1 }); bc.close(); }, d).catch(() => {}) : null;
  };
  for (const c of ctxs) {
    await c.exposeBinding('__bridge', (src, d) => { queue = queue.then(() => Promise.all(others(c).map(o => pass(o, d)))); });
    await c.addInitScript(() => {
      const post = BroadcastChannel.prototype.postMessage;
      BroadcastChannel.prototype.postMessage = function (d) {
        post.call(this, d);
        if (this.name === 'fake-mqtt' && d && !d.bridged) window.__bridge(d);
      };
    });
  }
}
// → true once every one of these phones (or pages) is linked
const allLinked = (xs, ms = 15000) => until(async () => (await Promise.all(xs.map(x => libState(x.p || x)))).every(s => s && s.linked), ms);

module.exports = { enterName, openPage, createLink, frameOf, libState, dialogText, oneNetwork, waitCard, waitShown, waitBox, clickWait, short, phone, pair, allLinked };
