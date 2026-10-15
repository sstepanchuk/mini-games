// index.js idle(): a page whose new version took over under it reloads only when that disturbs nobody: the shelf
// shown, no dialog open, no room or an internet one. A dialog is a .backdrop in #layer; the ghost of one that has just
// closed (motion.js: a copy fading in the fx layer, outside #layer, for 140 ms) is none (the UX spec §9). idle() is
// read from index.js (nothing of the page is run) and called with dom.js's own $ and dialogOpen on a small document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FILE = path.join(REPO, 'library/app/index.js');

// a node of the small document: its classes, children, hidden; querySelector(All) by one class (.backdrop) only
const node = (id, cls = '', ...kids) => ({ id, cls: cls.split(' ').filter(Boolean), kids, hidden: false,
  querySelectorAll(sel) { return below(this).filter(n => is(n, sel)); }, querySelector(sel) { return this.querySelectorAll(sel)[0] || null; } });
const below = n => n.kids.flatMap(k => [k, ...below(k)]);
const is = (n, sel) => /^\.[\w-]+$/.test(sel) && n.cls.includes(sel.slice(1));
function page({ dialog = false, ghost = false, stage = false } = {}) {
  const layer = node('layer', '', ...(dialog ? [node('', 'backdrop', node('', 'dialog card'))] : []));
  const fx = node('', 'ihk-fx', ...(ghost ? [node('', 'backdrop', node('', 'dialog card'))] : []));
  const st = node('stage', 'stage'), body = node('', '', node('shelf', 'shelf'), st, layer, fx);
  st.hidden = !stage;
  return { getElementById: id => below(body).find(n => n.id === id) || null, querySelector: sel => body.querySelector(sel), querySelectorAll: sel => body.querySelectorAll(sel), body };
}

// idle as index.js has it: its source, made a function of the names it uses from its module
function idleOf(scope) {
  const src = fs.readFileSync(FILE, 'utf8'), ast = espree.parse(src, { ecmaVersion: 'latest', sourceType: 'module', range: true });
  const decl = ast.body.flatMap(n => n.type === 'VariableDeclaration' ? n.declarations : []).find(d => d.id.name === 'idle');
  assert.ok(decl && decl.init, 'index.js: const idle = …');
  const names = Object.keys(scope);
  return new Function(...names, 'return (' + src.slice(...decl.init.range) + ')')(...names.map(k => scope[k]));
}

test('idle(): the ghost of a dialog that just closed is no dialog; a dialog, a game or a room nearby is', async () => {
  const dom = await import('../../library/app/dom.js');
  let room = null;
  const idle = idleOf({ $: dom.$, dialogOpen: dom.dialogOpen, currentRoom: () => room });   // (document: the global one)
  const was = globalThis.document;
  try {
    const at = o => { globalThis.document = page(o); return idle(); };
    assert.equal(at({}), true, 'the shelf, nothing open: idle');
    assert.equal(at({ ghost: true }), true, 'a closed dialog\'s ghost fading in the fx layer: still idle');
    assert.equal(at({ dialog: true }), false, 'a dialog open in #layer: not idle');
    assert.equal(at({ stage: true }), false, 'a game open: not idle');
    room = { kind: 'internet' };
    assert.equal(at({ ghost: true }), true, 'an internet room: idle (the page comes straight back into it)');
    room = { kind: 'nearby' };
    assert.equal(at({}), false, 'a room nearby: never (a reload would end it)');
  } finally { globalThis.document = was; }
});
