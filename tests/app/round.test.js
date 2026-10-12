// Whose copy runs a round (library/app/together.js with rules.js), in worker tabs that run the real library over
// fake brokers (tests/support), with the room's timing scaled down (window.__timeScale 0.3: AUTH_WAIT and
// HOST_WAIT 3 s). The round moves only when its runner has been gone for AUTH_WAIT, and only with proof that it
// was the runner who dropped out: someone else with the game open here with us, or the brokers answering us all
// that time. The runner back plays on as a guest. A round's snapshot: a game closed mid-round goes on from it when
// opened again, with the same players ('resume' before 'linked'); a round that is over (the game said so, or one of
// its players left for good) leaves a tombstone, and never comes back.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, sleep, until, world } from '../support/world.js';

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

  // (owner, decision 3: a round waits for a closed game, not for a player who quit; channel over() in together.js)
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
    assert.ok(await until(async () => (await B.events()).some(e => e[1] === 'role' && e[2] === null), 20000, 100), 'Богдан started over');
    await B.net({ up: true });
    assert.ok(await until(async () => { const s = await B.state(); return s.linked && s.players.length === 3; }, 15000, 100), 'Богдан is back');
    await sleep(1000);
    const s = await Promise.all([A, B, C].map(x => snapOf(x)));
    assert.deepEqual(s.map(x => x && x.s), [{ round: 11 }, { round: 11 }, { round: 11 }], 'the round is still there: ' + JSON.stringify(s));
  });
});
