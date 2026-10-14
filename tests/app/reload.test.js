// A page that reloads in a game (round-16): the browser comes back at the game's address (/<id>/?room=) and the shell
// shows that game before the room is back (shell.js startShell: show(initial)), so the room does not go back to the
// shelf with it. In worker tabs (tests/support: a reload keeps the page's view as its initial one), the room's timing
// scaled down.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { room, show, sleep, until, world } from '../support/world.js';

const plays = (tabs, names) => until(async () => {
  const g = await Promise.all(tabs.map(x => x.game()));
  return g.every(x => x && x.players.join() === names && x.linked) && g;
}, 8000);

test('the host\'s page reloads with its goodbye lost (back in the room: a guest hands the room on at once, owner q03): it comes back in its game, and the room stays there', { timeout: 60000 }, async t => {
  const W = world(t, { scale: 0.5 });
  const [A, B] = await room(W, 'reload01', ['Аня', 'Богдан'], { lib: {} });
  await A.open('g');
  assert.ok(await plays([A, B], 'Аня,Богдан'), 'they play');
  assert.equal(await A.call('rstart', {}), true, 'Аня\'s copy runs a round');
  await A.call('rsave', { s: { n: 2 } });
  await sleep(600);
  await A.net({ up: false });                                // (its goodbye lost)
  const A2 = await A.reload();
  await A2.lib('reload01', 'Аня');
  // (her new page asks for the room with her name while her old one is quiet: Богдан takes the room over at once and
  // lets her in, internet.js heir; before q03 the new page held the room alone until the merge)
  assert.ok(await until(async () => (await A2.state()).linked, 15000), 'back in the room: ' + show(await A2.state()));
  await sleep(1500);
  const sb = await B.state(), b = await B.game(), a = await A2.game();
  assert.equal(sb.lib.view, 'g', 'Богдан is still in the game');
  assert.ok(b, 'his game is still open');
  assert.ok(!b.follows.includes(null), 'he never followed the room to the shelf: ' + JSON.stringify(b.follows));
  assert.ok(a && a.view === 'g', 'Аня\'s new page has the game open, by itself: ' + JSON.stringify(a && a.view));
});
