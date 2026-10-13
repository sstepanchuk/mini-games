// The API games see, pinned: window.ihroteka (what library/app/shell.js hands a game, and the contract at the top of
// library/game-api.js), ihroteka.room (the channel's `api` object in library/app/together.js) and the events a game
// can get from it. Everything is read from the source, nothing is run. A member or an event added, renamed or
// removed fails here until tests/api-surface.json and README's "Game API" say the same: an API change is made on
// purpose, with its docs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';                      // ESLint's own parser (it comes with eslint)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const parse = f => espree.parse(read(f), { ecmaVersion: 'latest', sourceType: 'module', loc: true });
const SNAP = JSON.parse(read('tests/api-surface.json'));
const sorted = a => [...a].sort();

const FN = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
// every node under `node`; shallow: not into functions nested in it
function* walk(node, shallow = false, top = true) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  if (shallow && !top && FN.has(node.type)) return;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'range') continue;
    for (const c of Array.isArray(v) ? v : [v]) if (c && typeof c === 'object') yield* walk(c, shallow, false);
  }
}
const find = (ast, ok, what) => { for (const n of walk(ast)) if (ok(n)) return n; assert.fail('not found: ' + what); };
const keyOf = (p, where) => {
  assert.ok(p.type === 'Property' && !p.computed, where + ': a member the test cannot name (spread or computed key)');
  return p.key.type === 'Identifier' ? p.key.name : String(p.key.value);
};
const isCall = (n, obj, prop) => n.type === 'CallExpression' && n.callee.type === 'MemberExpression' && !n.callee.computed &&
  n.callee.property.name === prop && (obj === null || (n.callee.object.type === 'Identifier' && obj.includes(n.callee.object.name)));

/* ---------- window.ihroteka: shell.js api() returns Object.freeze({ … }) ---------- */
function ihroteka() {
  const fn = find(parse('library/app/shell.js'), n => n.type === 'FunctionDeclaration' && n.id.name === 'api', 'function api() in library/app/shell.js');
  const ret = fn.body.body.find(n => n.type === 'ReturnStatement');   // (its own: not one of a listener inside it)
  assert.ok(ret && ret.argument, 'shell.js api() returns something');
  assert.ok(isCall(ret.argument, ['Object'], 'freeze') && ret.argument.arguments[0].type === 'ObjectExpression', 'shell.js api() returns Object.freeze({ … })');
  const props = ret.argument.arguments[0].properties, by = Object.fromEntries(props.map(p => [keyOf(p, 'ihroteka'), p.value]));
  const game = by.game;
  assert.ok(game && isCall(game, ['Object'], 'freeze') && game.arguments[0].type === 'ObjectExpression', 'ihroteka.game is Object.freeze({ … })');
  assert.ok(by.version && by.version.type === 'Literal' && Number.isInteger(by.version.value), 'ihroteka.version is a number in shell.js');
  return { members: Object.keys(by), game: game.arguments[0].properties.map(p => keyOf(p, 'ihroteka.game')), version: by.version.value };
}

// the contract written at the top of library/game-api.js: `ihroteka.<name>` lines, and its version
function contract() {
  const head = read('library/game-api.js').match(/^\/\*[\s\S]*?\*\//)[0];
  return { members: [...head.matchAll(/^\s*ihroteka\.(\w+)/gm)].map(m => m[1]),
    versions: [...head.matchAll(/\bversion\s+(\d+)/gi)].map(m => +m[1]) };
}

/* ---------- ihroteka.room: `const api = { … }` in together.js ---------- */
const TOGETHER = parse('library/app/together.js');
function room() {
  const decl = find(TOGETHER, n => n.type === 'VariableDeclarator' && n.id.name === 'api' && n.init?.type === 'ObjectExpression', 'const api = { … } in library/app/together.js');
  const out = { getters: [], methods: [], policies: [] }, nodes = {};
  for (const p of decl.init.properties) {
    const k = keyOf(p, 'ihroteka.room');
    nodes[k] = p;
    if (p.kind === 'get') out.getters.push(k);
    else if (p.method || FN.has(p.value.type)) out.methods.push(k);
    else if (p.value.type === 'Literal' && p.value.value === null) out.policies.push(k);   // the game puts its function there
    else assert.fail('ihroteka.room.' + k + ': neither a getter, a method nor a policy (null)');
  }
  return { surface: Object.fromEntries(Object.entries(out).map(([k, v]) => [k, sorted(v)])), nodes };
}

/* ---------- the events: what together.js emits to the open game ---------- */
// <anything>.emit('x', …) in together.js (c, ch today: whatever a channel is called), or events a pure rule of
// library/app/rules.js lists:
//   for (const [e, ...a] of rules.f(…)) c.emit(e, ...a)      (also: of f(…), f imported from './rules.js'; c.emit(...e))
// where f builds them as arrays ['x', …]. Anything else is an event the test cannot name, and fails.
function events() {
  const found = new Set(), fromRules = new Set(), seen = new Set();
  const imports = new Map();                           // local name → its name in rules.js ('*': the module)
  for (const n of TOGETHER.body) if (n.type === 'ImportDeclaration' && n.source.value === './rules.js') {
    for (const s of n.specifiers) imports.set(s.local.name, s.type === 'ImportNamespaceSpecifier' ? '*' : s.imported.name);
  }
  const rulesFn = call => {                            // rules.f(…) or f(…) → 'f'
    if (call?.type !== 'CallExpression') return null;
    const f = call.callee;
    if (f.type === 'MemberExpression' && !f.computed && f.object.type === 'Identifier' && imports.get(f.object.name) === '*') return f.property.name;
    if (f.type === 'Identifier' && imports.has(f.name) && imports.get(f.name) !== '*') return imports.get(f.name);
    return null;
  };
  const isEmit = n => isCall(n, null, 'emit');
  for (const loop of walk(TOGETHER)) {
    const fn = loop.type === 'ForOfStatement' && rulesFn(loop.right);
    const decl = fn && loop.left.type === 'VariableDeclaration' && loop.left.declarations[0].id;
    const bound = decl && (decl.type === 'Identifier' ? decl.name : decl.type === 'ArrayPattern' && decl.elements[0]?.type === 'Identifier' ? decl.elements[0].name : null);
    if (!bound) continue;
    for (const n of walk(loop.body)) {
      const a = isEmit(n) && n.arguments[0];
      if (a && ((a.type === 'Identifier' && a.name === bound) || (a.type === 'SpreadElement' && a.argument.type === 'Identifier' && a.argument.name === bound))) { seen.add(n); fromRules.add(fn); }
    }
  }
  for (const n of walk(TOGETHER)) {
    if (!isEmit(n) || seen.has(n)) continue;
    const a = n.arguments[0];
    assert.ok(a && a.type === 'Literal' && typeof a.value === 'string', 'together.js line ' + n.loc.start.line + ': an event the test cannot name (emit a string, or the events of a rules.js function)');
    found.add(a.value);
  }
  if (fromRules.size) {
    const RULES = parse('library/app/rules.js');
    for (const name of fromRules) {
      const fn = find(RULES, n => (n.type === 'FunctionDeclaration' && n.id.name === name) ||
        (n.type === 'VariableDeclarator' && n.id.name === name && FN.has(n.init?.type)), 'function ' + name + ' in library/app/rules.js');
      const listed = [...walk(fn)].filter(n => n.type === 'ArrayExpression' && n.elements[0]?.type === 'Literal' && typeof n.elements[0].value === 'string');
      assert.ok(listed.length, 'rules.js ' + name + ': no events ([\'x\', …]) the test can name');
      for (const n of listed) found.add(n.elements[0].value);
    }
  }
  return sorted(found);
}

// README's "Game API" section, up to the next "## " heading
const README = (() => { const r = read('README.md'), at = r.indexOf('\n## Game API'); assert.ok(at >= 0, 'README has a "## Game API" section'); const end = r.indexOf('\n## ', at + 1); return r.slice(at, end < 0 ? undefined : end); })();
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('window.ihroteka: what the library hands every game, and its contract in game-api.js', () => {
  const s = ihroteka(), c = contract();
  assert.deepEqual(sorted(s.members), SNAP.ihroteka, 'shell.js api() ≠ tests/api-surface.json "ihroteka"');
  assert.deepEqual(sorted(c.members), SNAP.ihroteka, 'the contract at the top of game-api.js ≠ tests/api-surface.json "ihroteka"');
  assert.deepEqual(sorted(s.game), SNAP.game, 'ihroteka.game in shell.js ≠ tests/api-surface.json "game"');
});

test('the API version is one number wherever it is written', () => {
  const v = ihroteka().version, c = contract();
  assert.equal(v, SNAP.version, 'shell.js version ≠ tests/api-surface.json "version"');
  assert.ok(c.versions.length > 0 && c.versions.every(x => x === v), 'game-api.js contract says version ' + c.versions.join(', ') + ', shell.js ' + v);
  assert.match(README, new RegExp('ihroteka\\.version\\s+//\\s*' + v + '\\b'), 'README "Game API": ihroteka.version // ' + v);
  for (const m of read('library/app/shell.js').matchAll(/contract version (\d+)/g)) assert.equal(+m[1], v, 'a shell.js comment names contract version ' + m[1]);
});

test('ihroteka.room: its getters, methods and policies', () => {
  assert.deepEqual(room().surface, SNAP.room, 'together.js `api` ≠ tests/api-surface.json "room"');
});

test('the events a game can get from ihroteka.room', () => {
  assert.deepEqual(events(), SNAP.events, 'what together.js (and rules.js) emit ≠ tests/api-surface.json "events"');
});

test('on() returns the room, so calls chain', () => {
  const { nodes } = room();
  for (const name of SNAP.chainable) {
    const fn = nodes[name]?.value;
    assert.ok(fn && FN.has(fn.type) && fn.body.type === 'BlockStatement', 'room.' + name + ' is a method with a body');
    const returns = [...walk(fn.body, true)].filter(n => n.type === 'ReturnStatement');
    assert.ok(returns.length > 0, 'room.' + name + ' returns something');
    for (const r of returns) assert.ok(r.argument?.type === 'Identifier' && r.argument.name === 'api', 'room.' + name + ' (line ' + r.loc.start.line + ') returns the room (return api)');
    assert.equal(fn.body.body.at(-1).type, 'ReturnStatement', 'room.' + name + ' ends with return api');
  }
});

test('README "Game API" names every member and event', () => {
  const missing = [];
  const has = (re, what) => { if (!re.test(README)) missing.push(what); };
  for (const k of SNAP.ihroteka) has(new RegExp('ihroteka\\.' + esc(k) + '\\b'), 'ihroteka.' + k);
  const gameLine = README.split('\n').find(l => /ihroteka\.game\b/.test(l)) || '';
  for (const k of SNAP.game) if (!new RegExp('\\b' + esc(k) + '\\b').test(gameLine)) missing.push('ihroteka.game: ' + k);
  for (const k of Object.values(SNAP.room).flat()) has(new RegExp('room\\.' + esc(k) + '(?![\\w-])'), 'room.' + k);
  for (const e of SNAP.events) has(new RegExp("\\.on\\('" + esc(e) + "'"), ".on('" + e + "', …)");
  assert.deepEqual(missing, [], 'missing from README "Game API"');
});

test('the notes name members of ihroteka.room; kick does nothing (phase 2, H1: the room checks its network itself)', () => {
  const { surface, nodes } = room();
  for (const k of Object.keys(SNAP.notes || {})) assert.ok(Object.values(surface).flat().includes(k), 'tests/api-surface.json "notes": no member ' + k);
  const kick = nodes.kick?.value;
  assert.ok(kick && FN.has(kick.type) && kick.body.type === 'BlockStatement' && kick.body.body.length === 0, 'room.kick is () => {}');
});
