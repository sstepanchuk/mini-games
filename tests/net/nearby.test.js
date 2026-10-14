// Nearby rooms (library/net/nearby.js), in worker tabs with fake direct links (tests/support/fakertc.js): phones paired
// by codes, no brokers. A place is dropped in only three ways (room.js): a page that closes or reloads says a bye that
// keeps it (the link closes, the player is away until paired again); a name already in the room gets an answer at once
// (the host's own is refused, a guest's from another phone takes that place over, that phone is told); a phone back from
// a sleep longer than places are kept sees the others away at once.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFER, encode } from '../../library/net/code.js';
import { settled, show, shows, sleep, states, until, world } from '../support/world.js';

const T = { timeout: 40000 };
const said = async (tab, ...ev) => (await tab.events()).some(e => ev.every((x, i) => e[i + 1] === x));
const since = async (tab, n) => (await tab.events()).slice(n).map(e => e.slice(1).join(' '));
const lastStatus = async tab => (await tab.events()).filter(e => e[1] === 'status').map(e => e[2]).pop();

// two phones pair: the host shows its code, the guest answers, the host reads the answer
async function pairUp(H, G) {
  const offer = await H.pair('offer');
  const answer = await G.pair('answer', offer);
  await H.pair('finish', answer);
}
// phones for these players (pids p1…), the first holds the room and pairs with each of the others in turn → the phones
async function phones(W, names, { max } = {}) {
  const tabs = [];
  for (const [i, name] of names.entries()) {
    const X = await W.tab('p' + (i + 1) + 'tab');
    await X.near(name, { max });
    if (i) {
      await pairUp(tabs[0], X);
      if (!await until(settled([...tabs, X]), 8000)) throw new Error('phones: ' + name + ' is not in: ' + await shows([...tabs, X]));
    }
    tabs.push(X);
  }
  return tabs;
}

// (each test has its own network and tabs: they run side by side)
describe('nearby rooms: places, names', { concurrency: 3 }, () => {
  // (phase 1b, C1: a reload's bye used to end the link, and with it the room on the other phone)
  test('a guest\'s page reloads (a bye that keeps the place): the room goes on, the player away; paired again, back in their place', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G, K] = await phones(W, ['Ганна', 'Гліб', 'Кіра']);
    const n = (await H.events()).length;
    await G.close();                                       // pagehide: the bye goes out at once, then the page is gone
    const s = await until(async () => { const x = await H.state(); return x.away.includes('Гліб') && x; }, 5000);
    assert.ok(s, 'Гліб is away: ' + show(await H.state()));
    assert.deepEqual([s.linked, s.players], [true, ['Ганна', 'Гліб', 'Кіра']], 'the room goes on, his place kept: ' + show(s));
    assert.ok(await until(async () => (await K.state()).away.join() === 'Гліб', 3000), 'Кіра hears it from the host: ' + show(await K.state()));
    const G2 = await W.tab('p4tab');                       // the page after the reload: a new session, the same name
    await G2.near('Гліб');
    await pairUp(H, G2);
    const all = await until(settled([H, G2, K]), 8000);
    assert.ok(all, await shows([H, G2, K]));
    assert.deepEqual(all.map(x => x.players.join()), Array(3).fill('Ганна,Гліб,Кіра'), 'in his old place');
    const ev = await since(H, n);
    assert.ok(ev.includes('relinked Гліб true'), 'the host hears: Гліб, from a new tab: ' + ev);
    assert.ok(!ev.some(e => /^(peer-gone|leave|status peer-left)/.test(e)), 'nobody left, the room never ended: ' + ev);
  });

  test('the host\'s page reloads: the guest keeps the room, the host away; the host\'s new page pairs again and the room goes on', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G] = await phones(W, ['Ганна', 'Гліб']);
    const n = (await G.events()).length;
    await H.close();
    const s = await until(async () => { const x = await G.state(); return x.away.includes('Ганна') && x; }, 5000);
    assert.ok(s, show(await G.state()));
    assert.deepEqual([s.role, s.linked, s.weak, s.players], ['guest', true, true, ['Ганна', 'Гліб']], 'kept, waiting for the host: ' + show(s));
    const H2 = await W.tab('p3tab');
    await H2.near('Ганна');
    await pairUp(H2, G);                                   // (a guest pairs again only while its link to the host is broken or silent)
    const all = await until(settled([H2, G]), 8000);
    assert.ok(all, await shows([H2, G]));
    assert.deepEqual(all.map(x => [x.role, x.players.join()]), [['host', 'Ганна,Гліб'], ['guest', 'Ганна,Гліб']]);
    const ev = await since(G, n);
    assert.ok(ev.includes('relinked Ганна true') && !ev.some(e => /^(peer-gone|leave|role|status peer-left)/.test(e)), 'the same room, the host back: ' + ev);
    // (the new link counts before the room says who is back: what the game sends them then gets there)
    assert.ok(ev.indexOf('status ready') >= 0 && ev.indexOf('status ready') < ev.indexOf('relinked Ганна true'), 'linked first: ' + ev);
  });

  // (audit, net-edge-03: a guest paired again only once its dead link's channels closed, which a browser does when ICE
  // gives up, ~15 s after a crash in Chromium; until then its answer to the host's new page was refused, 'kind')
  test('the host\'s tab is killed (no bye; its channels stay open on the guest): its new page pairs again', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G] = await phones(W, ['Ганна', 'Гліб']);
    const n = (await G.events()).length;
    await H.kill();
    assert.ok(await until(async () => (await G.state()).away.includes('Ганна'), 5000), show(await G.state()));
    const H2 = await W.tab('p3tab');
    await H2.near('Ганна');
    await pairUp(H2, G);
    const all = await until(settled([H2, G]), 8000);
    assert.ok(all, await shows([H2, G]));
    assert.deepEqual(all.map(x => [x.role, x.players.join()]), [['host', 'Ганна,Гліб'], ['guest', 'Ганна,Гліб']]);
    const ev = await since(G, n);
    assert.ok(ev.includes('relinked Ганна true') && !ev.some(e => /^(peer-gone|leave|role|status peer-left)/.test(e)), 'the same room, the host back: ' + ev);
  });

  // a guest that hears its host never pairs with anyone else (it does not start pairing; only the host adds players)
  test('a guest whose link to the host works is refused another host\'s code (\'kind\'), also right after a blip it recovered from', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G] = await phones(W, ['Ганна', 'Гліб']);
    const X = await W.tab('p3tab');
    await X.near('Ксеня');
    await assert.rejects(G.pair('answer', await X.pair('offer')), /Error: kind\b/, 'a live link');
    await G.net({ direct: false });                        // a blip: silent both ways, then back by itself
    assert.ok(await until(async () => (await G.state()).away.includes('Ганна'), 5000), show(await G.state()));
    await G.net({ direct: true });
    assert.ok(await until(settled([H, G]), 5000), 'the old link is back: ' + await shows([H, G]));
    await assert.rejects(G.pair('answer', await H.pair('offer')), /Error: kind\b/, 'the link back after a blip');
    assert.ok(await until(settled([H, G]), 1000), 'the room as it was: ' + await shows([H, G]));
  });

  // (phase 1b review: the host's new page knew only itself, so the first guest paired again heard everyone else leave,
  // and the rounds they played were over)
  test('the host\'s page reloads in a room of three: the first guest paired again brings the room\'s places back; nobody leaves', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G, K] = await phones(W, ['Ганна', 'Гліб', 'Кіра']);
    const n = [(await G.events()).length, (await K.events()).length];
    await H.close();
    assert.ok(await until(async () => (await states([G, K])).every(x => x.away.includes('Ганна')), 5000), await shows([G, K]));
    const H2 = await W.tab('p4tab');
    await H2.near('Ганна');
    await pairUp(H2, G);
    const s = await until(async () => { const x = await states([H2, G]); return x.every(y => y.linked && y.players.join() === 'Ганна,Гліб,Кіра' && y.away.join() === 'Кіра') && x; }, 8000);
    assert.ok(s, 'Кіра\'s place waits for her, in its order: ' + await shows([H2, G]));
    await pairUp(H2, K);
    const all = await until(settled([H2, G, K]), 8000);
    assert.ok(all, 'Кіра back in her place: ' + await shows([H2, G, K]));
    assert.deepEqual(all.map(x => x.players.join()), Array(3).fill('Ганна,Гліб,Кіра'));
    const ev = [await since(G, n[0]), await since(K, n[1])];
    assert.ok(ev.every(e => e.includes('relinked Ганна true') && !e.some(x => /^(peer-gone|leave|join|status peer-left)/.test(x))), 'the same room, the host back: ' + ev.join(' | '));
    // her tab is the same, with no link left on the host's new page: it says 'relinked', so she gets the full picture
    assert.ok((await since(H2, 0)).includes('relinked Кіра false'), (await since(H2, 0)).join(', '));
  });

  // (phase 1b, C3: both used to wait, the guest up to 90 s, and then say the network keeps the devices apart)
  test('a phone under the host\'s name is refused at once: both pairings fail with reason \'name\'; the room stays as it was', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G] = await phones(W, ['Ганна', 'Гліб']);
    const X = await W.tab('p3tab');
    await X.near('Ганна');
    const t0 = Date.now();
    await pairUp(H, X);
    const s = await until(async () => { const x = await states([H, X]); return x.every(y => y.reason === 'name') && x; }, 3000);
    assert.ok(s, 'both know why: ' + JSON.stringify((await states([H, X])).map(y => y.reason)));
    assert.ok(Date.now() - t0 < 3000, 'at once: ' + (Date.now() - t0) + ' ms');
    assert.deepEqual([await lastStatus(H), await lastStatus(X)], ['failed', 'failed']);
    assert.deepEqual([s[1].linked, s[1].pairing, s[1].players], [false, false, ['Ганна']], 'the newcomer is not in: ' + show(s[1]));
    await sleep(1500);                                     // (the refused link closes a moment later)
    assert.ok(await until(settled([H, G]), 1000), 'Ганна and Гліб go on: ' + await shows([H, G]));
    assert.deepEqual((await H.state()).players, ['Ганна', 'Гліб']);
  });

  // (phase 1b, C3: the host used to ignore the new phone while the old link worked, and its pairing hung)
  test('a guest\'s name from another phone, while the old one is still linked: the new phone takes the place over, the old one is told', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G, K] = await phones(W, ['Ганна', 'Гліб', 'Кіра']);
    const n = [(await H.events()).length, (await K.events()).length];
    const G2 = await W.tab('p4tab');
    await G2.near('Гліб');
    await pairUp(H, G2);
    const all = await until(settled([H, G2, K]), 8000);
    assert.ok(all, await shows([H, G2, K]));
    assert.deepEqual(all.map(x => x.players.join()), Array(3).fill('Ганна,Гліб,Кіра'), 'in his place');
    assert.ok(await until(() => said(G, 'replaced'), 3000), 'the old phone hears it was replaced');
    assert.deepEqual([(await G.state()).role, (await G.state()).linked], ['out', false]);
    const [eh, ek] = [await since(H, n[0]), await since(K, n[1])];
    assert.ok(eh.includes('relinked Гліб true') && ek.includes('relinked Гліб true'), 'Гліб, from a new phone: ' + eh + ' | ' + ek);
    assert.ok(![...eh, ...ek].some(e => /^(peer-gone|leave|weak true|linked)/.test(e)), 'nobody hears him leave: ' + eh + ' | ' + ek);
    await G2.send({ t: 'x', n: 1 });
    assert.ok(await until(async () => (await K.got()).join() === 'Гліб:x:1', 3000), 'the new phone plays: ' + await K.got());
  });

  // (phase 1b, C3: a full room used to refuse even to show a code while a place was held)
  test('a full room with a place held: the host can pair again; a new name is refused (\'full\'), the held place\'s player comes back', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G] = await phones(W, ['Ганна', 'Гліб'], { max: 2 });
    await G.close();
    assert.ok(await until(async () => (await H.state()).away.includes('Гліб'), 5000), show(await H.state()));
    const X = await W.tab('p3tab');
    await X.near('Дана', { max: 2 });
    await pairUp(H, X);                                    // (the host's code: no 'full' while Гліб's place is held)
    assert.ok(await until(async () => (await states([H, X])).every(y => y.reason === 'full'), 3000),
      'no place for Дана: ' + JSON.stringify((await states([H, X])).map(y => y.reason)));
    assert.deepEqual((await H.state()).players, ['Ганна', 'Гліб']);
    await sleep(1200);
    const G2 = await W.tab('p4tab');
    await G2.near('Гліб', { max: 2 });
    await pairUp(H, G2);
    const all = await until(settled([H, G2]), 8000);
    assert.ok(all, 'Гліб back in his place: ' + await shows([H, G2]));
    assert.deepEqual(all[0].players, ['Ганна', 'Гліб']);
  });

  // (phase 1b, C5: the old name used to stay, shown as here, for good)
  test('the same phone back under another name (its final bye lost) leaves no ghost of its old name', T, async t => {
    const W = world(t, { rtc: true });
    const [H, G] = await phones(W, ['Ганна', 'Гліб']);
    await G.net({ direct: false });                        // Гліб's goodbye is lost…
    await G.leave();
    await G.net({ direct: true });
    await G.near('Борис');                                 // …and the same tab (the same session) pairs again as Борис
    await pairUp(H, G);
    const s = await until(settled([H, G]), 8000);
    assert.ok(s, await shows([H, G]));
    assert.deepEqual(s.map(x => x.players.join()), ['Ганна,Борис', 'Ганна,Борис'], 'Гліб is gone: his phone is Борис now');
    const ev = (await H.events()).map(e => e.slice(1).join(' '));
    assert.ok(ev.includes('leave Гліб') && ev.includes('join Борис') && !ev.includes('relinked Борис false'), ev.join(', '));
  });
});

// A phone locked for longer than places are kept (HOLD; the room's timing scaled down: 0.2, WEAK 0.3 s, GRACE 1 s, and
// HOLD set to 8 s outright: tests/support world timing, config.js __timing; scaled, it would be 36 s)
describe('nearby rooms: a long sleep', () => {
  // (phase 1b, C6: awake, it used to count the others here for GRACE, then wait a fresh HOLD for them)
  test('a phone awake after a sleep longer than HOLD sees the others away at once (they have let it go); its place waits again', { timeout: 90000 }, async t => {
    const W = world(t, { rtc: true, scale: 0.2, timing: { HOLD: 8000 } });
    const [H, G] = await phones(W, ['Ганна', 'Гліб']);
    const { HOLD, GRACE } = (await H.info()).timing;
    assert.equal(HOLD, 8000, 'HOLD as the test set it (a sleep of 10 s, not 38)');
    const n = (await G.events()).length;
    const woke = await G.freeze(HOLD + 2000);
    assert.ok(await until(async () => (await H.state()).players.join() === 'Ганна', 5000), 'the host let him go meanwhile (HOLD): ' + show(await H.state()));
    const s = await until(async () => { const x = await G.state(); return x.weak && x.away.includes('Ганна') && x; }, 3000, 10);
    assert.ok(s, 'awake, Гліб sees Ганна away: ' + show(await G.state()));
    const weak = (await G.events()).slice(n).find(e => e[1] === 'weak' && e[2] === true);
    assert.ok(weak && weak[0] - woke < GRACE, 'at once, not after GRACE (' + GRACE + ' ms): ' + (weak && weak[0] - woke) + ' ms');
    assert.deepEqual([s.role, s.linked, s.players], ['guest', true, ['Ганна', 'Гліб']], 'its room waits (pairing again brings them together): ' + show(s));
  });
});

// (audit, net-edge-05: a browser without WebRTC used to throw a TypeError, leave a pairing pending and give no reason)
describe('nearby rooms: no WebRTC', () => {
  test('no WebRTC: offer() and answer(code) refuse with nortc, pair.reason is nortc, nothing pending', T, async t => {
    const W = world(t);                                    // (no rtc: these tabs have no RTCPeerConnection)
    const H = await W.tab('p1tab'), G = await W.tab('p2tab');
    await H.near('Ганна'); await G.near('Гліб');
    const fp = Array(32).fill('AB').join(':');             // a host's code, as a browser with WebRTC shows it
    const offer = encode(['v=0', 'a=ice-ufrag:abcd', 'a=ice-pwd:abcdefghijklmnopqrstuv', 'a=fingerprint:sha-256 ' + fp, 'a=mid:0',
      'a=candidate:1 1 udp 2122260223 192.168.0.7 50000 typ host'].join('\r\n'), OFFER, 'test');
    for (const [X, step, code] of [[H, 'offer'], [G, 'answer', offer]]) {
      await assert.rejects(X.pair(step, code), /Error: nortc\b/, step);
      const s = await X.state();
      assert.deepEqual([s.reason, s.pairing], ['nortc', false], step + ': why, and no pairing left: ' + show(s));
    }
  });
});
