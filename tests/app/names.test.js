// Player names in worker tabs that run the real library over fake brokers (tests/support). A name typed on another
// device in another spelling (cleanName, as the dialog cleans it: owner, q17) is the same player; a name already in
// play is never changed (a reload into a newer version keeps it, and what the tab kept under it); «*» is nobody's own
// name. Names that are also the names of what every object has (__proto__, constructor, toString): the room, its shared
// state, rounds and seats keep them as names, never as an object's own parts. (audit: names-and-3plus-01, -06, -14)
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, show, sleep, until, world } from '../support/world.js';

// room.js in Node: config.js reads window (a session, the timing scale)
globalThis.window ??= globalThis;
const { cleanName } = await import('../../library/net/room.js');

const NAMES = ['__proto__', 'constructor', 'toString'];
// the round events the game heard: 'start constructor', 'run fresh', 'watch __proto__', 'end quit toString'
const rlines = g => g.events.filter(e => e[1].startsWith('round:')).map(([, n, a]) => n.slice(6) + ' ' + (n === 'round:start' ? a.by : n === 'round:run' ?
  (a.state === null ? 'fresh' : JSON.stringify(a.state)) : n === 'round:watch' ? a.runner : n === 'round:end' ? a.reason + ' ' + a.by : a));
const rec = async (X, game = 'g') => ((await X.state()).lib.rounds || {})[game];
const heardR = (X, l, ms = 5000) => until(async () => { const g = await X.game(); return g && rlines(g).includes(l) && g; }, ms, 50);

describe('players named as an object\'s own parts', () => {
  test('__proto__, constructor and toString play: a round starts and ends, shares go round, seats and release work, the report names them', { timeout: 40000 }, async t => {
    const W = world(t, { scale: 0.3 });
    const [A, B, C] = await room(W, 'nm1', NAMES, { lib: { g: 3 } });
    await A.open('g');
    const g = await until(async () => { const x = await Promise.all([A, B, C].map(X => X.game())); return x.every(y => y && y.linked && y.players.length === 3) && x; }, 8000);
    assert.ok(g, 'all three play');
    assert.deepEqual(g.map(x => [x.me, x.players]), NAMES.map(n => [n, NAMES]));
    for (const X of [A, B, C]) await X.call('rpolicy', { p: { endWhenSeatGone: true } });
    // a round, asked of the copy that starts them (__proto__'s)
    assert.equal(await B.call('rstart', { setup: 1 }), true, 'asked');
    assert.ok(await heardR(A, 'run fresh', 5000) && await heardR(B, 'watch __proto__', 3000) && await heardR(C, 'watch __proto__', 3000),
      'it begins: ' + rlines(await A.game()) + ' / ' + rlines(await C.game()));
    const { id, seats, runner, by } = await rec(C);
    assert.deepEqual([seats, runner, by], [NAMES, '__proto__', 'constructor']);
    assert.deepEqual(await Promise.all(NAMES.map(name => C.call('rseatOf', { name }))), [0, 1, 2], 'the seat of each');
    assert.equal(await A.call('rsave', { s: { n: 1 } }), true);
    // a shared value with those keys, round trip
    const v = JSON.parse('{"__proto__":1,"constructor":2,"toString":{"__proto__":[3]}}');
    assert.equal(await B.share('series', v), true);
    const got = await until(async () => { const x = await C.shared('series'); return x && x; }, 3000);
    assert.equal(JSON.stringify(got), JSON.stringify(v), 'as it was shared');
    assert.deepEqual([Object.keys(got), Object.getPrototypeOf(got) === Object.prototype], [['__proto__', 'constructor', 'toString'], true], 'its own keys, nothing else');
    // the round ends: toString quits it
    assert.equal(await C.call('rquit'), true);
    assert.ok(await heardR(A, 'end quit toString', 3000), 'over: ' + rlines(await A.game()));
    assert.ok(await heardR(B, 'end quit toString', 3000));
    assert.deepEqual(await Promise.all([A, B, C].map(async X => { const r = await rec(X); return [r.id, r.on, r.reason, r.by]; })), Array(3).fill([id, false, 'quit', 'toString']));
    // __proto__ cut off (it held the room): constructor lets its place go («Не чекати»: room.release) and holds the room
    await A.net({ up: false });
    assert.ok(await until(async () => (await B.state()).away.includes('__proto__'), 5000), 'away');
    const gone = await until(async () => { await B.release('__proto__'); const s = await B.state(); return !s.players.includes('__proto__') && s; }, 10000, 200);
    assert.ok(gone, 'released: ' + JSON.stringify((await B.state()).players));
    assert.deepEqual([gone.players, gone.role], [['constructor', 'toString'], 'host']);
    // the report says who plays (names-and-3plus-12: it holds the players' names)
    const head = (await B.diag()).split('\n').slice(0, 2);
    assert.match(head[0], /^Ігротека /);
    assert.match(head[1], /^room: internet, role: host, players: constructor, toString( \(away\))? \(at most 8\)$/, head[1]);   // (toString may still look for __proto__'s room)
  });
});

/* ---------- one player, whatever the device types (owner, q17) ---------- */
// (names-and-3plus-01: a player back on a new device with another apostrophe, a й in two parts or a small first letter
// was a stranger: the round waited 3 minutes for a ghost, then ended)
const T = { timeout: 60000 };
const POL = { p: { startNeedsEveryone: true, endWhenSeatGone: true } };   // (Хрестики-нулики's)
// A and B («before», cleaned) play a round with a snapshot; B's device dies; on another device the player types «after»
// in the dialog (cleaned, as invite.js does; ask: as the dialog's name) → whether that device is the same player
async function backAs(t, code, before, after) {
  const b = cleanName(before), a = cleanName(after);
  assert.equal(a, b, 'one spelling: ' + JSON.stringify([before, after, b, a]));
  const W = world(t, { scale: 0.3 });
  const [A, B] = await room(W, code, ['Богдан', b], { lib: {} });
  await A.open('g');
  assert.ok(await until(async () => (await B.game() || {}).linked, 5000), 'both play');
  for (const X of [A, B]) await X.call('rpolicy', POL);
  assert.ok(await until(() => A.call('rstart', {}), 5000, 200), 'a round starts');
  const id = (await rec(A)).id;
  await A.call('rsave', { s: { n: 7 } });
  await sleep(800);
  await B.kill();
  assert.ok(await until(async () => (await A.state()).away.includes(b), 5000), 'the old device is gone: ' + show(await A.state()));
  const B2 = await W.tab('p3tab');
  await B2.lib(code, a, {}, undefined, { ask: true });
  const g = await until(async () => { const x = await B2.game(); return x && x.seated && x.round && x.round.mySeat === 1 && x.round.id === id && x; }, 8000);
  assert.ok(g, 'seated again, in the same round: ' + JSON.stringify(await B2.game()));
  const r = await rec(A), s = await A.state();
  assert.ok(r.on && r.id === id, 'the round still on: ' + JSON.stringify(r));
  assert.deepEqual(s.players, ['Богдан', b], 'one player');
  assert.ok(await until(async () => { const x = await A.game(); return x && !x.weak && x; }, 5000), 'the game goes on');
}

describe('a player back on another device, the name typed in another spelling', { concurrency: 3 }, () => {
  test('a player back on another device types «Дар’я» where the old page had «Дар\'я»: one player, the same seat, the round resumes', T, t => backAs(t, 'nmc1', "Дар'я", 'Дар’я'));
  for (const [i, [what, before, after]] of [
    ['«Дарʼя» (U+02BC, a Windows layout) where the old page had «Дар\'я»', "Дар'я", 'Дарʼя'],
    ['«Андрій» with a й in two parts (NFD) where the old page had it as one', 'Андрій', 'Андрій'.normalize('NFD')],
    ['«аня» where the old page had «Аня» (a phone types the capital, a laptop does not)', 'Аня', 'аня']
  ].entries()) test(what + ': one player', T, t => backAs(t, 'nmc' + (i + 2), before, after));
});

describe('a name already in play, and «*»', { concurrency: 2 }, () => {
  // (names-and-3plus-01's verdict: the reload into a newer version carries room.me; cleaned there, the player would be
  // a stranger to their own place, and the quit their tab kept under it would be dropped)
  test('a name already in play stays as it was through a version reload: the same player in the same seat; the quit its tab kept goes on', T, async t => {
    const W = world(t, { scale: 0.3 });
    const raw = "Дар'я";                                     // (an older page's name: never cleaned)
    const [A, B] = await room(W, 'nmr1', ['Богдан', raw], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await B.game() || {}).linked, 5000));
    for (const X of [A, B]) await X.call('rpolicy', POL);
    assert.ok(await until(() => A.call('rstart', {}), 5000, 200));
    const id = (await rec(A)).id;
    await A.call('rsave', { s: { n: 1 } });
    // «Оновити»: the page reloads into the newer version, back into its room by itself (REJOIN)
    const update = async X => { await X.call('updateNow'); assert.equal(await X.reloadDone(), 'reload'); return X.reload({ boot: true }); };
    const B2 = await update(B);
    const g = await until(async () => { const x = await B2.game(); return x && x.round && x.round.mySeat === 1 && x.round.id === id && x; }, 8000);
    assert.ok(g, 'back in its seat: ' + JSON.stringify(await B2.game()) + ' ' + show(await B2.state()));
    assert.equal((await B2.state()).me, raw, 'as it was');
    assert.deepEqual((await A.state()).players, ['Богдан', raw], 'the same player');
    // a quit said while the round's runner is away is kept in the tab under that name, and goes on after the next reload
    await A.net({ up: false });
    assert.ok(await until(async () => (await B2.state()).away.includes('Богдан'), 5000), 'the runner is away');
    assert.equal(await B2.call('rquit'), true);
    const B3 = await update(B2);
    assert.ok(await until(async () => (await B3.state())?.me === raw, 5000), 'back as ' + raw + ': ' + show(await B3.state()));
    const k = await B3.stored('ihroteka-quits');
    assert.deepEqual([k && k.room, k && k.q], [JSON.stringify(['internet', 'nmr1', raw]), { g: id }], 'the quit kept: ' + JSON.stringify(k));
    await A.net({ up: true });
    const r = await until(async () => { const x = await rec(A); return x && !x.on && x; }, 15000);
    assert.ok(r, 'the runner hears it: ' + JSON.stringify(await rec(A)));
    assert.deepEqual([r.id, r.reason, r.by], [id, 'quit', raw]);
    assert.ok(!(await A.state()).players.includes('Дар’я'), 'never another player');
  });

  // (names-and-3plus-06: «*» is everyone on the wire; a message to a player named «*» went to every player)
  test('«*» is refused as one\'s own name: no room, nothing remembered', T, async t => {
    const W = world(t);
    const A = await W.tab('aaaa1111');
    await A.lib('nms1', 'Аня');
    await assert.rejects(A.lib('nms2', '*'), /not «\*»/);
    const s = await A.state();
    assert.deepEqual([s && s.me, s && s.lib.players], ['Аня', ['Аня']], 'still in the room it was in: ' + show(s));
    assert.ok(!(await A.local()).some(([k, v]) => k === 'ihroteka-name' && v === '*'), 'not taken as the last name');
  });
});
