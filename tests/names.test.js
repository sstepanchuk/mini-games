// Names (library/net/room.js, q17: the owner's «Рішення власника»): what a typed name becomes (cleanName: one spelling
// for what devices type differently, nothing invisible, nothing that turns the line around), whether it shows at all
// (nameShows) and whether a player may take it as their own (ownName: «*» means everyone on the wire). What others send
// is still checked by NAME only (an older page's names keep working). Run in Node.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

// room.js in Node: config.js reads window (a session, the timing scale)
globalThis.window ??= globalThis;
const { cleanName, EVERYONE, NAME, nameShows, ownName } = await import('../library/net/room.js');
const net = await import('../library/net/index.js').catch(() => null);   // (index.js too, where Node can load it)

const cps = s => [...s].length;
// typed names, as devices and people type them (and some that only look like names)
const TYPED = [
  "Дар'я", 'Дар’я', 'Дарʼя', 'Дар‘я', 'Дар`я', 'Дар´я', 'Дар′я', 'Дарʹя', 'Дарʻя', 'Андрій'.normalize('NFD'), 'Андрій', 'аня', 'Аня', 'Aня',
  ' Аня  Б ', 'Аня\tБ', 'Аня\nБ', 'Бо‮гдан', 'Бо⁩‮гдан', '​', 'ㅤ', '⠀', 'Аня​', 'x‍', '‍x', '*', '***', 'O’Neil', "o'neil", '42',
  '👨‍👩‍👧 Ліза', '👨‍👩‍👧 ліза', '❤️', '❤️‍🔥', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '👩🏽‍💻', '🏃🏽‍♀️', '1️⃣ Ігор', 'ß', 'ŉ', 'ǆ', 'іван', 'їжак', 'ґава', 'Ёж', 'ẛa',
  'Ана­стасія', 'Ліза﻿', '⁦Ліза⁩', 'Ліза؜', 'ᅟᅠ', 'ﾠ', 'a͏b', '\u0001Аня\u007F', 'Віра  ', '  ', '',
  'дуже-дуже довге ім’я, але таке', 'Ян' + '́', 'İlkay', 'ǈubica', '🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂🙂', 'Аня 🙂‍', 'Аня 🙂️'
];

describe('names (q17): cleanName, nameShows, ownName', () => {
  test('one spelling for the same name typed on different devices', () => {
    const d = ["Дар'я", 'Дар’я', 'Дарʼя', 'Дар‘я', 'Дар`я', 'Дар´я', 'Дар′я', 'Дарʹя', 'Дарʻя'].map(cleanName);
    assert.deepEqual([...new Set(d)], ['Дар’я'], 'every apostrophe becomes ’ (the form the library\'s texts use)');
    assert.equal(cleanName('Андрій'.normalize('NFD')), cleanName('Андрій'), 'a й typed in two parts is one letter (NFC)');
    assert.equal(cleanName('Андрій'.normalize('NFD')), 'Андрій');
    assert.equal(cleanName('аня'), 'Аня', 'the first letter is a capital, as phones type it');
    assert.equal(cleanName('аня'), cleanName('Аня'));
    assert.notEqual(cleanName('Aня'), cleanName('Аня'), 'a Latin A stays a Latin A: look-alikes are not mapped (owner)');
    assert.equal(cleanName(' Аня  Б '), 'Аня Б', 'runs of spaces become one, none around');
    assert.equal(cleanName('Аня\tБ'), 'Аня Б');
    assert.equal(cleanName('Аня\nБ'), 'Аня Б');
    assert.equal(cleanName("o'neil"), 'O’neil');
  });

  test('nothing invisible, nothing that turns the line around; emoji stay whole', () => {
    assert.equal(cleanName('Бо‮гдан'), 'Богдан', 'a direction override goes');
    assert.equal(cleanName('Бо⁩‮гдан'), 'Богдан');
    assert.equal(cleanName('⁦Ліза⁩'), 'Ліза');
    assert.equal(cleanName('​'), '', 'a name of only an invisible character is nothing');
    assert.equal(cleanName('Аня​'), 'Аня');
    assert.equal(cleanName('Ліза﻿'), 'Ліза');
    assert.equal(cleanName('Ана­стасія'), 'Анастасія', 'a soft hyphen goes');
    assert.equal(cleanName('\u0001Аня\u007F'), 'Аня', 'control characters go');
    assert.equal(cleanName('ㅤ'), '', 'a Hangul filler goes');
    assert.equal(cleanName('x‍'), 'X', 'a joiner that joins no emoji goes');
    assert.equal(cleanName('‍x'), 'X');
    assert.equal(cleanName('Аня 🙂‍'), 'Аня 🙂');
    for (const e of ['👨‍👩‍👧 Ліза', '❤️', '❤️‍🔥', '🏴󠁧󠁢󠁳󠁣󠁴󠁿', '👩🏽‍💻', '🏃🏽‍♀️', '1️⃣ Ігор', 'Аня 🙂️']) assert.equal(cleanName(e), e, 'kept whole: ' + e);
    assert.equal(cleanName('👨‍👩‍👧 ліза'), '👨‍👩‍👧 ліза', 'the emoji stays first (only a first letter becomes a capital)');
  });

  test('the first letter: a capital only where it stays one character', () => {
    assert.equal(cleanName('ß'), 'ß');
    assert.equal(cleanName('ŉ'), 'ŉ');
    assert.equal(cleanName('ǆ'), 'Ǆ');
    assert.equal(cleanName('їжак'), 'Їжак');
    assert.equal(cleanName('ґава'), 'Ґава');
    assert.equal(cleanName('іван'), 'Іван');
  });

  test('idempotent, never longer than typed, and what comes out passes NAME or is \'\'', () => {
    const pool = [...'аяїґ\'’ʼ ​‍️‮⁩\t*Aa1ß', '👨', '👩', '🏽', '❤', '🏴', '\u{E0067}', '\u{E007F}', '́', '̇', 'ſ', 'ㅤ', '⠀', '\u0001', '­'];
    let seed = 7;
    const rnd = n => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    const random = Array.from({ length: 3000 }, () => Array.from({ length: 1 + rnd(12) }, () => pool[rnd(pool.length)]).join(''));
    for (const s of [...TYPED, ...random]) {
      const c = cleanName(s);
      assert.equal(cleanName(c), c, 'idempotent: ' + JSON.stringify(s) + ' → ' + JSON.stringify(c));
      assert.ok(c.length <= s.length && cps(c) <= cps(s), 'never longer: ' + JSON.stringify(s) + ' → ' + JSON.stringify(c));
      assert.ok(c === '' || NAME.test(c), 'passes NAME or is empty: ' + JSON.stringify(s) + ' → ' + JSON.stringify(c));
    }
    assert.equal(cleanName('a'.repeat(30)), '', 'too long for a name: nothing (the field takes 24)');
  });

  test('nameShows: a letter, a digit or an emoji must be left once the invisible goes', () => {
    for (const n of ['​', 'ㅤ', '⠀', '*', '***', 'ᅟᅠ', 'ﾠ', '.', '’']) assert.equal(nameShows(n), false, JSON.stringify(n));
    for (const n of ['Аня', '42', 'O’Neil', '❤️', '👨‍👩‍👧', 'Ян', 'X']) assert.equal(nameShows(n), true, JSON.stringify(n));
  });

  test('«*» means everyone on the wire: nobody\'s own name, though NAME still takes it from others', () => {
    assert.equal(EVERYONE, '*');
    assert.equal(ownName('*'), false);
    assert.equal(NAME.test('*'), true, 'an older page\'s roster with a «*» player still validates');
    for (const n of ['Аня', '***', '*Аня']) assert.equal(ownName(n), true, n);
    for (const n of ['', ' Аня', 'a'.repeat(25), 5, null, undefined]) assert.equal(ownName(n), false, String(n));
  });

  test('net/index.js gives them to the library', { skip: !net && 'net/index.js does not load in Node' }, () => {
    for (const k of ['cleanName', 'EVERYONE', 'nameShows', 'ownName', 'NAME']) assert.ok(k in net, k);
  });
});
