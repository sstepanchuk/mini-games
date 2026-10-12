// Friends on different versions (owner, decision 9): of the library (config.js PROTO: the room does not link them,
// it says status 'version') or of a game (game.json "wire": they are not seated together). Both sides learn it
// («Онови сторінку — у друга інша версія»), and the older page updates itself when no game is open there (a round may
// run in one, even alone) and the room is not nearby (the shell does it: shell.reload; here, the decision shows in
// state().version.reloading, and reloadDone says what the shell does once the offline copy is in place). A library
// or a game that says no number is as old as the number: version 1. In worker tabs (tests/support).
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
    assert.deepEqual(v[0], { gap: { why: 'wire', game: 'g', theirs: 2, older: true, key: 'wire:g:2' }, reloading: 'wire:g:2', offer: true }, 'Аня (older) updates');
    assert.deepEqual(v[1], { gap: { why: 'wire', game: 'g', theirs: 1, older: false, key: 'wire:g:1' }, reloading: null, offer: false }, 'Богдан (newer) waits');
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
});
