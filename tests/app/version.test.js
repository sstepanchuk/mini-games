// Friends on different versions (owner, decision 9): of the library (config.js PROTO: the room does not link them,
// it says status 'version') or of a game (game.json "wire": they are not seated together), or a game that one shelf has
// and another not (decision 36: which page is the older, the site says: the shell's newer()). Each side learns its part
// (decision 37: the older «У друга новіша версія — онови сторінку», the newer «У друга старіша версія — хай оновить
// сторінку»), over a game only of that game or the library (decision 35), and the older page updates itself when no game
// is open there (a round may run in one, even alone), the password is not being typed (decision 38: the shell's busy())
// and the room is not nearby (the shell does it: shell.reload; here, the decision shows in state().version.reloading,
// and reloadDone says what the shell does once the offline copy is in place; an update that brings nothing to reload
// into, the tab's reloadAnswer, shows in state().version.failed). A copy is seated by the wire of the game code that runs
// (open(id, { wire })), whatever its shelf says. A library or a game that says no number is as old as the number:
// version 1. In worker tabs (tests/support).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readManifest, shelfEntry, withLibraryApi } from '../../tools/build.js';
import { room, settled, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 30000 };
const LIBRARY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../library');
const scratch = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-version-')); scratch.push(d); return d; };
process.on('exit', () => { for (const d of scratch) fs.rmSync(d, { recursive: true, force: true }); });

describe('a game\'s wire number in game.json', () => {
  const manifest = extra => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'game.json'), JSON.stringify({ title: 'T', tagline: 't', description: 'd', image: 'p.png', ...extra }));
    fs.writeFileSync(path.join(dir, 'p.png'), '');
    return () => readManifest('demo', dir);
  };
  test('optional, a whole number from 1; 1 when not given; on the shelf and in the game\'s page', () => {
    assert.equal(manifest({ wire: 3 })().wire, 3);
    for (const wire of [0, -1, 1.5, '2', null, 2 ** 53]) assert.throws(manifest({ wire }), /"wire" must be a whole number from 1/, JSON.stringify(wire));
    const g = manifest({})();
    assert.equal(shelfEntry('demo', g).wire, 1);
    assert.equal(shelfEntry('demo', { ...g, wire: 4 }).wire, 4);
    const html = withLibraryApi('<!doctype html><html><head><meta charset="utf-8"></head></html>', 'demo', { ...g, wire: 4 });
    assert.match(html, /\{"id":"demo","title":"T","players":\{"min":2,"max":2\},"wire":4\}/);
  });
});

describe('friends on different versions', { concurrency: 3 }, () => {
  // Богдан's library says his copy of 'g' speaks wire 2 (what a newer library writes: wire:<name>); Аня's says 1
  // (a worker tab's shell names no wires: every game 1).
  test('another wire of the open game: not seated together; the older page knows it and updates itself', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'ver1', ['Аня', 'Богдан'], { lib: {} });
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2, other: 1 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    const v = await until(async () => (await A.state()).lib.version.reloading && (await A.state()).lib.version, 3000);
    assert.ok(v, 'Аня\'s page updates itself (nobody plays there): ' + JSON.stringify((await A.state()).lib.version));
    assert.deepEqual(v.gap, { why: 'wire', game: 'g', theirs: 2, older: true, key: 'wire:g:2' });
    assert.equal(v.reloading, 'wire:g:2');
    assert.equal(v.offer, true, 'the note offers «Оновити» on the older page');
    await A.open('g');                                       // the room goes into the game: Богдан follows
    assert.ok(await until(async () => (await B.game())?.view === 'g', 5000));
    await sleep(800);
    const a = await A.game();
    assert.deepEqual([a.players, a.waiting, a.linked], [['Аня'], [], false], 'Аня does not play with Богдан\'s copy of another wire');
    assert.ok(!a.events.some(e => e[1] === 'linked'));
  });

  // Both shelves say their numbers (shell.wires): Аня's copy of 'g' speaks 1, Богдан's 2.
  test('another wire of the open game, both sides: neither plays with the other; only the older page updates itself', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.lib('ver6', 'Аня', {}, { g: 1, other: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('ver6', 'Богдан', {}, { g: 2, other: 1 });
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    const v = await until(async () => { const [a, b] = await states([A, B]); return a.lib.version.reloading && b.lib.version.gap && [a.lib.version, b.lib.version]; }, 3000);
    assert.ok(v, JSON.stringify((await states([A, B])).map(s => s.lib.version)));
    assert.deepEqual(v[0], { gap: { why: 'wire', game: 'g', theirs: 2, older: true, key: 'wire:g:2' }, reloading: 'wire:g:2', offer: true, failed: null }, 'Аня (older) updates');
    assert.deepEqual(v[1], { gap: { why: 'wire', game: 'g', theirs: 1, older: false, key: 'wire:g:1' }, reloading: null, offer: false, failed: null }, 'Богдан (newer) waits');
    await A.open('g');
    assert.ok(await until(async () => (await B.game())?.view === 'g', 5000));
    await sleep(800);
    const g = await Promise.all([A.game(), B.game()]);
    assert.deepEqual(g.map(x => [x.players, x.linked]), [[['Аня'], false], [['Богдан'], false]], 'each alone in its copy');
    // what an older page of Богдан's said, its clock ahead (passed on by Сава, as it was written): his page says his own again
    const C = await W.tab('p3tab');
    await C.lib('ver6', 'Сава');
    assert.ok(await until(settled([A, B, C]), 8000), await shows([A, B, C]));
    await C.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 1 }, c: Date.now() + 60000, a: 'Богдан' }]] });
    await sleep(800);
    assert.equal((await A.state()).lib.version.gap?.theirs, 2, 'Аня knows Богдан\'s copy speaks 2: ' + JSON.stringify((await A.state()).lib.version));
  });

  // A page open since before a deploy: its shelf (read when the page loaded) says the game speaks wire 1, while the
  // game it opens now is the new code, which speaks 2 (its own page says so, game-api.js GAME: shell.js api). The copy
  // that runs decides whom it plays with: Богдан's (2), not Сава's (1); and the others learn its wire before its here:.
  test('the running copy\'s wire wins over a stale shelf: seated by the code that runs', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab'), B = await W.tab('p2tab'), C = await W.tab('p3tab');
    await A.lib('ver9', 'Аня', {}, { g: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('ver9', 'Богдан', {}, { g: 2 });
    await C.lib('ver9', 'Сава', {}, { g: 1 });
    assert.ok(await until(settled([A, B, C]), 8000), await shows([A, B, C]));
    const from = (await B.log()).got.length;
    await A.open('g', { wire: 2 });
    const g = await until(async () => { const x = await Promise.all([A.game(), B.game(), C.game()]); return x.every(Boolean) && x[0].linked && x[1].linked && x; }, 5000);
    assert.ok(g, 'Аня plays with Богдан: ' + JSON.stringify((await Promise.all([A.game(), B.game(), C.game()])).map(x => x && [x.players, x.linked])));
    // (in the room's order, which a slow start may change: the host it ends up with first)
    assert.deepEqual([[...g[0].players].sort(), [...g[1].players].sort(), g[2].players, g[2].linked], [['Аня', 'Богдан'], ['Аня', 'Богдан'], ['Сава'], false], 'not with Сава');
    assert.ok(!g[2].events.some(e => e[1] === 'players' && e[2].includes('Аня')), 'Сава\'s copy never seated Аня\'s');
    // what Богдан heard from Аня: her wire numbers (the code's), no later than the here: that names the game
    const heard = (await B.log()).got.slice(from).map(([, m]) => m).filter(m => m.t === 'lib-state' && Array.isArray(m.e));
    const at = test => heard.findIndex(m => m.e.some(([k, e]) => test(k, e)));
    const wire = at((k, e) => k === 'wire:Аня' && e.v.g === 2), here = at((k, e) => k === 'here:Аня' && e.v === 'g');
    assert.ok(wire >= 0 && here >= 0 && wire <= here, 'wire:Аня { g: 2 } (at ' + wire + ') no later than here:Аня (at ' + here + ')');
    const [a, c] = [(await A.state()).lib.version, (await C.state()).lib.version];
    assert.deepEqual([a.gap?.older, a.gap?.theirs], [false, 1], 'Аня\'s copy is the newer: ' + JSON.stringify(a));
    assert.deepEqual([c.gap?.older, c.gap?.key], [true, 'wire:g:2'], 'Сава\'s is the older: ' + JSON.stringify(c));
    assert.equal(await A.call('rstart', { setup: {} }), true);
    // (whichever of them runs it writes the record: wait for it on both)
    const r = await until(async () => { const [a, b] = await states([A, B]); return a.lib.rounds.g?.on && b.lib.rounds.g?.on && a.lib.rounds.g; }, 3000);
    assert.ok(r, 'the round is on for both: ' + JSON.stringify((await states([A, B])).map(s => s.lib.rounds.g)));
    assert.equal(r.w, 2, 'its round is played with the wire of the code that runs');
  });

  // Сава's page at /g/ (a reload): his game opens as his room starts. As Аня's room links him, its list of players may
  // not name him yet, so her here: reaches him before her greeting: it carries her wire numbers, or his copy (wire 1)
  // would seat hers (2) by the number a missing one stands for, and hear 'linked', then 'peer-gone'.
  test('a newcomer whose game is open as it links: our here: never comes before our wire numbers', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.lib('ver14', 'Аня', {}, { g: 1 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await A.open('g', { wire: 2 });
    assert.ok(await until(async () => !!(await A.game()), 3000));
    const C = await W.tab('p3tab', {}, { initial: 'g' });
    await C.lib('ver14', 'Сава', {}, { g: 1 });
    assert.ok(await until(settled([A, C]), 8000), await shows([A, C]));
    assert.ok(await until(async () => (await C.state()).lib.version.gap?.older, 3000), JSON.stringify((await C.state()).lib.version));
    await sleep(500);
    const g = await C.game();
    assert.ok(g && !g.events.some(e => (e[1] === 'players' && e[2].includes('Аня')) || e[1] === 'linked'), 'Сава\'s copy never seated Аня\'s: ' + JSON.stringify(g && g.events));
  });

  // The other way: the shelf says 2, the code that runs speaks 1 (its page from before the deploy), as Богдан's does.
  test('the shelf newer than the code that runs: seated by the code, no version gap', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.lib('ver10', 'Аня', {}, { g: 2 });
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib('ver10', 'Богдан', {}, { g: 1 });
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    await A.open('g', { wire: 1 });
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'they play g together');
    assert.ok(await until(async () => { const [a, b] = await states([A, B]); return !a.lib.version.gap && !b.lib.version.gap; }, 3000),
      JSON.stringify((await states([A, B])).map(s => s.lib.version)));
  });

  // A device with no room for the newer copy (or no network for it: 'failed'): the shell's reload brings nothing
  // newer, so the page stays (the harness answers at once: reloadAnswer). No second try by itself for that version (it
  // would download the whole copy again and again); the player's «Оновити» tries again. RELOADED is noted only for a
  // reload that really happens.
  test('an update that cannot be stored: no reload, the version says why, no second try by itself; «Оновити» tries again', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab', {}, { reloadAnswer: 'storage' });
    await A.lib('ver11', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.lib('ver11', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    const before = await A.stored('ihroteka-reloaded');
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    const v = await until(async () => { const x = (await A.state()).lib.version; return x.failed && x; }, 3000);
    assert.deepEqual(v, { gap: { why: 'wire', game: 'g', theirs: 2, older: true, key: 'wire:g:2' }, reloading: null, offer: true, failed: 'storage' },
      JSON.stringify((await A.state()).lib.version));
    assert.deepEqual((await A.call('facts')).gap, { key: 'wire:g:2', older: true, failed: 'storage', why: 'wire', game: 'g' }, 'the screens\' facts say why too');
    assert.deepEqual(await A.call('reloads'), ['storage'], 'one try');
    await sleep(2500);                                       // (the check runs every second)
    assert.deepEqual(await A.call('reloads'), ['storage'], 'no second try by itself');
    assert.deepEqual(await A.stored('ihroteka-reloaded'), before, 'not noted as reloaded');
    await A.open('g');                                       // over the game (Аня alone in it): why, and «Спробувати ще» (decision 37)
    const row = await until(async () => ((await A.state()).lib.game?.screen.rows || []).find(r => r.kind === 'version'), 3000);
    assert.deepEqual(row && [row.text, row.acts.map(a => a.act)],
      ['Бракує місця на пристрої для нової версії Ігротеки: звільни трохи місця й натисни «Спробувати ще»', ['retry']], JSON.stringify(row));
    await A.call('updateNow');                               // «Оновити»
    assert.ok(await until(async () => (await A.call('reloads')).length === 2, 3000), 'the player\'s «Оновити» tries again');
    assert.equal((await A.state()).lib.version.failed, 'storage');
    await A.call('reloadAnswer', { answer: 'reload' });      // room on the device now
    await A.call('updateNow');
    assert.equal((await A.state()).lib.version.failed, null);
    assert.equal(await A.reloadDone(), 'reload');
  });

  // The site has nothing newer yet (the friend's version is not out here, or not to this device yet): no reload into the
  // same version; the page tries again by itself after a while (60 s; here, scaled: 6 s).
  test('an update that finds nothing newer: no reload; tried again by itself after a while', T, async t => {
    const W = world(t, { scale: 0.1 });
    const A = await W.tab('p1tab', {}, { reloadAnswer: 'same' });
    await A.lib('ver13', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.lib('ver13', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    const t0 = Date.now();                                   // (before the try: the next one comes 6 s after it, at the earliest)
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    assert.ok(await until(async () => (await A.state()).lib.version.failed === 'same', 3000), JSON.stringify((await A.state()).lib.version));
    const from = (await A.events()).length;
    assert.deepEqual(await A.call('reloads'), ['same']);
    assert.ok(await until(async () => (await A.call('reloads')).length === 2, 12000), 'tried again: ' + JSON.stringify(await A.call('reloads')));
    assert.ok(Date.now() - t0 > 5500, 'after a while, not at once: ' + (Date.now() - t0) + ' ms');
    await sleep(300);
    assert.deepEqual([(await A.state()).lib.version.reloading, (await A.state()).lib.version.failed], [null, 'same']);
    const told = (await A.events()).slice(from).filter(e => e[1] === 'lib:version');
    assert.deepEqual(told, [], 'quietly: the screens were told the first time');
  });

  // The newer copy still on its way after 30 s (a slow network): no reload then, the version says so; once it is in
  // place after all (shell.js reload's later), the page updates itself into it; one that failed after all says why.
  test('an update still on its way at the deadline: the page stays; in place after all, it reloads into it', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab', {}, { reloadAnswer: 'timeout' });
    await A.lib('ver15', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.lib('ver15', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    const before = await A.stored('ihroteka-reloaded');
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    assert.ok(await until(async () => (await A.state()).lib.version.failed === 'timeout', 3000), JSON.stringify((await A.state()).lib.version));
    await sleep(1500);
    assert.deepEqual(await A.call('reloads'), ['timeout'], 'no second try by itself meanwhile');
    await A.call('reloadAnswer', { answer: 'reload' });
    assert.equal(await A.call('reloadLater', { out: 'activated' }), true);   // the copy is in place after all
    assert.ok(await until(async () => (await A.call('reloads')).length === 2 && (await A.state()).lib.version.reloading, 3000),
      'it updates itself now: ' + JSON.stringify([await A.call('reloads'), (await A.state()).lib.version]));
    assert.equal((await A.state()).lib.version.failed, null);
    assert.deepEqual(await A.stored('ihroteka-reloaded'), before, 'not noted as reloaded before it does');
    assert.equal(await A.reloadDone(), 'reload');
    assert.deepEqual(await A.stored('ihroteka-reloaded'), ['wire:g:2']);
    // the other way: a try that ran past its time and then failed (no room for it) says why, and is not tried again
    const C = await W.tab('p3tab', {}, { reloadAnswer: 'timeout' });
    await C.lib('ver15', 'Сава');
    assert.ok(await until(async () => (await C.state()).lib.version.failed === 'timeout', 8000), JSON.stringify((await C.state()).lib.version));
    assert.equal(await C.call('reloadLater', { out: 'storage' }), true);
    assert.ok(await until(async () => (await C.state()).lib.version.failed === 'storage', 3000), JSON.stringify((await C.state()).lib.version));
    await sleep(1500);
    assert.deepEqual(await C.call('reloads'), ['timeout'], 'not tried again by itself');
  });

  // (the screens toast and announce every 'version': a gap that also starts the self-update is one change, not two)
  test('one version change per pass: a gap that starts the self-update is told once', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'ver12', ['Аня', 'Богдан'], { lib: {} });
    const from = (await A.events()).length;
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    assert.ok(await until(async () => (await A.state()).lib.version.reloading, 3000), 'Аня\'s page updates itself');
    await sleep(500);
    const told = (await A.events()).slice(from).filter(e => e[1] === 'lib:version');
    assert.equal(told.length, 1, JSON.stringify(told));
  });

  test('a round here: the older page does not reload in the middle of it', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'ver2', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'Аня and Богдан play');
    await C.send({ t: 'lib-state', e: [['wire:Сава', { v: { g: 2 }, c: Date.now() + 1000, a: 'Сава' }]] });
    assert.ok(await until(async () => (await A.state()).lib.version.gap?.older, 3000), 'Аня knows Сава\'s copy is newer');
    await sleep(1500);                                       // (the check runs every second)
    assert.equal((await A.state()).lib.version.reloading, null, 'but plays on with Богдан');
    await A.open(null);                                      // the round is over, everyone on the shelf: now
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:g:2', 3000));
  });

  // A game open alone may hold a round played alone (the library cannot see one): only on the shelf.
  test('the older page with a game open, alone in it, does not reload by itself; on the shelf it does', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'ver7', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked, 5000));
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    assert.ok(await until(async () => { const g = await A.game(); return g && !g.linked && (await A.state()).lib.version.gap?.older; }, 3000), 'Аня alone in g, knows she is older');
    await sleep(1500);                                       // (the check runs every second)
    const v = (await A.state()).lib.version;
    assert.deepEqual([v.reloading, v.offer, await A.reloadDone()], [null, true, null], 'no reload: «Оновити» is offered');
    await A.open(null);
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:g:2', 3000), 'on the shelf: now');
    assert.equal(await A.reloadDone(), 'reload');
  });

  // shell.reload waits for the newer offline copy (up to 30 s): a game opened meanwhile (the room went into one) calls
  // the reload off; back on the shelf, it goes. Leaving the room meanwhile: no way back into it after the reload.
  test('a reload under way is called off when a game opens meanwhile, and goes once the page is on the shelf again', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'ver8', ['Аня', 'Богдан'], { lib: {} });
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:g:2', 3000));
    const back = await A.stored('ihroteka-rejoin');
    assert.deepEqual([back?.code, back?.name], ['ver8', 'Аня'], 'back into the room after it');
    await B.open('g');                                       // the room goes into a game: Аня follows, before her offline copy is in
    assert.ok(await until(async () => (await A.game())?.view === 'g', 5000));
    assert.equal(await A.reloadDone(), 'stay', 'called off');
    assert.equal((await A.state()).lib.version.reloading, null);
    await sleep(1500);
    assert.equal((await A.state()).lib.version.reloading, null, 'not again while the game is open');
    await A.open(null);
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:g:2', 3000), 'on the shelf: again');
    assert.equal(await A.reloadDone(), 'reload');
    await A.leave();                                         // (she leaves the room before the reload)
    assert.equal(await A.stored('ihroteka-rejoin'), null, 'leaving the room: the reload does not bring her back into it');
  });

  // A browser that blocks site data: the page could not remember that it reloaded, and would do it on every visit
  // (its player let back into the room each time): it leaves it to the player.
  test('the older page whose browser blocks site data does not reload by itself', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'ver5', ['Аня', 'Богдан'], { lib: {} });
    await A.siteData(false);
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g: 2 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    assert.ok(await until(async () => (await A.state()).lib.version.gap?.older, 3000), 'Аня knows her page is the older');
    await sleep(1500);                                       // (the check runs every second)
    const v = (await A.state()).lib.version;
    assert.deepEqual([v.reloading, v.offer], [null, true], 'no reload by itself; «Оновити» is offered');
    await A.siteData(true);                                  // allowed again: now it does
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:g:2', 3000));
  });

  test('no number for the game (an older library): wire 1, it plays with copies of wire 1', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'ver3', ['Аня', 'Богдан'], { lib: {} });
    await B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { other: 7 }, c: Date.now() + 1000, a: 'Богдан' }]] });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'they play g together');
    assert.equal((await A.state()).lib.version.gap?.game, 'other', 'only the game whose number differs counts');
  });

  // Аня's library is one PROTO newer than Богдан's (a copy of library/ with config.js PROTO + 1): the room does not
  // link them; both say 'version'; Богдан's page (the older) updates itself, Аня's waits for him.
  test('another library version: not linked, both told, the older one updates itself', T, async t => {
    const src = fs.readFileSync(path.join(LIBRARY, 'net/config.js'), 'utf8'), m = /export const PROTO = (\d+);/.exec(src);
    if (!m) { t.skip('config.js has no PROTO yet'); return; }
    const newer = path.join(tmp(), 'library');
    fs.cpSync(LIBRARY, newer, { recursive: true });
    fs.writeFileSync(path.join(newer, 'net/config.js'), src.replace(m[0], 'export const PROTO = ' + (+m[1] + 1) + ';'));
    const W = world(t);
    const A = await W.tab('p1tab', {}, { library: newer });
    await A.lib('ver4', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.lib('ver4', 'Богдан');
    const told = async x => { const s = await x.state(); return s.lib.status === 'version' && s.lib.version.gap && s; };
    const [a, b] = [await until(() => told(A), 8000), await until(() => told(B), 8000)];
    assert.ok(a && b, 'both say version: ' + JSON.stringify([(await A.state()).lib, (await B.state()).lib].map(s => [s.status, s.version])));
    assert.ok(!a.linked && !b.linked, 'not linked');
    assert.deepEqual([a.lib.version.gap.older, a.lib.version.reloading, a.lib.version.offer], [false, null, false], 'Аня (newer) waits, and has no «Оновити»');
    assert.deepEqual([b.lib.version.gap.why, b.lib.version.gap.older, b.lib.version.reloading], ['proto', true, 'proto:' + (+m[1] + 1)], 'Богдан (older) updates');
  });

  // the older page is the one that opened the room (its «Через посилання» screen up, waiting for the friend): that
  // screen is not busy (decision 38: only the password dialog is), the reload is what lets the friend in
  test('another library version, the older page holds the room: it reloads itself back into the room', T, async t => {
    const src = fs.readFileSync(path.join(LIBRARY, 'net/config.js'), 'utf8'), m = /export const PROTO = (\d+);/.exec(src);
    if (!m) { t.skip('config.js has no PROTO yet'); return; }
    const newer = path.join(tmp(), 'library');
    fs.cpSync(LIBRARY, newer, { recursive: true });
    fs.writeFileSync(path.join(newer, 'net/config.js'), src.replace(m[0], 'export const PROTO = ' + (+m[1] + 1) + ';'));
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.lib('ver16', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab', {}, { library: newer });
    await B.lib('ver16', 'Богдан');
    const a = await until(async () => { const s = await A.state(); return s.lib.version.reloading && s; }, 8000);
    assert.ok(a, 'the older page updates itself: ' + JSON.stringify((await A.state()).lib.version));
    assert.deepEqual([a.lib.status, a.lib.linked, a.lib.version.reloading], ['version', false, 'proto:' + (+m[1] + 1)]);
    assert.equal(await A.reloadDone(), 'reload');
    const back = await A.stored('ihroteka-rejoin');
    assert.deepEqual([back?.code, back?.name], ['ver16', 'Аня'], 'back into the room after it');
  });

  /* ---------- the password dialog (decision 38): the page does not reload itself under it ---------- */
  async function pair(W, code) {
    const A = await W.tab('p1tab'), B = await W.tab('p2tab');
    await A.lib(code, 'Аня', {});
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.lib(code, 'Богдан', {});
    assert.ok(await until(settled([A, B]), 10000), await shows([A, B]));
    return [A, B];
  }
  const newerOf = (B, g = 2) => B.send({ t: 'lib-state', e: [['wire:Богдан', { v: { g }, c: Date.now() + 1000, a: 'Богдан' }]] });
  const busy = (X, on) => X.call('shellBusy', { on });

  test('the password dialog over a game being opened: no reload until it closes, then at once', T, async t => {
    const W = world(t);
    const [A, B] = await pair(W, 'ver17');
    await A.call('gameSlow', { on: true });                  // her game's page is not there yet (the dialog is up)
    await busy(A, true);
    await A.open('g');
    await newerOf(B);
    assert.ok(await until(async () => (await A.state()).lib.version.gap?.older, 3000), 'Аня knows she is the older');
    await sleep(2500);                                       // (the check runs every second)
    assert.equal((await A.state()).lib.version.reloading, null, 'no reload under the dialog');
    assert.equal(await A.reloadDone(), null, 'nothing asked of the shell');
    await busy(A, false);                                    // the dialog closed (the password given: the game still opening)
    assert.equal(await until(async () => (await A.state()).lib.version.reloading, 4000), 'wire:g:2');
    assert.equal(await A.reloadDone(), 'reload');
  });

  test('the dialog opens while the offline copy is still on its way: the reload is called off, and asked again once it closes', T, async t => {
    const W = world(t);
    const [A, B] = await pair(W, 'ver18');
    const before = await A.stored('ihroteka-reloaded');
    await newerOf(B);
    assert.equal(await until(async () => (await A.state()).lib.version.reloading, 3000), 'wire:g:2');
    await busy(A, true);                                     // (the shell's reload waits for the service worker: up to 30 s)
    assert.equal(await A.reloadDone(), 'stay', 'still() says no: the dialog is open');
    assert.equal((await A.state()).lib.version.reloading, null);
    assert.deepEqual(await A.stored('ihroteka-reloaded'), before, 'not noted as reloaded');
    await sleep(1500);
    assert.equal((await A.state()).lib.version.reloading, null, 'not again while it is open');
    await busy(A, false);
    assert.equal(await until(async () => (await A.state()).lib.version.reloading, 4000), 'wire:g:2', 'asked again');
    assert.equal(await A.reloadDone(), 'reload');
  });

  test('control: no dialog, a game being opened (its page loading): the reload goes', T, async t => {
    const W = world(t);
    const [A, B] = await pair(W, 'ver19');
    await A.call('gameSlow', { on: true });
    await A.open('g');
    await newerOf(B);
    assert.equal(await until(async () => (await A.state()).lib.version.reloading, 3000), 'wire:g:2');
    assert.equal(await A.reloadDone(), 'reload');
  });

  /* ---------- over a game, that game's version or the library's only (decision 35) ---------- */
  const rowsOf = s => s.lib.game ? s.lib.game.screen.rows.map(r => r.kind + (r.acts.length ? '+' + r.acts.map(a => a.act).join(',') : '')) : null;
  // tabs for these players ([name, the shelf's wires]), the first holds the room → the tabs, linked
  async function libRoom(W, code, list, { near = false } = {}) {
    const tabs = [];
    for (const [i, [name, wires, newer]] of list.entries()) {
      const X = await W.tab('p' + (i + 1) + 'tab');
      if (newer) await X.call('shellNewer', { value: true });     // (the site has a newer version than this page's)
      if (near) await X.libNear(name, {}, wires); else await X.lib(code, name, {}, wires);
      if (near && i) { const H = tabs[0]; await H.pair('finish', await X.pair('answer', await H.pair('offer'))); }
      tabs.push(X);
      if (!i && !near) assert.ok(await until(async () => (await X.state()).role === 'host', 5000));
      else if (i) assert.ok(await until(settled(tabs), 8000), await shows(tabs));
    }
    return tabs;
  }

  test('another version of another game: nothing said over this one (they play it together); the older page still updates on the shelf', T, async t => {
    const W = world(t);
    const [A, B] = await libRoom(W, 'ver20', [['Аня', { g: 1, h: 1 }], ['Богдан', { g: 1, h: 2 }]]);
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:h:2', 3000), 'on the shelf Аня (older in h) updates');
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'they play g together');
    assert.equal(await A.reloadDone(), 'stay', 'called off: a game opened');
    await sleep(1500);
    const [a, b] = await states([A, B]);
    assert.deepEqual([rowsOf(a), rowsOf(b)], [[], []], 'nothing said over g');
    assert.deepEqual([a.lib.version.gap?.game, a.lib.version.offer], ['h', true], 'the page still knows h: ' + JSON.stringify(a.lib.version));
    await A.open(null);
    assert.ok(await until(async () => (await A.state()).lib.version.reloading === 'wire:h:2', 3000), 'back on the shelf: it updates for h');
    assert.equal(await A.reloadDone(), 'reload');
  });

  test('over the game, a third player whose copy of it is newer: the row stays over it, «Оновити» for the older', T, async t => {
    const W = world(t);
    const [A, B, C] = await libRoom(W, 'ver21', [['Аня', { g: 1, h: 1 }], ['Богдан', { g: 1, h: 1 }], ['Сава', { g: 2, h: 1 }]]);
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'Аня and Богдан play g');
    const r = await until(async () => { const x = (await states([A, B, C])).map(rowsOf); return x.every(y => y && y.length) && x; }, 5000);
    assert.deepEqual(r, [['version+update'], ['version+update'], ['version']], JSON.stringify((await states([A, B, C])).map(rowsOf)));
  });

  test('the game whose versions differ, opened: the row over it', T, async t => {
    const W = world(t);
    const [A, B] = await libRoom(W, 'ver22', [['Аня', { g: 1, h: 1 }], ['Богдан', { g: 1, h: 2 }]]);
    await A.open('h');
    assert.ok(await until(async () => (await B.game())?.view === 'h', 5000));
    const r = await until(async () => { const x = (await states([A, B])).map(rowsOf); return x.every(y => y && y.length) && x; }, 5000);
    assert.deepEqual(r, [['version+update'], ['version']]);
  });

  /* ---------- a game one shelf has and another not (decision 36): the site says which page is the older ---------- */
  test('a game added by a deploy: the page without it (the site has newer) updates itself; over the game, the friend is named', T, async t => {
    const W = world(t);
    const [A, B] = await libRoom(W, 'ver23', [['Аня', { g: 1 }, true], ['Богдан', { g: 1, n: 1 }]]);
    await B.open('n');
    const v = await until(async () => { const x = (await A.state()).lib.version; return x.reloading && x; }, 5000);
    assert.ok(v, 'Аня\'s page updates itself: ' + JSON.stringify((await A.state()).lib.version));
    const g = v.gap;
    assert.deepEqual([g.why, g.game, g.older, g.key, g.missing, g.who], ['game', 'n', true, 'game:n', 'ours', ['Богдан']], JSON.stringify(g));
    assert.deepEqual([(await A.state()).lib.myHere, await A.reloadDone()], [null, 'reload'], 'on the shelf (the game is not on hers): it reloads');
    const row = await until(async () => ((await B.state()).lib.game?.screen.rows || []).find(r => r.kind === 'version'), 5000);
    assert.deepEqual(row && [row.text, row.acts], ['Аня не може відкрити цю гру: там інша версія Ігротеки', []], 'Богдан, over the game: ' + JSON.stringify(row));
    assert.deepEqual([(await B.state()).lib.version.gap?.older, (await B.state()).lib.version.reloading, await B.reloadDone()], [false, null, null], 'Богдан\'s page (the site has nothing newer) never reloads');
  });

  test('a game taken off by a deploy: the page that still has it is offered «Оновити» (no reload while it plays); the other never reloads', T, async t => {
    const W = world(t);
    const [A, B] = await libRoom(W, 'ver24', [['Аня', { g: 1, old: 1 }, true], ['Богдан', { g: 1 }]]);
    await A.open('old');
    const row = await until(async () => ((await A.state()).lib.game?.screen.rows || []).find(r => r.kind === 'version'), 5000);
    assert.deepEqual(row && [row.text, row.acts.map(a => a.act)], ['Богдан не може відкрити цю гру: там інша версія Ігротеки', ['update']], 'Аня, over the game: ' + JSON.stringify(row));
    assert.ok(await until(async () => (await B.state()).lib.version.gap?.why === 'game', 3000), 'Богдан knows: ' + JSON.stringify((await B.state()).lib.version));
    await sleep(1500);                                       // (the check runs every second)
    const [a, b] = await states([A, B]);
    assert.deepEqual([a.lib.version.reloading, await A.reloadDone()], [null, null], 'Аня plays: no reload by itself');
    assert.deepEqual([b.lib.version.gap.missing, b.lib.version.gap.older, b.lib.version.reloading, await B.reloadDone()], ['ours', false, null, null], 'Богдан\'s page, the newest, never reloads');
  });

  test('a game one shelf has, nearby: said, no reload either way', T, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await libRoom(W, '', [['Аня', { g: 1 }, true], ['Богдан', { g: 1, n: 1 }]], { near: true });
    await B.open('n');
    assert.ok(await until(async () => (await A.state()).lib.version.gap?.why === 'game', 5000), 'Аня knows: ' + JSON.stringify((await A.state()).lib.version));
    await sleep(1500);
    const [a, b] = await states([A, B]);
    assert.deepEqual([a.lib.version.gap.older, a.lib.version.reloading, a.lib.version.offer, await A.reloadDone()], [true, null, false, null], 'Аня (older): nearby, no reload, nothing to press');
    assert.deepEqual([b.lib.version.reloading, await B.reloadDone()], [null, null]);
  });
});
