// tags: @ci
// layers-motion: what fades as the view changes never covers a dialog that stays open (library/app/motion.js's fx
// layer: ghosts, the page veil, a card in flight; the UX spec's rule 2 and L-T05, L-T12). A dialog open over the game
// while the room goes back to the shelf: the page-coloured veil and the card flying home pass under the dialog, not
// over it. A dialog open over the shelf while a game opens under it (Back, then Forward: as when following a friend):
// at the reveal the opening card's ghost fades under the dialog (the game's page a little late, so its page-coloured
// layer is opaque by then). Each moment frozen in the task it starts in (every animation paused), then the dialog's
// paper compared with what it was just before: the same; and the game shown under an open dialog takes no focus from
// it. And a dialog that closes as the room goes back (a password cancelled): its ghost fades over the veil, not hidden
// under it. Motion on, 390×844. E2E_GAME: any game (the probe on
// CI).
'use strict';
const { GAME, launch, scenario, check, step, until, w } = require('./support/scenario.cjs');
const { openPage, frameOf } = require('./support/pages.cjs');

const CARD = 'a.game[href*="/' + GAME + '/"]';
const FRAME = '**/' + GAME + '/?frame';                  // the game's page, as its frame asks for it (the dev server)
const DIALOG = '#layer > .backdrop .dialog';

// every animation of the page stops where it is, in the task a view change starts in (popstate) or in the one its
// game is revealed in (the note hidden): window.__frozen then says which
function freezeOn(kind) {
  window.__frozen = null;
  const freeze = what => {
    for (const a of document.getAnimations()) a.pause();
    const f = document.activeElement;
    window.__focus = !f ? null : f.closest('#layer .dialog') ? 'dialog' : f.tagName;   // (where the focus is then)
    window.__frozen = what;
  };
  if (kind === 'popstate') { addEventListener('popstate', () => freeze('popstate'), { once: true }); return; }
  const note = document.getElementById('stage-note');
  const mo = new MutationObserver(() => { if (note.hidden && document.querySelector('iframe.frame')) { mo.disconnect(); freeze('reveal'); } });
  mo.observe(note, { attributes: true, attributeFilter: ['hidden'] });
}
const thaw = p => p.evaluate(() => { for (const a of document.getAnimations()) a.play(); window.__frozen = null; });
// The share of the dialog's paper (#f8f4ea, where nothing is drawn on it) in screenshot a that is something else in b
// (more than 12 off in a channel; the page's own colour, #eee7d7, is 19 off), read in page p. Only the paper: how its
// words are smoothed may change as other layers come and go, and a cover changes all of it.
const covered = (p, a, b) => !a || !b ? Promise.resolve(1) : p.evaluate(async ([a, b]) => {
  const load = s => new Promise((ok, no) => { const i = new Image(); i.onload = () => ok(i); i.onerror = no; i.src = s; });
  const px = i => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d'); g.drawImage(i, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; };
  const [x, y] = await Promise.all([load(a), load(b)]);
  if (x.width !== y.width || x.height !== y.height) return 1;
  const da = px(x), db = px(y), PAPER = [248, 244, 234];
  let paper = 0, gone = 0;
  for (let k = 0; k < da.length; k += 4) {
    if (PAPER.some((v, i) => Math.abs(da[k + i] - v) > 3)) continue;
    paper++;
    if (PAPER.some((v, i) => Math.abs(db[k + i] - v) > 12)) gone++;
  }
  return paper ? gone / paper : 1;
}, [a, b].map(x => 'data:image/png;base64,' + x.toString('base64')));

scenario('layers-motion: nothing that fades as the view changes covers an open dialog', async () => {
  const b = await launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, motion: true });
  const p = await openPage(ctx, 'layrlayrlayr');
  // the dialog's own pixels (inside its ink frame, away from its edges)
  const shot = async () => {
    const r = await p.evaluate(s => { const d = document.querySelector(s); if (!d) return null; const b = d.getBoundingClientRect(); return { x: b.x + 20, y: b.y + 20, width: b.width - 40, height: b.height - 40 }; }, DIALOG);
    return r && r.width > 0 && r.height > 0 ? p.screenshot({ clip: r, animations: 'allow' }) : null;
  };
  const settled = () => p.evaluate(() => new Promise(r => setTimeout(r, 600)));

  step('a dialog open over the game while the room goes back to the shelf');
  await p.click(CARD);
  const f = await frameOf(p);
  check(await until(() => p.evaluate(() => document.getElementById('stage-note').hidden), 15000, 50), 'the game shows');
  await settled();
  await f.evaluate(() => window.ihroteka.invite());
  await p.waitForSelector(DIALOG);
  await settled();
  const before = await shot();
  await p.evaluate(freezeOn, 'popstate');
  await f.evaluate(() => window.ihroteka.home());
  check(await until(() => p.evaluate(() => window.__frozen === 'popstate'), 5000, 20), 'the shelf again (frozen in the task it came in)');
  const veil = await p.evaluate(() => [...document.querySelectorAll('.ihk-fx > *')].map(n => n.className));
  check(veil.includes('page-veil'), '… under a page-coloured veil that fades off (the fx layer)', veil);
  const after = await shot();
  await thaw(p);
  const n = await covered(p, before, after);
  check(n < 0.01, '… which passes under the dialog: the dialog looks as it did', Math.round(n * 100) + '% of its paper covered');
  await settled();

  step('a dialog open over the shelf while a game opens under it and shows');
  check(!!(await p.$(DIALOG)), 'the dialog is still open on the shelf');
  const before2 = await shot();
  await p.evaluate(freezeOn, 'reveal');
  // (the game's page 400 ms late: its layer is opaque by the reveal, as for any game that is not instant)
  await p.route(FRAME, async r => { await w(400); await r.continue().catch(() => {}); });
  await p.evaluate(() => history.forward());
  check(await until(() => p.evaluate(() => window.__frozen === 'reveal'), 15000, 20), 'the game shows under the dialog (frozen in the task of the reveal)');
  const ghost = await p.evaluate(() => [...document.querySelectorAll('.ihk-fx > *')].map(n => n.className));
  check(ghost.some(c => /stage-note/.test(c)), '… the opening card\'s ghost fades (the fx layer)', ghost);
  const after2 = await shot();
  await p.unroute(FRAME);
  await thaw(p);
  const n2 = await covered(p, before2, after2);
  check(n2 < 0.01, '… under the dialog: the dialog looks as it did', Math.round(n2 * 100) + '% of its paper covered');
  const focus2 = await p.evaluate(() => window.__focus);
  check(focus2 === 'dialog', '… and the dialog keeps the focus (a key typed then goes to its field, not to the game)', focus2);
  await w(300);

  step('a dialog that closes as the room goes back to the shelf (a password cancelled): its ghost over the veil');
  await p.keyboard.press('Escape');                      // (the dialog of the step before, over the game)
  await p.evaluate(() => history.back());
  await until(() => p.evaluate(() => !document.getElementById('shelf').hidden && !document.querySelector('#layer > .backdrop, .ihk-fx > *')), 5000, 50);
  await p.click(CARD);
  const g = await frameOf(p);
  await until(() => p.evaluate(() => document.getElementById('stage-note').hidden), 15000, 50);
  await settled();
  await g.evaluate(() => window.ihroteka.invite());
  await p.waitForSelector(DIALOG);
  await settled();
  await p.evaluate(freezeOn, 'popstate');
  // (closed, then the way back, in one task: as lock.js's dialog closes and the shell goes back)
  await p.evaluate(() => {
    [...document.querySelectorAll('#layer .dialog button')].find(b => b.textContent === 'Закрити').click();
    document.querySelector('iframe.frame').contentWindow.ihroteka.home();
  });
  check(await until(() => p.evaluate(() => window.__frozen === 'popstate'), 5000, 20), 'the shelf again (frozen in the task it came in)');
  const order = await p.evaluate(() => [...document.querySelectorAll('.ihk-fx > *')].map(n => n.classList.contains('backdrop') ? 'dialog' : n.classList.contains('page-veil') ? 'veil' : 'other'));
  check(order.includes('dialog') && order.indexOf('veil') >= 0 && order.indexOf('veil') < order.indexOf('dialog'),
    '… the closed dialog\'s ghost fades over the page-coloured veil, not hidden under it', order);
  await thaw(p);
  await settled();
  await ctx.close();
}, { timeout: 120000 });
