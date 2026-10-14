// What the library says about players is gender-neutral (owner, decision 41: a player may be anyone; the word
// «друг» and decision 9's sentence stay). Every string and template literal with Cyrillic in the files below is
// read from the source (nothing is run) and must not use a gendered pronoun or past-tense verb about a player.
// The texts the owner keeps as they are: KEPT. (Phase B adds shell.js to FILES.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';                      // ESLint's own parser (it comes with eslint)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['library/app/invite.js', 'library/app/dom.js', 'library/app/qr.js', 'library/app/together.js', 'library/app/waiting.js'];
// a whole word (Ukrainian letters and the apostrophe ’ make up a word)
const GENDERED = /(^|[^а-яіїєґ’])(він|зайшов|вийшов|приєднався|відпав|скопіював|той, хто)([^а-яіїєґ’]|$)/i;
const KEPT = [
  'Друг вийшов. Посилання діє далі — чекаю…',         // the link screen's status 'peer-left' (owner, decision 28)
  /^На одному з пристроїв увімкнено VPN/              // (not about a player: «він» is the VPN)
];
const kept = t => KEPT.some(k => typeof k === 'string' ? k === t : k.test(t));

// every node under `node`
function* walk(node) {
  if (!node || typeof node.type !== 'string') return;
  yield node;
  for (const [k, v] of Object.entries(node)) {
    if (k === 'loc' || k === 'range') continue;
    for (const c of Array.isArray(v) ? v : [v]) if (c && typeof c === 'object') yield* walk(c);
  }
}
// → [{ text, line }]: the file's string literals and the pieces of its template literals that have Cyrillic in them
function texts(file) {
  const ast = espree.parse(fs.readFileSync(path.join(REPO, file), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', loc: true });
  const out = [];
  for (const n of walk(ast)) {
    const t = n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateElement' ? n.value.cooked : null;
    if (t && /[а-яіїєґ]/i.test(t)) out.push({ text: t, line: n.loc.start.line });
  }
  return out;
}

test('the files say something to players (the check reads their texts)', () => {
  assert.ok(texts('library/app/invite.js').length > 50, 'invite.js: its texts are read');
  for (const f of ['library/app/together.js', 'library/app/waiting.js']) assert.ok(texts(f).length, f + ': its texts are read');
});

test('the check itself: it finds a gendered word, and lets the neutral ones and longer words go', () => {
  for (const bad of ['«Аня» щойно зайшов у кімнату', 'щойно він відкриє', 'Один гравець вийшов', 'До вас приєднався ще один', 'Богдан — відпав', 'код, який друг скопіював', 'додає той, хто показував'])
    assert.match(bad, GENDERED, bad);
  for (const ok of ['Під іменем «Аня» щойно увійшли', 'Тепер вас 3', 'Одне місце звільнилося', '— зв’язок зник, місце чекає', 'Вийти', 'вийшовши', 'Вінниця', 'вінок'])
    assert.doesNotMatch(ok, GENDERED, ok);
});

for (const f of FILES) {
  test(f + ': what it says about players is gender-neutral', () => {
    const bad = texts(f).filter(x => !kept(x.text) && GENDERED.test(x.text));
    assert.deepEqual(bad.map(x => f + ':' + x.line + ' ' + x.text), []);
  });
}
