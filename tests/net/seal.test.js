// The brokers' traffic, sealed (library/net/seal.js, brokers.js; phase 5, J2; owner, decision 10). In Node: the room's
// keys and packets agree with node:crypto's own AES-GCM (tests/support/seal.js), a packet opens only on its topic, from its
// sender, under its number, and only with its room's key; one sealed at once (the last words) opens like any other;
// the replay window; room codes. In worker tabs over fake brokers (tests/support), a stranger who watches every topic
// (it knows no code) reads no names, forges nothing (plain 'moved' and 'ak', packets of another key, garbage under a
// sender's next numbers) and sends nothing again that counts, at once or long after; a host announcement recorded long
// ago makes no host give way to a tab that is gone; a page that goes away still says what it sent as it went (and as it
// was hidden just before: still being sealed), then its goodbye (its last words, sealed at once); a page back in its room
// with its clock set back is heard (its numbers never go back), and one back in its room takes nothing again that it heard
// before (its host's 'moved', recorded); at the door, a page of an older library (plain, on its
// own topic) hears our version and nothing else, and only once it spoke (one from before the version number: nothing).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { keysOf, openWith, sealWith } from '../support/seal.js';
import { room, settled, show, shows, sleep, until, world } from '../support/world.js';

globalThis.window ??= globalThis;                        // (config.js reads window: a session, the timing scale)
const { fresh, ITER, mark, newWindow, open, roomKeys, seal, sealNow, spare, SPARE, WINDOW } = await import('../../library/net/seal.js');
const { CODE_LENGTH, newRoomCode, validRoomCode } = await import('../../library/net/config.js');

const T = { timeout: 40000 };
const mailbox = (topic, from, to) => topic + '/d/' + from + '/' + to;   // (brokers.js mailbox)
const F = 'abcd1234.efgh56';

describe('the seal, in Node', () => {
  test('the room\'s topic and key are those of PBKDF2 and HKDF (node:crypto agrees); the topic is no hash of the code', async () => {
    const t0 = performance.now(), K = await roomKeys('ihroteka', 'k2m4p6r8'), ms = performance.now() - t0, N = keysOf('ihroteka', 'k2m4p6r8');
    assert.equal(K.topic, N.topic);
    assert.equal(K.legacy, N.legacy, 'the old library\'s topic, for the door');
    assert.match(K.topic, /^ihroteka\/s\/[0-9a-f]{32}$/);
    assert.notEqual(K.topic.slice(11), N.legacy.slice(9), 'not the hash of the code a library before PROTO 2 used');
    assert.notEqual(K.topic, (await roomKeys('test', 'k2m4p6r8')).topic, 'another game, another room');
    assert.notEqual(K.topic, (await roomKeys('ihroteka', 'k2m4p6r9')).topic);
    assert.ok(ITER >= 40000, 'PBKDF2 iterations: ' + ITER);
    console.log('    (a room\'s key: ' + ITER + ' iterations of PBKDF2 took ' + ms.toFixed(0) + ' ms here)');
  });

  test('a packet opens only on its topic, from its sender, under its number, with its key; both ways with node:crypto', async () => {
    const K = await roomKeys('test', 'aaaa2222'), N = keysOf('test', 'aaaa2222'), box = mailbox(K.topic, F, 'zzzz9999.yyyyyy');
    const p = await seal(K, box, F, 77, '{"t":"x","n":"Аня"}'), e = JSON.parse(p);
    assert.deepEqual(Object.keys(e), ['s', 'f', 'q'], 'f and q readable, last: ' + p);
    assert.ok(!p.includes('Аня') && !p.includes('"x"'));
    assert.equal(await open(K, box, F, 77, e.s), '{"t":"x","n":"Аня"}');
    assert.deepEqual(openWith(N.key, box, p), { t: 'x', n: 'Аня', f: F, q: 77 }, 'node:crypto opens it');
    assert.equal(await open(K, K.topic, F, 77, e.s), null, 'moved to the room\'s topic');
    assert.equal(await open(K, box, 'abcd1234.other1', 77, e.s), null, 'credited to another sender');
    assert.equal(await open(K, box, F, 78, e.s), null, 'renumbered');
    assert.equal(await open(await roomKeys('test', 'aaaa2223'), box, F, 77, e.s), null, 'another room\'s key');
    const b = Buffer.from(e.s, 'base64'); b[20] ^= 1;
    assert.equal(await open(K, box, F, 77, b.toString('base64')), null, 'one bit changed');
    assert.equal(await open(K, box, F, 77, 'not base64!'), null);
    const q = JSON.parse(sealWith(N.key, K.topic, F, 5, { t: 'who', n: 'Богдан' }));
    assert.equal(await open(K, K.topic, F, 5, q.s), '{"t":"who","n":"Богдан"}', 'what node:crypto sealed opens');
  });

  test('sealed at once (the last words): opens like any other, of any length up to SPARE; a spare is used once', async () => {
    const K = await roomKeys('test', 'bbbb3333'), N = keysOf('test', 'bbbb3333');
    const json = w => '{"t":"bye","w":"' + w + '"}';   // (18 bytes around w)
    const plains = [0, 1, 15, 16].map(n => 'x'.repeat(n)).concat([18, 33, 1000, 4096, SPARE].map(n => json('a'.repeat(n - 18))), json('я'.repeat(100)));
    for (const plain of plains) {
      const n = Buffer.byteLength(plain), M = await spare(K), p = sealNow(K, M, K.topic, F, 1000 + n, plain);
      assert.ok(p, n + ' bytes');
      const e = JSON.parse(p);
      assert.equal(await open(K, K.topic, F, 1000 + n, e.s), plain, n + ' bytes: Web Crypto opens it');
      if (plain[0] === '{') assert.deepEqual(openWith(N.key, K.topic, p), { ...JSON.parse(plain), f: F, q: 1000 + n }, n + ' bytes: node:crypto too');
      assert.equal(sealNow(K, M, K.topic, F, 2000 + n, ''), null, 'used: never twice with one iv');
    }
    const M = await spare(K);
    assert.equal(sealNow(K, M, K.topic, F, 1, 'x'.repeat(SPARE + 1)), null, 'too long');
    assert.ok(sealNow(K, M, K.topic, F, 1, '{"t":"bye"}'), 'and the spare is still there for a shorter one');
    assert.equal(sealNow(K, null, K.topic, F, 1, '{"t":"bye"}'), null, 'no spare');
  });

  test('the replay window: each number once; none more than WINDOW below the highest; marked numbers only', () => {
    const w = newWindow(), base = 1_700_000_000_000;
    assert.ok(fresh(w, base));
    mark(w, base);
    assert.ok(!fresh(w, base), 'once');
    assert.ok(fresh(w, base - 5), 'a number before it, not seen (it came later, by a slower broker)');
    mark(w, base - 5);
    assert.ok(!fresh(w, base - 5));
    mark(w, base + 3);
    assert.ok(fresh(w, base + 1) && fresh(w, base + 2) && !fresh(w, base + 3), 'the numbers it moved past are free');
    mark(w, base + WINDOW + 10);
    assert.ok(!fresh(w, base + 1), 'too old now');
    assert.ok(fresh(w, base + 11) && !fresh(w, base + 10), 'WINDOW below the highest: the edge');
    assert.ok(!fresh(w, base + WINDOW + 10) && fresh(w, base + WINDOW + 9));
    mark(w, base + 10 * WINDOW);
    assert.ok(fresh(w, base + 9 * WINDOW + 1) && !fresh(w, base + 9 * WINDOW), 'a jump clears the window');
  });

  test('a new room\'s code: 8 characters without look-alikes, from cryptographic randomness; 6 to 12 are taken', () => {
    assert.equal(CODE_LENGTH, 8);
    const codes = Array.from({ length: 2000 }, newRoomCode);
    assert.ok(codes.every(c => /^[abcdefghjkmnpqrstuvwxyz23456789]{8}$/.test(c) && validRoomCode(c)), codes.find(c => !/^[a-z2-9]{8}$/.test(c)));
    assert.equal(new Set(codes).size, codes.length);
    const count = new Map();
    for (const c of codes) for (const x of c) count.set(x, (count.get(x) || 0) + 1);
    assert.equal(count.size, 31, 'every character is used');
    assert.ok(Math.max(...count.values()) < 2.0 * Math.min(...count.values()), 'about as often each: ' + JSON.stringify([...count]));
    for (const c of ['abcdef', 'abcdefgh', 'abcdefghjkmn']) assert.ok(validRoomCode(c), c + ': taken (an old room\'s link)');
    for (const c of ['abcde', 'abcdefghjkmnp', 'ABCDEFGH', 'abcd efg', null]) assert.ok(!validRoomCode(c), c);
  });
});

// (each test has its own network and tabs: they run side by side)
describe('sealed rooms, in worker tabs (phase 5, J2)', { concurrency: 3 }, () => {
  test('a stranger who watches every topic reads no names, no messages and no code; a friend with the code reads them', T, async t => {
    const W = world(t), S = W.spy({ stranger: true }), Fr = W.spy();
    const [A, B] = await room(W, 'seal0001', ['Аня', 'Богдан']);
    await A.send({ t: 'x', s: 'Таємниця' }); await B.send({ t: 'y', s: 'Секрет' }, { fast: true });
    assert.ok(await until(async () => (await B.got()).length && (await A.got()).length, 3000));
    await sleep(300);
    const seen = S.seen.filter(x => x.topic.startsWith('ihroteka/'));
    assert.ok(seen.length > 20, 'the stranger sees the packets: ' + seen.length);
    for (const x of seen) {
      assert.ok(x.sealed && Object.keys(x.m).join() === 's,f,q', 'sealed, only f and q readable: ' + x.raw.slice(0, 80));
      assert.doesNotMatch(x.raw + ' ' + x.topic, /Аня|Богдан|Таємниця|Секрет|seal0001|"t":/, 'nothing readable');
      assert.match(x.topic, /^ihroteka\/s\/[0-9a-f]{32}(\/d\/[a-z0-9.]+\/[a-z0-9.]+)?$/, 'a topic from the key: ' + x.topic);
    }
    const said = Fr.seen.map(x => x.m);
    assert.ok(said.some(m => m.t === 'who' && m.n === 'Аня') && said.some(m => m.t === 'hello' && m.n === 'Богдан'), 'a friend with the code reads the handshakes');
    assert.ok(said.some(m => m.t === 'd' && JSON.stringify(m.d).includes('Таємниця')), 'and the messages');
  });

  test('forged packets are dropped: plain «moved» and «ak» as the host, one of another key, garbage under a sender\'s next numbers', T, async t => {
    const W = world(t), S = W.spy({ stranger: true });
    const [A, B, C] = await room(W, 'seal0002', ['Аня', 'Богдан', 'Сава']);
    const { topic } = await A.info('seal0002'), other = keysOf('test', 'seal0003');
    const q = () => Math.max(...S.seen.map(x => x.m.q).filter(Number.isSafeInteger)) + 1;
    S.publish(topic, { t: 'moved', to: C.session }, A.session, { plain: true });                // as before the seal
    S.send(topic, sealWith(other.key, topic, A.session, q(), { t: 'moved', to: B.session }));   // a wrong guess at the code
    await A.net({ send: false });                            // what Аня sends now is lost on the way…
    await A.send({ t: 'r1' }); await A.send({ t: 'r2' });
    // …and «Богдан has everything up to a million», plain
    S.publish(mailbox(topic, B.session, A.session), { t: 'd', to: A.session, d: [{ t: 'ak', a: 1e6 }] }, B.session, { plain: true });
    // garbage under Богдан's next numbers (they are readable): were they taken, his own packets would be dropped as copies
    const next = Math.max(...S.seen.filter(x => x.m.f === B.session).map(x => x.m.q));
    for (let k = 1; k <= 300; k++) {
      const s = randomBytes(60).toString('base64');
      for (const to of [topic, mailbox(topic, B.session, A.session), mailbox(topic, B.session, C.session)]) S.send(to, JSON.stringify({ s, f: B.session, q: next + k }));
    }
    await sleep(500);
    await A.net({ send: true });
    assert.ok(await until(async () => (await B.got()).length >= 2, 3000), 'r1 and r2 arrive: the forged ak was not taken: ' + await B.got());
    assert.deepEqual(await B.got(), ['Аня:r1', 'Аня:r2']);
    await B.sendAll([1, 2, 3, 4, 5].map(n => ({ t: 'f', n })), { fast: true });   // (fast: nothing would send them again)
    assert.ok(await until(async () => (await A.got()).filter(g => g.startsWith('Богдан:f')).length === 5, 3000), 'Богдан\'s next packets all arrive: ' + await A.got());
    const s = await until(settled([A, B, C]), 3000);
    assert.ok(s, 'nobody moved: ' + await shows([A, B, C]));
    assert.deepEqual(s.map(x => x.role), ['host', 'guest', 'guest']);
    assert.ok(!(await C.events()).some(e => e[1] === 'replaced') && !(await B.events()).some(e => e[1] === 'replaced'));
  });

  test('packets sent again are dropped: at once (copies), and long after (more than WINDOW numbers later)', T, async t => {
    const W = world(t), S = W.spy({ stranger: true });
    const [A, B] = await room(W, 'seal0004', ['Аня', 'Богдан']);
    const { topic } = await A.info('seal0004'), box = mailbox(topic, B.session, A.session);
    const fs = async () => (await A.got()).filter(g => g.startsWith('Богдан:f')).length;
    await sleep(300);
    const from = S.seen.length;
    await B.sendAll([1, 2, 3, 4, 5].map(n => ({ t: 'f', n })), { fast: true });
    assert.ok(await until(async () => await fs() === 5, 3000));
    await sleep(200);
    const rec = S.seen.slice(from).filter(x => x.topic === box || x.topic === topic);
    assert.ok(rec.length >= 2, 'recorded: ' + rec.length);
    for (const x of rec) S.send(x.topic, x.raw);
    await sleep(600);
    assert.equal(await fs(), 5, 'at once: not again');
    await B.sendAll(Array.from({ length: WINDOW + 100 }, (_, n) => ({ t: 'r', n })));   // (each reliable one: a publish of its own)
    assert.ok(await until(async () => (await A.got()).filter(g => g.startsWith('Богдан:r')).length === WINDOW + 100, 20000), 'all of them arrive');
    for (const x of rec) S.send(x.topic, x.raw);
    await sleep(600);
    assert.equal(await fs(), 5, 'long after: not again either (below the window)');
    assert.ok(await until(settled([A, B]), 2000), await shows([A, B]));
  });

  test('a host announcement recorded long ago, sent again, makes no host give way to a tab that is gone', T, async t => {
    const W = world(t), S = W.spy({ stranger: true });
    const D = await W.tab('p1tab');                          // (a smaller session: the one a host gives way to, between equals)
    await D.join('seal0005', 'Дана');
    assert.ok(await until(async () => (await D.state()).role === 'host', 5000));
    await sleep(3000);                                       // (it announces itself every 2.5 s)
    const rec = S.seen.filter(x => x.m.f === D.session && !x.topic.includes('/d/'));
    await D.kill();
    const H = await W.tab('p2tab');
    await H.join('seal0005', 'Ганна');
    assert.ok(await until(async () => (await H.state()).role === 'host', 5000));
    for (const x of rec) S.send(x.topic, x.raw);
    await sleep(2000);
    const s = await H.state();
    assert.deepEqual([s.role, s.status], ['host', 'waiting'], 'still the host, waiting: ' + JSON.stringify(s));
    const C = await W.tab('p3tab');
    await C.join('seal0005', 'Сава');
    assert.ok(await until(settled([H, C]), 8000), 'a friend still finds it: ' + await shows([H, C]));
  });

  // (the page's own pagehide comes first, as the library's does: app/together.js sends the open game's last snapshot)
  test('a page that goes away says its last words: what it sent as it went, through the brokers, then its goodbye, at once', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('seal0006', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab'), C = await W.tab('p3tab');
    await B.onHide([{ m: { t: 'last', n: 1 } }, { m: { t: 'last', n: 2 }, opts: { fast: true } }]);
    await C.onHide([{ m: { t: 'big', s: 'x'.repeat(70000) } }]);   // (more than a spare holds: the goodbye goes alone)
    await B.join('seal0006', 'Богдан'); await C.join('seal0006', 'Сава');
    assert.ok(await until(settled([A, B, C]), 8000), await shows([A, B, C]));
    const away = n => async () => (await A.state()).away.includes(n);
    await B.close();
    assert.ok(await until(away('Богдан'), 1200), 'Богдан is away at once (his goodbye came): ' + show(await A.state()));
    assert.deepEqual(await A.got(), ['Богдан:last:1', 'Богдан:last:2'], 'what he sent as he went came first, both');
    await C.close();
    assert.ok(await until(away('Сава'), 1200), 'Сава too: ' + show(await A.state()));
    assert.ok(!(await A.got()).some(g => g.startsWith('Сава:')), 'without what did not fit');
    assert.deepEqual((await A.state()).players.sort(), ['Аня', 'Богдан', 'Сава'], 'their places are kept');
  });

  // (review of phase 5: a closed tab is hidden first, then goes, with nothing between: app/together.js sends the open
  // game's snapshot as the page is hidden, so it was still being sealed when the last words went, ahead of it, and never
  // went itself; the link then held what came after it, waiting for it)
  test('a tab in sight that closes: what it sent as it was hidden, still being sealed, goes in its last words, in order', T, async t => {
    const W = world(t);
    const A = await W.tab('p1tab');
    await A.join('seal0008', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const B = await W.tab('p2tab');
    await B.onHide([{ m: { t: 'hid', n: 1 } }, { m: { t: 'hid', n: 2 }, opts: { fast: true } }], 'hidden');
    await B.onHide([{ m: { t: 'last', n: 3 } }]);
    await B.join('seal0008', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    await B.close({ hidden: true });
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 1200), 'his goodbye came: ' + show(await A.state()));
    await sleep(300);
    assert.deepEqual(await A.got(), ['Богдан:hid:1', 'Богдан:hid:2', 'Богдан:last:3'], 'all of it, once, in order');
  });

  test('the same in the library: the runner\'s tab in sight closes within half a second of its last snapshot, which still arrives', T, async t => {
    const W = world(t, { scale: 0.3 });
    const [A, B] = await room(W, 'seal0009', ['Аня', 'Богдан'], { lib: {} });
    const snapOf = async tab => ((await tab.state()).lib.snaps || {}).g;   // (tests/app/round.test.js)
    await A.open('g');
    assert.ok(await until(async () => (await Promise.all([A, B].map(x => x.game()))).every(g => g && g.linked && g.players.join() === 'Аня,Богдан'), 6000));
    await A.snapshot({ round: 30, moves: 1 });
    assert.ok(await until(async () => (await snapOf(B))?.s?.moves === 1, 3000), 'the first one goes at once');
    await A.snapshot({ round: 30, moves: 2 });               // within the half second: it waits for its turn…
    await A.close({ hidden: true });                         // …and goes as the page is hidden, just before it goes
    assert.ok(await until(async () => (await snapOf(B))?.s?.moves === 2, 3000), 'Богдан has the latest: ' + JSON.stringify(await snapOf(B)));
  });

  // (review of phase 5: a sender's numbers start from the clock when its room begins, and the replay window drops one far
  // below the highest it has opened from that session; the same page in the same room again, after a clock set back)
  test('a page that leaves and comes back, its clock set back meanwhile, is heard again: its numbers never go back', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'seal0010', ['Аня', 'Богдан']);
    await B.leave(false);                                    // (its place is kept)
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 3000), show(await A.state()));
    await B.clock(-60000);                                   // (a phone's clock put right by the network)
    await B.join('seal0010', 'Богдан');
    assert.ok(await until(settled([A, B]), 8000), 'back in: ' + await shows([A, B]));
    assert.deepEqual((await A.state()).away, []);
  });

  // (integration of phase 5: each room used to start with empty replay windows, so the same page back in the same room
  // took a packet of its host once more, recorded before it left)
  test('a tab that takes its place back: its host\'s «moved», recorded and sent again, does not move it out again', T, async t => {
    const W = world(t), S = W.spy({ stranger: true });
    const [A, B] = await room(W, 'seal0011', ['Аня', 'Богдан']);
    const { topic } = await A.info('seal0011'), from = S.seen.length;
    const B2 = await W.tab('p3tab');
    await B2.join('seal0011', 'Богдан');                     // Богдан goes on in another tab: his old one is told «moved»…
    assert.ok(await until(async () => (await B.state()).role === 'out', 8000), show(await B.state()));
    const rec = S.seen.slice(from).filter(x => x.m.f === A.session && x.topic === topic);
    await B.join('seal0011', 'Богдан');                      // …and takes his place back there (the same page, the same session)
    assert.ok(await until(async () => (await B2.state()).role === 'out', 8000), show(await B2.state()));
    assert.ok(await until(settled([A, B]), 8000), await shows([A, B]));
    for (const x of rec) S.send(x.topic, x.raw);
    await sleep(1500);
    const s = await B.state();
    assert.deepEqual([s.role, s.linked], ['guest', true], 'still in: ' + show(s));
  });

  // (the previous release itself, at the door: tests/net/version.test.js; this one needs no release tag)
  test('the door: an older page\'s plain question gets our version only, from a session of its own; one without a version number, nothing', T, async t => {
    const W = world(t), S = W.spy({ stranger: true });
    const A = await W.tab('p1tab');
    await A.join('seal0007', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000));
    const { legacy, proto } = await A.info('seal0007');
    const ours = () => S.seen.filter(x => x.topic === legacy && !/^old/.test(x.m.f)).map(x => x.m);
    await sleep(500);
    assert.deepEqual(ours(), [], 'nothing of ours on the old topic before an old page speaks there');
    S.publish(legacy, { t: 'who', n: 'Стара' }, 'old0page.aaaaaa', { plain: true });   // a library from before the number
    await sleep(800);
    assert.deepEqual(ours(), [], 'it gets no answer (it would take our host for a room to join)');
    for (let i = 0; i < 2; i++) S.publish(legacy, { t: 'who', n: 'Стара', pv: 1 }, 'old1page.bbbbbb', { plain: true });   // looking for the room (twice at once)
    S.publish(legacy, { t: 'host', c: 1, pv: 1 }, 'old2page.cccccc', { plain: true });        // holding it
    const to = f => ours().find(m => m.to === f);           // (the spy sees a copy through each broker)
    assert.ok(await until(() => to('old1page.bbbbbb') && to('old2page.cccccc'), 3000), 'both answered: ' + JSON.stringify(ours()));
    const [a, b] = [to('old1page.bbbbbb'), to('old2page.cccccc')];
    assert.deepEqual([a.t, a.pv, b.t, b.pv], ['host', proto, 'who', proto], 'a host to its question, a question to its host');
    for (const m of ours()) {
      assert.ok(m.f !== A.session && m.n === undefined && m.m === undefined, 'from a session of the door\'s own, no name: ' + JSON.stringify(m));
      assert.equal(m.f, a.f);
    }
    const s = await A.state();
    assert.deepEqual([s.version, s.status, s.role], [1, 'version', 'host'], 'we say \'version\' too, and hold our room');
    await sleep(300);
    assert.equal(new Set(ours().filter(m => m.to === 'old1page.bbbbbb').map(m => m.q)).size, 1, 'once in 2 s per tab (one number, through every broker)');
  });
});
