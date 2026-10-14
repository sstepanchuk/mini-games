// Whose copy runs a round (library/app/together.js with rules.js), in worker tabs that run the real library over
// fake brokers (tests/support), with the room's timing scaled down (window.__timeScale 0.3: AUTH_WAIT and
// HOST_WAIT 3 s). The round moves only when its runner has been gone for AUTH_WAIT, and only with proof that it
// was the runner who dropped out: someone else with the game open here with us, or the brokers answering us all
// that time. The runner back plays on as a guest. A round's snapshot: a game closed mid-round goes on from it when
// opened again, with the same players ('resume' before 'linked'); a round that is over (the game said so, or one of
// its players left for good) leaves a tombstone, and never comes back. Then the round layer, ihroteka.round
// (library/app/round.js, phase 4): one record per game, one writer, requests that expire or hold, snapshots by round
// id, frozen seats, events once per round id, a round lost after LOST_WAIT, and no policy but the game's.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, shows, sleep, until, world } from '../support/world.js';
import { CAP } from '../../library/app/rules.js';

const T = { timeout: 40000 }, SCALE = 0.3;
const evs = (g, from = 0) => g.events.slice(from).map(e => e.slice(1).map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
const snapOf = async (tab, game = 'g') => ((await tab.state()).lib.snaps || {})[game];
const onShelf = tabs => until(async () => (await Promise.all(tabs.map(x => x.game()))).every(g => !g), 5000);
const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names) && g.filter(x => x.seated).every(x => x.linked) && g;
}, 6000);

// (each test has its own network and tabs: they run side by side)
describe('whose copy runs a round', { concurrency: 3 }, () => {
  test('the runner gone: after AUTH_WAIT the first seated player still here runs the round on from its last snapshot', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'run1', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'), 'Аня and Богдан play, Сава waits');
    await A.snapshot({ round: 1, n: 5 });
    await sleep(300);                                        // (the first snapshot goes at once)
    const { AUTH_WAIT } = (await A.info()).timing;
    const t0 = Date.now();
    await A.net({ up: false });
    const b = await until(async () => { const g = await B.game(); return g.role === 'host' && g.events.some(e => e[1] === 'resume') && g; }, AUTH_WAIT + 6000, 50);
    assert.ok(b, 'Богдан runs the round on: ' + evs(await B.game()));
    assert.ok(Date.now() - t0 > AUTH_WAIT - 400, 'not before AUTH_WAIT (' + AUTH_WAIT + ' ms): ' + (Date.now() - t0) + ' ms');
    const e = evs(b);
    assert.ok(e.includes('role host') && e.indexOf('role host') < e.indexOf('resume {"round":1,"n":5}'), 'role, then resume with the snapshot: ' + e);
    assert.equal(b.host, 'Богдан');
    const c = await until(async () => { const g = await C.game(); return g.host === 'Богдан' && g; }, 3000);
    assert.ok(c && !c.seated && c.players.join() === 'Аня,Богдан', 'Сава still waits; Аня keeps her seat');
  });

  test('two players, the runner gone: the other runs on (the brokers answer it all that time); back, the runner plays as a guest', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'run2', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 2 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    const b = await until(async () => { const g = await B.game(); return g.events.some(e => e[1] === 'resume') && g; }, AUTH_WAIT + 6000, 50);
    assert.ok(b, 'Богдан runs the round on: ' + evs(await B.game()));
    assert.ok(evs(b).includes('resume {"round":2}') && b.role === 'host');
    await A.net({ up: true });
    const a = await until(async () => { const g = await A.game(); return g.linked && g.role === 'guest' && g; }, 15000, 100);
    assert.ok(a, 'Аня plays on as a guest: ' + evs(await A.game()));
    assert.ok(evs(a).includes('role guest') && a.host === 'Богдан');
    assert.equal((await B.game()).role, 'host');
  });

  // A copy that ran the round and lost it (it plays as a guest now) has nothing of what came since: when the round
  // comes back to it, it hears 'resume' again, with the newer snapshot (together.js resets legacy.js own on the role).
  test('the round moves away and back: the first runner, in charge again, hears resume with the newer snapshot', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'run8', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 8, n: 1 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.game()).events.some(e => e[1] === 'resume'), AUTH_WAIT + 6000, 50), 'Богдан runs the round on: ' + evs(await B.game()));
    await A.net({ up: true });
    assert.ok(await until(async () => { const g = await A.game(); return g.linked && !g.weak && g.role === 'guest'; }, 15000, 100), 'Аня plays as a guest: ' + evs(await A.game()));
    assert.equal(await B.snapshot({ round: 8, n: 2 }), true);
    assert.ok(await until(async () => (await snapOf(A))?.s?.n === 2, 3000), 'Аня keeps Богдан\'s snapshot: ' + JSON.stringify(await snapOf(A)));
    const n = (await A.game()).events.length;
    await B.net({ up: false });
    const a = await until(async () => { const g = await A.game(); return g.role === 'host' && evs(g, n).some(e => e.startsWith('resume')) && g; }, AUTH_WAIT + 8000, 50);
    assert.ok(a, 'Аня runs the round again, from Богдан\'s snapshot: ' + evs(await A.game(), n));
    assert.deepEqual(evs(a, n).filter(e => e.startsWith('resume')), ['resume {"round":8,"n":2}'], 'once, the newer one');
  });

  test('a player who dropped out themself does not take the round over', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'run3', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 3 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    const n = (await B.game()).events.length;
    await B.net({ up: false });                              // Богдан cannot tell it was not him: nobody vouches for him
    await sleep(AUTH_WAIT + 2500);
    const b = await B.game();
    assert.ok(b.weak, 'Богдан waits (paused)');
    assert.deepEqual(evs(b, n).filter(e => /^(role|resume)/.test(e)), [], 'no takeover: ' + evs(b, n));
    assert.equal(b.host, 'Аня');
    await B.net({ up: true });
    const g = await until(async () => { const x = await Promise.all([A.game(), B.game()]); return x.every(y => y.linked && !y.weak) && x; }, 15000, 100);
    assert.ok(g, 'together again');
    assert.deepEqual(g.map(x => x.role), ['host', 'guest'], 'Аня still runs the round');
  });

  // The room's order may change on a shaky network (rules.runnerOf: else the first seated runs the round): the copy
  // that runs a round names itself in the shared state with its first snapshot, once, so only a takeover moves it.
  test('the runner names itself with its round\'s first snapshot (not alone, not a tombstone, once): the room\'s order cannot move the round', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'run6', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await sleep(300);
    assert.deepEqual((await B.state()).lib.auth, {}, 'nobody named before a round');
    assert.equal(await A.snapshot({ round: 6 }), true);
    assert.ok(await until(async () => (await B.state()).lib.auth.g === 'Аня', 3000), 'Богдан knows: ' + JSON.stringify((await B.state()).lib.auth));
    const keys = async () => (await A.state()).lib.keys.length;
    const n = await keys();
    await A.snapshot({ round: 6, n: 2 }); await A.snapshot(null);
    await sleep(300);
    assert.equal(await keys(), n, 'once: no more writes of it');
    // alone in a game (nobody to play with): no name, as there is no round with anyone
    const C = await W.tab('p3tab');
    await C.lib('run7', 'Сава');
    assert.ok(await until(async () => (await C.state()).role === 'host', 5000));
    await C.open('g');
    assert.ok(await until(async () => (await C.game())?.role === 'host', 3000));
    await C.snapshot({ solo: 1 });
    assert.deepEqual((await C.state()).lib.auth, {});
  });

  // Found by these tests (phase 0): a player back from an outage on the same session, to a room's host that stayed
  // linked with others, was greeted by nobody (together.js greets on 'linked', 'join' and 'relinked'; this was only
  // 'away' → false), so it missed what changed meanwhile, auth:<game> among it: with three players, two copies ran the
  // round. Now the host says 'relinked' for the same tab on a new link (net/internet.js hello), and everyone greets it.
  test('the runner back after the round moved on, in a room of three, learns it and plays on as a guest', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'run5', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await A.snapshot({ round: 5 });
    await sleep(300);
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.game()).events.some(e => e[1] === 'resume'), AUTH_WAIT + 6000, 50), 'Богдан runs the round on');
    await A.net({ up: true });
    const g = await until(async () => { const x = await Promise.all([A.game(), B.game()]); return x.every(y => y.linked && !y.weak) && x; }, 15000, 100);
    assert.ok(g, 'together again');
    await sleep(1500);
    const a = await A.game();
    assert.deepEqual([a.host, (await B.game()).host], ['Богдан', 'Богдан'], 'one runner, the same for both');
    assert.equal(a.role, 'guest', 'Аня plays on as a guest: ' + evs(a));
  });

});

describe('a round\'s snapshot', { concurrency: 3 }, () => {
  test('a round whose runner left for good does not come back (no resume after peer-gone, nor with someone new)', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'run4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 4 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.round === 4, 3000), 'Богдан keeps the round\'s snapshot');
    const n = (await B.game()).events.length;
    await A.leave();                                         // Аня leaves for good: her round is over
    await sleep(1500);
    const e = evs(await B.game(), n);
    assert.ok(e.includes('peer-gone'), 'the round is over: ' + e);
    assert.deepEqual(e.slice(e.indexOf('peer-gone')).filter(x => x.startsWith('resume')), [], 'and it does not come back: ' + e);
    const tomb = await snapOf(B);
    assert.ok(tomb && tomb.s === null && tomb.a === 'Богдан', 'Богдан keeps a tombstone: ' + JSON.stringify(tomb));
    const C = await W.tab('p3tab');                          // someone new: Богдан runs a round with them, not Аня's
    await C.lib('run4', 'Сава');
    assert.ok(await plays([B, C], 'Богдан,Сава'), 'Богдан and Сава play');
    await sleep(500);
    const b = evs(await B.game(), n);
    assert.deepEqual(b.filter(x => x.startsWith('resume')), [], 'no resume of Аня\'s round: ' + b);
    assert.equal((await snapOf(C))?.s, null, 'Сава was greeted with the tombstone');
  });

  test('a game closed mid-round waits: opened again, its runner hears resume before linked and goes on', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap1', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 7, food: [1, 2] });
    await sleep(300);
    await A.open(null);                                      // everyone back to the shelf, mid-round
    assert.ok(await onShelf([A, B]), 'both on the shelf');
    const [na, nb] = (await Promise.all([A.game(), B.game()])).map(g => g ? g.events.length : null);
    assert.equal(na, null);
    assert.deepEqual((await snapOf(A))?.s, { round: 7, food: [1, 2] }, 'the round waits: its snapshot is kept');
    await B.open('g');                                       // opened again (by the other player: Аня follows)
    const g = await plays([A, B], 'Аня,Богдан');
    assert.ok(g, 'together in the game again');
    await sleep(300);
    const a = evs(await A.game()), at = a.lastIndexOf('linked'), r = a.lastIndexOf('resume {"round":7,"food":[1,2]}');
    assert.ok(r >= 0 && r < at, 'Аня runs the round on: resume, then linked: ' + a);
    assert.deepEqual(evs(await B.game()).filter(x => x.startsWith('resume')), [], 'Богдан is a guest: ' + evs(await B.game()));
    assert.equal(nb, null);
  });

  // (README, Listening late: what a game missed before its code listened, once, in the order the room tells it live)
  test('a game that starts listening late hears players, resume, linked, then the messages kept for it', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap7', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 13 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.round === 13, 3000));
    await A.open(null);
    assert.ok(await onShelf([A, B]));
    await A.call('gameLate', { on: true });                  // Аня's game page runs its code late: it listens when told
    await B.open('g');                                       // Аня follows: her copy is linked before it listens
    assert.ok(await until(async () => (await B.game())?.linked, 5000));
    assert.equal(await B.gsend({ t: 'hi' }), true);
    assert.equal(await B.gsend({ t: 'again' }), true);
    await sleep(500);                                        // (they wait for Аня's game to listen)
    const n = (await A.game()).heard.length;
    await A.call('glisten');
    assert.ok(await until(async () => (await A.game()).heard.length >= n + 5, 3000));
    await sleep(200);
    assert.deepEqual((await A.game()).heard.slice(n), ['players', 'resume', 'linked', 'message:hi', 'message:again'], 'once each, in this order');
  });

  test('a round that waited on the shelf does not go on with someone new in the seat of a player who quit', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap2', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 8 });
    await sleep(300);
    await A.open(null);
    assert.ok(await onShelf([A, B]));
    await B.leave();                                         // Богдан leaves for good while nobody has the game open
    const C = await W.tab('p3tab');
    await C.lib('snap2', 'Сава');
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня,Сава', 5000));
    await A.open('g');
    assert.ok(await plays([A, C], 'Аня,Сава'), 'Аня and Сава play');
    await sleep(500);
    const a = evs(await A.game());
    assert.deepEqual(a.filter(x => x.startsWith('resume')), [], 'no resume of a round with Богдан: ' + a);
  });

  // (rules.snapFits: a snapshot kept from a round of other players, say passed on by an older copy, is not ours)
  test('a snapshot of a round with other players does not go on with these', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap9', ['Аня', 'Богдан'], { lib: {} });
    await B.send({ t: 'lib-snap', v: 'g', s: { round: 15 }, c: Date.now() + 1000, a: 'Богдан', p: ['Богдан', 'Яків'] });
    assert.ok(await until(async () => (await snapOf(A))?.s?.round === 15, 3000), 'Аня keeps it');
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await sleep(500);
    const a = evs(await A.game());
    assert.deepEqual(a.filter(x => x.startsWith('resume')), [], 'Аня runs a new round: ' + a);
  });

  // (an older library's snapshot says nothing of its seats: it fits any; still, a round goes on only with someone)
  test('a round goes on only once we play with someone: alone in the game first, the runner hears resume just before linked', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap10', ['Аня', 'Богдан'], { lib: {} });
    await B.send({ t: 'lib-snap', v: 'g', s: { round: 16 }, c: Date.now() + 1000, a: 'Богдан' });
    assert.ok(await until(async () => (await snapOf(A))?.s?.round === 16, 3000));
    await A.open('g');                                       // Аня's copy is alone a moment, until Богдан follows
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await sleep(300);
    const a = evs(await A.game());
    assert.deepEqual(a.slice(a.indexOf('resume {"round":16}') - 1, a.indexOf('linked') + 1), ['players ["Аня","Богдан"]', 'resume {"round":16}', 'linked'], a.join(' | '));
  });

  test('a round that is over leaves a tombstone everywhere, also with who waits for a seat, and an old copy cannot come back', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'snap3', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await A.snapshot({ round: 9 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.round === 9, 3000));
    const B2 = await W.tab('p4tab');                         // Богдан's new tab: greeted with the round
    await B2.lib('snap3', 'Богдан');
    assert.ok(await until(async () => (await snapOf(B2))?.s?.round === 9, 5000), 'the new tab has the round');
    assert.ok(await until(async () => (await B2.game())?.linked, 5000));
    await A.snapshot(null);                                  // the game says: the round is over
    const over = async x => { const s = await snapOf(x); return s && s.s === null; };
    assert.ok(await until(async () => await over(B2) && await over(C), 3000), 'Богдан and Сава (waiting for a seat) keep its tombstone: ' +
      JSON.stringify([await snapOf(B2), await snapOf(C)]));
    const B3 = await W.tab('p5tab');                         // and a tab that comes now is told it is over, by everyone
    await B3.lib('snap3', 'Богдан');
    assert.ok(await until(async () => (await B3.game())?.linked, 5000));
    await sleep(500);
    assert.equal((await snapOf(B3))?.s, null, 'tombstone, not round 9: ' + JSON.stringify(await snapOf(B3)));
  });

  // (review of phase 1a: 'resume' handed the game the library's own object; a game that keeps its state in it changed
  // the snapshot that the library keeps and greets newcomers with)
  test('the round a game resumes is its own copy: changing it changes nothing the library keeps', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'snap6', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await A.snapshot({ round: 12, board: [1, 2] });
    await sleep(300);
    await A.open(null);
    assert.ok(await onShelf([A, B, C]));
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    assert.ok(await until(async () => (await A.game()).events.some(e => e[1] === 'resume'), 3000), 'Аня resumes the round');
    assert.equal(await A.call('gtouch', { ev: 'resume', set: { round: 'live', board: [9] } }), true);
    assert.deepEqual((await snapOf(A)).s, { round: 12, board: [1, 2] }, 'the library keeps the snapshot as it was');
    const D = await W.tab('p4tab');
    await D.lib('snap6', 'Дана');
    assert.ok(await until(async () => (await snapOf(D))?.s, 5000));
    assert.deepEqual((await snapOf(D)).s, { round: 12, board: [1, 2] }, 'and greets newcomers with it');
  });

  // (review of phase 1a: the round waited for the closed game, and came back with the player who had quit)
  test('a player who quits the room while the game is closed ends that round: back later, they start a new one', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap4', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 10 });
    await sleep(300);
    await A.open(null);                                      // the round waits on the shelf…
    assert.ok(await onShelf([A, B]));
    await B.leave();                                         // …and Богдан quits the room
    assert.ok(await until(async () => (await snapOf(A))?.s === null, 3000), 'Аня keeps a tombstone: ' + JSON.stringify(await snapOf(A)));
    await B.lib('snap4', 'Богдан');                          // he comes back (a new place, the same name)
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня,Богдан' && (await B.state()).linked, 5000));
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await sleep(500);
    const a = evs(await A.game());
    assert.deepEqual(a.filter(x => x.startsWith('resume')), [], 'no resume of the round he quit: ' + a);
    assert.equal((await snapOf(B))?.s, null, 'he was greeted with its tombstone');
  });

  // (owner, decision 3: a round waits for a closed game, not for a player who quit; forGame over() in legacy.js)
  test('the partner quits the room mid-round, the game open: the round is a tombstone; whoever waited plays a new one', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'snap8', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await A.snapshot({ round: 14 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.round === 14, 3000));
    assert.equal(await snapOf(C), undefined, 'Сава, waiting for a seat, has none of it');
    const n = (await A.game()).events.length;
    await B.leave();                                         // Богдан quits: Сава gets his seat
    assert.ok(await plays([A, C], 'Аня,Сава'));
    const tomb = await snapOf(A);
    assert.ok(tomb && tomb.s === null && tomb.a === 'Аня', 'Аня keeps a tombstone of the round: ' + JSON.stringify(tomb));
    assert.ok(await until(async () => (await snapOf(C))?.s === null, 3000), 'and so does Сава');
    const a = evs(await A.game(), n);
    assert.ok(a.includes('peer-gone') && !a.some(x => x.startsWith('resume')), a.join(' | '));
  });

  // (review of phase 1a: a guest that looks for the room again (internet.js discover) has only itself in its list for
  // a moment; it took everyone else as gone for good and its tombstone ended the round for all, once it was back)
  test('a guest that starts over looking for the room does not end the round: nobody left', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, C, B] = await room(W, 'snap5', ['Аня', 'Сава', 'Богдан'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Сава,Богдан'));
    await A.snapshot({ round: 11 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.round === 11, 3000));
    // Богдан cut off: his host is away for HOST_WAIT, so he says hello to Сава (whom he takes for the first one
    // here); six hellos unanswered, and he looks for the room again (internet.js discover: role null; before phase 1b
    // his list was then only him, now every place stays)
    await B.net({ up: false });
    assert.ok(await until(async () => (await B.state()).role === null, 20000, 50), 'Богдан started over');
    await B.net({ up: true });
    assert.ok(await until(async () => { const s = await B.state(); return s.linked && s.players.length === 3; }, 15000, 100), 'Богдан is back');
    await sleep(1000);
    const s = await Promise.all([A, B, C].map(x => snapOf(x)));
    assert.deepEqual(s.map(x => x && x.s), [{ round: 11 }, { round: 11 }, { round: 11 }], 'the round is still there: ' + JSON.stringify(s));
  });

  // (review of phase 3: snapshots go out at most twice a second, and the one still waiting for its turn was dropped
  // when the game closed or the page went: back in a new tab, the runner went on one move behind; tests/e2e/newgame)
  test('the runner\'s page closes within half a second of its last snapshot: that one still goes out, and the round goes on from it', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap10', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 20, moves: 1 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.moves === 1, 3000), 'the first one goes at once');
    await A.snapshot({ round: 20, moves: 2 });               // within the half second: it waits for its turn
    await A.close();                                         // a reload: pagehide, and the page is gone
    assert.ok(await until(async () => (await snapOf(B))?.s?.moves === 2, 3000), 'Богдан has the latest: ' + JSON.stringify(await snapOf(B)));
    const A2 = await W.tab('p3tab');                         // Аня's page again
    await A2.lib('snap10', 'Аня');
    const a = await until(async () => { const g = await A2.game(); return g && g.linked && g.events.some(e => e[1] === 'resume') && g; }, 15000, 50);
    assert.ok(a, 'Аня runs the round on: ' + (await A2.game() && evs(await A2.game())));
    assert.ok(evs(a).includes('resume {"round":20,"moves":2}'), 'from the latest snapshot: ' + evs(a));
  });

  test('the runner closes the game within half a second of its last snapshot: the others get that one at once', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'snap11', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.snapshot({ round: 21, moves: 1 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.moves === 1, 3000));
    await A.snapshot({ round: 21, moves: 2 });
    await A.open(null);                                      // back to the shelf, mid-round
    assert.ok(await until(async () => (await snapOf(B))?.s?.moves === 2, 2000), 'Богдан has the latest: ' + JSON.stringify(await snapOf(B)));
    await A.close();                                         // and then the page goes: the round waits with Богдан's copy
    await sleep(300);
    assert.deepEqual((await snapOf(B))?.s, { round: 21, moves: 2 });
  });
});

/* ---------- the round layer: ihroteka.round (library/app/round.js, its invariants at its top) ---------- */
// the round events a tab's game heard (since `from`): [name, its argument]; and as short lines: 'start Аня' (by),
// 'run fresh' or 'run {state}', 'watch Аня' (its runner), 'end quit Богдан' (reason, by), 'rejoin Богдан'
const rev = (g, from = 0) => g.events.slice(from).filter(e => e[1].startsWith('round:')).map(e => [e[1].slice(6), e[2]]);
const line = ([n, a]) => n + ' ' + (n === 'start' ? a.by : n === 'run' ? (a.state === null ? 'fresh' : JSON.stringify(a.state)) : n === 'watch' ? a.runner :
  n === 'end' ? a.reason + ' ' + a.by : a);
const rlines = (g, from = 0) => rev(g, from).map(line);
const rec = async (X, game = 'g') => ((await X.state()).lib.rounds || {})[game];
const saveOf = async (X, game = 'g') => ((await X.state()).lib.saves || {})[game];
const heardR = (X, l, ms = 5000) => until(async () => { const g = await X.game(); return g && rlines(g).includes(l) && g; }, ms, 50);
const start = (X, setup, opts) => X.call('rstart', { setup, opts });
const save = (X, s) => X.call('rsave', { s });
// a round record as another library would write it (a forged one: the room checks only its shape and writer); dc: how
// far its clock is ahead of the wall clock
const forged = (v, a = v.runner, dc = 1000) => ({ t: 'lib-state', e: [['round:g', { v: { on: true, by: v.runner, reason: null, result: null, setup: null, saved: false, w: 1, ...v }, c: Date.now() + dc, a }]] });

describe('the round layer (ihroteka.round)', { concurrency: 3 }, () => {
  test('a round begins: everyone hears start, then the runner run (fresh) and the others watch, a player without a seat too', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rl1', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    assert.deepEqual((await A.game()).round, { active: false, id: null, seats: null, mySeat: -1, runner: 'Аня', runs: true }, 'between rounds: whose copy starts the next');
    assert.deepEqual((await B.game()).round, { active: false, id: null, seats: null, mySeat: -1, runner: 'Аня', runs: false });
    assert.equal(await B.call('rseatOf', { name: 'Аня' }), -1, 'between rounds nobody has a seat in one');
    assert.equal(await start(A, { mode: 'race' }), true);
    assert.equal(await start(A), false, 'not while a round is on');
    const g = await until(async () => { const x = await Promise.all([A, B, C].map(X => X.game())); return x.every(y => rev(y).length >= 2) && x; }, 3000);
    assert.ok(g, 'everyone hears it');
    assert.deepEqual(g.map(x => rlines(x)), [['start Аня', 'run fresh'], ['start Аня', 'watch Аня'], ['start Аня', 'watch Аня']]);
    const run = rev(g[0])[1][1], id = run.id;
    assert.deepEqual([run.seats, run.setup, rev(g[1])[0][1].setup], [['Аня', 'Богдан'], { mode: 'race' }, { mode: 'race' }]);
    const seats = ['Аня', 'Богдан'];
    assert.deepEqual(g.map(x => x.round), [{ active: true, id, seats, mySeat: 0, runner: 'Аня', runs: true },
      { active: true, id, seats, mySeat: 1, runner: 'Аня', runs: false }, { active: true, id, seats, mySeat: -1, runner: 'Аня', runs: false }]);
    assert.deepEqual([await B.call('rseatOf', { name: 'Богдан' }), await B.call('rseatOf', { name: 'Сава' })], [1, -1]);
    assert.ok(/^[a-z0-9]{8}$/.test(id), 'a new id: ' + id);
  });

  test('a start asked by a player whose copy does not start rounds: the runner offers it, it begins, by them', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl2', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await start(B, 7), true, 'asked');
    assert.ok(await heardR(A, 'run fresh', 3000), 'it begins: ' + rlines(await A.game()));
    assert.ok(await heardR(B, 'watch Аня', 3000));
    assert.deepEqual([rlines(await A.game()), rlines(await B.game())], [['start Богдан', 'run fresh'], ['start Богдан', 'watch Аня']]);
    const r = await rec(A);
    assert.deepEqual([r.by, r.runner, r.setup, r.seats], ['Богдан', 'Аня', 7, ['Аня', 'Богдан']]);
  });

  // (a request held up anyway, say in an outbox through an outage, is the same: its answer comes late; a link that
  // started over meanwhile drops it altogether)
  test('a start answered late starts nothing: the one who asked takes the offer only within ASK_TTL of asking, by its own clock', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'rl3', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await start(B), true, 'asked');
    await B.freeze(5000 * SCALE + 300);                      // (values.js ASK_TTL) Богдан's tab stops: Аня's offer waits for it
    assert.ok(await until(async () => (await B.state()).lib.trace.some(l => /offered came too late/.test(l)), 5000), 'the offer came, too late: ' +
      (await B.state()).lib.trace.slice(-8).join(' | '));
    assert.ok((await A.state()).lib.trace.some(l => /start asked by Богдан, offered/.test(l)), 'Аня offered it');
    assert.ok(await until(async () => (await Promise.all([A.game(), B.game()])).every(y => y.linked && !y.weak), 15000, 100), 'together again');
    await sleep(500);
    assert.deepEqual([rlines(await A.game()), rlines(await B.game()), (await A.game()).round.active], [[], [], false], 'no round');
    assert.equal(await start(B), true, 'asked again now');
    assert.ok(await heardR(B, 'watch Аня', 3000), 'it begins');
  });

  test('a start asked again before the first is answered is refused (within ASK_TTL); the first begins, once', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl31', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    const frozen = A.freeze(1000);                           // Аня's tab stops a moment: the start Богдан asks waits for her
    await sleep(100);
    assert.equal(await start(B, 1), true, 'asked');
    assert.equal(await start(B, 2), false, 'asked already');
    assert.ok((await B.state()).lib.trace.some(l => /refused: start: asked already/.test(l)), (await B.state()).lib.trace.slice(-5).join(' | '));
    await frozen;
    assert.ok(await heardR(B, 'watch Аня', 5000), 'the first begins: ' + rlines(await B.game()));
    await sleep(500);
    assert.deepEqual([rlines(await A.game()), (await rec(A)).setup], [['start Богдан', 'run fresh'], 1], 'once, as first asked');
  });

  // (start(setup, { seats }): the same players in another order; no game uses it yet)
  test('start with the seats in another order, by the runner and asked by another player; any other seats are refused', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl30', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    for (const seats of [['Аня'], ['Аня', 'Сава'], ['Аня', 'Богдан', 'Сава'], 'Аня,Богдан', ['Аня', 'Аня']]) assert.equal(await start(A, 1, { seats }), false, 'not the players seated: ' + seats);
    assert.equal(await start(A, 1, { seats: ['Богдан', 'Аня'] }), true);
    const g = await heardR(B, 'watch Аня', 3000);
    assert.ok(g, rlines(await B.game()));
    assert.deepEqual([(await rec(A)).seats, g.round.seats, g.round.mySeat, (await A.game()).round.mySeat], [['Богдан', 'Аня'], ['Богдан', 'Аня'], 0, 1]);
    assert.equal(await A.call('rover', {}), true);
    assert.ok(await heardR(B, 'end over Аня', 3000));
    assert.equal(await start(B, 2, { seats: ['Аня', 'Сава'] }), false, 'asked: refused as well');
    assert.equal(await start(B, 2, { seats: ['Богдан', 'Аня'] }), true, 'asked');
    assert.ok(await until(async () => (await rec(A))?.on && (await rec(A)).setup === 2, 3000), 'it begins');
    assert.deepEqual([(await rec(A)).seats, (await rec(A)).runner, (await rec(A)).by], [['Богдан', 'Аня'], 'Аня', 'Богдан']);
  });

  test('save: only from the copy that runs the round; its players keep the latest; one from anyone else, of another round or wire, is refused', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rl4', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await B.send(forged({ id: 'otherwir', seats: ['Аня', 'Богдан'], runner: 'Аня', w: 2 }));   // (a copy of the game of another wire)
    assert.ok(await until(async () => (await rec(A))?.id === 'otherwir', 3000));
    await sleep(300);
    assert.deepEqual([(await A.game()).round.active, rlines(await A.game())], [false, []], 'a round of another wire is not ours to see');
    await start(A);
    assert.ok(await heardR(B, 'watch Аня', 3000));
    const { id } = await rec(A);
    assert.deepEqual([await save(A, { n: 1 }), await save(B, { n: 2 }), await save(C, { n: 3 })], [true, false, false]);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000), 'Богдан keeps it');
    assert.deepEqual(await saveOf(B), { r: id, a: 'Аня', c: (await saveOf(B)).c, s: { n: 1 } });
    assert.ok(await until(async () => (await rec(B))?.saved, 3000), 'the record says it was saved');   // (it may come a moment after the snapshot)
    const at = Date.now() + 5000, fake = o => ({ t: 'lib-save', v: 'g', r: id, s: { n: 99 }, c: at, a: 'Аня', w: 1, ...o });
    await B.send(fake({ a: 'Богдан' }));                     // not its runner
    await B.send(fake({ r: 'zzzzzzzz' }));                   // another round
    await B.send(fake({ w: 2 }));                            // another wire
    await sleep(500);
    assert.deepEqual([(await saveOf(A)).s, (await saveOf(B)).s, await saveOf(C)], [{ n: 1 }, { n: 1 }, undefined], 'refused (Сава, without a seat in the round, gets none)');
    // one writer (invariant 1): a record written by anyone but the runner it names is dropped, whatever its clock
    await B.send(forged({ id: 'byanyone', seats: ['Аня', 'Богдан'], runner: 'Аня' }, 'Богдан'));
    await sleep(300);
    assert.deepEqual([(await rec(A)).id, (await rec(C)).id], [id, id], 'not taken');
    await assert.rejects(A.call('rsave', { s: { big: 1n } }), /TypeError: ihroteka\.round\.save: not JSON/);
  });

  test('stale resume is impossible: a round that is over never comes back; the next one begins fresh, and only its own snapshot goes on', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl5', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { round: 1 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.round === 1, 3000));
    const id1 = (await rec(A)).id;
    assert.equal(await B.call('rover', { result: 1 }), false, 'over: only the runner');
    assert.equal(await A.call('rover', { result: { winner: 'Аня' } }), true);
    const b = await heardR(B, 'end over Аня', 3000);
    assert.ok(b, 'everyone hears it is over');
    assert.deepEqual(rev(b).at(-1)[1], { id: id1, by: 'Аня', reason: 'over', result: { winner: 'Аня' } });
    assert.deepEqual([await saveOf(A), await saveOf(B), (await rec(B)).on], [undefined, undefined, false], 'its snapshot goes with it');
    await B.send({ t: 'lib-save', v: 'g', r: id1, s: { round: 1 }, c: Date.now() + 5000, a: 'Аня', w: 1 });   // a late copy of it
    await sleep(300);
    assert.deepEqual([await saveOf(A), await saveOf(B)], [undefined, undefined], 'not taken: the round is over');
    await start(A);
    assert.ok(await until(async () => rlines(await A.game()).filter(l => l === 'run fresh').length === 2, 3000), 'the next round begins fresh: ' + rlines(await A.game()));
    await save(A, { round: 2 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.round === 2, 3000));
    await A.close();                                         // the runner's page reloads
    const A2 = await W.tab('p3tab');
    await A2.lib('rl5', 'Аня');
    const a = await heardR(A2, 'run {"round":2}', 8000);
    assert.ok(a, 'its new copy runs round 2 on: ' + (await A2.game() && rlines(await A2.game())));
    assert.deepEqual(rlines(a), ['run {"round":2}'], 'and nothing else');
    assert.deepEqual(evs(a).filter(x => x.startsWith('resume')), [], 'nothing of the room\'s own snapshots');
  });

  test('a runner reload resumes with no none: its new copy hears run with the snapshot, before any game message', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl6', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 3 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 3, 3000));
    const nb = (await B.game()).events.length;
    await A.close();
    const A2 = await W.tab('p3tab');
    await A2.lib('rl6', 'Аня');
    assert.ok(await until(async () => evs(await B.game(), nb).includes('relinked Аня'), 8000), 'Богдан\'s game hears her new copy is open');
    assert.equal(await B.gsend({ t: 'hi' }, { to: 'Аня' }), true);
    const a = await until(async () => { const g = await A2.game(); return g && g.heard.includes('message:hi') && g; }, 5000);
    assert.ok(a, 'the message arrives');
    assert.deepEqual(rlines(a), ['run {"n":3}'], 'run with the snapshot, never fresh');
    assert.ok(a.heard.indexOf('round:run') >= 0 && a.heard.indexOf('round:run') < a.heard.indexOf('message:hi'), a.heard.join(' '));
    assert.deepEqual(rlines(await B.game()), ['start Аня', 'watch Аня'], 'Богдан still watches the same round');
  });

  test('while our copy waits for its round\'s snapshot, the game\'s messages wait too: run comes first', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl7', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    // a round Аня's copy runs, saved, whose snapshot has not reached her (her new page, say): she waits for it
    await B.send(forged({ id: 'waitwait', seats: ['Аня', 'Богдан'], runner: 'Аня', saved: true }));
    assert.ok(await until(async () => (await rec(A))?.id === 'waitwait', 3000));
    const n = (await A.game()).heard.length;
    assert.equal(await B.gsend({ t: 'early' }), true);
    await sleep(500);
    assert.deepEqual((await A.game()).heard.slice(n), [], 'nothing yet: neither run nor the message');
    assert.deepEqual((await A.game()).round, { active: true, id: 'waitwait', seats: ['Аня', 'Богдан'], mySeat: 0, runner: 'Аня', runs: false });
    await B.send({ t: 'lib-save', v: 'g', r: 'waitwait', s: { n: 5 }, c: Date.now() + 5000, a: 'Аня', w: 1 });
    assert.ok(await until(async () => (await A.game()).heard.length >= n + 2, 3000));
    assert.deepEqual((await A.game()).heard.slice(n), ['round:run', 'message:early'], 'its part first, then the message');
    assert.deepEqual(rlines(await A.game()), ['run {"n":5}']);
  });

  test('a game closed mid-round waits: opened again, the runner hears run with the snapshot, the other watch', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl8', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 7 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 7, 3000));
    const [na, nb] = (await Promise.all([A.game(), B.game()])).map(g => g.events.length);   // (a tab's games' events: of every game it opened)
    await A.open(null);                                      // everyone back to the shelf, mid-round
    assert.ok(await onShelf([A, B]));
    assert.equal((await rec(A)).on, true, 'the round waits');
    await B.open('g');                                       // opened again (Аня follows)
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.ok(await heardR(A, 'run {"n":7}', 3000), 'Аня runs it on: ' + rlines(await A.game()));
    await sleep(300);
    // (and, if Богдан's copy opened after hers, 'rejoin Богдан': his copy is new to the round's runner)
    assert.deepEqual([rlines(await A.game(), na).filter(l => l !== 'rejoin Богдан'), rlines(await B.game(), nb)], [['run {"n":7}'], ['watch Аня']]);
  });

  test('a reorder keeps the round: its players keep their seats, whoever else is in the room first', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'rl9', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await start(A);
    assert.ok(await heardR(B, 'watch Аня', 3000));
    const { id } = await rec(A);
    await B.net({ up: false });
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000));
    await A.release('Богдан');                               // «Не чекати»: his place goes; back, he is last in the room
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня,Сава', 5000));
    const c = await C.game();
    assert.ok(!c.seated && c.round.active && c.round.mySeat === -1, 'Сава does not take his seat mid-round: ' + JSON.stringify(c.round));
    await B.net({ up: true });
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня,Сава,Богдан', 15000, 100), 'the room\'s order: ' + (await A.state()).players);
    const g = await until(async () => { const x = await Promise.all([A.game(), B.game(), C.game()]); return x[0].players.join() === 'Аня,Богдан' && x[1].linked && !x[0].weak && x; }, 15000, 100);
    assert.ok(g, 'Аня and Богдан play on: ' + JSON.stringify((await A.game()).players));
    assert.deepEqual(g.map(x => [x.round.id, x.round.mySeat, x.seated]), [[id, 0, true], [id, 1, true], [id, -1, false]], 'the same round, the same seats');
    assert.ok(!rlines(g[0]).some(l => l.startsWith('end')), 'never over: ' + rlines(g[0]));
    assert.ok(await heardR(A, 'rejoin Богдан', 3000), 'his copy needs everything again');
  });

  test('quit ends the round for everyone: at once for the one who quits, as soon as its runner hears it for the others', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rl10', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await start(A);
    assert.ok(await heardR(B, 'watch Аня', 3000) && await heardR(C, 'watch Аня', 3000));
    assert.equal(await C.call('roff', { ev: 'end' }), true, 'Сава\'s game stops listening to end (round.off)');
    assert.equal(await C.call('rquit'), false, 'only a player of the round');
    await C.send({ t: 'lib-ask', v: 'g', q: 'quit', r: (await rec(A)).id });   // (and the runner takes it only from one)
    await sleep(300);
    assert.equal((await rec(A)).on, true, 'still on');
    assert.equal(await B.call('rquit'), true);
    const b = await B.game();
    assert.deepEqual([rlines(b).at(-1), b.round.active], ['end quit Богдан', false], 'at once for him');
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'and for Аня');
    assert.deepEqual([(await rec(A)).on, (await rec(A)).reason, (await rec(A)).by], [false, 'quit', 'Богдан']);
    assert.ok(await until(async () => !(await C.game()).round.active, 3000));
    assert.ok(!rlines(await C.game()).some(l => l.startsWith('end')), 'Сава\'s game, not listening, hears nothing of it');
    await start(A);
    assert.ok(await heardR(B, 'watch Аня', 3000));
    assert.equal(await A.call('rquit'), true, 'the runner quits');
    assert.ok(await until(async () => rlines(await B.game()).at(-1) === 'end quit Аня', 3000));
  });

  test('a quit holds until its round is over: the runner back hears it; a round that moves to the one who quit, ends', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'rl11', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 1 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    await A.net({ up: false });                              // the runner cut off; Богдан quits meanwhile
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
    assert.equal(await B.call('rquit'), true);
    await A.net({ up: true });
    assert.ok(await heardR(A, 'end quit Богдан', 10000), 'back, Аня hears it: ' + rlines(await A.game()));
    // again, and this time Аня stays away: the round moves to Богдан, whose copy ends it
    await start(A);
    await save(A, { n: 2 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 2, 3000));
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
    assert.equal(await B.call('rquit'), true);
    const { AUTH_WAIT } = (await A.info()).timing;
    const r = await until(async () => { const x = await rec(B); return x && !x.on && x.runner === 'Богдан' && x; }, AUTH_WAIT + 6000, 100);
    assert.ok(r, 'Богдан\'s copy ends it: ' + JSON.stringify(await rec(B)));
    assert.deepEqual([r.reason, r.by], ['quit', 'Богдан']);
    assert.ok(!(await B.state()).lib.trace.some(l => /runs on here/.test(l)), 'ended, not run on first');
    await A.net({ up: true });
    assert.ok(await until(async () => rlines(await A.game()).filter(l => l === 'end quit Богдан').length === 2, 15000, 100), 'back, Аня hears it: ' + rlines(await A.game()));
  });

  test('a third player gets a seat after a round: not during it, though a player of the round left for good', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rl12', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await start(A);
    assert.ok(await heardR(C, 'watch Аня', 3000));
    const n = (await A.game()).events.length;
    await B.leave();                                         // Богдан leaves the room for good
    assert.ok(await until(async () => evs(await A.game(), n).includes('peer-gone'), 5000), 'Аня\'s game hears the room\'s peer-gone, and decides');
    await sleep(1200);
    const [a, c] = await Promise.all([A.game(), C.game()]);
    assert.deepEqual([a.round.active, a.players, c.seated, c.waiting], [true, ['Аня'], false, ['Сава']], 'the round is still on (no policy), its seats frozen');
    assert.equal(await A.call('rover', {}), true, 'the game ends it');
    assert.ok(await until(async () => { const x = await C.game(); return x.seated && x.linked && x; }, 5000), 'now Сава has a seat');
    await start(A);
    const s = await until(async () => { const x = await C.game(); return rlines(x).filter(l => l === 'watch Аня').length === 2 && x; }, 3000);
    assert.ok(s, rlines(await C.game()));
    assert.deepEqual([s.round.seats, s.round.mySeat], [['Аня', 'Сава'], 1]);
  });

  test('a round whose snapshot is on no device ends after LOST_WAIT (lost); not while a player who may have it is away', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'rl13', ['Аня', 'Богдан'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await B.net({ up: false });                              // Богдан away: he may have it
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000));
    // a round run by Яків, who left the room for good after he saved it; nobody here has the snapshot
    const fake = forged({ id: 'lostlost', seats: ['Яків', 'Аня', 'Богдан'], runner: 'Яків', saved: true });
    const C = await W.tab('p3tab');                          // (a third tab passes it on to Аня: she cannot send to herself)
    await C.lib('rl13', 'Сава', { g: 3 });
    assert.ok(await until(async () => (await C.state()).linked, 5000));
    await C.send(fake);
    assert.ok(await until(async () => (await rec(A))?.id === 'lostlost', 3000));
    const LOST = 15000 * SCALE;                              // (values.js LOST_WAIT)
    await sleep(LOST + 2000);
    assert.equal((await rec(A)).on, true, 'Богдан is away: the round waits (' + rlines(await A.game()) + ')');
    await B.net({ up: true });
    const t0 = Date.now();
    const a = await heardR(A, 'end lost Аня', LOST + 15000);
    assert.ok(a, 'lost: ' + rlines(await A.game()) + ' ' + JSON.stringify(await rec(A)));
    assert.ok(Date.now() - t0 > LOST - 1500, 'not before LOST_WAIT (' + LOST + ' ms): ' + (Date.now() - t0));
    assert.deepEqual(rlines(a).filter(l => l.startsWith('run')), [], 'never run fresh: it was saved');
  });

  test('no policies by default: a round starts with a player away, and a player of it gone for good does not end it', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'rl14', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'));
    assert.deepEqual(await A.call('rpolicy', { p: {} }), { startNeedsEveryone: false, endWhenSeatGone: false });
    await C.net({ up: false });
    assert.ok(await until(async () => (await A.state()).away.includes('Сава'), 5000));
    assert.equal(await start(A), true, 'Сава away: it starts anyway');
    assert.deepEqual((await rec(A)).seats, ['Аня', 'Богдан', 'Сава']);
    const n = (await A.game()).events.length;
    await A.release('Сава');                                 // her place goes for good
    assert.ok(await until(async () => evs(await A.game(), n).includes('leave Сава'), 5000), 'the game hears the room\'s leave');
    await sleep(1500);
    assert.deepEqual([(await A.game()).round.active, (await B.game()).round.active], [true, true], 'and the round goes on');
  });

  test('policy startNeedsEveryone: start is refused while a seated player is away, by the one asking and by the runner', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'rl15', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'));
    for (const X of [A, B]) await X.call('rpolicy', { p: { startNeedsEveryone: true } });
    await C.net({ up: false });
    assert.ok(await until(async () => (await A.state()).away.includes('Сава') && (await B.state()).away.includes('Сава'), 5000));
    assert.deepEqual([await start(A), await start(B)], [false, false]);
    await B.call('rpolicy', { p: { startNeedsEveryone: false } });   // Богдан's copy asks anyway: Аня's refuses
    assert.equal(await start(B), true);
    await sleep(1000);
    assert.equal((await A.game()).round.active, false, 'refused by the runner');
    await C.net({ up: true });
    assert.ok(await until(async () => !(await A.state()).away.length && !(await A.game()).weak, 15000, 100));
    assert.equal(await start(A), true, 'everyone here: it starts');
  });

  test('policy endWhenSeatGone: a player\'s place gone for good ends the round (gone), also with the game closed', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rl16', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'));
    await A.call('rpolicy', { p: { endWhenSeatGone: true } });
    await start(A);
    assert.ok(await heardR(C, 'watch Аня', 3000));
    await C.leave();
    assert.ok(await heardR(A, 'end gone Сава', 3000) && await heardR(B, 'end gone Сава', 3000), 'over for everyone: ' + rlines(await B.game()));
    await start(A);
    assert.ok(await heardR(B, 'start Аня', 3000));
    await A.open(null);                                      // the game closed: nobody has it open
    assert.ok(await onShelf([A, B]));
    await B.leave();
    const r = await until(async () => { const x = await rec(A); return x && !x.on && x; }, 3000);
    assert.ok(r && r.reason === 'gone' && r.by === 'Богдан', JSON.stringify(await rec(A)));
  });

  test('the runner gone: after AUTH_WAIT the first player here runs the round on from its snapshot; back, the old runner watches', T, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B, C] = await room(W, 'rl17', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'));
    await start(A);
    await save(A, { n: 5 });
    assert.ok(await until(async () => (await saveOf(C))?.s?.n === 5, 3000));
    const { AUTH_WAIT } = (await A.info()).timing;
    await A.net({ up: false });
    const b = await heardR(B, 'run {"n":5}', AUTH_WAIT + 6000);
    assert.ok(b, 'Богдан runs it on: ' + rlines(await B.game()));
    assert.ok(b.round.runs && b.round.runner === 'Богдан');
    assert.ok(await heardR(C, 'watch Богдан', 3000), 'Сава watches Богдан\'s copy');
    assert.ok(await until(async () => (await saveOf(C))?.a === 'Богдан', 3000), 'and keeps its snapshot, signed by Богдан');
    assert.deepEqual(rlines(await C.game()), ['start Аня', 'watch Аня', 'watch Богдан']);
    await A.net({ up: true });
    const a = await heardR(A, 'watch Богдан', 15000);
    assert.ok(a, 'back, Аня watches: ' + rlines(await A.game()));
    assert.deepEqual([a.round.runs, await save(A, { n: 6 })], [false, false]);
  });

  test('rejoin: one of the round\'s players opens a new copy of the game (a new tab): the runner hears it, once', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl18', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    assert.ok(await heardR(B, 'watch Аня', 3000));
    const B2 = await W.tab('p3tab');
    await B2.lib('rl18', 'Богдан');                          // Богдан goes on in another tab
    assert.ok(await heardR(A, 'rejoin Богдан', 8000), 'Аня\'s game hears it: ' + rlines(await A.game()));
    assert.ok(await heardR(B2, 'watch Аня', 3000), 'his new copy watches');
    await sleep(500);
    assert.deepEqual(rlines(await A.game()).filter(l => l.startsWith('rejoin')), ['rejoin Богдан'], 'once');
  });

  // (the dev server: a refused call says why, once; and a game that keeps rounds both ways hears that it does, once)
  test('on the dev server: a refused round call says why in the console, and a game that also calls room.snapshot hears it once', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab', {}, { dev: true });
    await A.lib('rl20', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.lib('rl20', 'Богдан');
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await save(A, { n: 1 }), false);
    assert.equal(await save(A, { n: 2 }), false);
    assert.equal(await A.snapshot({ v4: 1 }), true);
    assert.equal(await start(A), true);
    await start(A);
    const said = (await A.takeErrors()).filter(e => /ihroteka\.round/.test(e));
    const starts = ['ihroteka.round: save: only from the copy that runs the round', 'ihroteka.round: this game also keeps rounds with room.snapshot',
      'ihroteka.round: start: a round is on'];
    assert.ok(said.length === starts.length && said.every((e, i) => e.startsWith(starts[i])), 'once each: ' + said.join(' | '));
  });

  test('a game that starts listening late hears players, its part (run), linked, then the messages kept for it', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl19', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 13 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 13, 3000));
    await A.open(null);
    assert.ok(await onShelf([A, B]));
    await A.call('gameLate', { on: true });                  // Аня's game page runs its code late
    await B.open('g');
    assert.ok(await until(async () => (await B.game())?.linked, 5000));
    assert.equal(await B.gsend({ t: 'hi' }), true);
    await sleep(500);
    const n = (await A.game()).heard.length;
    await A.call('glisten');
    assert.ok(await until(async () => (await A.game()).heard.length >= n + 4, 3000));
    await sleep(200);
    assert.deepEqual((await A.game()).heard.slice(n), ['players', 'round:run', 'linked', 'message:hi'], 'once each, in this order');
    assert.deepEqual(rlines(await A.game()).slice(-1), ['run {"n":13}']);
  });

  // Two copies cut off from each other both write the record: the runner ends the round (quit), the other runs it on
  // meanwhile (AUTH_WAIT, with proof). Whichever write has the later clock (the copy that wrote more meanwhile), the
  // round is over for both once they meet again (an end is final, invariant 3): never back on for the one who quit.
  for (const later of ['Богдан', 'Аня']) test('split: the runner quits while cut off and the other runs the round on meanwhile; together again, it is over for both (' + later + '\'s clock ahead)', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, later === 'Аня' ? 'rl21' : 'rl22', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 1 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
    for (let i = 0; i < 20; i++) await (later === 'Аня' ? A : B).share('k' + (i % 3), i);   // (its clock runs ahead: each write ticks it)
    assert.equal(await A.call('rquit'), true, 'Аня, cut off, quits: her copy runs the round, so it ends there at once');
    const { AUTH_WAIT } = (await A.info()).timing;
    assert.ok(await heardR(B, 'run {"n":1}', AUTH_WAIT + 8000), 'Богдан runs it on meanwhile: ' + rlines(await B.game()));
    await A.net({ up: true });
    const same = await until(async () => { const [a, b] = [await rec(A), await rec(B)]; return a && b && !a.on && !b.on && a.runner === b.runner && [a, b]; }, 15000, 100);
    assert.ok(same, 'over for both: ' + JSON.stringify([await rec(A), await rec(B)]));
    assert.deepEqual([same[0].reason, same[0].by], ['quit', 'Аня']);
    await sleep(1500);
    assert.deepEqual(rlines(await A.game()), ['start Аня', 'run fresh', 'end quit Аня'], 'never back in the round she quit');
    assert.deepEqual(rlines(await B.game()), ['start Аня', 'watch Аня', 'run {"n":1}', 'end quit Аня']);
    assert.deepEqual([(await A.game()).round.active, (await B.game()).round.active], [false, false]);
  });

  // A split in which the runner also starts a new round: Аня, cut off, quits X (her copy runs it: over there at once)
  // and starts Y; Богдан runs X on meanwhile (on), and ends it too (off). Together again, the record with the later
  // clock wins (Богдан's, but in 'Аня ahead'): an older round over that came back over the newer one its runner
  // answers by writing Y again (round.js merged), and Y's record carries how X ended (prev), so Богдан hears X's real
  // end, never 'closed' (owner, decision 46). (audit round-05: Y was gone, and Аня's game heard 'closed' for her own Y)
  for (const v of ['on', 'off', 'Аня ahead']) test('split: Аня, cut off, quits X and starts Y; Богдан runs X on' + (v === 'off' ? ' and ends it' : '') + '; together again, Y stays for both and Богдан hears X\'s real end (' + v + ')', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B] = await room(W, 'rl3' + ['on', 'off', 'Аня ahead'].indexOf(v), ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 1 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    const X = (await rec(A)).id;
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
    if (v !== 'Аня ahead') for (let i = 0; i < 40; i++) await B.share('k' + (i % 3), i);   // (his clock runs ahead: each write ticks it)
    const { AUTH_WAIT } = (await A.info()).timing;
    assert.ok(await heardR(B, 'run {"n":1}', AUTH_WAIT + 8000), 'Богдан runs X on: ' + rlines(await B.game()));
    if (v === 'off') assert.equal(await B.call('rover', { result: { w: 'Богдан' } }), true, 'and ends it (over)');
    assert.equal(await A.call('rquit'), true, 'Аня quits X (her copy runs it, as far as she knows)');
    assert.equal(await start(A), true, 'and starts Y');
    const Y = (await rec(A)).id;
    assert.notEqual(Y, X);
    assert.deepEqual((await rec(A)).prev, { id: X, by: 'Аня', reason: 'quit', result: null }, 'Y\'s record says how X ended');
    await save(A, { y: 1 });
    if (v === 'Аня ahead') for (let i = 0; i < 40; i++) await A.share('k' + (i % 3), i);
    await A.net({ up: true });
    const both = await until(async () => { const [a, b] = [await rec(A), await rec(B)]; return a && b && a.id === Y && b.id === Y && [a, b]; }, 15000, 100);
    assert.ok(both, 'Y in both records: ' + JSON.stringify([await rec(A), await rec(B)]));
    await sleep(2000);                                       // (settled: nothing writes X over it again)
    const recs = [await rec(A), await rec(B)];
    assert.deepEqual(recs.map(r => [r.id, r.on, r.runner]), [[Y, true, 'Аня'], [Y, true, 'Аня']], JSON.stringify(recs));
    const a = rlines(await A.game()), b = rlines(await B.game());
    assert.ok(!a.includes('end closed null'), 'Аня never hears closed for her own Y: ' + a.join(' | '));
    assert.equal(a[a.length - 1], 'rejoin Богдан', a.join(' | '));
    assert.ok(!b.some(l => l.startsWith('end closed')), 'Богдан hears X\'s real end, not closed: ' + b.join(' | '));
    const real = v === 'off' ? 'end over Богдан' : 'end quit Аня';
    assert.deepEqual(b.slice(b.indexOf('run {"n":1}') + 1), [real, 'watch Аня'], 'X\'s end, then he watches Y: ' + b.join(' | '));
    assert.ok(await until(async () => (await saveOf(B))?.r === Y, 3000), 'Богдан keeps Y\'s snapshot: ' + JSON.stringify(await saveOf(B)));
  });

  // Not a split: the runner was cut off, and its round was run on, ended, and followed by more rounds, all over, before
  // it came back. The record it sees then is over, but it hears of that end only now: a round newer than its own, which
  // it never writes over again (the room would go back to Y: over, or, with nobody left who knows Y ended, on).
  for (const reload of [false, true]) test('the runner cut off: its round run on and ended, two more rounds played and over; back, its round never comes back (' + (reload ? 'Богдан reloaded meanwhile' : 'the same pages') + ')', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE });
    const [A, B0] = await room(W, reload ? 'rl3r' : 'rl3s', ['Аня', 'Богдан'], { lib: {} });
    let B = B0;
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 1 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    const Y = (await rec(A)).id;
    await A.net({ up: false });
    const { AUTH_WAIT } = (await A.info()).timing;
    assert.ok(await heardR(B, 'run {"n":1}', AUTH_WAIT + 8000), 'Богдан runs Y on: ' + rlines(await B.game()));
    assert.equal(await B.call('rover', { result: { y: 1 } }), true, 'Y over');
    for (const r of ['z', 'w']) {
      assert.equal(await start(B), true, r);
      assert.ok(await until(async () => (await rec(B))?.on, 3000));
      assert.equal(await B.call('rover', { result: { [r]: 1 } }), true, r + ' over');
    }
    const last = (await rec(B)).id;
    if (reload) {
      B = await B.reload();
      await B.lib('rl3r', 'Богдан', {});
      assert.ok(await until(async () => (await rec(B))?.id === last, 8000), 'Богдан back, the last round over: ' + JSON.stringify(await rec(B)));
    }
    const n = (await B.game())?.events.length || 0;
    await A.net({ up: true });
    await sleep(5000);
    const recs = [await rec(A), await rec(B)];
    assert.deepEqual(recs.map(r => [r.id, r.on]), [[last, false], [last, false]], 'the last round, over, for both (Y: ' + Y + '): ' + JSON.stringify(recs));
    const b = await B.game();
    if (b) assert.ok(!rlines(b, n).some(l => /^(run|watch)/.test(l)), 'Богдан never hears a part in Y again: ' + rlines(b, n));
  });

  // The same seen by a copy without a seat (a watcher): the round it knows is over comes back on (a record of the
  // other side, its clock ahead). Its players end it again; the watcher leaves that to them: its own end would name a
  // runner outside the seats, which nobody takes, and its record would differ from everyone's for good (invariant 3).
  test('split seen by a watcher: a copy without a seat never ends the round again (its players do); the same record everywhere', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rl28', ['Аня', 'Богдан', 'Сава'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан'));
    await start(A);
    assert.ok(await heardR(C, 'watch Аня', 3000));
    const { id } = await rec(A);
    assert.equal(await A.call('rover', {}), true);
    assert.ok(await until(async () => (await rec(B))?.on === false && (await rec(C))?.on === false, 3000), 'over for everyone');
    // that round on, as Богдан's copy wrote it on the other side of a split, after it ran it on (its clock ahead)
    await B.send(forged({ id, seats: ['Аня', 'Богдан'], runner: 'Богдан', saved: true }, 'Богдан', 5000));
    await sleep(1500);
    const recs = await Promise.all([A, B, C].map(X => rec(X)));
    assert.deepEqual(recs.map(r => [r.id, r.on, r.runner, r.by, r.reason]), Array(3).fill([id, false, 'Аня', 'Аня', 'over']),
      'Аня ended it again; the same record everywhere: ' + JSON.stringify(recs));
    assert.ok(!(await C.state()).lib.trace.some(l => /on again/.test(l)), 'not Сава\'s copy');
    assert.deepEqual(rlines(await C.game()), ['start Аня', 'watch Аня', 'end over Аня'], 'her game heard nothing more of it');
  });

  // (together.js update: one pass at a time; what the game does on an event comes in a pass of its own after it)
  test('a round the game ends from its own listener (on start): it hears start, run, then end, once each, never its part after its end', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl24', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.call('ron', { ev: 'start', call: 'over', arg: { early: 1 } });
    assert.equal(await start(A), true);
    assert.ok(await heardR(B, 'end over Аня', 3000), 'over for Богдан too: ' + rlines(await B.game()));
    await sleep(300);
    const a = await A.game();
    assert.deepEqual([rlines(a), a.round.active], [['start Аня', 'run fresh', 'end over Аня'], false]);
    assert.ok(!rlines(await B.game()).slice(rlines(await B.game()).indexOf('end over Аня')).some(l => /^(run|watch)/.test(l)), rlines(await B.game()));
  });

  test('a player who does not run the round quits it from its own listener (on start): start, watch, then end', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl29', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await B.call('ron', { ev: 'start', call: 'quit' });
    assert.equal(await start(A), true);
    assert.ok(await heardR(A, 'end quit Богдан', 3000), 'over for Аня: ' + rlines(await A.game()));
    await sleep(300);
    const [a, b] = await Promise.all([A.game(), B.game()]);
    assert.deepEqual([rlines(b), b.round.active], [['start Аня', 'watch Аня', 'end quit Богдан'], false], 'his part, then its end (never its end in the middle of the pass that told him the start)');
    assert.deepEqual([rlines(a), a.round.active], [['start Аня', 'run fresh', 'end quit Богдан'], false]);
  });

  test('our room closed mid-round (end closed) and we are back in it, the game still open: our part again, then its real end', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl23', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 1 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    await B.lib('rl23', 'Богдан');                           // Богдан's library leaves the room and comes in again (his game open all along)
    assert.ok(await heardR(B, 'end closed null', 5000), 'we lost sight of it: ' + rlines(await B.game()));
    assert.ok(await until(async () => rlines(await B.game()).filter(l => l === 'watch Аня').length === 2, 8000), 'back in it: ' + rlines(await B.game()));
    assert.equal(await A.call('rover', { result: 1 }), true);
    const b = await until(async () => { const g = await B.game(); return rlines(g).at(-1) === 'end over Аня' && g; }, 5000);
    assert.ok(b, 'its real end: ' + rlines(await B.game()));
    assert.deepEqual(rlines(b), ['start Аня', 'watch Аня', 'end closed null', 'watch Аня', 'end over Аня']);
  });

  test('rejoin: a player\'s link with the runner starts over in place (the same copy of the game): the runner hears it too', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl25', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    assert.ok(await heardR(B, 'watch Аня', 3000));
    const n = (await A.game()).events.length;
    const { topic } = await A.info('rl25', 'ihroteka');      // (the library's room: together.js LIB)
    W.spy().publish(topic, { t: 'bye', to: A.session }, B.session);   // as if his link was lost: Аня lets it go, it starts over
    const a = await until(async () => { const g = await A.game(); return evs(g, n).includes('relinked Богдан') && g; }, 8000);
    assert.ok(a, 'his link starts over: ' + evs(await A.game(), n));
    assert.ok(await heardR(A, 'rejoin Богдан', 3000), 'and her copy, which runs the round, sends his everything: ' + rlines(await A.game()));
  });

  test('a quit said while the runner\'s page reloads reaches its new copy: the round is over there too', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rl26', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await start(A);
    await save(A, { n: 4 });
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 4, 3000));
    await A.close();                                         // the runner's page goes
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
    assert.equal(await B.call('rquit'), true, 'Богдан quits meanwhile');
    const A2 = await W.tab('p3tab');
    await A2.lib('rl26', 'Аня');                             // her new page
    const r = await until(async () => { const x = await rec(A2); return x && !x.on && x; }, 8000);
    assert.ok(r, 'over: ' + JSON.stringify(await rec(A2)) + ' ' + (await A2.game() && rlines(await A2.game())));
    assert.deepEqual([r.reason, r.by], ['quit', 'Богдан']);
  });

  // (a page's last words hold about 64 KB, net/brokers.js lastWords: one copy of a snapshot near CAP, not two. The
  // runner's snapshots go to its players in seat order, round.js sendSave, so that one is the first guest's, the one
  // rules.takeOver names to run the round on: it does, from it, and passes it on)
  test('3 seats: the runner\'s tab closes in sight with a save near CAP still waiting; its last words hold the first guest\'s copy, and the round goes on from the latest save', { timeout: 60000 }, async t => {
    const W = world(t, { scale: SCALE }), S = W.spy();
    const [A, B, C] = await room(W, 'rl32', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'));
    await start(A);
    const pad = 'x'.repeat(CAP - 50 - JSON.stringify({ moves: 1, pad: '' }).length);
    assert.equal(await save(A, { moves: 1, pad }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.moves === 1 && (await saveOf(C))?.s?.moves === 1, 6000), 'both have it');
    // a save that goes at once (both its copies sealed and out: the spy sees them), then the last one, which waits for
    // its turn (half a second after the one before: round.js SAVE_EVERY) as the page goes (a busy machine: again)
    const out = (n, X) => S.seen.some(x => x.m && x.m.f === A.session && x.m.t === 'd' && x.m.to === X.session && (x.m.d || []).some(m => m.t === 'lib-save' && m.s.moves === n));
    let last = 0;
    for (let n = 2; !last; n += 2) {
      assert.ok(n < 12, 'a save that waits for its turn as the page goes');
      await sleep(700);
      const at = Date.now();
      assert.equal(await save(A, { moves: n, pad }), true);
      if (await until(() => out(n, B) && out(n, C), 400, 5) && Date.now() - at < 400 && await save(A, { moves: n + 1, pad })) last = n + 1;
    }
    await A.close({ hidden: true });                         // (it goes now, as the page goes: in its last words, what fits)
    const bye = await until(() => S.seen.filter(x => x.m && x.m.f === A.session && x.m.t === 'bye').pop(), 3000);
    assert.ok(bye, 'her last words');
    const w = (bye.m.w || []).map(([to, , list]) => [to, list.filter(m => m.t === 'lib-save').map(m => m.s.moves)]).filter(([, l]) => l.length);
    assert.deepEqual(w, [[B.session, [last]]], 'they hold the latest save, Богдан\'s copy only: ' + JSON.stringify(w));
    assert.ok(await until(async () => (await saveOf(B))?.s?.moves === last, 3000), 'Богдан has it');
    assert.equal((await saveOf(C)).s.moves, last - 1, 'Сава has the one before');
    const { AUTH_WAIT } = (await B.info()).timing;
    assert.ok(await until(async () => (await rec(B))?.runner === 'Богдан', AUTH_WAIT + 8000, 100), 'Богдан runs the round on: ' + JSON.stringify(await rec(B)));
    const c = await until(async () => { const x = await saveOf(C); return x?.a === 'Богдан' && x; }, 3000);
    assert.ok(c, 'Сава keeps his copy of it');
    assert.deepEqual([c.s.moves, (await rec(C)).on], [last, true], 'the round goes on from the latest save');
  });

  test('a round whose runner left waits for the player away who has its snapshot: back, it goes on from it there', { timeout: 60000 }, async t => {
    // (scale 0.5: Богдан's outage has to stay well inside his own HOST_WAIT. Past it his page takes the room over and
    // comes back as a guest on new links, and what Сава's outbox held for him is gone, as on any link that starts
    // over (net/link.js); at 0.3 the outage was within a few tenths of a second of it, and the test failed now and then)
    const W = world(t, { scale: 0.5 });
    const [A, B] = await room(W, 'rl27', ['Аня', 'Богдан'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    const C = await W.tab('p3tab');                          // (a third tab passes it on)
    await C.lib('rl27', 'Сава', { g: 3 });
    assert.ok(await until(async () => (await C.state()).linked, 5000));
    await B.net({ up: false });
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000));
    // a round run by Яків, who left the room for good after he saved it: its snapshot went to Богдан (his outbox keeps it)
    await C.send(forged({ id: 'heldheld', seats: ['Яків', 'Аня', 'Богдан'], runner: 'Яків', saved: true }));
    await C.send({ t: 'lib-save', v: 'g', r: 'heldheld', s: { n: 9 }, c: Date.now() + 5000, a: 'Яків', w: 1 }, { to: 'Богдан' });
    assert.ok(await until(async () => (await rec(A))?.id === 'heldheld', 3000));
    await sleep(1500);
    assert.equal((await rec(A)).runner, 'Яків', 'Аня does not run it on without its snapshot (it would refuse Яків\'s, then)');
    await B.net({ up: true });
    const a = await heardR(A, 'run {"n":9}', 15000);
    assert.ok(a, 'Богдан back with it: Аня runs it on from it: ' + rlines(await A.game()) + ' ' + JSON.stringify(await rec(A)));
    assert.ok(!rlines(a).some(l => l.startsWith('end')), rlines(a));
  });
});

/* ---------- the round through what the room does (phase A: the room's own fixes, seen from the round) ---------- */
const roomEv = async (X, n, kinds = ['leave']) => (await X.events()).slice(n).filter(e => kinds.includes(e[1])).map(e => e.slice(1).join(' '));
describe('the round through the room\'s changes', { concurrency: 3 }, () => {
  // (net-core-06: the released tab heard a final bye from its host, took it as "Аня left for good", ran the round on at
  // once, and its record won when it was heard again: the room's round moved to it, back to its last snapshot)
  test('«Не чекати» for a guest whose page still hears the room: its copy never takes the round over, and back, the round stays with its runner', { timeout: 60000 }, async t => {
    const W = world(t);                                      // (real time: back well before HOST_WAIT, as a page that was only stuck)
    const [A, B, C] = await room(W, 'rla1', ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
    await A.open('g');
    assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'), 'all three play');
    assert.equal(await start(A), true);
    assert.equal(await save(A, { n: 1 }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000), 'Богдан keeps the snapshot');
    const id = (await rec(A)).id, nB = (await B.game()).events.length;
    await B.net({ send: false });                            // Богдан hears the room; nobody hears him
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 8000), 'away');
    await A.release('Богдан');                               // «Не чекати»
    assert.ok(await until(async () => (await A.state()).players.join() === 'Аня,Сава', 3000), 'his place goes');
    await sleep(1000);
    assert.equal(await save(A, { n: 2 }), true, 'the room plays on without him');
    await sleep(1500);
    assert.deepEqual(rlines(await B.game(), nB).filter(l => l.startsWith('run')), [], 'his copy never ran it meanwhile: ' + rlines(await B.game(), nB));
    await B.net({ send: true });
    const s = await until(async () => { const x = await Promise.all([A, B, C].map(X => X.state())); return x.every(y => y.linked && y.players.length === 3 && !y.away.length) && x; }, 15000, 100);
    assert.ok(s, 'he is back, as a new player: ' + await shows([A, B, C]));
    assert.deepEqual(s.map(x => x.role), ['host', 'guest', 'guest'], 'Аня still holds the room');
    await sleep(1500);
    for (const X of [A, B, C]) {
      const r = await rec(X);
      assert.deepEqual(r && [r.id, r.on, r.runner], [id, true, 'Аня'], 'the round stays with its runner: ' + JSON.stringify(r));
    }
    assert.deepEqual(rlines(await B.game(), nB).filter(l => l.startsWith('run')), [], 'his copy never ran it: ' + rlines(await B.game(), nB));
    assert.ok(rlines(await A.game()).every(l => !l.startsWith('watch') && !l.startsWith('end')), 'Аня\'s copy runs it on: ' + rlines(await A.game()));
    assert.equal((await saveOf(C))?.s?.n, 2, 'from her latest snapshot, not his');
  });

  // (net-core-09: the others waited out HOST_WAIT for the old phone, and about half the time the rooms then merged the
  // wrong way: a guest heard «Сава left», and the round became a tombstone everywhere)
  for (const pid of ['p0tab', 'p4tab']) {
    test('the host\'s phone offline, her new device joins: the round goes on, whichever session sorts first (' + (pid === 'p0tab' ? 'before' : 'after') + ' the others\')', { timeout: 60000 }, async t => {
      const W = world(t), code = 'rla2' + pid;
      const [A, B, C] = await room(W, code, ['Аня', 'Богдан', 'Сава'], { lib: { g: 3 } });
      await A.open('g');
      assert.ok(await plays([A, B, C], 'Аня,Богдан,Сава'), 'all three play');
      await A.snapshot({ round: 1, n: 5 });
      assert.ok(await until(async () => (await snapOf(B))?.s?.round === 1 && (await snapOf(C))?.s?.round === 1, 5000), 'everyone keeps it');
      const n = [(await B.events()).length, (await C.events()).length];
      await A.net({ up: false });                            // her phone drops out…
      await sleep(3000);
      const A2 = await W.tab(pid);                           // …and she opens the room on another device
      await A2.lib(code, 'Аня', { g: 3 }, undefined, { ask: true });
      assert.ok(await until(settled([A2, B, C]), 8000), 'in the room: ' + await shows([A2, B, C]));
      await sleep(3000);
      for (const X of [A2, B, C]) {
        const x = await snapOf(X);
        assert.ok(x && x.s && x.s.round === 1, 'the round on, never a tombstone: ' + JSON.stringify(x));
      }
      assert.deepEqual([...await roomEv(B, n[0]), ...await roomEv(C, n[1])], [], 'nobody heard a player leave');
    });
  }

  // (round-11: two rooms on one code merged, and the list a guest had until its new host's came said the others had
  // left: the round ended 'gone', or its runner moved at once)
  const only = i => ({ brokers: [0, 1, 2, 3].map(j => j === i) });
  for (const [label, pol] of [['endWhenSeatGone', { endWhenSeatGone: true }], ['no policy', null]]) {
    for (const order of ['its host first', 'a guest first']) {
      test('two rooms on one code merge mid-round (' + label + ', ' + order + '): the round stays on, with its runner; nobody hears anyone leave', { timeout: 60000 }, async t => {
        const W = world(t, { scale: 0.5 }), code = 'rla3' + (pol ? 'p' : 'n') + (order === 'a guest first' ? 'g' : 'h');
        const mk = async (pid, name, net, host) => {
          const X = await W.tab(pid, net);
          await X.lib(code, name, {});
          assert.ok(await until(async () => { const s = await X.state(); return host ? s.role === 'host' : s.linked; }, 8000), name);
          return X;
        };
        // Богдан's room (broker 0) plays a round; Дана's (broker 1) is the other, whose host's session sorts first
        const B = await mk('p5tab', 'Богдан', only(0), true), C = await mk('p6tab', 'Сава', only(0));
        const D = await mk('p0tab', 'Дана', only(1), true), E = await mk('p1tab', 'Еля', only(1));
        await B.open('g');
        assert.ok(await until(async () => (await B.game())?.linked && (await C.game())?.linked, 8000), 'they play');
        if (pol) for (const X of [B, C]) await X.call('rpolicy', { p: pol });
        assert.equal(await start(B), true);
        assert.ok(await heardR(C, 'watch Богдан', 3000));
        const id = (await rec(B)).id, n = await Promise.all([B, C, D, E].map(async X => (await X.events()).length));
        if (order === 'a guest first') {
          // Сава comes over to Дана before Богдан can hear her: a 'go' said as Богдан, while only Сава hears both rooms
          const { topic } = await C.info(code, 'ihroteka');
          const S = W.spy();
          await C.net({ brokers: true });
          await C.kick();
          await sleep(3000);                                 // (its brokers connect)
          S.publish(topic, { t: 'go', h: D.session, to: C.session }, B.session);
          assert.ok(await until(async () => (await C.state()).players.includes('Дана'), 8000), 'Сава went over to Дана: ' + await shows([C]));
          await sleep(1500);
        }
        for (const X of [B, C, D, E]) await X.net({ brokers: true });
        assert.ok(await until(settled([B, C, D, E]), 20000), 'one room: ' + await shows([B, C, D, E]));
        await sleep(2000);
        for (const X of [B, C, D, E]) {
          const r = await rec(X);
          assert.deepEqual(r && [r.id, r.on, r.runner], [id, true, 'Богдан'], 'the round stays on, with its runner: ' + JSON.stringify(r));
        }
        const left = (await Promise.all([B, C, D, E].map((X, i) => roomEv(X, n[i])))).flat();
        assert.deepEqual(left, [], 'nobody heard anyone leave');
      });
    }
  }
});

/* ---------- a game opened after the end of its round (round.js invariant 6; owner, decision 49) ---------- */
// The tab keeps the round whose part its game was told and whose end it was not (sessionStorage 'ihroteka-heard', with
// the room and the player's name). A copy of the game that opens after that round ended (the page reloaded meanwhile,
// or the game was closed and opened again), or whose code was not listening yet when it ended, hears that end once:
// after 'players' and 'linked' (Two Dragons' 'linked' wipes what it shows), and never again. A new tab or another
// device does not (the tab's own memory: owner). (audit round-08, dragons-06: such a game heard nothing of that round)
describe('гра, відкрита після кінця свого раунду', { concurrency: 3 }, () => {
  const HEARD = 'ihroteka-heard';
  const ends = g => rlines(g).filter(l => l.startsWith('end'));
  const endOf = g => g.events.find(e => e[1] === 'round:end')[2];
  // Аня runs a round with Богдан, saved once (n) → the tabs and its id
  async function roundOn(W, code, n = 4) {
    const [A, B] = await room(W, code, ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    assert.equal(await start(A), true);
    assert.equal(await save(A, { n }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === n, 3000));
    return [A, B, (await rec(A)).id];
  }
  // X's game hears the end `line` once (after 'linked', when it plays with someone: linked), and the tab forgets it → the game
  async function once(X, line, linked = true) {
    const g = await until(async () => { const x = await X.game(); return x && ends(x).length && x; }, 8000, 50);
    assert.ok(g, 'it hears the end: ' + JSON.stringify(await X.game() && [rlines(await X.game()), (await X.game()).heard]));
    await sleep(1000);
    const x = await X.game();
    assert.deepEqual(ends(x), [line], 'once: ' + rlines(x).join(' | '));
    if (linked) assert.ok(x.heard.includes('linked') && x.heard.indexOf('round:end') > x.heard.indexOf('linked'), 'after linked: ' + x.heard.join(' '));
    assert.equal(await X.stored(HEARD), null, 'the tab keeps nothing of it');
    return x;
  }

  for (const moved of [false, true]) {
    for (const how of ['opens', 'listens']) {
      test('the runner\'s page reloads while the other player quits (' + (moved ? 'the round moved to his copy first, which ended it' : 'the quit reaches the new page') + '); its game ' + how + ' late: it hears that end once, after linked', { timeout: 60000 }, async t => {
        const W = world(t, { scale: 0.5 }), code = 'lend' + (moved ? 'm' : 'q') + how[0];
        const [A, B, id] = await roundOn(W, code);
        const A2 = await A.reload();                         // (at the game's address: its game opens before the room is there)
        assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
        assert.equal(await B.call('rquit'), true);
        if (moved) assert.ok(await until(async () => (await rec(B))?.on === false, 15000, 100), 'his copy ends it: ' + JSON.stringify(await rec(B)));
        await A2.call(how === 'opens' ? 'gameSlow' : 'gameLate', { on: true });   // (its game's page, or its code, still loading)
        await A2.lib(code, 'Аня');
        assert.ok(await until(async () => (await rec(A2))?.on === false, 10000, 50), 'over for her page: ' + JSON.stringify(await rec(A2)));
        await sleep(500);
        await A2.call(how === 'opens' ? 'gameSlow' : 'glisten', { on: false });
        const g = await once(A2, 'end quit Богдан');
        assert.deepEqual(endOf(g), { id, by: 'Богдан', reason: 'quit', result: null });
        assert.ok(!rlines(g).some(l => /^(run|watch)/.test(l)), 'nothing of it but its end: ' + rlines(g));
      });
    }
  }

  test('the runner\'s page reloads and its game listens late: told its part (to nobody yet), then the other player quits; listening, it hears that end once, after linked', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [A, B, id] = await roundOn(W, 'lend5', 3);
    const A2 = await A.reload();
    await A2.call('gameLate', { on: true });
    await A2.lib('lend5', 'Аня');
    assert.ok(await until(async () => (await A2.state()).lib.trace.some(l => /→ g round run/.test(l)), 8000, 50), 'told run (nobody listens yet)');
    assert.ok(await until(async () => (await B.game())?.linked, 5000));
    assert.equal(await B.call('rquit'), true);
    assert.ok(await until(async () => (await rec(A2))?.on === false, 5000, 50));
    await sleep(500);
    await A2.call('glisten');
    assert.deepEqual(endOf(await once(A2, 'end quit Богдан')), { id, by: 'Богдан', reason: 'quit', result: null });
  });

  test('a player\'s page reloads while the runner ends the round (over): the new page hears that end once, with its result', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [A, B, id] = await roundOn(W, 'lend6');
    const B2 = await B.reload();
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 5000));
    assert.equal(await A.call('rover', { result: { w: 'Аня' } }), true);
    await B2.lib('lend6', 'Богдан');
    assert.deepEqual(endOf(await once(B2, 'end over Аня')), { id, by: 'Аня', reason: 'over', result: { w: 'Аня' } });
  });

  test('a page reloaded mid-round hears its part (run with the snapshot) and no end; then the end, live, once; reloaded after it: nothing of it', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [A, B, id] = await roundOn(W, 'lend7', 7);
    const A2 = await A.reload();
    await A2.lib('lend7', 'Аня');
    assert.ok(await heardR(A2, 'run {"n":7}', 8000), 'runs on: ' + ((await A2.game()) && rlines(await A2.game())));
    await sleep(1000);
    assert.deepEqual(ends(await A2.game()), [], 'no end');
    assert.deepEqual((await A2.stored(HEARD))?.t, { g: id }, 'the tab knows its part');
    assert.ok(await until(async () => (await B.game())?.linked, 5000));
    assert.equal(await B.call('rquit'), true);
    await once(A2, 'end quit Богдан');
    const A3 = await A2.reload();
    await A3.lib('lend7', 'Аня');
    assert.ok(await until(async () => (await A3.game())?.linked, 8000), 'in the game again');
    await sleep(1500);
    assert.deepEqual(rlines(await A3.game()), [], 'an end heard live is not told again');
  });

  test('the game closed mid-round, its round ends meanwhile (gone), the game opened again in the same page: it hears that end once', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [A, B] = await room(W, 'lend9', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await plays([A, B], 'Аня,Богдан'));
    await A.call('rpolicy', { p: { endWhenSeatGone: true } });
    assert.equal(await start(A), true);
    assert.equal(await save(A, { n: 1 }), true);
    assert.ok(await until(async () => (await saveOf(B))?.s?.n === 1, 3000));
    await A.open(null);
    assert.ok(await until(async () => !(await B.game()), 3000), 'he follows her to the shelf');
    await B.leave();
    assert.ok(await until(async () => (await rec(A))?.on === false, 8000, 100), 'her copy ends it: ' + JSON.stringify(await rec(A)));
    await A.open('g');
    await once(A, 'end gone Богдан', false);                 // (nobody to play with: after NEWS_WAIT)
  });

  test('a new tab of the same player does not hear it (the tab\'s own memory)', { timeout: 60000 }, async t => {
    const W = world(t, { scale: 0.5 });
    const [A, B] = await roundOn(W, 'lend10');
    await A.close();
    assert.ok(await until(async () => (await B.state()).away.includes('Аня'), 5000));
    assert.equal(await B.call('rquit'), true);
    const A2 = await W.tab('p3tab', {}, { local: A.browser });   // (her browser, another tab)
    await A2.lib('lend10', 'Аня');
    assert.ok(await until(async () => (await rec(A2))?.on === false && (await A2.game())?.linked, 10000, 50), 'in the game, the round over');
    await sleep(1500);
    assert.deepEqual(rlines(await A2.game()), []);
  });
});
