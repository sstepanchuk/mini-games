// The trace for bug reports (library/app/trace.js, written by together.js; phase 2, G5): the last 40 lines, a stream of
// the same line counted in one, errors by type and place only; and in worker tabs (tests/support), what the library
// writes into it while two play: the room's events, what the game is told, the shared state's keys, snapshot sizes,
// never what a message, a snapshot or a shared value says. The game's room.diag() ends with it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { room, until, world } from '../support/world.js';
import * as trace from '../../library/app/trace.js';

describe('the trace (phase 2, G5)', () => {
  test('the last 40 lines; the same key again is one line, counted', () => {
    for (let i = 0; i < 45; i++) trace.note('line ' + i);
    let r = trace.read();
    assert.equal(r.length, trace.MAX);
    assert.match(r[0], /^\d\d:\d\d:\d\d\.\d  line 5$/, 'the oldest go: ' + r[0]);
    assert.match(r.at(-1), /  line 44$/);
    trace.note('snapshot g: 100 B', 'snap'); trace.note('snapshot g: 120 B', 'snap'); trace.note('snapshot g: 90 B', 'snap');
    r = trace.read();
    assert.match(r.at(-1), /  snapshot g: 90 B  ×3$/, 'one line, the latest, three of them');
    trace.note('room weak true'); trace.note('room weak true');
    assert.match(trace.read().at(-1), /room weak true  ×2$/);
  });

  test('what an event says: names, flags and numbers; anything else only its size', () => {
    assert.equal(trace.args(['Аня', true, 3, ['Аня', 'Богдан'], { secret: 'ab' }, null]), 'Аня true 3 [Аня, Богдан] 15 B null');
    assert.equal(trace.size({ s: 'їж' }), '12 B', 'bytes of its JSON (UTF-8)');
    const cyc = {}; cyc.cyc = cyc;
    assert.equal(trace.size(cyc), '? B');
  });

  test('an error: its type and place, never its message (also one from another window)', () => {
    let e;
    try { JSON.parse('{"secret": 1'); } catch (x) { e = x; }
    const t = trace.error(e);
    assert.match(t, /^SyntaxError at \S+:\d+:\d+$/, t);
    assert.doesNotMatch(t, /secret/);
    const other = vm.runInNewContext('new RangeError("the secret of the round")');
    assert.match(trace.error(other), /^RangeError\b/);
    assert.doesNotMatch(trace.error(other), /secret/);
    assert.equal(trace.error(new TypeError('secret'), { filename: 'http://127.0.0.1:8000/dragons/js/main.js?x=1', lineno: 12, colno: 5 }), 'TypeError at main.js:12:5');
    assert.equal(trace.error(new TypeError('secret'), { filename: 'http://127.0.0.1:8000/dragons/?frame', lineno: 3, colno: 1 }), 'TypeError at dragons:3:1');
    assert.equal(trace.error('the secret itself'), 'string', 'a thrown string: only that it was one');
    assert.equal(trace.error({ name: 'secret', message: 'secret' }), 'object');
    assert.equal(trace.error(null), 'null');
  });

  test('in tabs: two play; the trace tells events, keys and sizes, and none of what they said; room.diag() ends with it', { timeout: 30000 }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'trace1', ['Аня', 'Богдан'], { lib: {} });
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'both in the game');
    const SECRET = 'Таємниця-42';
    assert.ok(await A.gsend({ t: 'move', note: SECRET }));
    assert.ok(await A.gsend({ t: 'pos', note: SECRET }, { fast: true }));
    assert.ok(await A.share('mode', SECRET));
    for (let i = 0; i < 3; i++) assert.ok(await A.snapshot({ round: 1, note: SECRET + i }));
    assert.ok(await until(async () => (await B.shared('mode')) === SECRET, 3000));
    const [ta, tb] = [(await A.state()).lib.trace, (await B.state()).lib.trace];
    const all = ta.concat(tb).join('\n');
    assert.doesNotMatch(all, new RegExp(SECRET), 'nothing anyone said');
    const has = (lines, re, what) => assert.ok(lines.some(l => re.test(l)), what + ': ' + lines.join('\n'));
    has(ta, /room: internet, as Аня$/, 'the room');
    has(ta, /room linked$/, 'a room event');
    has(ta, /game g open \(2 seats\)$/, 'the game opened');
    has(ta, /→ g players \[Аня, Богдан\]$/, 'what the game is told');
    has(ta, /state → g:g:mode$/, 'the key we shared, not its value');
    has(ta, /snapshot g: \d+ B(  ×[23])?$/, 'the snapshots, their size');
    has(tb, /state ← Аня: .*g:g:mode/, 'the key that came');
    has(tb, /→ g shared mode \d+ B$/, 'the game told a key changed, and its size');
    assert.ok(ta.length <= 40);
    const d = await A.diag();
    assert.match(d, /^Ігротека \?\nroom: internet, role: host/, 'the site version, then the connection');
    assert.match(d, /\ntrace:\n(.+\n)*.*snapshot g: \d+ B/, 'then the trace');
  });

  test('in tabs: a game\'s listener that throws stops none after it; the trace has its type and place, the shell hears it', { timeout: 30000 }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'trace2', ['Аня', 'Богдан'], { lib: {} });
    await B.call('gameLate', { on: true });                  // (Богдан's game listens when told: the thrower first)
    await A.open('g');
    assert.ok(await until(async () => (await A.game())?.linked && (await B.game())?.linked, 5000), 'both in the game');
    const SECRET = 'Таємниця-43';
    await B.call('gthrow', { ev: 'shared', msg: SECRET });
    await B.call('glisten');
    assert.ok(await A.share('mode', 'race'));
    assert.ok(await until(async () => (await B.game()).events.some(e => e[1] === 'shared' && e[2] === 'mode'), 3000), 'the listener after it heard it too');
    const tb = (await B.state()).lib.trace;
    assert.ok(tb.some(l => /error in the game: TypeError at tab\.js:\d+:\d+$/.test(l)), 'the type and the place: ' + tb.join('\n'));
    assert.doesNotMatch(tb.join('\n'), new RegExp(SECRET));
    assert.equal(await B.call('gbroke'), 1, 'the shell heard it (it says the game broke, if it is starting)');
    const errs = await B.takeErrors();
    assert.ok(errs.length === 1 && errs[0].startsWith('TypeError: ' + SECRET), 'and the console, as before: ' + errs);
  });
});
