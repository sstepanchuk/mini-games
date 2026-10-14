// What the library says while an open game waits (library/app/waiting.js; owner, decision 6 (c)): each kind's words,
// time, small line, buttons and what a screen reader hears; the rows' order and identity (key: never the time); and
// where they may show (placeLines: the card over a game, or nothing while a copy of the game's <ihroteka-wait> holds them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, LABEL, mmss, NAMED, names, placeLines, sayOf, screen, shown, versionAct, versionWords } from '../library/app/waiting.js';
import * as rules from '../library/app/rules.js';

const OLDER = 'У друга новіша версія — онови сторінку', NEARBY = 'Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.';
const facts = o => ({ waits: [], restoring: false, seat: null, gap: null, offer: false, nearby: false, ...o });
const link = (name, o) => ({ name, left: 165000, why: 'link', release: true, ...o });
const one = o => { const m = screen(facts(o)); assert.equal(m.rows.length, 1, JSON.stringify(m.rows)); return m.rows[0]; };
const acts = r => r.acts.map(a => a.act);
// a name after «на», where Ukrainian would need another case (q16; \b knows no Cyrillic: letters by Unicode)
const ACCUSATIVE = /(?<!\p{L})на (Ганна|Богдан|Марія)(?!\p{L})/u;
// the names a row isolates (screens.js puts each in a <bdi>): [line, small line]
const isolated = r => [r.text, r.fine || ''].map((s, i) => (r.iso[i ? 'fine' : 'text'] || []).map(([a, b]) => s.slice(a, b)));

test('link: «Чекаємо, поки повернеться X…», the time their place is kept, «Не чекати» where it works; «З’єднатися знову» first where it works', () => {
  let r = one({ waits: [link('Богдан')] });
  assert.deepEqual([r.kind, r.name, r.text, r.time, r.fine, r.say], ['link', 'Богдан', 'Чекаємо, поки повернеться Богдан…', 165000, null, 'Чекаємо, поки повернеться Богдан…']);
  assert.deepEqual(r.acts, [{ act: 'release', arg: 'Богдан' }]);
  r = one({ waits: [link('Богдан', { repair: true })], nearby: true });
  assert.equal(r.fine, NEARBY);
  assert.deepEqual(acts(r), ['repair', 'release']);
  assert.deepEqual(acts(one({ waits: [link('Богдан', { release: false, repair: true })], nearby: true })), ['repair']);
  assert.deepEqual(acts(one({ waits: [link('Богдан', { release: false })] })), []);
  assert.deepEqual([LABEL.repair, LABEL.release, LABEL.update, LABEL.retry], [['З’єднатися знову', 'btn'], ['Не чекати', 'btn ghost'], ['Оновити', 'btn ghost'], ['Спробувати ще', 'btn ghost']]);
});

// (owner, q16: arbitrary names cannot be declined: every line has the name in the nominative, and no gender)
test('names stand in the nominative: link, loading, closed, over any name', () => {
  for (const n of ['Ганна', 'Богдан', 'Марія']) {
    const lines = [
      [link(n), 'Чекаємо, поки повернеться ' + n + '…'],
      [{ name: n, left: 9000, why: 'loading', release: false }, n + ' повертається в гру'],
      [{ name: n, left: 0, why: 'closed', release: false, round: true }, n + ' зараз не в грі — чекаємо']
    ];
    for (const [x, text] of lines) {
      const r = one({ waits: [x] });
      assert.deepEqual([r.text, r.say], [text, text], x.why);
      assert.ok(!ACCUSATIVE.test(r.text + ' ' + r.say), r.text);
    }
  }
});

test('loading, closed, restoring: the line only, no time, nothing to press', () => {
  const kinds = [
    [{ waits: [{ name: 'Богдан', left: 9000, why: 'loading', release: false }] }, 'loading', 'Богдан повертається в гру'],
    [{ waits: [{ name: 'Богдан', left: 0, why: 'closed', release: false, round: true }], nearby: true }, 'closed', 'Богдан зараз не в грі — чекаємо'],
    [{ restoring: true }, 'restoring', 'Повертаю гру з того місця, де ви зупинилися…']
  ];
  for (const [f, kind, text] of kinds) {
    const r = one(f);
    assert.deepEqual([r.kind, r.text, r.time, r.fine, r.acts, r.say], [kind, text, null, null, [], text], kind);
  }
});

// (owner, q26: while someone still plays with us, a round player whose game is closed is named as one not in the game now)
test('closed while others play with us (on): «X зараз не в грі», nothing to press, a row of its own', () => {
  const closed = o => ({ name: 'Богдан', left: 0, why: 'closed', release: false, round: true, ...o });
  const r = one({ waits: [closed({ on: true })] }), plain = one({ waits: [closed()] });
  assert.deepEqual([r.kind, r.name, r.text, r.say, r.time, r.fine, r.acts, r.classic], ['closed', 'Богдан', 'Богдан зараз не в грі', 'Богдан зараз не в грі', null, null, [], false]);
  assert.notEqual(r.key, plain.key, 'another text: another row');
  // one who dropped out meanwhile: the link row as ever (its words, the time, «Не чекати»)
  const l = one({ waits: [link('Богдан', { round: true, on: true })] });
  assert.deepEqual([l.text, acts(l), l.classic], ['Чекаємо, поки повернеться Богдан…', ['release'], false]);
});

// (owner, q05: «З’єднатися знову» and why only where pairing again works; a guest cut off from the hub hears of the hub only)
test('nearby: «З’єднатися знову» and why only where it works; the hub\'s row on a guest cut off from it; another guest\'s row', () => {
  let r = one({ waits: [link('Кіра')], nearby: true, host: 'Ганна' });
  assert.deepEqual([acts(r), r.fine], [['release'], 'Кіра і Ганна мають з’єднатися ще раз кодами.'], 'another guest dropped out: only they and the hub can pair again');
  assert.equal(r.say, 'Чекаємо, поки повернеться Кіра… Кіра і Ганна мають з’єднатися ще раз кодами.');
  r = one({ waits: [link('Кіра', { release: false })], nearby: true, host: 'Ганна' });
  assert.deepEqual(acts(r), [], 'nothing to press there');
  r = one({ waits: [link('Кіра', { repair: true })], nearby: true, host: 'Ганна' });
  assert.deepEqual([acts(r), r.fine, r.say], [['repair', 'release'], NEARBY, 'Чекаємо, поки повернеться Кіра… ' + NEARBY], 'the hub: pairs any guest again');
  r = one({ waits: [link('Ганна', { repair: true, cut: true })], nearby: true, host: 'Ганна' });
  const CUT = 'Кімнату поруч тримає телефон, на якому грає Ганна: без нього не чути й інших.';
  assert.deepEqual([r.text, acts(r), r.fine, r.say], ['Чекаємо, поки повернеться Ганна…', ['repair', 'release'], CUT, 'Чекаємо, поки повернеться Ганна… ' + CUT], 'a guest cut off from the hub');
  assert.equal(one({ waits: [link('Кіра')] }).fine, null, 'over the internet: no small line');
  // each says something else: a row of its own
  const keys = [one({ waits: [link('Кіра')], nearby: true, host: 'Ганна' }), one({ waits: [link('Кіра')], nearby: true, host: 'Гліб' }),
    one({ waits: [link('Кіра', { repair: true })], nearby: true }), one({ waits: [link('Кіра', { repair: true, cut: true })], nearby: true, host: 'Кіра' })].map(x => x.key);
  assert.equal(new Set(keys).size, keys.length, keys.join(' | '));
});

// (owner, q06: nearby, a guest that waits for a seat is told the hub went: the hub's row first, then the seat)
test('nearby: the hub\'s row for a guest that waits for a seat; the card of a game without the element shows it', () => {
  const f = { me: 'Кіра', players: ['Ганна', 'Гліб', 'Кіра'], here: () => 'g', wire: () => 1, loading: new Map(), nearby: true, role: 'guest', host: 'Ганна', hold: 180000,
    now: 100000, away: p => ({ Ганна: 15000, Гліб: 15000 })[p] || 0 };
  const waits = rules.hubWaits(f, []).map(x => ({ ...x, repair: rules.canRepair(f), cut: rules.cutOffFrom(f) === x.name }));
  const m = screen(facts({ waits, seat: { players: ['Ганна', 'Гліб'] }, nearby: true, host: 'Ганна' }));
  assert.deepEqual(m.rows.map(r => [r.kind, r.text, acts(r).join()]), [['link', 'Чекаємо, поки повернеться Ганна…', 'repair,release'], ['seat', 'Ти чекаєш на місце', '']]);
  assert.deepEqual(placeLines(m.rows, { ready: true, adopted: false, held: false }).map(r => r.kind), ['link']);
});

test('seat: «Ти чекаєш на місце», who plays now (none: no small line)', () => {
  let r = one({ seat: { players: ['Аня', 'Богдан'] } });
  assert.deepEqual([r.kind, r.text, r.fine, r.say, r.acts], ['seat', 'Ти чекаєш на місце', 'Грають зараз: Аня і Богдан.', 'Ти чекаєш на місце. Грають зараз: Аня і Богдан', []]);
  r = one({ seat: { players: ['Аня', 'Богдан', 'Віра'] } });
  assert.deepEqual([r.fine, r.say], ['Грають зараз: Аня, Богдан і Віра.', 'Ти чекаєш на місце. Грають зараз: Аня, Богдан і Віра']);
  r = one({ seat: { players: [] } });
  assert.deepEqual([r.fine, r.say], [null, 'Ти чекаєш на місце']);
});

// (owner, q32: the other players of a round on no device hear who brings it back)
test('restoring: our copy («Повертаю гру…»), or another one, named («Аня повертає гру…»)', () => {
  const r = one({ restoring: { by: 'Аня' } });
  assert.deepEqual([r.kind, r.text, r.say, r.time, r.fine, r.acts, r.classic], ['restoring', 'Аня повертає гру з того місця, де ви зупинилися…', 'Аня повертає гру з того місця, де ви зупинилися…', null, null, [], false]);
  assert.deepEqual(isolated(r), [['Аня'], []]);
  const keys = [{ restoring: true }, { restoring: { by: 'Аня' } }, { restoring: { by: 'Богдан' } }].map(f => one(f).key);
  assert.equal(new Set(keys).size, 3, keys.join(' | '));
});

// (owner, q11: each page its own part; nearby, when there is internet; why an update did not happen)
test('versionWords: the older page and the newer one, online and nearby; the chip\'s short words', () => {
  const w = (gap, o) => versionWords({ why: 'wire', key: 'wire:g:2', ...gap }, o);
  assert.equal(w({ older: true }), OLDER);
  assert.equal(w({ older: false }), 'У друга старіша версія — хай оновить сторінку');
  assert.equal(w({ older: true }, { nearby: true }), 'У друга новіша версія — онови сторінку, коли буде інтернет');
  assert.equal(w({ older: false }, { nearby: true }), 'У друга старіша версія — хай оновить сторінку, коли буде інтернет');
  assert.equal(versionWords({ why: 'proto', key: 'proto:3', older: true }), OLDER, 'the library\'s version: the same words');
  assert.deepEqual([w({ older: true }, { short: true }), w({ older: false }, { short: true }), w({ older: true }, { short: true, nearby: true })],
    ['У друга новіша версія', 'У друга старіша версія', 'У друга новіша версія']);
});

test('versionWords: our update did not happen, and why', () => {
  const w = (failed, o) => versionWords({ why: 'wire', key: 'wire:g:2', older: true, failed }, o);
  assert.equal(w('storage'), 'Бракує місця на пристрої для нової версії Ігротеки: звільни трохи місця й натисни «Спробувати ще»');
  assert.equal(w('failed'), 'Не вдалося завантажити нову версію: перевір інтернет');
  assert.equal(w('timeout'), 'Не вдалося завантажити нову версію: перевір інтернет');
  assert.equal(w('same'), OLDER, 'the site has nothing newer yet (tried again by itself)');
  for (const f of ['storage', 'failed', 'timeout', 'same']) assert.equal(w(f, { short: true }), 'У друга новіша версія', f);
  // the button with them (the screens and «Грати разом» alike): «Спробувати ще» where these words ask for it
  assert.deepEqual(['storage', 'failed', 'timeout', 'same', null].map(failed => versionAct({ failed })), ['retry', 'retry', 'retry', 'update', 'update']);
});

// (owner, q10: a game one shelf lacks)
test('versionWords: a game another shelf lacks (theirs: whom), or this one lacks (ours)', () => {
  const theirs = who => versionWords({ why: 'game', game: 'g', key: 'game:g', older: null, missing: 'theirs', who });
  assert.equal(theirs(['Аня']), 'Аня не може відкрити цю гру: там інша версія Ігротеки');
  assert.equal(theirs(['Аня', 'Богдан']), 'Аня і Богдан не можуть відкрити цю гру: там інша версія Ігротеки');
  assert.equal(theirs(['Аня', 'Богдан', 'Віра']), 'Аня, Богдан і Віра не можуть відкрити цю гру: там інша версія Ігротеки');
  const ours = { why: 'game', game: 'g', key: 'game:g', older: null, missing: 'ours', who: ['Аня'] };
  assert.equal(versionWords(ours), 'У кімнаті відкрили гру, якої тут немає');
  assert.equal(versionWords({ ...ours, older: true }, { short: true }), 'У кімнаті відкрили гру, якої тут немає', 'the chip: the same words');
  assert.equal(versionWords({ ...ours, older: true, failed: 'storage' }), 'Бракує місця на пристрої для нової версії Ігротеки: звільни трохи місця й натисни «Спробувати ще»');
});

test('version: its words, «Оновити» only on the page that is offered it, «Спробувати ще» after an update that did not happen; a row per side', () => {
  let r = one({ gap: { why: 'wire', key: 'wire:g:2', older: true }, offer: true });
  assert.deepEqual([r.kind, r.text, r.say, r.time, r.fine, r.classic], ['version', OLDER, OLDER, null, null, true]);
  assert.deepEqual(r.acts, [{ act: 'update' }]);
  assert.deepEqual(one({ gap: { why: 'wire', key: 'wire:g:2', older: false } }).acts, []);
  for (const failed of ['storage', 'failed', 'timeout']) assert.deepEqual(acts(one({ gap: { why: 'wire', key: 'wire:g:2', older: true, failed }, offer: true })), ['retry'], failed);
  assert.deepEqual(acts(one({ gap: { why: 'wire', key: 'wire:g:2', older: true, failed: 'same' }, offer: true })), ['update'], 'same: «Оновити»');
  assert.deepEqual(acts(one({ gap: { why: 'wire', key: 'wire:g:2', older: true, failed: 'storage' } })), [], 'not offered: nothing');
  r = one({ gap: { why: 'game', game: 'g', key: 'game:g', older: null, missing: 'theirs', who: ['Аня', 'Богдан'] } });
  assert.deepEqual([r.text, isolated(r)], ['Аня і Богдан не можуть відкрити цю гру: там інша версія Ігротеки', [['Аня', 'Богдан'], []]]);
  // screens build a row once per key: a card never keeps another side's words
  const gaps = [{ older: true }, { older: false }, { older: true, nearby: true }, { older: false, nearby: true }, { older: true, failed: 'storage' }, { older: true, failed: 'failed' },
    { older: null, why: 'game', missing: 'theirs', who: ['Аня'] }, { older: null, why: 'game', missing: 'theirs', who: ['Аня', 'Богдан'] }, { older: true, why: 'game', missing: 'theirs', who: ['Аня'] }];
  const keys = gaps.map(({ nearby, ...g }) => one({ gap: { why: 'wire', key: 'wire:g:2', ...g }, nearby }).key);
  assert.equal(new Set(keys).size, keys.length, keys.join(' | '));
});

test('the time, m:ss rounded up; names joined «А», «А і Б», «А, Б і В»', () => {
  assert.deepEqual([0, 1, 59001, 165000, 180000, -5].map(mmss), ['0:00', '0:01', '1:00', '2:45', '3:00', '0:00']);
  assert.deepEqual([[], ['Аня'], ['Аня', 'Богдан'], ['Аня', 'Богдан', 'Віра']].map(names), ['', 'Аня', 'Аня і Богдан', 'Аня, Богдан і Віра']);
});

// (owner, q17: a name never reorders the rest of the line: no direction controls in it, and isolated where it stands)
test('names in the rows: without direction controls, and where each stands (isolated by the screens)', () => {
  const odd = 'Бо\u2069\u202eгдан';
  assert.equal(shown(odd), 'Богдан');
  assert.equal(shown('Аня\u200e'), 'Аня');
  assert.equal(shown('محمد'), 'محمد', 'a name written right to left stays as it is');
  const m = screen(facts({ waits: [link(odd), { name: odd, left: 1, why: 'loading', release: false }, { name: odd, left: 0, why: 'closed', release: false, round: true, on: true }],
    restoring: { by: odd }, seat: { players: ['Аня', odd] }, nearby: true, host: 'Ганна' }));
  for (const r of m.rows) assert.ok(!/\p{Bidi_Control}/u.test(r.text + (r.fine || '') + r.say), r.kind + ': ' + JSON.stringify(r.text + ' ' + r.fine));
  assert.deepEqual(m.rows.map(isolated), [[['Богдан'], ['Богдан', 'Ганна']], [['Богдан'], []], [['Богдан'], []], [['Богдан'], []], [[], ['Аня', 'Богдан']]]);
  assert.equal(m.rows[0].name, odd, 'the row\'s name as the room knows it (whom «Не чекати» lets go)');
  assert.deepEqual(m.rows[0].acts, [{ act: 'release', arg: odd }]);
  // a name that is also a word of the line: isolated where the name stands
  const r = one({ waits: [link('по')] });
  assert.deepEqual([r.text, r.iso.text], ['Чекаємо, поки повернеться по…', [[26, 28]]]);
});

test('rows in order: the waits as given, then restoring, seat, version; showing: each kind once, in that order', () => {
  const m = screen(facts({ waits: [link('Богдан'), link('Віра'), { name: 'Гліб', left: 0, why: 'closed', release: false, round: true }], restoring: true,
    seat: { players: ['Аня'] }, gap: { key: 'proto:3', older: false } }));
  assert.deepEqual(m.rows.map(r => r.kind + (r.name ? ' ' + r.name : '')), ['link Богдан', 'link Віра', 'closed Гліб', 'restoring', 'seat', 'version']);
  assert.equal(m.showing, 'link closed restoring seat version');
  assert.equal(screen(facts({ waits: [link('Богдан'), link('Віра')], gap: { key: 'proto:3' } })).showing, 'link version');
  assert.deepEqual([...KINDS], ['link', 'loading', 'closed', 'restoring', 'seat', 'version']);
  assert.deepEqual(screen(null), { rows: [], showing: '', say: '', key: '' });
  assert.deepEqual(screen(facts({})), { rows: [], showing: '', say: '', key: '' });
});

test('key: the same while only the time changes; another when who, why, the buttons, who plays or the version does', () => {
  const base = { waits: [link('Богдан')], seat: null, gap: { key: 'wire:g:2' }, offer: false };
  const key = o => screen(facts({ ...base, ...o })).key;
  const k = key({});
  assert.equal(key({ waits: [link('Богдан', { left: 3000 })] }), k, 'only the time');
  for (const [what, o] of [
    ['a name', { waits: [link('Віра')] }],
    ['why', { waits: [{ name: 'Богдан', left: 9000, why: 'loading', release: false }] }],
    ['release', { waits: [link('Богдан', { release: false })] }],
    ['repair', { waits: [link('Богдан', { repair: true })], nearby: true }],
    ['nearby', { nearby: true }],
    ['the version', { gap: { key: 'wire:g:3' } }],
    ['offer', { offer: true }]
  ]) assert.notEqual(key(o), k, what);
  const seat = p => screen(facts({ seat: { players: p } })).key;
  assert.notEqual(seat(['Аня', 'Богдан']), seat(['Аня', 'Віра']), 'who plays now');
  assert.equal(new Set(screen(facts({ waits: [link('Богдан'), link('Віра')], restoring: true, seat: { players: [] }, gap: { key: 'x' } })).rows.map(r => r.key)).size, 5, 'one key per row');
});

test('what a screen reader hears: never the time; rows as sentences («. » between them, a space after «…» or «.»)', () => {
  const gap = { why: 'wire', key: 'wire:g:2', older: true };
  const m = screen(facts({ waits: [link('Богдан')], gap, offer: true }));
  assert.equal(m.say, 'Чекаємо, поки повернеться Богдан… ' + OLDER);
  assert.equal(sayOf(m.rows), m.say);
  assert.ok(!/\d:\d\d/.test(m.say));
  assert.equal(screen(facts({ waits: [{ name: 'Богдан', left: 5000, why: 'loading', release: false }] })).say, 'Богдан повертається в гру');
  assert.equal(screen(facts({ waits: [{ name: 'Б', left: 1, why: 'loading', release: false }], gap })).say, 'Б повертається в гру. ' + OLDER);
  assert.equal(screen(facts({ restoring: true, seat: { players: ['Аня'] }, gap })).say,
    'Повертаю гру з того місця, де ви зупинилися… Ти чекаєш на місце. Грають зараз: Аня. ' + OLDER);
  const every = screen(facts({ waits: [link('Б', { repair: true }), link('В'), { name: 'Г', left: 0, why: 'closed', release: false, round: true }], restoring: { by: 'Аня' },
    seat: { players: ['Аня'] }, gap: { ...gap, failed: 'storage' }, nearby: true, host: 'Аня' }));
  for (const s of [every.say, ...every.rows.map(r => r.say)]) assert.ok(!/[.…]\./.test(s), s);
});

test('nearby: why the link waits is heard once, with the first row that says it (its key as before); over the internet, only who', () => {
  const gap = { why: 'wire', key: 'g', older: false };
  const m = screen(facts({ waits: [{ name: 'Г', left: 0, why: 'closed', release: false, round: true }, link('Богдан', { repair: true }), link('Віра', { repair: true })], nearby: true, gap }));
  const NEWER = 'У друга старіша версія — хай оновить сторінку, коли буде інтернет';
  assert.equal(m.say, 'Г зараз не в грі — чекаємо. Чекаємо, поки повернеться Богдан… ' + NEARBY + ' Чекаємо, поки повернеться Віра… ' + NEWER);
  assert.equal(m.say.split(NEARBY).length - 1, 1, 'once');
  assert.deepEqual(m.rows.map(r => r.say), ['Г зараз не в грі — чекаємо', 'Чекаємо, поки повернеться Богдан… ' + NEARBY, 'Чекаємо, поки повернеться Віра…', NEWER]);
  assert.deepEqual(m.rows.map(r => r.fine), [null, NEARBY, NEARBY, null], 'the small line of every such row stays');
  assert.deepEqual(m.rows.map(r => r.key), ['closed:Г::', 'link:Богдан:repair,release:', 'link:Віра:repair,release:', 'version:::g>:n']);
  assert.ok(sayOf(placeLines(m.rows, { ready: true, adopted: false, held: false })).includes(NEARBY), 'the card of a game without the element says it too');
  assert.equal(one({ waits: [link('Богдан')] }).say, 'Чекаємо, поки повернеться Богдан…', 'over the internet');
});

test('«Не чекати» for one player, as a screen reader names it: the visible words first, then whom', () => {
  assert.equal(NAMED.release('Богдан'), 'Не чекати, поки повернеться Богдан');
  for (const n of ['Ганна', 'Богдан', 'Марія']) assert.doesNotMatch(NAMED.release(n), ACCUSATIVE, 'the name in the nominative (decision 42)');
  assert.match('Не чекати на Богдан', ACCUSATIVE, '(the check itself sees the old words)');
  assert.ok(NAMED.release('Богдан').startsWith(LABEL.release[0]));
  assert.deepEqual(Object.keys(NAMED), ['release'], '«З’єднатися знову», «Оновити» and «Спробувати ще» keep their plain names');
});

test('classic (the card as it was before the screens): link and loading of whom we play with, and the version; not the round\'s, closed, restoring or seat', () => {
  const m = screen(facts({ waits: [link('Богдан'), { name: 'Віра', left: 4000, why: 'loading', release: false }, link('Гліб', { round: true }),
    { name: 'Дана', left: 0, why: 'closed', release: false, round: true }], restoring: true, seat: { players: ['Аня'] }, gap: { key: 'proto:3' } }));
  assert.deepEqual(m.rows.map(r => [r.kind + (r.name ? ' ' + r.name : ''), r.classic]),
    [['link Богдан', true], ['loading Віра', true], ['link Гліб', false], ['closed Дана', false], ['restoring', false], ['seat', false], ['version', true]]);
});

test('where the rows show (placeLines): nothing over a game whose screen holds them; before its page parsed only the version; a game that placed the element every row; one that never did, the card as it was', () => {
  const m = screen(facts({ waits: [link('Богдан'), link('Гліб', { round: true })], restoring: true, seat: { players: ['Аня'] }, gap: { key: 'proto:3' } }));
  const kinds = rows => rows.map(r => r.kind + (r.name ? ' ' + r.name : ''));
  for (const ready of [false, true]) for (const adopted of [false, true]) for (const held of [false, true]) {
    const got = kinds(placeLines(m.rows, { ready, adopted, held })), at = JSON.stringify({ ready, adopted, held });
    if (held) assert.deepEqual(got, [], at);
    else if (!ready) assert.deepEqual(got, ['version'], at);
    else if (adopted) assert.deepEqual(got, kinds(m.rows), at);
    else assert.deepEqual(got, ['link Богдан', 'version'], at);
  }
});
