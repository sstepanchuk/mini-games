// index.js stuck(): a library that did not open says why, with «Спробувати ще»; a try that does not help says «Ще не
// вийшло — спробую знову, щойно з’явиться інтернет.» (the UX spec L-T02), and keeps that promise: the network back while
// a try runs, or in the 600 ms its button stays busy after it, is one more try once that try has failed (an 'online'
// then would else be lost: the page would wait for one that never comes). stuck() is read from index.js (nothing of the
// page is run) with the names it uses from its module given here: a small document, timers run by hand, motion off.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(REPO, 'library/app/index.js');
const AGAIN = 'Ще не вийшло — спробую знову, щойно з’явиться інтернет.';

// the module's own names that stuck() needs (those index.js has: its state, its words), then stuck itself
const OWN = ['AGAIN', 'pressed', 'more', 'soon', 'stuck'];
function stuckOf(scope) {
  const src = fs.readFileSync(FILE, 'utf8'), ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', range: true });
  const parts = ast.body.filter(n => (n.type === 'FunctionDeclaration' && OWN.includes(n.id.name)) ||
    (n.type === 'VariableDeclaration' && n.declarations.some(d => OWN.includes(d.id.name))));
  assert.ok(parts.some(n => n.type === 'FunctionDeclaration'), 'index.js: function stuck');
  const names = Object.keys(scope);
  return new Function(...names, parts.map(n => src.slice(...n.range)).join('\n') + '\nreturn stuck;')(...names.map(k => scope[k]));
}

// a small page: #boot, #busy, and what stuck() adds after them; the window's 'online' listeners; timers by hand
function world() {
  const ids = {}, online = new Set(), timers = [], tries = [];
  const node = (props = {}) => {
    const n = { textContent: '', className: '', attrs: {}, onclick: null, ...props,
      classList: { add() {}, remove() {} }, setAttribute(k, v) { this.attrs[k] = v; }, focus() {},
      after(x) { if (x.id) ids[x.id] = x; } };
    if (n.id) ids[n.id] = n;
    return n;
  };
  node({ id: 'boot' }); node({ id: 'busy', className: 'busy' });
  const scope = {
    $: id => ids[id] || null,
    el: (tag, props) => node(props),
    btn: text => node({ textContent: text }),
    busy: () => {}, free: (b, o = {}) => { if (o.done) o.done(); return Promise.resolve(); }, play: () => {},
    later: (ms, fn) => { timers.push(fn); return () => {}; },
    addEventListener: (type, fn) => { if (type === 'online') online.add(fn); },
    removeEventListener: (type, fn) => { if (type === 'online') online.delete(fn); }
  };
  return {
    scope, ids, tries,
    again: n => () => tries.push(n),                    // a try: the shelf asked for again (index.js shelf())
    press: () => ids['busy-retry'].onclick(),
    online: () => { for (const fn of [...online]) fn(); },
    tick: () => { while (timers.length) timers.shift()(); }
  };
}

test('stuck(): «Ще не вийшло…» after a try that did not help; the network back meanwhile is one more try', () => {
  const was = globalThis.ihrotekaTries;
  try {
    globalThis.ihrotekaTries = 0;
    {
      // a try that did not help, nothing else: the line, and the button ready for a press or the network
      const W = world(), stuck = stuckOf(W.scope);
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(1), true);
      W.press();
      assert.deepEqual(W.tries, [1], 'a press: a try');
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(2), true);
      W.tick();
      assert.equal(W.ids['busy-again'].textContent, AGAIN, '… that did not help: «Ще не вийшло — …»');
      assert.deepEqual(W.tries, [1], '… and no try by itself');
      W.online();
      assert.deepEqual(W.tries, [1, 2], 'the network back afterwards: a try');
    }
    {
      // the network comes back while the try is still under way (it fails: the network was not up yet)
      const W = world(), stuck = stuckOf(W.scope);
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(1), true);
      W.press();
      W.online();
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(2), true);
      W.tick();
      assert.deepEqual(W.tries, [1, 2], 'the network back during a try that then failed: one more try right after');
    }
    {
      // the network comes back in the 600 ms the button stays busy after a try failed
      const W = world(), stuck = stuckOf(W.scope);
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(1), true);
      W.press();
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(2), true);
      W.online();
      W.tick();
      assert.deepEqual(W.tries, [1, 2], 'the network back while the button was still busy: one more try');
    }
    {
      // pressed again while a try runs: once more right after (as before)
      const W = world(), stuck = stuckOf(W.scope);
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(1), true);
      W.press();
      W.press();
      stuck('Не вдалося завантажити. Перевір інтернет і спробуй ще.', W.again(2), true);
      W.tick();
      assert.deepEqual(W.tries, [1, 2], 'pressed again during a try: one more try');
    }
    {
      // a library that broke (no network to wait for: online false): the network is no reason to try again
      const W = world(), stuck = stuckOf(W.scope);
      stuck('Щось пішло не так.', W.again(1), false);
      W.press();
      W.online();
      stuck('Щось пішло не так.', W.again(2), false);
      W.tick();
      assert.deepEqual(W.tries, [1], 'online false: the network does not try again');
      assert.equal(W.ids['busy-again'].textContent, '', '… and no «Ще не вийшло — …» (it promises the network)');
    }
  } finally { globalThis.ihrotekaTries = was; }
});
