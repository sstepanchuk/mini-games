// Places by name (library/net/room.js, internet.js), in worker tabs over fake brokers (tests/support): the same name
// from a new tab takes that player's place over and the old tab steps aside ('replaced'), the host's name too; the
// takeover sticks (a hello the old tab says by itself is not fresh: it is told 'moved'), and the new session is seated
// before the old link goes, so nobody hears the player leave.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { room, settled, show, shows, sleep, states, until, world } from '../support/world.js';

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

  // (phase 1b, C2: the old link used to go first: in a room of two, the host heard 'peer-gone' and 'linked' again, and
  // the old tab kept its page and network listeners)
  test('a takeover in a room of two: the host hears no one leave (no peer-gone, no second linked); the old tab lets go of the page', T, async t => {
    const W = world(t);
    const [A, B] = await room(W, 'take5', ['Аня', 'Богдан']);
    const n = (await A.events()).length, before = await (await W.tab('p9tab')).listeners();
    assert.ok(Object.keys(await B.listeners()).length > Object.keys(before).length, 'in a room, the page has listeners: ' + JSON.stringify(await B.listeners()));
    const B2 = await W.tab('p3tab');
    await B2.join('take5', 'Богдан');
    assert.ok(await until(settled([A, B2]), 8000), await shows([A, B2]));
    assert.ok(await until(() => said(B, 'replaced'), 3000));
    await sleep(300);
    const ev = (await A.events()).slice(n).map(e => e.slice(1).join(' '));
    assert.ok(ev.includes('relinked Богдан true'), 'the host hears: Богдан, from a new tab: ' + ev);
    assert.ok(!ev.some(e => /^(peer-gone|linked|leave|weak true)/.test(e)), 'and nothing else: ' + ev);
    assert.deepEqual(await B.listeners(), before, 'the old tab has no listeners of the room left (one teardown)');
  });

  // (phase 1b, C2: a guest whose host said u: 1 used to start over as a new guest: 'peer-gone' and 'linked' again, and
  // the host never said 'relinked', so nobody gave it the full picture)
  test('a host that let a guest go: the guest, still there, starts its link over in place; both hear relinked, nobody leaves', T, async t => {
    const W = world(t);
    const [A, B, C] = await room(W, 'take6', ['Аня', 'Богдан', 'Сава']);
    const { topic } = await A.info('take6');
    const n = [(await A.events()).length, (await B.events()).length];
    W.spy().publish(topic, { t: 'bye', to: A.session }, B.session);   // as if Богдан's tab closed (a lost link, say)
    assert.ok(await until(async () => (await A.state()).away.includes('Богдан'), 3000), 'the host lets the link go, the place kept: ' + await shows([A]));
    const s = await until(settled([A, B, C]), 8000);       // Богдан talks to it as if linked: 'host' u: 1, a hello on a new attempt
    assert.ok(s, await shows([A, B, C]));
    assert.deepEqual(s.map(x => x.players.join()), Array(3).fill('Аня,Богдан,Сава'));
    const [ea, eb] = [(await A.events()).slice(n[0]), (await B.events()).slice(n[1])].map(e => e.map(x => x.slice(1).join(' ')));
    assert.ok(ea.includes('relinked Богдан false') && eb.includes('relinked Аня false'), 'both hear relinked (the full picture again): ' + ea + ' | ' + eb);
    assert.ok(!eb.some(e => /^(peer-gone|linked|role)/.test(e)), 'Богдан\'s room does not fall apart meanwhile: ' + eb);
    assert.ok(!ea.some(e => /^leave/.test(e)), 'nobody left: ' + ea);
  });

  // (phase 1b, C2: the old tab used to take the place back and the new one was replaced)
  test('a takeover sticks: the old tab, back after it missed «moved», does not take the place back', T, async t => {
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

  // (phase 1b, C5: the old name used to stay, shown as here, for good)
  test('a tab that comes back under another name leaves no ghost of its old name', T, async t => {
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
