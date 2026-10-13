// Internet rooms (library/net), in worker tabs over fake brokers (tests/support): players linking up, one roster,
// messages to everyone or to one player, a full room, leaving, «Не чекати» (release), and strangers who talk to the
// room as if they were in it.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 30000 };

// (each test has its own network and tabs: they run side by side)
describe('internet rooms: linking up, messages, a full room, leaving, «Не чекати», strangers', { concurrency: 3 }, () => {
  test('two tabs: the first holds the room, the second joins it', T, async t => {
    const W = world(t);
    const A = await W.tab('p1aaaa');
    await A.join('rooms1', 'Аня');
    assert.ok(await until(async () => (await A.state()).role === 'host', 5000), 'nobody else here: Аня holds the room');
    const B = await W.tab('p2bbbb');
    await B.join('rooms1', 'Богдан');
    const s = await until(settled([A, B]), 5000);
    assert.ok(s, await shows([A, B]));
    assert.deepEqual(s.map(x => [x.role, x.host, x.players]), [['host', 'Аня', ['Аня', 'Богдан']], ['guest', 'Аня', ['Аня', 'Богдан']]]);
    const ea = (await A.events()).map(e => e.slice(1).join(' ')), eb = (await B.events()).map(e => e.slice(1).join(' '));
    assert.ok(ea.includes('linked') && ea.includes('join Богдан'), 'the host hears linked and join: ' + ea);
    assert.ok(eb.includes('linked') && eb.includes('status joining'), 'the guest hears linked, after joining: ' + eb);
    assert.deepEqual(ea.filter(e => e.startsWith('status')), ['status connecting', 'status waiting', 'status ready']);
  });

  test('three tabs: one roster in the order they came; messages to everyone or to one player, by name', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rooms2', ['Аня', 'Богдан', 'Сава']);
    for (const s of await states([A, B, C])) assert.deepEqual(s.players, ['Аня', 'Богдан', 'Сава'], show(s));
    await C.send({ t: 'hey' }, { to: 'Богдан' });            // a guest to a guest: through the host
    await A.send({ t: 'all' });
    await B.send({ t: 'f', n: 1 }, { fast: true, to: 'Сава' });
    assert.ok(await until(async () => (await B.got()).length === 2 && (await C.got()).length === 2, 5000));
    await sleep(300);                                        // (anything more would come by now)
    assert.deepEqual((await B.got()).sort(), ['Аня:all', 'Сава:hey']);
    assert.deepEqual((await C.got()).sort(), ['Аня:all', 'Богдан:f:1']);
    assert.deepEqual(await A.got(), [], 'the host passes on what is not for it, and does not hear it');
    assert.match(await C.send({ t: '_r' }), /a message needs a string t/, 'the room\'s own types are refused');
    assert.match(await C.send({ t: 'p' }), /a message needs a string t/);
  });

  // (phase 1b review: room.lag merged its figures with reduce(Math.max), whose index and array arguments made it NaN as
  // soon as two links counted: the slowest of two guests at the host, or one player's two links while a new tab takes
  // over; a game that keeps its picture behind by a NaN stops it for good)
  test('the delay to the slowest player, or to one (room.lag), is a number of ms, also at a host with two guests', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rooms8', ['Аня', 'Богдан', 'Сава']);
    await sleep(1000);                                       // (a few pings measured)
    for (const [X, n] of [[A, undefined], [A, 'Сава'], [B, undefined], [B, 'Аня'], [C, 'Богдан']]) {
      const v = await X.lag(n);
      assert.ok(Number.isFinite(v) && v >= 0, (await X.state()).me + ' → ' + (n || 'the slowest') + ': ' + v);
    }
  });

  test('a full room says so; a place that comes free is taken', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rooms3', ['Аня', 'Богдан'], { max: 2 });
    const C = await W.tab('p3cccc');
    await C.join('rooms3', 'Сава', { max: 2 });
    assert.ok(await until(async () => (await C.events()).some(e => e[1] === 'status' && e[2] === 'full'), 5000), 'Сава hears the room is full');
    assert.equal((await C.state()).linked, false);
    assert.deepEqual((await A.state()).players, ['Аня', 'Богдан']);
    await B.leave();                                         // Богдан leaves for good: his place goes at once
    assert.ok(await until(settled([A, C]), 8000), 'Сава takes the free place: ' + await shows([A, C]));
    assert.deepEqual((await A.state()).players, ['Аня', 'Сава']);
  });

  test('leaving for good drops the place at once; a closed tab keeps it (away)', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rooms4', ['Аня', 'Богдан', 'Сава']);
    const t0 = Date.now();
    await C.leave();
    assert.ok(await until(async () => (await states([A, B])).every(s => s.players.join() === 'Аня,Богдан'), 3000), await shows([A, B]));
    assert.ok(Date.now() - t0 < 1500, 'at once, not after a silence');
    await B.close();                                         // pagehide: a bye that keeps the place (maybe a reload)
    const s = await until(async () => { const x = await A.state(); return x.away.includes('Богдан') && x; }, 1500);
    assert.ok(s, 'Богдан is away at once: ' + show(await A.state()));
    assert.deepEqual(s.players, ['Аня', 'Богдан'], 'his place is kept');
    assert.equal(s.linked, false);
    const ea = (await A.events()).map(e => e.slice(1).join(' '));
    assert.ok(ea.includes('leave Сава') && ea.includes('away Богдан true') && !ea.includes('leave Богдан'), ea.join(', '));
  });

  test('«Не чекати»: a guest asks the host to let an away player\'s place go; back, they come in as new, last', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'rooms5', ['Сава', 'Аня', 'Богдан']);
    await B.release('Богдан');                               // a guest asks for a player who is here: nothing happens
    await sleep(800);
    assert.deepEqual((await B.state()).players, ['Сава', 'Аня', 'Богдан']);
    await C.net({ up: false });
    assert.ok(await until(async () => (await states([A, B])).every(s => s.away.includes('Богдан')), 5000), 'Богдан is away: ' + await shows([A, B]));
    await B.release('Богдан');                               // a guest asks the host (_x)
    assert.ok(await until(async () => (await states([A, B])).every(s => s.players.join() === 'Сава,Аня' && s.linked), 3000), await shows([A, B]));
    await C.net({ up: true });
    const s = await until(settled([A, B, C]), 10000);
    assert.ok(s, 'all three again: ' + await shows([A, B, C]));
    assert.deepEqual(s[0].players, ['Сава', 'Аня', 'Богдан']);
    await B.net({ up: false });                              // and the host itself lets a place go
    assert.ok(await until(async () => (await A.state()).away.includes('Аня'), 5000));
    await A.release('Аня');
    assert.ok(await until(async () => (await states([A, C])).every(s => s.players.join() === 'Сава,Богдан'), 3000), await shows([A, C]));
  });

  test('two rooms on one code (the brokers split them) merge: the smaller one comes over, its guests too', T, async t => {
    const W = world(t);
    const one = { brokers: [true, true, false, false] }, two = { brokers: [false, false, true, true] };
    const [A, B, C] = await room(W, 'rooms7', ['Аня', 'Богдан', 'Сава'], { net: one });
    const D = await W.tab('p4tab', two), E = await W.tab('p5tab', two);
    await D.join('rooms7', 'Дана');
    assert.ok(await until(async () => (await D.state()).role === 'host', 5000), 'Дана holds a room of her own');
    await E.join('rooms7', 'Єва');
    assert.ok(await until(settled([D, E]), 5000), await shows([D, E]));
    for (const x of [A, B, C, D, E]) await x.net({ brokers: true });   // one network again
    const s = await until(settled([A, B, C, D, E]), 20000, 100);
    assert.ok(s, 'one room of five: ' + await shows([A, B, C, D, E]));
    assert.deepEqual(s[0].players.slice(0, 3), ['Аня', 'Богдан', 'Сава'], 'the bigger room\'s order first');
    assert.deepEqual(s.map(x => x.role), ['host', 'guest', 'guest', 'guest', 'guest']);
  });

  test('strangers: the host asks them to say hello again, a guest says we are not together (a bye that keeps every place); once in 2 s each', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'rooms6', ['Аня', 'Богдан']);
    const { topic } = await A.info('rooms6');
    const S = W.spy(), eve = 'eve0spy0.aaaaaa', mal = 'mal0spy0.bbbbbb';
    // what one session said to another (one copy through each broker: counted once)
    const said = (from, to) => [...new Map(S.seen.filter(x => x.m.f === from && x.m.to === to).map(x => [x.m.q, x.m])).values()];
    S.publish(topic, { t: 'here', to: A.session }, eve);     // as if linked with the host
    S.publish(topic, { t: 'here', to: B.session }, eve);     // as if a guest were its host
    S.publish(topic, { t: 'd', to: A.session, d: [{ t: 'x', _x: 1 }] }, mal);   // data as if linked
    assert.ok(await until(() => said(A.session, eve).length && said(B.session, eve).length && said(A.session, mal).length, 3000), 'every one is answered');
    const host = said(A.session, eve)[0], guest = said(B.session, eve)[0];
    assert.equal(host.t, 'host'); assert.equal(host.u, 1); assert.equal(host.c, 2);
    assert.equal(guest.t, 'bye'); assert.equal(guest.menu, undefined, 'not final: nobody left for good (room.js, the places invariant)');
    assert.equal(said(A.session, mal)[0].u, 1);
    S.publish(topic, { t: 'here', to: A.session }, eve);     // again at once: not answered again
    await sleep(600);
    assert.equal(said(A.session, eve).length, 1);
    assert.equal((await A.got()).length, 0, 'their data never reaches the room');
    assert.ok(await until(settled([A, B]), 1000), 'the room goes on as it was: ' + await shows([A, B]));
  });
});
