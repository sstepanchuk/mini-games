// Library versions in one room (config.js PROTO, phase 1a: J1), in worker tabs over fake brokers and fake direct
// links (tests/support), each tab running a library of its own: this one; this one with PROTO + 1 (what the next
// wire version will be); and the release before the commit that set this wire version, from git history (git archive,
// tests/support/release.js: no tags needed; skipped, with the reason, where there is none, such as a shallow clone; CI
// fetches the whole history and fails instead). Another version is not linked, over the internet or nearby,
// and both sides say status 'version' with the other's number (room.versionMismatch). The previous release speaks
// version 1, before the brokers' traffic was sealed (phase 5, J2: PROTO 2, on another topic): it meets this one only at
// the door (internet.js), where this one says its version and nothing else, and only once the old page spoke there.
// And the release before this one of the same wire version (release.js previousRelease): what this one added to that
// wire is ignored by it, and the two still play as before (a typed name's question, ask: an older host asks nothing, an
// older guest says no ask: the place moves as ever).
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { noPrevious, previousRelease } from '../support/release.js';
import { settled, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const LIB = fileURLToPath(new URL('../../library', import.meta.url));
let dir, next, prev, why, same, whySame;

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

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'ihroteka-versions-'));
  next = nextVersion();
  same = previousRelease(dir);                             // (the library before its last change: this PROTO)
  whySame = noPrevious();
  prev = previousRelease(dir, { older: true });            // (tests/support/release.js: the library just before this PROTO)
  why = noPrevious();
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

  // The previous release (version 1: before the seal) with this one, either one there first: not linked, both say
  // 'version' with the other's number, and a friend of ours still gets in. On the old page's plain topic (a hash of the
  // code) nothing of ours goes before it speaks there; then only our version, from a session of the door's own: no name.
  for (const oldFirst of [true, false]) {
    test('internet: the previous release (before the seal) and this one are not linked; both say \'version\' (' + (oldFirst ? 'the old one' : 'this one') + ' holds the room first)', T, async t => {
      if (!prev) { t.skip('no previous release: ' + why); return; }
      const W = world(t), code = oldFirst ? 'ver3' : 'ver4', S = W.spy({ stranger: true });
      const old = await W.tab('p1tab', {}, { library: prev.library }), neu = await W.tab('p2tab');
      const { proto } = await neu.info(), { legacy } = await neu.info(code), was = (await old.info()).proto ?? 1;
      assert.ok(was < proto, prev.tag + ' speaks an older version: ' + was);
      const [X, Y] = oldFirst ? [old, neu] : [neu, old];
      await X.join(code, 'Аня');
      assert.ok(await until(async () => (await X.state()).role === 'host', 5000));
      if (!oldFirst) {
        await sleep(3000);                                   // (more than a host's announcement: 2.5 s)
        assert.deepEqual(S.seen.filter(x => x.topic === legacy), [], 'the door is quiet while no old page speaks there');
      }
      await Y.join(code, 'Богдан');
      assert.ok(await until(async () => (await neu.state()).version === was && (await old.state()).version === proto, 8000),
        'each learns the other\'s number: ' + JSON.stringify((await states([neu, old])).map(s => s.version)));
      await sleep(3500);
      const [a, b] = await states([X, Y]);
      assert.deepEqual([a.linked, a.role, a.players, b.linked, b.role, b.players], [false, 'host', ['Аня'], false, 'host', ['Богдан']], 'a room each');
      assert.equal(await lastStatus(neu), 'version', 'this one says \'version\'');
      assert.equal(await lastStatus(old), 'version', 'and the old one');
      const door = S.seen.filter(x => x.topic === legacy && x.m.f !== old.session);
      assert.ok(door.length, 'this one spoke at the door');
      for (const x of door) {
        assert.equal(x.m.pv, proto);
        assert.ok(x.m.f !== neu.session && x.m.n === undefined && !/Аня|Богдан/.test(x.raw), 'its version, from a session of the door\'s own, no name: ' + x.raw);
      }
      assert.ok(!S.seen.some(x => x.topic.startsWith('ihroteka/s/') && x.m.f === old.session), 'the old one never reaches the sealed topic');
      const C = await W.tab('p3tab');                        // a friend of our version still gets in
      await C.join(code, 'Сава');
      assert.ok(await until(settled([neu, C]), 8000), await shows([neu, C, old]));
      assert.equal((await old.state()).linked, false, 'the old one still alone');
    });
  }

  // (q18: a typed name asks before it takes a place whose device is still on the line, ask and take on the hello: an older
  // host ignores both, an older guest says neither; PROTO stays)
  test('internet: a host of the release before this one seats a guest that asks, as ever (it knows no question)', T, async t => {
    if (!same) { t.skip('no previous release of this wire version: ' + whySame); return; }
    const W = world(t);
    const A = await W.tab('p1tab', {}, { library: same.library }), B = await W.tab('p2tab');
    await A.join('ver7', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.join('ver7', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    const B2 = await W.tab('p3tab');
    await B2.join('ver7', 'Богдан', { ask: true });
    const s = await until(settled([A, B2]), 8000);
    assert.ok(s, 'the place moves as ever: ' + await shows([A, B2]));
    assert.equal((await B.state()).role, 'out');
    assert.ok(!(await B2.events()).some(e => e[1] === 'status' && e[2] === 'taken'), 'nobody asked');
  });

  test('internet: a guest of the release before this one (it says no ask) takes a place over as ever', T, async t => {
    if (!same) { t.skip('no previous release of this wire version: ' + whySame); return; }
    const W = world(t);
    const [A, B] = [await W.tab('p1tab'), await W.tab('p2tab')];
    await A.join('ver8', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    await B.join('ver8', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    const B2 = await W.tab('p3tab', {}, { library: same.library });
    await B2.join('ver8', 'Богдан', { ask: true });          // (that library has no ask: its hello says none)
    const s = await until(settled([A, B2]), 8000);
    assert.ok(s, 'the place moves as ever: ' + await shows([A, B2]));
    assert.equal((await B.state()).role, 'out');
  });

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

  // the next version, and the previous release (nearby, only its number differs: the seal is the brokers')
  for (const which of ['next', 'previous']) {
    test('nearby: a phone of the ' + which + ' version is not linked; both say \'version\' and the pairing ends (no \'failed\')', T, async t => {
      const library = which === 'next' ? next : prev && prev.library;
      if (!library) { t.skip('no previous release: ' + why); return; }
      const W = world(t, { rtc: true });
      const H = await W.tab('p1tab'), G = await W.tab('p2tab', {}, { library });
      const { proto } = await H.info(), theirs = (await G.info()).proto ?? 1;
      assert.notEqual(theirs, proto);
      await H.near('Аня'); await G.near('Богдан');
      await pairUp(H, G);
      assert.ok(await until(async () => (await H.state()).version === theirs && (await G.state()).version === proto, 5000),
        JSON.stringify((await states([H, G])).map(s => s.version)));
      await sleep(1500);                                     // (the refused link closes after a second)
      for (const [tab, s] of [[H, await H.state()], [G, await G.state()]]) {
        assert.deepEqual([s.linked, s.pairing, s.players.length], [false, false, 1], s.me + ': not linked, not pairing');
        assert.equal(await lastStatus(tab), 'version', s.me + ' says \'version\'');
      }
      assert.ok(!(await H.events()).some(e => e[1] === 'status' && e[2] === 'failed'), 'the host does not say the network failed');
      await pairUp(H, await (async () => { const X = await W.tab('p3tab'); await X.near('Сава'); return X; })());   // a phone of ours pairs after it
      assert.ok(await until(async () => (await H.state()).linked, 8000), 'a phone of our version pairs after it: ' + await shows([H]));
    });
  }

  // (audit, deploy-day-live-02: the library's dialog leaves the room the moment it hears 'version', in the same call,
  // app/invite.js otherVersion; a host that heard it before it answered never said its own hello, and the other phone
  // waited at «Чекаю на з’єднання…» for good. Not here: a host of the previous release that leaves so, which cannot
  // answer either; what our phone says then waits for the owner)
  for (const [which, oursHost] of [['next', true], ['previous', true], ['next', false]]) {
    test('nearby: the host leaves the moment it hears another version (as the library\'s dialog does): the guest says version too (' +
      (oursHost ? 'a guest of the ' + which + ' version' : 'a host of the ' + which + ' version') + ')', T, async t => {
      const library = which === 'next' ? next : prev && prev.library;
      if (!library) { t.skip('no previous release: ' + why); return; }
      const W = world(t, { rtc: true });
      const ours = await W.tab('p1tab'), theirs = await W.tab('p2tab', {}, { library });
      const [H, G] = oursHost ? [ours, theirs] : [theirs, ours];
      await H.near('Аня', { leaveOn: 'version' }); await G.near('Богдан');
      await pairUp(H, G);
      assert.ok(await until(async () => (await H.events()).some(e => e[1] === 'leaveOn'), 5000), 'the host hears it and leaves');
      const s = await until(async () => { const x = await G.state(); return await lastStatus(G) === 'version' && !x.pairing && x; }, 5000);
      assert.ok(s, 'the guest says \'version\', its pairing over: ' + (await lastStatus(G)) + ' ' + JSON.stringify(await G.state()));
      await sleep(1500);
      assert.deepEqual([await lastStatus(G), (await G.state()).linked], ['version', false], 'and stays so');
    });
  }

  // (the same: the dialog of a host already linked ends only the pairing, room.pair.cancel)
  test('nearby: a host already linked adds a phone of another version: that phone says version', T, async t => {
    const W = world(t, { rtc: true });
    const H = await W.tab('p1tab'), G = await W.tab('p2tab'), X = await W.tab('p3tab', {}, { library: next });
    const { proto } = await H.info();
    await H.near('Аня', { leaveOn: 'version' }); await G.near('Богдан'); await X.near('Сава');
    await pairUp(H, G);
    assert.ok(await until(settled([H, G]), 8000), await shows([H, G]));
    await pairUp(H, X);
    const x = await until(async () => { const s = await X.state(); return s.version === proto && !s.pairing && s; }, 5000);
    assert.ok(x, 'the new phone learns our number, its pairing over: ' + JSON.stringify(await X.state()));
    assert.ok((await H.events()).some(e => e[1] === 'leaveOn'), 'the host heard it (and ended the pairing)');
    await sleep(1500);
    assert.deepEqual([await lastStatus(X), (await X.state()).linked], ['version', false], 'the new phone says \'version\'');
    const s = await until(settled([H, G]), 1000);
    assert.ok(s, 'the room goes on: ' + await shows([H, G]));
    assert.deepEqual(s[0].players, ['Аня', 'Богдан']);
  });
});
