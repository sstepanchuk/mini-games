// What the library says while an open game waits (library/app/waiting.js; owner, decision 6 (c)): each kind's words,
// time, small line, buttons and what a screen reader hears; the rows' order and identity (key: never the time); and
// where they may show (placeLines: the card over a game, or nothing while a copy of the game's <ihroteka-wait> holds them).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KINDS, LABEL, mmss, names, placeLines, sayOf, screen } from '../library/app/waiting.js';

const UPDATE = 'Онови сторінку — у друга інша версія';
const facts = o => ({ waits: [], restoring: false, seat: null, gap: null, offer: false, nearby: false, ...o });
const link = (name, o) => ({ name, left: 165000, why: 'link', release: true, ...o });
const one = o => { const m = screen(facts(o)); assert.equal(m.rows.length, 1, JSON.stringify(m.rows)); return m.rows[0]; };
const acts = r => r.acts.map(a => a.act);

test('link: «Чекаємо на X…», the time their place is kept, «Не чекати» where it works; nearby: why, and «З’єднатися знову» first', () => {
  let r = one({ waits: [link('Богдан')] });
  assert.deepEqual([r.kind, r.name, r.text, r.time, r.fine, r.say], ['link', 'Богдан', 'Чекаємо на Богдан…', 165000, null, 'Чекаємо на Богдан…']);
  assert.deepEqual(r.acts, [{ act: 'release', arg: 'Богдан' }]);
  r = one({ waits: [link('Богдан')], nearby: true });
  assert.equal(r.fine, 'Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.');
  assert.deepEqual(acts(r), ['repair', 'release']);
  assert.deepEqual(acts(one({ waits: [link('Богдан', { release: false })], nearby: true })), ['repair']);
  assert.deepEqual(acts(one({ waits: [link('Богдан', { release: false })] })), []);
  assert.deepEqual([LABEL.repair, LABEL.release, LABEL.update], [['З’єднатися знову', 'btn'], ['Не чекати', 'btn ghost'], ['Оновити', 'btn ghost']]);
});

test('loading, closed, restoring: the line only, no time, nothing to press', () => {
  const kinds = [
    [{ waits: [{ name: 'Богдан', left: 9000, why: 'loading', release: false }] }, 'loading', 'Чекаємо на Богдан — повертається в гру'],
    [{ waits: [{ name: 'Богдан', left: 0, why: 'closed', release: false, round: true }], nearby: true }, 'closed', 'Чекаємо на Богдан — зараз не в грі'],
    [{ restoring: true }, 'restoring', 'Повертаю гру з того місця, де ви зупинилися…']
  ];
  for (const [f, kind, text] of kinds) {
    const r = one(f);
    assert.deepEqual([r.kind, r.text, r.time, r.fine, r.acts, r.say], [kind, text, null, null, [], text], kind);
  }
});

test('seat: «Ти чекаєш на місце», who plays now (none: no small line)', () => {
  let r = one({ seat: { players: ['Аня', 'Богдан'] } });
  assert.deepEqual([r.kind, r.text, r.fine, r.say, r.acts], ['seat', 'Ти чекаєш на місце', 'Грають зараз: Аня і Богдан.', 'Ти чекаєш на місце. Грають зараз: Аня і Богдан', []]);
  r = one({ seat: { players: ['Аня', 'Богдан', 'Віра'] } });
  assert.deepEqual([r.fine, r.say], ['Грають зараз: Аня, Богдан і Віра.', 'Ти чекаєш на місце. Грають зараз: Аня, Богдан і Віра']);
  r = one({ seat: { players: [] } });
  assert.deepEqual([r.fine, r.say], [null, 'Ти чекаєш на місце']);
});

test('version: «Онови сторінку — у друга інша версія», «Оновити» only on the page that is offered it', () => {
  let r = one({ gap: { key: 'wire:g:2', older: true }, offer: true });
  assert.deepEqual([r.kind, r.text, r.say, r.time, r.fine], ['version', UPDATE, UPDATE, null, null]);
  assert.deepEqual(r.acts, [{ act: 'update' }]);
  r = one({ gap: { key: 'wire:g:2', older: false } });
  assert.deepEqual(r.acts, []);
});

test('the time, m:ss rounded up; names joined «А», «А і Б», «А, Б і В»', () => {
  assert.deepEqual([0, 1, 59001, 165000, 180000, -5].map(mmss), ['0:00', '0:01', '1:00', '2:45', '3:00', '0:00']);
  assert.deepEqual([[], ['Аня'], ['Аня', 'Богдан'], ['Аня', 'Богдан', 'Віра']].map(names), ['', 'Аня', 'Аня і Богдан', 'Аня, Богдан і Віра']);
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
    ['nearby', { nearby: true }],
    ['the version', { gap: { key: 'wire:g:3' } }],
    ['offer', { offer: true }]
  ]) assert.notEqual(key(o), k, what);
  const seat = p => screen(facts({ seat: { players: p } })).key;
  assert.notEqual(seat(['Аня', 'Богдан']), seat(['Аня', 'Віра']), 'who plays now');
  assert.equal(new Set(screen(facts({ waits: [link('Богдан'), link('Віра')], restoring: true, seat: { players: [] }, gap: { key: 'x' } })).rows.map(r => r.key)).size, 5, 'one key per row');
});

test('what a screen reader hears: never the time, rows joined as the card always joined them', () => {
  const m = screen(facts({ waits: [link('Богдан')], gap: { key: 'wire:g:2' }, offer: true }));
  assert.equal(m.say, 'Чекаємо на Богдан…. ' + UPDATE);
  assert.equal(sayOf(m.rows), m.say);
  assert.ok(!/\d:\d\d/.test(m.say));
  assert.equal(screen(facts({ waits: [{ name: 'Богдан', left: 5000, why: 'loading', release: false }] })).say, 'Чекаємо на Богдан — повертається в гру');
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
