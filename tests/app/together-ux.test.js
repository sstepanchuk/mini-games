// What «Грати разом» says outside a game's screens (library/app/waiting.js, for invite.js; the UX spec and the
// owner's answers Q2–Q4): the chip's short words and its dot (never colour alone: the word says it; no ping on it),
// which statuses of the link screen are still under way (a spinner beside them only then), and the notes at the
// bottom of the screen, none of which repeats what a dialog or the game already says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chipLook, noteOf, underway } from '../../library/app/waiting.js';

const room = o => ({ linked: false, weak: false, players: 1, nearby: false, status: 'waiting', secure: true, gap: false, ...o });
const look = o => { const l = chipLook(o === null ? null : room(o)); return [l.text, l.dot]; };

// (owner, Q3: short words with a dot; «Без інтернету» on the shelf, Q2)
test('the chip: a word or two and a dot for each state of the room', () => {
  assert.deepEqual(look(null), ['Грати разом', '']);
  assert.deepEqual(look({}), ['Чекаю…', 'wait']);
  assert.deepEqual(look({ status: 'connecting' }), ['Чекаю…', 'wait']);
  assert.deepEqual(look({ nearby: true, status: 'pairing' }), ['З’єднуюсь…', 'wait']);
  assert.deepEqual(look({ linked: true, players: 2, status: 'ready' }), ['Разом', 'on']);
  assert.deepEqual(look({ linked: true, players: 3, status: 'ready' }), ['Разом · 3', 'on']);
  assert.deepEqual(look({ linked: true, players: 2, nearby: true }), ['Разом', 'on'], 'nearby too: no «поруч» on it');
  assert.deepEqual(look({ linked: true, weak: true, players: 3 }), ['Зв’язок зник', 'lost']);
  assert.deepEqual(look({ status: 'no-signal' }), ['Без інтернету', 'lost']);
  assert.deepEqual(look({ status: 'unavailable' }), ['Без інтернету', 'lost']);
  assert.deepEqual(look({ status: 'unavailable', secure: false }), ['Лише через https', 'lost'], 'a page without Web Crypto: as before');
  assert.deepEqual(look({ gap: true, status: 'version' }), ['Інша версія', 'warn']);
  assert.deepEqual(look({ gap: true, nearby: true, status: 'failed' }), ['Інша версія', 'warn']);
  assert.deepEqual(look({ gap: true, linked: true, players: 2 }), ['Разом', 'on'], 'together all the same: the dialog says the version');
});

test('the chip: no milliseconds, nor a word longer than «Грати разом» but on a page that cannot have internet rooms', () => {
  const all = [null, {}, { nearby: true }, { linked: true, players: 2 }, { linked: true, players: 8 }, { linked: true, weak: true }, { status: 'no-signal' }, { gap: true }];
  for (const o of all) {
    const [text] = look(o);
    assert.ok(!/мс|\d+\s*ms/.test(text), text);
    assert.ok(text.length <= 'Грати разом'.length + 2, text);
  }
});

// (owner, UX I22: a spinner only while something is under way)
test('the link screen\'s status: under way (a spinner) or said as it is', () => {
  for (const s of ['connecting', 'no-signal', 'waiting', 'joining', 'peer-left']) assert.equal(underway(s), true, s);
  for (const s of ['unavailable', 'taken', 'full', 'ready', 'failed', 'version', 'pairing', '', undefined]) assert.equal(underway(s), false, String(s));
});

const ctx = o => ({ kind: 'internet', players: 2, linked: true, dialog: '', game: false, known: false, ...o });
// (owner, Q4: never what a dialog or the game already says)
test('notes: «Ви разом!» only where nothing else says it', () => {
  assert.equal(noteOf('linked', ctx()), 'Ви разом!');
  assert.equal(noteOf('linked', ctx({ kind: 'nearby' })), 'Ви разом, поруч без інтернету');
  assert.equal(noteOf('linked', ctx({ dialog: 'link' })), '', '«Грати разом» is open: its «Ви граєте разом» says it');
  assert.equal(noteOf('linked', ctx({ dialog: 'code' })), '', 'nearby, the same');
  assert.equal(noteOf('linked', ctx({ game: true })), '', 'over a game that shows the room itself');
  assert.equal(noteOf('linked', ctx({ known: true })), '', 'only someone we played with is back (a reload)');
});

test('notes: «Тепер вас N» and «Одне місце звільнилося», as before, but over a game that shows the room, or what the dialog says', () => {
  assert.equal(noteOf('join', ctx({ players: 3 })), 'Тепер вас 3');
  assert.equal(noteOf('join', ctx({ players: 2 })), '', 'two: «Ви разом!» says it');
  assert.equal(noteOf('join', ctx({ players: 3, linked: false })), '');
  assert.equal(noteOf('join', ctx({ players: 3, dialog: 'together' })), '', '«Вас 3» in the dialog');
  assert.equal(noteOf('join', ctx({ players: 4, dialog: 'link' })), 'Тепер вас 4', 'the link screen does not say it');
  assert.equal(noteOf('join', ctx({ players: 3, game: true })), '');
  assert.equal(noteOf('leave', ctx()), 'Одне місце звільнилося');
  assert.equal(noteOf('leave', ctx({ linked: false })), '');
  assert.equal(noteOf('leave', ctx({ game: true })), '');
  for (const w of ['status', 'away', 'stats', 'relinked', 'peer-gone', 'version']) assert.equal(noteOf(w, ctx({ players: 3 })), '', w);
});
