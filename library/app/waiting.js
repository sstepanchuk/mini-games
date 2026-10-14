/* =====================================================================
   What the library says while an open game waits (owner, decision 6 (c): «Спільний набір екранів»): the words, the
   buttons and the order of its rows, the same for every game, as pure functions (no DOM: worker tabs read them too).
   together.js waitFacts says the facts; screens.js puts the rows into the game's own <ihroteka-wait>, and invite.js
   into its card over a game that shows none. tests/waiting.test.js pins them; tests/api-surface.json "screens" the kinds.
   One row per thing said, in this order:
     link       «Чекаємо на X… 2:45»: X dropped out, their place kept that long; «Не чекати» (their place goes) where it
                works from here (rules.canRelease); nearby, «З’єднатися знову» (pairing again) and why (owner, decision 5)
     loading    «Чекаємо на X — повертається в гру»: back in a new tab or device, the game not open there yet; nothing
                to press (owner, decision 4)
     closed     «Чекаємо на X — зараз не в грі»: a player of our round whose game is closed (rules.roundWaits)
     restoring  «Повертаю гру з того місця, де ви зупинилися…»: our copy waits for its round's snapshot (round.js)
     seat       «Ти чекаєш на місце» and «Грають зараз: …» (owner, decision 7)
     version    «Онови сторінку — у друга інша версія», «Оновити» on the older page (owner, decision 9)
   ===================================================================== */
export const KINDS = ['link', 'loading', 'closed', 'restoring', 'seat', 'version'];   // row order; api-surface.json "screens"
// a button: its text and its classes (the markup's hooks, screens.js)
export const LABEL = { repair: ['З’єднатися знову', 'btn'], release: ['Не чекати', 'btn ghost'], update: ['Оновити', 'btn ghost'] };
// what a screen reader calls a button that acts on one player (its aria-label: the visible words first, then whom);
// «З’єднатися знову» keeps its plain name: it is the same pairing on every row
export const NAMED = { release: n => 'Не чекати на ' + n };
export const UPDATE = 'Онови сторінку — у друга інша версія';   // (owner, decision 9: also the chip's and the dialog's)
const NEARBY = 'Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.';
const RESTORING = 'Повертаю гру з того місця, де ви зупинилися…', SEAT = 'Ти чекаєш на місце';
const LINE = { link: n => 'Чекаємо на ' + n + '…', loading: n => 'Чекаємо на ' + n + ' — повертається в гру', closed: n => 'Чекаємо на ' + n + ' — зараз не в грі' };
// the time a place is still kept, m:ss (165000 → 2:45, 1 → 0:01)
export const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return (s / 60 | 0) + ':' + String(s % 60).padStart(2, '0'); };
// names as the screens join them: «Аня», «Аня і Богдан», «Аня, Богдан і Віра» (no .at(): Safari 15.4)
export const names = l => l.length > 1 ? l.slice(0, -1).join(', ') + ' і ' + l[l.length - 1] : l.join('');

// facts: null (nothing to say: the shelf) | { waits: [{ name, why: 'link'|'loading'|'closed', left, release, round? }],
//   restoring: bool, seat: null | { players: [names] }, gap: null | { key, older, failed }, offer: bool, nearby: bool }
// → { rows: [{ key, kind, name, text, time, fine, acts: [{ act, arg }], say, classic }], showing, say, key }
//   time: ms left (link only, else null); say: what a screen reader hears (never the time; nearby, why with the first
//   link row only); classic: a row of the card from before the screens (placeLines); key: a row's identity (who, why
//   and what can be done: never the time)
export function screen(facts) {
  if (!facts) return { rows: [], showing: '', say: '', key: '' };
  const rows = [];
  const add = (kind, name, text, { time = null, fine = null, acts = [], say = text, classic = false, extra = '' } = {}) =>
    rows.push({ key: kind + ':' + (name || '') + ':' + acts.map(a => a.act).join(',') + ':' + extra, kind, name, text, time, fine, acts, say, classic });
  let why = !!facts.nearby;                              // nearby: why the link rows wait, heard once (with the first)
  for (const x of facts.waits || []) {
    const link = x.why === 'link', text = LINE[x.why](x.name), told = link && why;
    if (told) why = false;
    add(x.why, x.name, text, { time: link ? x.left : null, fine: link && facts.nearby ? NEARBY : null, say: told ? text + ' ' + NEARBY : text,
      acts: link ? [...(facts.nearby ? [{ act: 'repair' }] : []), ...(x.release ? [{ act: 'release', arg: x.name }] : [])] : [],
      classic: !x.round && x.why !== 'closed' });
  }
  if (facts.restoring) add('restoring', null, RESTORING);
  if (facts.seat) {
    const who = names(facts.seat.players);
    add('seat', null, SEAT, { fine: who ? 'Грають зараз: ' + who + '.' : null, say: who ? SEAT + '. Грають зараз: ' + who : SEAT, extra: facts.seat.players.join(',') });
  }
  if (facts.gap) add('version', null, UPDATE, { acts: facts.offer ? [{ act: 'update' }] : [], classic: true, extra: facts.gap.key });
  return { rows, showing: [...new Set(rows.map(r => r.kind))].join(' '), say: sayOf(rows), key: rows.map(r => r.key).join('|') };
}
// the rows as sentences: '. ' between them, only a space after one that already ends one («…», «.»)
export const sayOf = rows => rows.reduce((s, r) => !s ? r.say : s + (/[.…!?]$/.test(s) ? ' ' : '. ') + r.say, '');
// The card's rows (invite.js): none while a copy of the game's holds them (held); before the game's page has parsed
// (ready false), only the version row; a game that placed <ihroteka-wait> (adopted): every row; one that never did:
// exactly the card from before the screens (classic rows: link and loading of whom we play with, and version)
export const placeLines = (rows, { ready, adopted, held }) =>
  held ? [] : !ready ? rows.filter(r => r.kind === 'version') : adopted ? rows : rows.filter(r => r.classic);
