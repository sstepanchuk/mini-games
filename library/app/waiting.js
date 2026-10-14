/* =====================================================================
   What the library says while an open game waits (owner, decision 6 (c): «Спільний набір екранів»): the words, the
   buttons and the order of its rows, the same for every game, as pure functions (no DOM: worker tabs read them too).
   together.js waitFacts says the facts; screens.js puts the rows into the game's own <ihroteka-wait>, and invite.js
   into its card over a game that shows none. tests/waiting.test.js pins them; tests/api-surface.json "screens" the kinds.
   One row per thing said, in this order:
     link       «Чекаємо, поки повернеться X… 2:45»: X dropped out, their place kept that long; «Не чекати» (their place
                goes) where it works from here (rules.canRelease). Nearby (owner, decision 5 and q05): «З’єднатися
                знову» (pairing again) and why only where pairing again works (repair: rules.canRepair); a guest cut off
                from the hub (cut) hears of the hub only, and why it hears nobody else; on another guest's row, that
                they and the hub must pair again. Nearby, a guest's hub, also while it waits for a seat (q06)
     loading    «X повертається в гру»: back in a new tab or device, the game not open there yet; nothing to press
                (owner, decision 4)
     closed     «X зараз не в грі — чекаємо»: a player of our round whose game is closed (rules.roundWaits); «X зараз
                не в грі» while someone else plays with us (on: in a game for 3+ seats the round may go on without
                them, the game's own rule: q26)
     restoring  «Повертаю гру з того місця, де ви зупинилися…»: our copy waits for its round's snapshot (round.js);
                «X повертає гру з того місця, де ви зупинилися…»: X's copy, the round's runner, does (q32)
     seat       «Ти чекаєш на місце» and «Грають зараз: …» (owner, decision 7)
     version    each page its own part (versionWords; owner, decision 9 and q11): the older «У друга новіша версія —
                онови сторінку» with «Оновити», the newer «У друга старіша версія — хай оновить сторінку», nearby «…,
                коли буде інтернет»; why our update did not happen, with «Спробувати ще»; a game one shelf lacks (q10)
   Every name stands in the nominative (arbitrary names cannot be declined; and no gender: q16), without direction
   controls (shown), and the screens isolate it where it stands (iso: a name never reorders the rest of its line, q17).
   ===================================================================== */
export const KINDS = ['link', 'loading', 'closed', 'restoring', 'seat', 'version'];   // row order; api-surface.json "screens"
// a button: its text and its classes (the markup's hooks, screens.js)
export const LABEL = { repair: ['З’єднатися знову', 'btn'], release: ['Не чекати', 'btn ghost'], update: ['Оновити', 'btn ghost'], retry: ['Спробувати ще', 'btn ghost'] };
// what a screen reader calls a button that acts on one player (its aria-label: the visible words first, then whom, the
// name in the nominative as the row says it: owner, decision 42); «З’єднатися знову», «Оновити» and «Спробувати ще» keep
// their plain names: the same on every row
export const NAMED = { release: n => 'Не чекати, поки повернеться ' + shown(n) };
const NEARBY = 'Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.';
const RESTORING = 'Повертаю гру з того місця, де ви зупинилися…', SEAT = 'Ти чекаєш на місце';
// the time a place is still kept, m:ss (165000 → 2:45, 1 → 0:01)
export const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
// names as the screens join them: «Аня», «Аня і Богдан», «Аня, Богдан і Віра» (no .at(): Safari 15.4)
export const names = l => l.length > 1 ? l.slice(0, -1).join(', ') + ' і ' + l[l.length - 1] : l.join('');
// A name as a row puts it into its words: without direction controls (a name from a library from before names were
// cleaned could reverse the rest of its line, the time too: q17)
export const shown = n => String(n).replace(/\p{Bidi_Control}/gu, '');

// A line with names in it, from its parts (words, and { n: a name }, also in arrays) → { text, at: where each name
// stands in it, [from, to] } (screens.js isolates each one there); plain: a line with none
const line = (...parts) => {
  let text = '';
  const at = [];
  for (const p of parts.flat()) {
    if (typeof p === 'string') { text += p; continue; }
    const n = shown(p.n);
    at.push([text.length, text.length + n.length]);
    text += n;
  }
  return { text, at };
};
const plain = text => ({ text, at: [] });
// names joined as the screens join them (names), as parts of a line
const joined = l => l.flatMap((n, i) => [i ? i === l.length - 1 ? ' і ' : ', ' : '', { n }]);
const LINE = {
  link: n => line('Чекаємо, поки повернеться ', { n }, '…'),
  loading: n => line({ n }, ' повертається в гру'),
  closed: n => line({ n }, ' зараз не в грі — чекаємо'),
  on: n => line({ n }, ' зараз не в грі')
};
// nearby, why a link row has no «З’єднатися знову»: on a guest cut off from the hub (the hub's row), and on another
// guest's row (only they and the hub can pair again)
const CUT = n => line('Кімнату поруч тримає телефон, на якому грає ', { n }, ': без нього не чути й інших.');
const PAIR = (n, hub) => line({ n }, ' і ', { n: hub }, ' мають з’єднатися ще раз кодами.');

// Why our update to the newer version did not happen (gap.failed, together.js attempt): words, and «Спробувати ще»
// ('same': the site has nothing newer yet, tried again by itself: said as before)
const FAILED = new Map([
  ['storage', 'Бракує місця на пристрої для нової версії Ігротеки: звільни трохи місця й натисни «Спробувати ще»'],
  ['failed', 'Не вдалося завантажити нову версію: перевір інтернет'],
  ['timeout', 'Не вдалося завантажити нову версію: перевір інтернет']
]);
// What a page says of a version gap (rules.versionGap, with failed: together.js), each its own part (owner, decision 9
// and q11): the older page that it should update, the newer that the friend should, nearby (no internet: a reload
// brings back the same copy) when there is internet; why our update did not happen; a game one shelf lacks (q10: whom,
// or that this one lacks it). short: the chip's words (a game's and a failure's as they are, or the side only).
// gap: { why, older, failed, missing, who }
function versionLine(gap, { nearby = false, short = false } = {}) {
  const failed = FAILED.get(gap.failed);
  if (failed) return plain(short ? 'У друга новіша версія' : failed);
  if (gap.why === 'game' && gap.missing === 'theirs' && gap.who && gap.who.length) {
    return line(joined(gap.who), gap.who.length > 1 ? ' не можуть' : ' не може', ' відкрити цю гру: там інша версія Ігротеки');
  }
  if (gap.why === 'game' && gap.missing === 'ours') return plain('У кімнаті відкрили гру, якої тут немає');
  const older = gap.older === true;
  if (short) return plain(older ? 'У друга новіша версія' : 'У друга старіша версія');
  return plain((older ? 'У друга новіша версія — онови сторінку' : 'У друга старіша версія — хай оновить сторінку') + (nearby ? ', коли буде інтернет' : ''));
}
export const versionWords = (gap, opts) => versionLine(gap, opts).text;
// the button offered for it (LABEL; the same call either way): «Спробувати ще» after an update that did not happen,
// else «Оновити» (also invite.js's «Грати разом»)
export const versionAct = gap => FAILED.has(gap.failed) ? 'retry' : 'update';

// facts: null (nothing to say: the shelf) | { waits: [{ name, why: 'link'|'loading'|'closed', left, release, round?,
//   repair?, cut?, on? }], restoring: false | true | { by: name }, seat: null | { players: [names] },
//   gap: null | { key, older, failed, why, game, missing, who }, offer: bool, nearby: bool, host: the hub's name (nearby) }
// → { rows: [{ key, kind, name, text, time, fine, acts: [{ act, arg }], say, classic, iso }], showing, say, key }
//   time: ms left (link only, else null); say: what a screen reader hears (never the time; nearby, why with the first
//   row that says it only); classic: a row of the card from before the screens (placeLines); key: a row's identity
//   (who, why, what can be done and what it says: never the time); iso: { text, fine }, where each name stands in them
export function screen(facts) {
  if (!facts) return { rows: [], showing: '', say: '', key: '' };
  const rows = [];
  const add = (kind, name, l, { time = null, fine = null, acts = [], say = l.text, classic = false, extra = '' } = {}) =>
    rows.push({ key: kind + ':' + (name || '') + ':' + acts.map(a => a.act).join(',') + ':' + extra, kind, name, text: l.text, time, fine: fine && fine.text, acts, say,
      classic, iso: { text: l.at, fine: fine ? fine.at : [] } });
  let told = false;                                      // nearby: why pairing again is needed, heard once (with the first)
  for (const x of facts.waits || []) {
    const link = x.why === 'link', l = (x.why === 'closed' && x.on ? LINE.on : LINE[x.why])(x.name);
    let fine = null, say = l.text, extra = x.why === 'closed' && x.on ? 'on' : '';
    if (link && x.cut) { fine = CUT(x.name); say += ' ' + fine.text; extra = 'cut'; }
    else if (link && x.repair) { fine = plain(NEARBY); if (!told) { told = true; say += ' ' + NEARBY; } }
    else if (link && facts.nearby && facts.host && x.name !== facts.host) { fine = PAIR(x.name, facts.host); say += ' ' + fine.text; extra = 'with:' + facts.host; }
    add(x.why, x.name, l, { time: link ? x.left : null, fine, say, extra, classic: !x.round && x.why !== 'closed',
      acts: link ? [...(x.repair ? [{ act: 'repair' }] : []), ...(x.release ? [{ act: 'release', arg: x.name }] : [])] : [] });
  }
  const by = facts.restoring && facts.restoring.by;
  if (typeof by === 'string') add('restoring', null, line({ n: by }, ' повертає гру з того місця, де ви зупинилися…'), { extra: by });
  else if (facts.restoring) add('restoring', null, plain(RESTORING));
  if (facts.seat) {
    const p = facts.seat.players, now = p.length ? line('Грають зараз: ', joined(p)) : null;
    add('seat', null, plain(SEAT), { fine: now && { text: now.text + '.', at: now.at }, say: now ? SEAT + '. ' + now.text : SEAT, extra: p.join(',') });
  }
  if (facts.gap) {
    const g = facts.gap, side = g.older === true ? '<' : g.older === false ? '>' : '?';
    add('version', null, versionLine(g, { nearby: facts.nearby }), { classic: true, acts: facts.offer ? [{ act: versionAct(g) }] : [],
      extra: g.key + side + (g.missing ? ':' + g.missing + ':' + (g.who || []).join(',') : '') + (facts.nearby ? ':n' : '') + (g.failed ? ':' + g.failed : '') });
  }
  return { rows, showing: [...new Set(rows.map(r => r.kind))].join(' '), say: sayOf(rows), key: rows.map(r => r.key).join('|') };
}
// the rows as sentences: '. ' between them, only a space after one that already ends one («…», «.»)
export const sayOf = rows => rows.reduce((s, r) => !s ? r.say : s + (/[.…!?]$/.test(s) ? ' ' : '. ') + r.say, '');
// The card's rows (invite.js): none while a copy of the game's holds them (held); before the game's page has parsed
// (ready false), only the version row; a game that placed <ihroteka-wait> (adopted): every row; one that never did:
// exactly the card from before the screens (classic rows: link and loading of whom we play with, and version)
export const placeLines = (rows, { ready, adopted, held }) =>
  held ? [] : !ready ? rows.filter(r => r.kind === 'version') : adopted ? rows : rows.filter(r => r.classic);
