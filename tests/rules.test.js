// The room's rules for an open game (library/app/rules.js), as they work today: who plays and who waits, whose
// copy runs the round, who is away and why, when the round moves to another copy, what the game hears when its
// players change. The known bugs are { todo } tests of what should happen; phase 1 turns them green.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { absence, arrivesLoading, awayMs, goneForGood, inGame, loadingTooLong, offerUpdate, onlineSince, paused, playersChange, reloadNow, roleOf, runnerOf, sameWire,
  seating, snapFits, takeOver, versionGap, waitingFor } from '../library/app/rules.js';

const G = 'dragons', WAIT = 10000, HOLD = 180000, NOW = 1000000;   // AUTH_WAIT and HOLD as the library has them
// The room as together.js shows it to the rules. here: the game each player has open (everyone: G, unless given);
// away: ms since a player dropped out; loading: since when (ms) a player's new tab has not opened the game; wire: the
// wire number of each player's copy of G (not given: their library does not say).
const room = ({ me = 'Аня', players = ['Аня', 'Богдан'], here, stale = [], loading = {}, away = {}, weak = [], nearby = false, role = 'host', host = players[0], now = NOW, wire = {} } = {}) => {
  const h = here || Object.fromEntries(players.map(p => [p, G]));
  return { me, players, here: p => h[p], wire: (p, game) => game === G ? wire[p] : undefined, stale: new Set(stale), loading: new Map(Object.entries(loading)), away: p => away[p] || 0,
    weak: p => weak.includes(p), nearby, role, host, now };
};
// what together.js counts for the open game (recount)
const seats = (f, n, mine = G) => seating(inGame(f, G, mine), n, f.me);

/* ---------- who is in the game ---------- */
test('in the game: we and whoever has it open, in the room\'s order', () => {
  const f = room({ players: ['Сава', 'Аня', 'Богдан', 'Дана'], here: { Сава: G, Богдан: G, Дана: null } });
  assert.deepEqual(inGame(f, G, G), ['Сава', 'Аня', 'Богдан']);
});

test('in the game: not a player on the shelf or in another game', () => {
  const f = room({ players: ['Аня', 'Богдан', 'Сава'], here: { Богдан: null, Сава: 'other' } });
  assert.deepEqual(inGame(f, G, G), ['Аня']);
});

test('in the game: what we have open counts for us, not our here: key (it may be our old tab\'s)', () => {
  assert.deepEqual(inGame(room({ here: { Аня: null, Богдан: G } }), G, G), ['Аня', 'Богдан']);
  assert.deepEqual(inGame(room({ here: { Аня: G, Богдан: G } }), G, null), []);      // we have no game open
  assert.deepEqual(inGame(room({ here: { Аня: G, Богдан: G } }), G, 'other'), []);
});

test('in the game: a player who dropped out or is still loading keeps their place', () => {
  assert.deepEqual(inGame(room({ away: { Богдан: 60000 } }), G, G), ['Аня', 'Богдан']);
  assert.deepEqual(inGame(room({ loading: { Богдан: NOW - 5000 } }), G, G), ['Аня', 'Богдан']);
});

// (Дана's library is older than the numbers: it says none, and speaks wire 1, as every game did before them)
test('in the game: not a player whose copy of the game speaks another wire number; one whose library does not say speaks 1', () => {
  const players = ['Аня', 'Богдан', 'Сава', 'Дана'];
  assert.deepEqual(inGame(room({ players, wire: { Аня: 2, Богдан: 1, Сава: 2 } }), G, G), ['Аня', 'Сава']);
  assert.deepEqual(inGame(room({ me: 'Богдан', players, wire: { Аня: 2, Богдан: 1, Сава: 2 } }), G, G), ['Богдан', 'Дана']);
  assert.deepEqual(inGame(room({ players, wire: { Аня: 1 } }), G, G), players, 'the release that brings the numbers: every game 1, all play');
  assert.deepEqual(seats(room({ players: ['Аня', 'Богдан', 'Сава'], wire: { Аня: 1, Богдан: 2, Сава: 1 } }), 2).seated, ['Аня', 'Сава']);
  assert.equal(sameWire(1, undefined), true);
  assert.equal(sameWire(undefined, undefined), true);
  assert.equal(sameWire(undefined, 3), false);
  assert.equal(sameWire(2, undefined), false);
  assert.equal(sameWire(2, 2), true);
  assert.equal(sameWire(2, 3), false);
});

test('in the game: not a stale player (their new tab never opened the game), though they are still in the room', () => {
  assert.deepEqual(inGame(room({ stale: ['Богдан'] }), G, G), ['Аня']);
  assert.deepEqual(inGame(room({ stale: ['Аня'] }), G, G), ['Аня', 'Богдан']);      // never us
});

/* ---------- seats ---------- */
test('two seats: the first two play, a third waits', () => {
  const f = room({ players: ['Аня', 'Богдан', 'Сава'] });
  assert.deepEqual(seats(f, 2), { inGame: ['Аня', 'Богдан', 'Сава'], seated: ['Аня', 'Богдан'], waiting: ['Сава'], others: ['Богдан'] });
  assert.deepEqual(seats({ ...f, me: 'Богдан' }, 2).others, ['Аня']);
});

test('two seats: a waiting player plays with nobody', () => {
  const s = seats(room({ me: 'Сава', players: ['Аня', 'Богдан', 'Сава'] }), 2);
  assert.deepEqual(s.seated, ['Аня', 'Богдан']);
  assert.deepEqual(s.waiting, ['Сава']);
  assert.deepEqual(s.others, []);
});

test('three or more seats: everyone who has the game open plays, up to the seats', () => {
  const f = room({ players: ['Аня', 'Богдан', 'Сава', 'Дана'] });
  assert.deepEqual(seats(f, 3), { inGame: ['Аня', 'Богдан', 'Сава', 'Дана'], seated: ['Аня', 'Богдан', 'Сава'], waiting: ['Дана'], others: ['Богдан', 'Сава'] });
  assert.deepEqual(seats(f, 8).waiting, []);
  assert.deepEqual(seats(f, 8).others, ['Богдан', 'Сава', 'Дана']);
});

test('seats: the room\'s order decides, and a player on the shelf takes no seat', () => {
  const f = room({ me: 'Сава', players: ['Аня', 'Богдан', 'Сава'], here: { Аня: null, Богдан: G } });
  assert.deepEqual(seats(f, 2).seated, ['Богдан', 'Сава']);
});

test('seats: alone in the game, we are seated but play with nobody', () => {
  const s = seats(room({ here: { Богдан: null } }), 2);
  assert.deepEqual(s.seated, ['Аня']);
  assert.deepEqual(s.others, []);
});

test('seats: a dropped player keeps their seat; a stale one gives it to the one waiting', () => {
  const players = ['Аня', 'Богдан', 'Сава'];
  assert.deepEqual(seats(room({ players, away: { Богдан: 170000 } }), 2).seated, ['Аня', 'Богдан']);
  assert.deepEqual(seats(room({ players, stale: ['Богдан'] }), 2).seated, ['Аня', 'Сава']);
});

/* ---------- whose copy runs the round ---------- */
test('runner: nobody named, the first who plays', () => {
  assert.equal(runnerOf(['Аня', 'Богдан'], undefined), 'Аня');
  assert.equal(runnerOf(['Аня', 'Богдан'], null), 'Аня');
  assert.equal(runnerOf([], undefined), null);
});

test('runner: the one the shared state names (auth:<game>), while they play', () => {
  assert.equal(runnerOf(['Аня', 'Богдан'], 'Богдан'), 'Богдан');
  assert.equal(runnerOf(['Аня', 'Богдан', 'Сава'], 'Сава'), 'Сава');
});

test('runner: named but not playing (waiting, gone): the first who plays', () => {
  assert.equal(runnerOf(['Аня', 'Богдан'], 'Сава'), 'Аня');
  assert.equal(runnerOf(['Богдан'], 'Аня'), 'Богдан');
  assert.equal(runnerOf([], 'Аня'), null);
});

test('role: host where our copy runs the round, guest where it does not, null while we wait', () => {
  const seated = ['Аня', 'Богдан'];
  assert.equal(roleOf(seated, 'Аня', undefined), 'host');
  assert.equal(roleOf(seated, 'Богдан', undefined), 'guest');
  assert.equal(roleOf(seated, 'Аня', 'Богдан'), 'guest');
  assert.equal(roleOf(seated, 'Богдан', 'Богдан'), 'host');
  assert.equal(roleOf(seated, 'Сава', 'Сава'), null);
});

/* ---------- away, and why ---------- */
test('absence: we are never away', () => {
  const f = room({ away: { Аня: 5000 }, loading: { Аня: NOW - 5000 } });
  assert.equal(absence(f, 'Аня'), null);
  assert.equal(awayMs(f, 'Аня'), 0);
});

test('absence: here', () => {
  assert.equal(absence(room(), 'Богдан'), null);
  assert.equal(awayMs(room(), 'Богдан'), 0);
});

test('absence: dropped out (the room keeps their place), for as long as the room says', () => {
  const f = room({ away: { Богдан: 4000 } });
  assert.deepEqual(absence(f, 'Богдан'), { ms: 4000, why: 'link' });
  assert.equal(awayMs(f, 'Богдан'), 4000);
});

test('absence: back in a new tab or device whose game is not open yet: loading, since then (at least 1 ms)', () => {
  assert.deepEqual(absence(room({ loading: { Богдан: NOW - 3000 } }), 'Богдан'), { ms: 3000, why: 'loading' });
  assert.deepEqual(absence(room({ loading: { Богдан: NOW } }), 'Богдан'), { ms: 1, why: 'loading' });
});

test('absence: dropped out while loading counts as dropped out', () => {
  assert.deepEqual(absence(room({ away: { Богдан: 2000 }, loading: { Богдан: NOW - 9000 } }), 'Богдан'), { ms: 2000, why: 'link' });
});

/* ---------- coming back, loading, stale ---------- */
test('arrival: back in a new tab or device with a game open: loading until their new here: arrives', () => {
  const f = room();
  assert.equal(arrivesLoading(f, 'Богдан', 'relinked', true), true);
  assert.equal(arrivesLoading(f, 'Богдан', 'relinked', false), false);   // the same tab after its link started over
  assert.equal(arrivesLoading(room({ here: { Аня: G, Богдан: null } }), 'Богдан', 'relinked', true), false);   // no game open
});

test('arrival: a player joining (no place kept) counts as here at once', () => {
  assert.equal(arrivesLoading(room({ here: { Аня: G, Богдан: null } }), 'Богдан', 'join'), false);
});

test('stale: loading for longer than a place is kept (strictly)', () => {
  const loading = new Map([['Богдан', NOW - HOLD - 1], ['Сава', NOW - HOLD], ['Дана', NOW - 5]]);
  assert.deepEqual(loadingTooLong(loading, NOW, HOLD), ['Богдан']);
  assert.deepEqual(loadingTooLong(new Map(), NOW, HOLD), []);
});

/* ---------- the game pauses ---------- */
test('pause: one of the players we play with went quiet or is still loading', () => {
  assert.equal(paused(room(), ['Богдан']), false);
  assert.equal(paused(room({ weak: ['Богдан'] }), ['Богдан']), true);
  assert.equal(paused(room({ loading: { Богдан: NOW - 1 } }), ['Богдан']), true);
  assert.equal(paused(room({ players: ['Аня', 'Богдан', 'Сава'], weak: ['Сава'], loading: { Сава: NOW } }), ['Богдан']), false);   // Сава waits for a seat
  assert.equal(paused(room({ weak: ['Богдан'] }), []), false);
});

/* ---------- waiting for players ---------- */
test('waiting for: who of those we play with is away, and the time left of their place', () => {
  const f = room({ players: ['Аня', 'Богдан', 'Сава', 'Дана'], away: { Богдан: 5000 }, loading: { Сава: NOW - 2000 } });
  assert.deepEqual(waitingFor(f, ['Богдан', 'Сава', 'Дана'], HOLD), [{ name: 'Богдан', left: 175000 }, { name: 'Сава', left: 178000 }]);
  assert.deepEqual(waitingFor(room({ away: { Богдан: HOLD + 5000 } }), ['Богдан'], HOLD), [{ name: 'Богдан', left: 0 }]);
  assert.deepEqual(waitingFor(room(), ['Богдан'], HOLD), []);
  assert.deepEqual(waitingFor(room({ away: { Сава: 5000 }, players: ['Аня', 'Богдан', 'Сава'] }), ['Богдан'], HOLD), []);   // not one we play with
});

/* ---------- the round moves to another copy ---------- */
test('online clock: starts when we are online, keeps its start, and stops when we are not', () => {
  assert.equal(onlineSince(0, true, 500), 500);
  assert.equal(onlineSince(500, true, 9000), 500);
  assert.equal(onlineSince(500, false, 9000), 0);
  assert.equal(onlineSince(0, false, 9000), 0);
});

// Богдан plays with Аня, whose copy runs the round
const pair = o => room({ me: 'Богдан', players: ['Аня', 'Богдан'], role: 'guest', host: 'Аня', ...o });
const take = (f, { seated = f.players.filter(p => f.here(p) === G).slice(0, 2), runner = 'Аня', since = NOW - WAIT, now = NOW } = {}) =>
  takeOver(f, { seated, runner, since, now, wait: WAIT });

test('takeover: never while our own copy runs the round, or nobody does', () => {
  assert.equal(take(pair({ away: { Аня: 60000 } }), { runner: 'Богдан' }), null);
  assert.equal(take(pair({ away: { Аня: 60000 } }), { runner: null }), null);
});

test('takeover: not before the runner has been away for AUTH_WAIT', () => {
  const f = a => pair({ away: { Аня: a }, role: 'host', host: 'Богдан' });
  assert.equal(take(f(0)), null);
  assert.equal(take(f(WAIT - 1)), null);
  assert.equal(take(f(WAIT)), 'reached');
});

test('takeover: two players, the runner was also the room\'s host: the room moves first (we hear no host)', () => {
  assert.equal(take(pair({ away: { Аня: 12000 } })), null);
});

test('takeover: through the internet, we are the room\'s host now and online for AUTH_WAIT: reached', () => {
  const f = pair({ away: { Аня: 12000 }, role: 'host', host: 'Богдан' });
  assert.equal(take(f), 'reached');
  assert.equal(take(f, { since: NOW - WAIT + 1 }), null);           // not online for long enough
  assert.equal(take(f, { since: 0 }), null);                        // not online
});

test('takeover: nearby, two phones that lose each other never take over', () => {
  assert.equal(take(pair({ away: { Аня: 60000 }, role: 'host', host: 'Богдан', nearby: true })), null);
});

test('takeover: company, someone else in the room is here (seated, waiting or on the shelf), even nearby', () => {
  const trio = o => room({ me: 'Богдан', players: ['Аня', 'Богдан', 'Сава'], role: 'host', host: 'Богдан', nearby: true, away: { Аня: 12000 }, ...o });
  assert.equal(take(trio()), 'company');                                         // Сава waits for a seat
  assert.equal(take(trio({ here: { Аня: G, Богдан: G, Сава: null } })), 'company');   // Сава is on the shelf
  assert.equal(take(trio({ stale: ['Сава'] })), 'company');                      // a stale player is still in the room
  assert.equal(take(trio({ away: { Аня: 12000, Сава: 3000 } })), null);         // Сава dropped out too
  assert.equal(take(trio({ loading: { Сава: NOW - 3000 } })), null);            // Сава is still opening the game
  assert.equal(take(trio({ nearby: false, role: 'guest', host: 'Сава' }), { since: 0 }), 'company');
});

test('takeover: only the first seated player who is here takes the round over', () => {
  const players = ['Аня', 'Сава', 'Богдан', 'Дана'], seated = ['Аня', 'Сава', 'Богдан'];
  const f = (me, o) => room({ me, players, role: me === 'Сава' ? 'host' : 'guest', host: 'Сава', away: { Аня: 12000 }, ...o });
  assert.equal(take(f('Сава'), { seated }), 'company');
  assert.equal(take(f('Богдан'), { seated }), null);
  assert.equal(take(f('Дана'), { seated }), null);                              // waiting: no seat
  assert.equal(take(f('Богдан', { loading: { Сава: NOW - 2000 } }), { seated }), 'company');   // Сава still loading: the next one
  assert.equal(take(f('Богдан', { away: { Аня: 12000, Сава: 500 } }), { seated }), 'company');
});

test('takeover: a runner still opening the game in a new tab counts as away', () => {
  const f = pair({ loading: { Аня: NOW - WAIT }, role: 'host', host: 'Богдан' });
  assert.equal(take(f), 'reached');
  assert.equal(take({ ...f, loading: new Map([['Аня', NOW - WAIT + 1]]) }), null);
});

// A guest cut off from the room's host only knows the others' presence as the host last told it: with the host
// (who also runs the round) gone, a third player still looks here, and the guest splits the round (today: 'company').
test('takeover: a guest cut off from the room\'s host cannot vouch for anyone', { todo: 'phase 2 (C4)' }, () => {
  const f = room({ me: 'Богдан', players: ['Аня', 'Богдан', 'Сава'], role: 'guest', host: 'Аня', away: { Аня: 12000 } });
  assert.equal(take(f, { seated: ['Аня', 'Богдан'], since: 0 }), null);
});

/* ---------- what the game hears when its players change ---------- */
test('players: the first time we play with someone, linked', () => {
  assert.deepEqual(playersChange(2, [], ['Аня', 'Богдан'], null), [['linked']]);
  assert.deepEqual(playersChange(3, [], ['Аня', 'Богдан', 'Сава'], undefined), [['linked']]);
});

test('players: nothing changed, nothing said', () => {
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], ['Аня', 'Богдан'], 'Аня'), []);
  assert.deepEqual(playersChange(2, [], [], null), []);
});

test('players: nobody left to play with, the round is over', () => {
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], [], 'Аня'), [['peer-gone']]);
  assert.deepEqual(playersChange(3, ['Аня', 'Богдан', 'Сава'], [], 'Аня'), [['peer-gone']]);
});

test('players: a game for two, the other player is someone else now: the round ends, then linked again', () => {
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], ['Аня', 'Сава'], 'Аня'), [['peer-gone'], ['linked']]);
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], ['Аня', 'Сава'], 'Богдан'), [['peer-gone'], ['linked']]);
});

test('players: more seats, one more player joins or one who does not run the round leaves', () => {
  assert.deepEqual(playersChange(3, ['Аня', 'Богдан'], ['Аня', 'Богдан', 'Сава'], 'Аня'), [['join', 'Сава']]);
  assert.deepEqual(playersChange(3, ['Аня', 'Богдан', 'Сава'], ['Аня', 'Сава'], 'Аня'), [['leave', 'Богдан']]);
  assert.deepEqual(playersChange(4, ['Аня', 'Богдан', 'Сава'], ['Аня', 'Сава', 'Дана'], 'Сава'), [['leave', 'Богдан'], ['join', 'Дана']]);
});

test('players: more seats, whoever ran the round is gone: the round is over, then linked again', () => {
  assert.deepEqual(playersChange(3, ['Аня', 'Богдан', 'Сава'], ['Богдан', 'Сава'], 'Аня'), [['peer-gone'], ['linked']]);
});

test('players: more seats, the same players in another order say nothing', () => {
  assert.deepEqual(playersChange(3, ['Аня', 'Богдан', 'Сава'], ['Богдан', 'Аня', 'Сава'], 'Аня'), []);
});

test('players: a game for two, a third player waiting takes the seat of one who left for good: a new round', () => {
  const before = seats(room({ players: ['Аня', 'Богдан', 'Сава'] }), 2), after = seats(room({ players: ['Аня', 'Сава'] }), 2);
  assert.deepEqual(before.others, ['Богдан']);
  assert.deepEqual(playersChange(2, before.seated, after.seated, 'Аня'), [['peer-gone'], ['linked']]);
});

test('players: a player who drops out keeps their seat (the game pauses on weak; nobody takes the seat)', () => {
  const players = ['Аня', 'Богдан', 'Сава'], s = seats(room({ players, away: { Богдан: 60000 }, weak: ['Богдан'] }), 2);
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], s.seated, 'Аня'), []);
  assert.deepEqual(s.waiting, ['Сава']);
});

// The room's order may change on a shaky network; the round's seats must not, and neither must the round.
test('players: a game for two, the same pair in another order keeps the round', () => {
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], ['Богдан', 'Аня'], 'Аня'), []);
  assert.deepEqual(playersChange(2, ['Аня', 'Богдан'], ['Богдан', 'Аня'], 'Богдан'), []);
});

/* ---------- a round's snapshot ---------- */
test('snapshot: fits the players seated now, as a set; one from an older library (no players) fits any', () => {
  assert.equal(snapFits({ s: 1, p: ['Аня', 'Богдан'] }, ['Аня', 'Богдан']), true);
  assert.equal(snapFits({ s: 1, p: ['Аня', 'Богдан'] }, ['Богдан', 'Аня']), true);
  assert.equal(snapFits({ s: 1, p: ['Аня', 'Богдан'] }, ['Аня', 'Сава']), false);    // someone else's round
  assert.equal(snapFits({ s: 1, p: ['Аня', 'Богдан'] }, ['Аня']), false);
  assert.equal(snapFits({ s: 1, p: ['Аня', 'Богдан'] }, ['Аня', 'Богдан', 'Сава']), false);
  assert.equal(snapFits({ s: 1 }, ['Аня', 'Сава']), true);
});

test('round over for good: one of its players is gone from the room (not one who only closed the game or is away)', () => {
  assert.equal(goneForGood(['Аня', 'Богдан'], ['Аня'], 'Аня'), true);
  assert.equal(goneForGood(['Аня', 'Богдан'], ['Аня', 'Богдан'], 'Аня'), false);
  assert.equal(goneForGood(['Аня', 'Богдан'], ['Богдан', 'Сава'], 'Аня'), false);   // (never us: we left, the room is gone)
  assert.equal(goneForGood([], ['Аня'], 'Аня'), false);
});

/* ---------- versions ---------- */
const mine = (proto, w) => ({ proto, wires: g => w[g] });
test('versions: another library version (PROTO) the room met; ours older when theirs is the higher number', () => {
  assert.equal(versionGap(mine(1, {}), null, []), null);
  assert.equal(versionGap(mine(1, {}), undefined, []), null);                          // an older net (no versionMismatch)
  assert.deepEqual(versionGap(mine(1, {}), 2, []), { why: 'proto', game: null, theirs: 2, older: true, key: 'proto:2' });
  assert.deepEqual(versionGap(mine(2, {}), 1, []), { why: 'proto', game: null, theirs: 1, older: false, key: 'proto:1' });
});

test('versions: a game\'s wire, for a game both libraries have; the one that makes us older first', () => {
  const m = mine(1, { [G]: 2, other: 1 });
  assert.equal(versionGap(m, null, [{ [G]: 2 }, undefined, { other: 1, notOurs: 5 }]), null);
  assert.deepEqual(versionGap(m, null, [{ [G]: 1 }]), { why: 'wire', game: G, theirs: 1, older: false, key: 'wire:dragons:1' });
  assert.deepEqual(versionGap(m, null, [{ [G]: 1 }, { other: 3 }]), { why: 'wire', game: 'other', theirs: 3, older: true, key: 'wire:other:3' });
});

test('versions: the older page reloads only with no round here, never nearby, once per version', () => {
  const older = { older: true, key: 'proto:2' }, none = new Set();
  assert.equal(reloadNow(older, { nearby: false, playing: false, done: none }), true);
  assert.equal(reloadNow(null, { nearby: false, playing: false, done: none }), false);
  assert.equal(reloadNow({ ...older, older: false }, { nearby: false, playing: false, done: none }), false);   // the newer one waits for the friend
  assert.equal(reloadNow(older, { nearby: true, playing: false, done: none }), false);
  assert.equal(reloadNow(older, { nearby: false, playing: true, done: none }), false);
  assert.equal(reloadNow(older, { nearby: false, playing: false, done: new Set(['proto:2']) }), false);
  assert.equal(reloadNow(older, { nearby: false, playing: false, done: new Set(['proto:3']) }), true);
});

test('versions: the note offers «Оновити» only on the older page, and never nearby', () => {
  const older = { older: true, key: 'wire:dragons:2' };
  assert.equal(offerUpdate(older, { nearby: false }), true);
  assert.equal(offerUpdate(older, { nearby: false, playing: true }), true);          // (the player asks: even in a round)
  assert.equal(offerUpdate({ ...older, older: false }, { nearby: false }), false);   // the newer page has nothing newer to get
  assert.equal(offerUpdate(older, { nearby: true }), false);                         // a reload would end the room for every phone
  assert.equal(offerUpdate(null, { nearby: false }), false);
});

// A player whose place dropped (HOLD over, or «Не чекати») comes back: the room says 'join', not 'relinked', and
// the shared state still has their old here:. Today they are seated and here at once, so the game goes on without
// them; they should count as loading until a here: they write after joining arrives.
test('arrival: back after their place dropped, with an old here:, a player is loading', { todo: 'phase 1b (D1)' }, () => {
  const f = room({ players: ['Аня', 'Богдан'] });                  // here:Богдан is still G, from before
  if (arrivesLoading(f, 'Богдан', 'join')) f.loading.set('Богдан', NOW);   // what together.js does on 'join'
  assert.deepEqual(seats(f, 2).seated, ['Аня', 'Богдан']);
  assert.deepEqual(absence(f, 'Богдан'), { ms: 1, why: 'loading' });
  assert.equal(paused(f, ['Богдан']), true);
});
