// Library versions in one room (config.js PROTO, phase 1a: J1), in worker tabs over fake brokers and fake direct
// links (tests/support), each tab running a library of its own: this one; this one with PROTO + 1 (what the next
// wire version will be); and the newest release tag whose library differs from this one (git archive; skipped in a
// checkout without tags, such as CI's shallow clone). Another version is not linked, over the internet or nearby,
// and both sides say status 'version' with the other's number (room.versionMismatch); the previous release, whose
// handshakes say no version or this one, still plays with this one either way round.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { previousRelease } from '../support/release.js';
import { settled, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const LIB = fileURLToPath(new URL('../../library', import.meta.url));
let dir, next, prev;

// this library with PROTO + 1
function nextVersion() {
  const to = join(dir, 'next');
  cpSync(LIB, to, { recursive: true });
  const f = join(to, 'net', 'config.js'), s = readFileSync(f, 'utf8');
  const out = s.replace(/^export const PROTO = (\d+);/m, (_, n) => 'export const PROTO = ' + (+n + 1) + ';');
  if (out === s) throw new Error('library/net/config.js: no line "export const PROTO = <n>;"');
  writeFileSync(f, out);
  return to;
}
const lastStatus = async tab => (await tab.events()).filter(e => e[1] === 'status').map(e => e[2]).pop();
// the numbers of one kind of message (t) a tab got from one player, in the order they came
const numbers = async (tab, from, t = 'x') => (await tab.got()).filter(g => g.startsWith(from + ':' + t + ':')).map(g => +g.split(':')[2]);
const seq = (from, n) => Array.from({ length: n }, (_, i) => from + i + 1);

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ihroteka-versions-'));
  next = nextVersion();
  prev = previousRelease(dir);                             // (tests/support/release.js)
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

// (each test has its own network and tabs: they run side by side)
describe('library versions in one room', { concurrency: 3 }, () => {
  /* ---------- internet ---------- */
  // ours holds the room first, or the next version does: no link, no merge, both say 'version' for good
  for (const nextFirst of [false, true]) {
    test('internet: a tab of the next version is not linked' + (nextFirst ? ' (it holds the room first)' : '') + '; both say \'version\'; ours still link up', T, async t => {
      const W = world(t), code = nextFirst ? 'ver2' : 'ver1';
      const ours = await W.tab('p1tab'), theirs = await W.tab('p2tab', {}, { library: next });
      const { proto } = await ours.info();
      assert.equal((await theirs.info()).proto, proto + 1);
      const [X, Y] = nextFirst ? [theirs, ours] : [ours, theirs];
      await X.join(code, nextFirst ? 'Богдан' : 'Аня');
      assert.ok(await until(async () => (await X.state()).role === 'host', 5000));
      await Y.join(code, nextFirst ? 'Аня' : 'Богдан');
      assert.ok(await until(async () => (await ours.state()).version === proto + 1 && (await theirs.state()).version === proto, 5000),
        'each learns the other\'s number: ' + JSON.stringify((await states([ours, theirs])).map(s => s.version)));
      await sleep(3500);                                     // (longer than a host's announcement: 2.5 s)
      const [a, b] = await states([ours, theirs]);
      assert.deepEqual([a.linked, a.role, a.players], [false, 'host', ['Аня']], 'ours: a room of its own');
      assert.deepEqual([b.linked, b.role, b.players], [false, 'host', ['Богдан']], 'theirs: a room of its own');
      assert.equal(await lastStatus(ours), 'version', 'alone, ours says \'version\', not \'waiting\'');
      assert.equal(await lastStatus(theirs), 'version');
      const C = await W.tab('p3tab');                        // a friend of our version still gets in
      await C.join(code, 'Сава');
      const s = await until(settled([ours, C]), 8000);
      assert.ok(s, await shows([ours, C, theirs]));
      assert.deepEqual(s[0].players, ['Аня', 'Сава']);
      assert.equal((await theirs.state()).linked, false, 'theirs still alone');
    });
  }

  // A tab of another version that leaves is forgotten once it has not been heard for TIMING.VERSION (while there, it
  // says so at least every 2.5 s alone, every 10 s as a host with guests): the note goes, alone the room waits again
  for (const alone of [true, false]) {
    test('internet: a tab of the next version that left is forgotten' + (alone ? '; alone, ours says \'waiting\' again' : ', also while ours is linked'), T, async t => {
      const W = world(t, { scale: 0.3 }), code = alone ? 'ver5' : 'ver6';
      const ours = await W.tab('p1tab'), theirs = await W.tab('p3tab', {}, { library: next });
      const { proto, timing } = await ours.info();
      await ours.join(code, 'Аня');
      assert.ok(await until(async () => (await ours.state()).role === 'host', 5000));
      if (!alone) {
        const C = await W.tab('p2tab');
        await C.join(code, 'Сава');
        assert.ok(await until(settled([ours, C]), 8000), await shows([ours, C]));
      }
      await theirs.join(code, 'Богдан');
      assert.ok(await until(async () => (await ours.state()).version === proto + 1, 5000), 'ours hears it');
      await sleep(timing.VERSION + 1000);
      assert.equal((await ours.state()).version, proto + 1, 'still there (heard again and again): not forgotten');
      if (alone) assert.equal(await lastStatus(ours), 'version');
      await theirs.leave();
      assert.ok(await until(async () => (await ours.state()).version === null, timing.VERSION + 4000), 'gone: forgotten');
      if (alone) assert.equal(await lastStatus(ours), 'waiting', 'alone, ours waits for friends again');
      else assert.ok((await ours.state()).linked);
    });
  }

  // The previous release (its handshakes say no version: 1) with this one, either one holding the room
  for (const oldFirst of [true, false]) {
    test('internet: the previous release and this one play together (' + (oldFirst ? 'the old one' : 'this one') + ' holds the room)', T, async t => {
      if (!prev) { t.skip('no earlier release tag in this checkout'); return; }
      const W = world(t), code = oldFirst ? 'ver3' : 'ver4';
      const old = await W.tab('p1tab', {}, oldFirst ? { library: prev.library } : {}), neu = await W.tab('p2tab', {}, oldFirst ? {} : { library: prev.library });
      const [O, N] = oldFirst ? [old, neu] : [neu, old];     // O: the old library, N: this one
      await old.join(code, 'Аня');
      assert.ok(await until(async () => (await old.state()).role === 'host', 5000));
      await neu.join(code, 'Богдан');
      assert.ok(await until(settled([old, neu]), 8000), prev.tag + ': ' + await shows([old, neu]));
      await O.sendAll(seq(0, 10).map(n => ({ t: 'x', n })));
      await N.sendAll(seq(100, 10).map(n => ({ t: 'x', n })));
      await O.send({ t: 'f', n: 1 }, { fast: true });
      await N.send({ t: 'f', n: 2 }, { fast: true });
      const [on, nn] = [(await O.state()).me, (await N.state()).me];
      const all = async () => (await N.got()).length === 11 && (await O.got()).length === 11;
      assert.ok(await until(all, 5000), (await N.got()) + ' | ' + (await O.got()));
      assert.deepEqual(await numbers(N, on), seq(0, 10), 'the old one\'s reliable ones, in order, once');
      assert.deepEqual(await numbers(O, nn), seq(100, 10), 'and this one\'s');
      assert.deepEqual([await numbers(N, on, 'f'), await numbers(O, nn, 'f')], [[1], [2]], 'fast ones both ways');
      assert.equal((await N.state()).version, null, 'no version said: compatible');
    });
  }

  /* ---------- nearby ---------- */
  // two phones pair: the host shows its code, the guest answers, the host reads the answer
  async function pairUp(H, G) {
    const offer = await H.pair('offer');
    const answer = await G.pair('answer', offer);
    await H.pair('finish', answer);
  }

  test('nearby: two phones of this version pair and link up', T, async t => {
    const W = world(t, { rtc: true });
    const H = await W.tab('p1tab'), G = await W.tab('p2tab');
    await H.near('Аня'); await G.near('Богдан');
    await pairUp(H, G);
    const s = await until(settled([H, G]), 8000);
    assert.ok(s, await shows([H, G]));
    assert.deepEqual(s.map(x => [x.role, x.players.join(), x.version, x.pairing]), [['host', 'Аня,Богдан', null, false], ['guest', 'Аня,Богдан', null, false]]);
    await G.send({ t: 'x', n: 1 });
    assert.ok(await until(async () => (await H.got()).join() === 'Богдан:x:1', 3000));
  });

  test('nearby: a phone of the next version is not linked; both say \'version\' and the pairing ends (no \'failed\')', T, async t => {
    const W = world(t, { rtc: true });
    const H = await W.tab('p1tab'), G = await W.tab('p2tab', {}, { library: next });
    const { proto } = await H.info();
    await H.near('Аня'); await G.near('Богдан');
    await pairUp(H, G);
    assert.ok(await until(async () => (await H.state()).version === proto + 1 && (await G.state()).version === proto, 5000),
      JSON.stringify((await states([H, G])).map(s => s.version)));
    await sleep(1500);                                       // (the refused link closes after a second)
    for (const [tab, s] of [[H, await H.state()], [G, await G.state()]]) {
      assert.deepEqual([s.linked, s.pairing, s.players.length], [false, false, 1], s.me + ': not linked, not pairing');
      assert.equal(await lastStatus(tab), 'version', s.me + ' says \'version\'');
    }
    assert.ok(!(await H.events()).some(e => e[1] === 'status' && e[2] === 'failed'), 'the host does not say the network failed');
    await pairUp(H, await (async () => { const X = await W.tab('p3tab'); await X.near('Сава'); return X; })());   // a phone of ours pairs after it
    assert.ok(await until(async () => (await H.state()).linked, 8000), 'a phone of our version pairs after it: ' + await shows([H]));
  });

  // (since phase 1b the host says its hello only in answer to the guest's: an old one says its own at once, either way)
  for (const oldHost of [true, false]) {
    test('nearby: the previous release pairs with this one (' + (oldHost ? 'the old one' : 'this one') + ' shows the code)', T, async t => {
      if (!prev) { t.skip('no earlier release tag in this checkout'); return; }
      const W = world(t, { rtc: true });
      const H = await W.tab('p1tab', {}, oldHost ? { library: prev.library } : {}), G = await W.tab('p2tab', {}, oldHost ? {} : { library: prev.library });
      await H.near('Аня'); await G.near('Богдан');
      await pairUp(H, G);
      assert.ok(await until(settled([H, G]), 8000), prev.tag + ': ' + await shows([H, G]));
      await H.send({ t: 'x', n: 1 }); await G.send({ t: 'x', n: 2 });
      assert.ok(await until(async () => (await G.got()).join() === 'Аня:x:1' && (await H.got()).join() === 'Богдан:x:2', 3000));
    });
  }
});
