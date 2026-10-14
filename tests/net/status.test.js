// The room's status and kind (library/net/room.js, phase 2, G2): getters of the net room, one setStatus that the modes
// call and that never says the same status twice in a row, the list of statuses (STATUSES) with a text for each in the
// dialog (app/invite.js STATUS), no 'role' event, and a library (app/) that writes nothing onto the net room it does
// not own (no r.kind, no r.lastStatus). A page without Web Crypto (plain http) has no internet room: 'unavailable',
// and nothing of it reaches the brokers (phase 3, L4). A room alone whose one working broker drops says 'no-signal' and
// tries the others again at once, and a short blip ends as soon as the browser is online. The status tells the truth
// (owner, q02): an internet host left alone says 'peer-left', and 'version' only while that version is heard. Read from
// the source, run in Node, and in worker tabs (tests/support).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';
import { room, settled, shows, sleep, until, world } from '../support/world.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const parse = f => espree.parse(read(f), { ecmaVersion: 'latest', sourceType: 'module', loc: true });
function* walk(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const [k, v] of Object.entries(node)) if (k !== 'loc') for (const c of Array.isArray(v) ? v : [v]) if (c && typeof c === 'object') yield* walk(c);
}
// every string a value can be: 'a', or c ? 'a' : d ? 'b' : 'c'
const leaves = n => n.type === 'Literal' ? [n.value] : n.type === 'ConditionalExpression' ? [...leaves(n.consequent), ...leaves(n.alternate)] : [null];
const NET = ['room.js', 'link.js', 'internet.js', 'nearby.js', 'rtc.js', 'brokers.js', 'seal.js', 'code.js', 'config.js', 'index.js'].map(f => 'library/net/' + f);
const APP = fs.readdirSync(path.join(REPO, 'library/app')).filter(f => f.endsWith('.js')).map(f => 'library/app/' + f);

// room.js in Node: config.js reads window (a session, the timing scale)
globalThis.window ??= globalThis;
const { STATUSES, setStatus } = await import('../../library/net/room.js');
const statuses = async T => (await T.events()).filter(e => e[1] === 'status').map(e => e[2]);

describe('the room\'s status (phase 2, G2)', () => {
  test('setStatus: only a known status; never the same one twice in a row; alone, another version says \'version\', not \'waiting\' or \'peer-left\'', () => {
    const heard = [], N = { status: '', mismatch: null, linked: false, emit: (e, s) => heard.push(e + ' ' + s) };
    for (const s of ['connecting', 'connecting', 'waiting', 'ready', 'ready', 'peer-left']) setStatus(N, s);
    assert.deepEqual(heard, ['status connecting', 'status waiting', 'status ready', 'status peer-left']);
    assert.throws(() => setStatus(N, 'sleepy'), /not a status/);
    N.mismatch = 2;
    setStatus(N, 'waiting');
    setStatus(N, 'waiting');
    assert.deepEqual(heard.slice(4), ['status version'], 'once');
    N.linked = true;
    setStatus(N, 'ready');
    assert.equal(N.status, 'ready');
    N.linked = false;
    setStatus(N, 'peer-left');
    assert.equal(N.status, 'version', 'left alone while that version is heard: version (one of us must update)');
  });

  test('every status a mode sets is in STATUSES, each one in STATUSES is set somewhere, and only through setStatus', () => {
    const set = new Set();
    for (const f of NET) for (const n of walk(parse(f))) {
      if (n.type !== 'CallExpression') continue;
      const c = n.callee, a = n.arguments;
      if (c.type === 'Identifier' && c.name === 'setStatus') for (const v of leaves(a[1])) {
        assert.ok(STATUSES.includes(v), f + ':' + n.loc.start.line + ': setStatus with ' + v + ', not one of STATUSES');
        set.add(v);
      }
      if (c.type === 'MemberExpression' && c.property.name === 'emit' && a[0]?.type === 'Literal') {
        assert.ok(a[0].value !== 'status' || (f.endsWith('room.js') && a[1]?.type === 'Identifier'), f + ':' + n.loc.start.line + ': a status said without setStatus');
        assert.notEqual(a[0].value, 'role', f + ':' + n.loc.start.line + ': the net room has no \'role\' event any more');
      }
    }
    assert.deepEqual([...set].sort(), [...STATUSES].sort(), 'statuses nobody sets (or set and not listed)');
  });

  test('the dialog has a text for each status (invite.js STATUS)', () => {
    const decl = [...walk(parse('library/app/invite.js'))].find(n => n.type === 'VariableDeclarator' && n.id.name === 'STATUS');
    assert.ok(decl && decl.init.type === 'ObjectExpression', 'const STATUS = { … } in invite.js');
    const keys = decl.init.properties.map(p => p.key.type === 'Identifier' ? p.key.name : p.key.value);
    assert.deepEqual(keys.sort(), [...STATUSES].sort());
  });

  test('the library writes nothing onto the net room but its policies (streaming, pulse, playing): no r.kind, no r.lastStatus', () => {
    for (const f of APP) for (const n of walk(parse(f))) {
      if (n.type !== 'AssignmentExpression' || n.left.type !== 'MemberExpression' || n.left.computed) continue;
      const o = n.left.object, k = n.left.property.name;      // (the net room: r or room in app/)
      if (o.type === 'Identifier' && (o.name === 'r' || o.name === 'room')) assert.ok(['streaming', 'pulse', 'playing'].includes(k), f + ':' + n.loc.start.line + ': writes room.' + k);
    }
    for (const f of APP) assert.doesNotMatch(read(f), /\blastStatus\b/, f);
  });

  test('a page without Web Crypto (plain http): \'unavailable\', and nothing of its room reaches the brokers (not its code either)', { timeout: 20000 }, async t => {
    const W = world(t), S = W.spy();
    const B = await W.tab('p1tab');
    await B.join('plain1', 'Богдан');
    assert.ok(await until(async () => (await B.state()).status === 'waiting', 5000), 'a page with Web Crypto holds the room');
    const A = await W.tab('p2tab', {}, { insecure: true });
    await A.join('plain1', 'Аня');
    assert.ok(await until(async () => (await A.state()).status === 'unavailable', 3000), 'unavailable: ' + (await A.state()).status);
    await sleep(1500);
    const [a, b] = [await A.state(), await B.state()];
    assert.ok(!a.linked && !b.linked && b.players.join() === 'Богдан', 'they never meet: ' + JSON.stringify([a, b]));
    assert.deepEqual((await A.events()).filter(e => e[1] === 'status').map(e => e[2]), ['connecting', 'unavailable']);
    assert.deepEqual(S.seen.filter(x => x.m.f === A.session), [], 'nothing from the page without Web Crypto');
    assert.ok(S.seen.length && !S.seen.some(x => x.topic.includes('plain1')), 'no room code in a topic: ' + S.seen.map(x => x.topic).join(' '));
  });

  test('in tabs: room.kind and room.status are getters; status is the last one heard; the library\'s state says the same', { timeout: 30000 }, async t => {
    const W = world(t, { rtc: true });
    const [A, B] = await room(W, 'stat1', ['Аня', 'Богдан']);
    const st = async T => { const s = await T.state(), ev = (await T.events()).filter(e => e[1] === 'status').map(e => e[2]); return { s, ev }; };
    for (const T of [A, B]) {
      const { s, ev } = await st(T);
      assert.equal(s.kind, 'internet');
      assert.equal(s.status, 'ready');
      assert.equal(ev.at(-1), s.status);
      assert.ok(ev.every((x, i) => i === 0 || x !== ev[i - 1]), 'never the same twice in a row: ' + ev);
    }
    const C = await W.tab('p3tab');
    await C.near('Сава');
    assert.ok(await until(async () => (await C.state()).status === 'pairing', 3000));
    assert.equal((await C.state()).kind, 'nearby');
    const own = await C.call('roomProps');
    assert.deepEqual([own.kind, own.status], ['get', 'get'], 'getters: ' + JSON.stringify(own));
    const L = await W.tab('p4tab');
    await L.lib('stat2', 'Дана');
    assert.ok(await until(async () => (await L.state()).status === 'waiting', 5000));
    const s = await L.state();
    assert.equal(s.lib.status, 'waiting', 'together.js state() reads room.status');
    assert.equal(s.lib.kind, 'internet');
    const props = await L.call('roomProps');
    assert.ok(!('lastStatus' in props) && props.kind === 'get', 'nothing written onto the net room: ' + JSON.stringify(props));
  });

  // (net-edge-02: the brokers that failed meanwhile waited for their own retry, which grows to two minutes while another
  // works: the room said «Немає інтернету» that long, and nobody found it)
  test('alone, the one broker that worked drops as another comes back: those that kept failing meanwhile try again at once, and a newcomer there finds the room', { timeout: 60000 }, async t => {
    const W = world(t);
    const A = await W.tab('p1tab', { brokers: [true, false, false, false] });
    await A.join('stat3', 'Аня');
    assert.ok(await until(async () => (await A.state()).status === 'waiting', 5000));
    await sleep(20000);                                      // the others keep failing while EMQX works: each tries later and later (brokers.js retryBroker)
    const n = (await A.events()).length;
    await A.net({ brokers: [false, true, false, false] });   // EMQX goes, HiveMQ is back; no 'online' (the device never went offline)
    const statuses = async () => (await A.events()).slice(n).filter(e => e[1] === 'status').map(e => e[2]);
    assert.ok(await until(async () => (await statuses()).join() === 'no-signal,waiting', 2000, 50), 'waiting again through HiveMQ within 2 s: ' + await statuses());
    const B = await W.tab('p2tab', { brokers: [false, true, false, false] });
    await B.join('stat3', 'Богдан');
    assert.ok(await until(settled([A, B]), 5000), await shows([A, B]));
  });

  // (and what that must not cost: a check of every broker when the last one drops would take the 3 s limit that 'online'
  // needs a moment later)
  test('a blip: no-signal, then online within a second: waiting again within 0.5 s', { timeout: 30000 }, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('stat4', 'Аня');
    assert.ok(await until(async () => (await A.state()).status === 'waiting', 5000));
    await sleep(3500);                                       // (past any check of the start)
    await A.net({ up: false });
    assert.ok(await until(async () => (await A.state()).status === 'no-signal', 3000));
    await sleep(1000);
    await A.net({ up: true });
    assert.ok(await until(async () => (await A.state()).status === 'waiting', 500, 20), 'waiting again within 0.5 s of online');
  });

  // (net-core-07, owner q02: only hostGone said 'peer-left' over the internet; a host whose last guest went kept 'ready',
  // «Ви разом.», while alone)
  for (const how of ['leaves for good', 'closes its tab']) {
    test('an internet host whose last guest ' + how + ' says peer-left, not ready', { timeout: 20000 }, async t => {
      const W = world(t);
      const [A, B] = await room(W, 'left' + how.length, ['Аня', 'Богдан']);
      if (how === 'leaves for good') await B.leave(); else await B.close();
      assert.ok(await until(async () => !(await A.state()).linked, 5000));
      assert.equal((await A.state()).status, 'peer-left', 'heard: ' + await statuses(A));
    });
  }

  // (net-core-07, owner q02: 'version' stayed for good once a page of another version passed by while two played)
  test('a version heard while we play: version only while it is heard; then ready, and peer-left once alone', { timeout: 30000 }, async t => {
    const W = world(t, { scale: 0.3 }), S = W.spy();
    const [A, B] = await room(W, 'vpass1', ['Аня', 'Богдан']);
    const { topic, timing } = await A.info('vpass1');
    S.publish(topic, { t: 'who', n: 'Віра', pv: 99 }, 'zzzzzzzz.zzzzzz');   // a page of another version asks, once
    assert.ok(await until(async () => (await A.state()).version === 99, 3000));
    assert.equal((await A.state()).status, 'version', 'while it is heard (the add-player screen says why a third cannot join)');
    assert.ok(await until(async () => (await A.state()).version === null, timing.VERSION + 3000), 'forgotten');
    await sleep(100);
    assert.deepEqual([(await A.state()).status, (await B.state()).status], ['ready', 'ready'], 'A: ' + await statuses(A) + ' | B: ' + await statuses(B));
    await B.leave();
    assert.ok(await until(async () => !(await A.state()).linked, 5000));
    assert.equal((await A.state()).status, 'peer-left');
  });
});
