// Places by name (library/net/room.js, internet.js), in worker tabs over fake brokers (tests/support): the same name
// from a new tab takes that player's place over and the old tab steps aside ('replaced'), the host's name too.
// The known bugs are { todo } tests of what should happen; phase 1 turns them green.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, states, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const said = async (tab, ...ev) => (await tab.events()).some(e => ev.every((x, i) => e[i + 1] === x));

// (each test has its own network and tabs: they run side by side)
describe('places by name: another tab takes a place over', { concurrency: 3 }, () => {
  test('the same name from a new tab takes the place over; the old tab steps aside', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'take1', ['Аня', 'Богдан', 'Сава']);
    const B2 = await W.tab('p4tab');
    await B2.join('take1', 'Богдан');
    const s = await until(settled([A, B2, C]), 8000);
    assert.ok(s, 'the new tab is in, still three names: ' + await shows([A, B2, C]));
    assert.deepEqual(s.map(x => [x.role, x.players.join()]), [['host', 'Аня,Богдан,Сава'], ['guest', 'Аня,Богдан,Сава'], ['guest', 'Аня,Богдан,Сава']]);
    assert.ok(await until(() => said(B, 'replaced'), 3000), 'the old tab hears it was replaced');
    const old = await B.state();
    assert.equal(old.role, 'out', show(old));
    assert.equal(old.linked, false);
    assert.ok(await said(A, 'relinked', 'Богдан', true), 'the host hears: Богдан, from a new tab');
    assert.ok(!await said(A, 'leave', 'Богдан') && !await said(C, 'leave', 'Богдан'), 'nobody hears he left');
  });

  test('the host\'s name from a new tab: the host steps aside, the next player holds the room, the new tab gets the place', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'take2', ['Аня', 'Богдан', 'Сава']);
    const A2 = await W.tab('p4tab');
    await A2.join('take2', 'Аня');
    const s = await until(settled([A2, B, C]), 10000);
    assert.ok(s, await shows([A2, B, C]));
    assert.deepEqual(s.map(x => x.role), ['guest', 'host', 'guest'], 'Богдан holds the room now');
    assert.deepEqual(s[0].players, ['Аня', 'Богдан', 'Сава'], 'Аня keeps her place, first');
    assert.ok(await until(() => said(A, 'replaced'), 3000), 'the old host tab hears it was replaced');
    assert.equal((await A.state()).role, 'out');
  });

  /* ---------- known bugs (phase 1) ---------- */
  test('a takeover sticks: the old tab, back after it missed «moved», does not take the place back', { ...T, todo: 'phase 1b (C2): today the old tab takes the place back and the new one is replaced' }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'take3', ['Богдан', 'Аня']);
    await B.net({ up: false });                              // Аня's tab goes offline…
    const B2 = await W.tab('p3tab');
    await B2.join('take3', 'Аня');                           // …and she goes on in a new one; «moved» to the old tab is lost
    assert.ok(await until(settled([A, B2]), 8000), await shows([A, B2]));
    await B.net({ up: true });                               // the old tab is back
    const s = await until(async () => { const x = await states([B, B2]); return x.some(y => y.role === 'out') && x; }, 15000, 100);
    assert.ok(s, 'one of the two tabs steps aside: ' + await shows([B, B2]));
    assert.equal(s[1].role, 'guest', 'the new tab keeps the place: ' + show(s[1]));
    assert.equal(s[0].role, 'out', 'the old one steps aside: ' + show(s[0]));
  });

  test('a tab that comes back under another name leaves no ghost of its old name', { ...T, todo: 'phase 1b (C5): today the old name stays, shown as here, for good' }, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'take4', ['Аня', 'Богдан']);
    await B.net({ send: false });                            // Богдан's goodbye is lost…
    await B.leave();
    await B.net({ send: true });
    await B.join('take4', 'Борис');                          // …and the same tab (the same session) comes back as Борис
    const s = await until(async () => { const x = await A.state(); return x.players.includes('Борис') && x; }, 8000);
    assert.ok(s, show(await A.state()));
    assert.deepEqual(s.players, ['Аня', 'Борис'], 'Богдан is gone: his tab is Борис now (' + show(s) + ')');
  });
});
