// What the library says about players is gender-neutral (owner, decision 41: a player may be anyone; the word
// «друг» and decision 9's sentence stay). Every string and template literal with Cyrillic in the files below is
// read from the source (nothing is run) and must not use a gendered pronoun or past-tense verb about a player; so is
// page.html's (its inline scripts, and its markup's text). New lines say what a player does now, in the present tense
// (the UX spec's Q2: «Аня відкриває…», «Аня повертає всіх…»), never «відкрила», «повернувся». The texts the owner
// keeps as they are: KEPT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as espree from 'espree';                      // ESLint's own parser (it comes with eslint)

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['library/app/invite.js', 'library/app/dom.js', 'library/app/qr.js', 'library/app/together.js', 'library/app/legacy.js',
  'library/app/values.js', 'library/app/waiting.js', 'library/app/shell.js', 'library/app/lock.js', 'library/app/index.js',
  'library/app/install.js', 'library/app/screens.js', 'library/app/motion.js'];
const PAGE = 'library/app/page.html';
// a whole word (Ukrainian letters and the apostrophe ’ make up a word): a pronoun, or a verb's past tense (both genders)
const GENDERED = /(^|[^а-яіїєґ’])(він|зайшов|зайшла|вийшов|вийшла|приєднався|приєдналася|відпав|відпала|скопіював|скопіювала|відкрив|відкрила|повернувся|повернулася|увійшов|увійшла|обрав|обрала|той, хто)([^а-яіїєґ’]|$)/i;
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
// → [{ text, line }]: the code's string literals and the pieces of its template literals that have Cyrillic in them
// (line: from `from`, the line the code starts on in its file)
function literals(code, sourceType = 'module', from = 1) {
  const ast = espree.parse(code, { ecmaVersion: 'latest', sourceType, loc: true });
  const out = [];
  for (const n of walk(ast)) {
    const t = n.type === 'Literal' && typeof n.value === 'string' ? n.value : n.type === 'TemplateElement' ? n.value.cooked : null;
    if (t && /[а-яіїєґ]/i.test(t)) out.push({ text: t, line: from + n.loc.start.line - 1 });
  }
  return out;
}
const texts = file => literals(fs.readFileSync(path.join(REPO, file), 'utf8'));
// page.html (or its text): its inline scripts' literals (and its handlers', onerror="…"), and its markup's text with
// Cyrillic, each piece between two tags (no comments: what a player reads before the library runs, «Відкриваю Ігротеку…»)
function pageTexts(html = fs.readFileSync(path.join(REPO, PAGE), 'utf8')) {
  const out = [], lineAt = i => html.slice(0, i).split('\n').length;
  const blank = s => s.replace(/[^\n]/g, ' ');                        // (the same lines, nothing to read)
  let rest = html.replace(/<!--[\s\S]*?-->/g, blank);
  rest = rest.replace(/(<script\b(?![^>]*\bsrc=)[^>]*>)([\s\S]*?)(<\/script>)/g, (all, open, code, close, at) => {
    // (the page is a template: a {{placeholder}} is a value there)
    out.push(...literals(code.replace(/\{\{[^}]*\}\}/g, '0'), /\btype=["']?module/.test(open) ? 'module' : 'script', lineAt(at + open.length)));
    return open + blank(code) + close;
  });
  rest.replace(/<[^>]*>/g, tag => {
    for (const [, code] of tag.matchAll(/\son[a-z]+="([^"]*)"/g)) out.push(...literals(code, 'script', lineAt(rest.indexOf(tag))));
    return tag;
  });
  // (the text between two tags, a line broken in it or not)
  for (const m of rest.matchAll(/>([^<]+)/g)) {
    const t = m[1].replace(/\s+/g, ' ').trim();
    if (/[а-яіїєґ]/i.test(t)) out.push({ text: t, line: lineAt(m.index + 1 + m[1].search(/\S/)) });
  }
  return out;
}

test('the files say something to players (the check reads their texts)', () => {
  assert.ok(texts('library/app/invite.js').length > 50, 'invite.js: its texts are read');
  for (const f of ['library/app/values.js', 'library/app/waiting.js', 'library/app/shell.js', 'library/app/lock.js', 'library/app/index.js', 'library/app/install.js']) assert.ok(texts(f).length, f + ': its texts are read');
  const page = pageTexts().map(x => x.text);
  for (const t of ['Відкриваю Ігротеку…', 'Ще не вийшло — спробую знову, щойно з’явиться інтернет.', 'Спробувати ще', 'Не вдалося завантажити. Перевір інтернет і спробуй ще.'])
    assert.ok(page.includes(t), PAGE + ': ' + t);
  assert.ok(!page.some(t => /Motion off|motion\.js/.test(t)), PAGE + ': its comments are not read');
});

test('the check itself: it finds a gendered word, and lets the neutral ones and longer words go', () => {
  for (const bad of ['«Аня» щойно зайшов у кімнату', 'щойно він відкриє', 'Один гравець вийшов', 'До вас приєднався ще один', 'Богдан — відпав', 'код, який друг скопіював', 'додає той, хто показував',
    'Друг відкрив цю гру. Щоб грати, потрібен пароль.',
    // (the past tense the UX designs tried: either gender)
    'Аня відкрила «Два дракони»…', 'Богдан повернувся в гру', 'Аня повернулася до бібліотеки', 'Віра вийшла з партії', 'Аня обрала режим', 'Богдан обрав режим'])
    assert.match(bad, GENDERED, bad);
  for (const ok of ['Під іменем «Аня» щойно увійшли', 'Тепер вас 3', 'Одне місце звільнилося', '— зв’язок зник, місце чекає', 'Вийти', 'вийшовши', 'Вінниця', 'вінок',
    'Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.', 'Відкрий її за звичайним посиланням.', 'відкрити',
    // (the owner's new lines, UX Q2: the present tense, names in the nominative)
    'Аня відкриває «Два дракони»…', 'Аня повертає всіх до бібліотеки', 'Аня повертається в гру', 'Гаразд, не чекаємо.',
    'Ще не вийшло — спробую знову, щойно з’явиться інтернет.', 'Гра зламалася. Можна відкрити її ще раз або повернутися до бібліотеки.',
    'Відкрити ще раз', 'Оновлюю Ігротеку…', 'Тепер граєш ти', 'Твоє місце займає Віра', 'Раунд іде · 1:12', 'Аня обирає режим…',
    'Друг уже тут: гру на одному пристрої завершено.', 'Без інтернету', 'Немає інтернету на цьому пристрої — чекаємо, поки зв’язок повернеться…',
    'Зв’язок зник', 'Чекаю…', 'Разом · 3', 'Гра зламалася'])
    assert.doesNotMatch(ok, GENDERED, ok);
});

test('page.html: a gendered line in its script or its markup is found, at its line (and none in a comment)', () => {
  const bad = pageTexts('<p>Відкриваю</p>\n<!-- він -->\n<script>\nvar t = \'Аня відкрила гру\';\n</script>\n<p class="err">Богдан\n повернувся</p>\n' +
    '<script type="module" onerror="say(\'Він вийшов\')">\nimport \'./x.js\'; say(`Віра вийшла`);\n</script>');
  assert.deepEqual(bad.filter(x => GENDERED.test(x.text)).map(x => x.line + ' ' + x.text), ['4 Аня відкрила гру', '9 Віра вийшла', '8 Він вийшов', '6 Богдан повернувся']);
});

for (const f of [...FILES, PAGE]) {
  test(f + ': what it says about players is gender-neutral', () => {
    const bad = (f === PAGE ? pageTexts() : texts(f)).filter(x => !kept(x.text) && GENDERED.test(x.text));
    assert.deepEqual(bad.map(x => f + ':' + x.line + ' ' + x.text), []);
  });
}
