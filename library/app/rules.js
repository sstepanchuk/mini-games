/* =====================================================================
   The room's rules for an open game, as pure functions: who plays it and who waits, whose copy runs the round,
   who is away and why, when the round moves to another copy, and what the game hears when its players change; and
   those of the round layer (round.js, at the end): frozen seats, our part in a round, who runs it on or ends it.
   together.js and round.js hold the state and call these with it; tests/rules.test.js pins them.
   No DOM, no state of its own: everything comes in as arguments. `f` is the room as it is now:
     me, players          our name; everyone in the room, in the order they came (ours too)
     here(p)              the game p has open (their here: key in the shared state; null/undefined: none)
     wire(p, game)        the wire number of p's copy of that game (their wire: key; ours from our shelf), undefined
                          when their library does not say (older than the number: wire 1, see sameWire)
     loading              name → since when (ms): back (in a new tab or device, or after their place dropped), their
                          game not open there yet as far as we know (see arrivesLoading)
     away(p)              the room's word: p dropped out (their place is kept), for how long, ms (0: here). A player
                          whose link went quiet is away too (net/room.js presence): the room says so at once
     nearby, role, host   a nearby room (no internet); 'host' or 'guest' in the room; the room's host (a name)
     hold                 how long a place is kept (net HOLD)
     now                  the clock of `loading` (performance.now()); away(p) is already a duration
   ===================================================================== */

// What a game may hand the library, in bytes of its JSON (UTF-8: Cyrillic takes 2 a letter): a reliable message and a
// snapshot up to CAP (docs/ROADMAP.md, decision 18: the brokers' and WebKit's own limits are still to be measured); a
// shared value up to SHARE_BYTES, and SHARE_KEYS keys per game. The library's own messages go in chunks of up to CAP.
export const CAP = 32 * 1024, SHARE_BYTES = 8000, SHARE_KEYS = 32;

// Who has the game open, in the room's order (whoever came first, first): we do while we have it open (mine);
// anyone else while their here: names it, they are not stale, and their copy speaks our wire. A player who dropped
// out, or is still opening the game, keeps their place here too.
export function inGame(f, game, mine) {
  if (mine !== game) return [];
  return f.players.filter(p => p === f.me || (f.here(p) === game && !stale(f, p) && sameWire(f.wire(f.me, game), f.wire(p, game))));
}
// Two copies of a game play together only when their wire numbers (game.json "wire") are the same. A library that
// does not say (undefined: older than the number) speaks wire 1, as every game did before the numbers (owner,
// decision 9: a missing number counts as compatible in the release that brings the numbers, where every game is 1;
// once a game raises its number, not with that game; as PROTO, net/config.js pvOf).
export const sameWire = (mine, theirs) => (mine ?? 1) === (theirs ?? 1);

// A friend's library or game is another version than ours (owner, decision 9: they are not linked or seated
// together, and the older page updates itself). proto: the other library's PROTO the room met (room.versionMismatch,
// null: none; ours: mine.proto); wires: each other player's wire numbers by game (their wire: key), against ours
// (mine.wires, by game; a game one of us does not have does not count). → null | { why: 'proto' | 'wire', game,
// theirs, older: ours is the lower number (this page should update), key: what it is about, for reloadNow }
export function versionGap(mine, proto, wires) {
  if (Number.isSafeInteger(proto) && proto !== mine.proto) return { why: 'proto', game: null, theirs: proto, older: proto > mine.proto, key: 'proto:' + proto };
  let gap = null;
  for (const w of wires) {
    for (const [game, theirs] of Object.entries(w || {})) {
      const ours = mine.wires(game);
      if (ours === undefined || sameWire(ours, theirs)) continue;
      // one that makes us the older page first: that is the one to update for
      if (!gap || (theirs > ours && !gap.older)) gap = { why: 'wire', game, theirs, older: theirs > ours, key: 'wire:' + game + ':' + theirs };
    }
  }
  return gap;
}
// Whether the older page reloads itself now (to the newer version, after updating its offline copy): only while no
// round may run here (playing: a game is open, where a round may run, with others or alone: the library cannot see
// one played alone), never in a nearby room (a reload would end it: the phones would have to pair again), and once
// per version and session (done: the keys already reloaded for), so a reload that did not bring the newer version (its
// files not out yet) never loops.
export const reloadNow = (gap, { nearby, playing, done }) => !!gap && gap.older && !nearby && !playing && !done.has(gap.key);
// Whether the note offers to update now (a reload, whatever runs here): only on the older page (the newer one has
// nothing newer to get), and never in a nearby room (a reload would end it for every phone, and with no internet it
// brings back the same version).
export const offerUpdate = (gap, { nearby }) => !!gap && gap.older && !nearby;

// The first `seats` of them play; anyone after them waits for a seat. We play with the others who are seated,
// and with nobody while we wait ourselves. While a round of the round layer is on (frozen: its players, round.js),
// its seats are frozen: its players who have the game open are seated, in the round's order, and nobody else (the
// others wait, and may watch), whatever the room's order (a shaky network may change it) and whoever else comes.
export function seating(all, seats, me, frozen) {
  const seated = frozen ? frozen.filter(p => all.includes(p)).slice(0, seats) : all.slice(0, seats);
  return { inGame: all, seated, waiting: all.filter(p => !seated.includes(p)), others: seated.includes(me) ? seated.filter(p => p !== me) : [] };
}

// Whose copy runs the round: the one the shared state names (auth:<game>), if they play; else the first who plays.
// (The runner names itself with its round's first snapshot, together.js: so the room's order, which a shaky network
// may change, does not move a round; only a takeover does.)
export const runnerOf = (seated, auth) => auth && seated.includes(auth) ? auth : seated[0] || null;
// ours: 'host' (our copy runs it), 'guest', or null (we have no seat)
export const roleOf = (seated, me, auth) => !seated.includes(me) ? null : runnerOf(seated, auth) === me ? 'host' : 'guest';

// Why a player is not here, and since when (on the clock of f.now): 'link', they dropped out (the room keeps their
// place), or 'loading', they are back (in a new tab or device, or after their place dropped) and their game is not
// open there yet. We are always here. The one answer to "whom do we wait for, and why": the pause (paused), the
// takeover's proof (takeOver), who goes stale and the library's card (waitingFor) all ask it. → null | { since, why }
export function absence(f, p) {
  if (p === f.me) return null;
  const ms = f.away(p);
  if (ms > 0) return { since: f.now - ms, why: 'link' };
  return f.loading.has(p) ? { since: f.loading.get(p), why: 'loading' } : null;
}
// for how long, ms (at least 1; 0: here)
export const awayMs = (f, p) => { const a = absence(f, p); return a ? Math.max(1, f.now - a.since) : 0; };
const isAway = (f, p) => !!absence(f, p);
// Still opening the game for longer than a place is kept: their new tab or device never opened it. They stay in the
// room, but out of the game (their seat goes to who waits), until they say where they are (a here: of theirs).
export const stale = (f, p) => f.loading.has(p) && f.now - f.loading.get(p) > f.hold;

// Whether a player who comes in counts as loading (they keep their seat and the game waits) until a here: they wrote
// after it arrives: when the shared state says they have a game open (here:, written before) and either
//   - 'relinked' with fresh: back in a new tab or device (that one has not opened the game yet), or
//   - 'join': back after their place dropped (left, «Не чекати», or 3 minutes away): from any tab, the old here: is
//     no news of what is open there now.
// (Only a player may write their own here:, so nobody else can set it right: whoever comes in says it again, as
// soon as they link, if they have a game open; see together.js sayHere.)
export const arrivesLoading = (f, p, event, fresh) => (event === 'join' || (event === 'relinked' && !!fresh)) && !!f.here(p);

// The game pauses while one of the players we play with is away (dropped out, went quiet, or is still opening the game).
export const paused = (f, others) => others.some(p => isAway(f, p));

// Since when we are online (the brokers answer us), on the clock of `now`; 0 while we are not.
export const onlineSince = (since, online, now) => online ? since || now : 0;

// The round's runner has been away for `wait`: do we run it on? Only the first seated player who is here takes
// over (only that one writes it; everyone sees it in the shared state). Silence has two ends, though: only a
// player who can show it is not them who dropped out takes over, and only while they hold the room or hear whoever
// does (a guest cut off from the room's host knows the others only as the host last told it: it vouches for nobody,
// and waits for a host again) —
//   - 'company': someone else who has the game open (inGame: seated or waiting for a seat; not the runner) is here
//     with us, or
//   - 'reached': through the internet, the brokers have answered us for `wait` (since: onlineSince, on the clock
//     of `now`).
// Two phones nearby that lose each other cannot tell which of them it was: the round waits for its runner (on
// either phone, taking over would split it in two, each going on alone). → 'company' | 'reached' | null
export function takeOver(f, { inGame, seated, runner, since, now, wait }) {
  if (!runner || runner === f.me || awayMs(f, runner) < wait) return null;
  if (f.role !== 'host' && !(f.host && !f.away(f.host))) return null;
  const company = inGame.some(p => p !== f.me && p !== runner && !isAway(f, p));
  const reached = !f.nearby && since && now - since >= wait;
  if (!company && !reached) return null;
  return seated.find(p => !isAway(f, p)) === f.me ? company ? 'company' : 'reached' : null;
}

// What the open game hears when who we play with changes: was → now, the seated players while we play with
// someone (else []), and wasRunner, whose copy ran the round. The round ends ('peer-gone', then 'linked' again if
// someone is left) when whoever ran it is gone, or in a game for two when the other player is someone else now
// (the same two in another order are the same round: the room's order may change on a shaky network); otherwise
// players coming and going are 'join' and 'leave'. → [[event, ...args]] in order
export function playersChange(seats, was, now, wasRunner) {
  if (now.join() === was.join()) return [];
  const partner = seats === 2 && now.length && was.length && !sameSet(now, was);
  const gone = was.length && (!now.length || !now.includes(wasRunner) || partner);
  const out = [];
  if (gone) out.push(['peer-gone']);
  if (now.length && (!was.length || gone)) out.push(['linked']);
  else if (now.length) {
    for (const p of was) if (!now.includes(p)) out.push(['leave', p]);
    for (const p of now) if (!was.includes(p)) out.push(['join', p]);
  }
  return out;
}

const sameSet = (a, b) => a.length === b.length && a.every(p => b.includes(p));

// A round's snapshot fits the players seated now: the same players as when it was taken (p; a set, not an order).
// One from an older library says nothing of them (no p): it fits. (A round goes on only with its own players: after
// one of them was replaced, the snapshot is someone else's round.)
export const snapFits = (snap, seated) => !snap.p || sameSet(snap.p, seated);
// The round is over for good when one of the players it was played with is gone from the room for good (left, «Не
// чекати», or their place ran out): its snapshot becomes a tombstone, so it can never come back. A player who only
// closed the game, or is away, is not gone: the round waits for them (owner, decision 3).
export const goneForGood = (was, players, me) => was.some(p => p !== me && !players.includes(p));

// Whether «Не чекати» can let p's place go from here: the room's host lets it go, a guest asks the host (net/room.js
// release), and anyone can stop waiting for the host itself. A guest cut off from the room's host can do only that:
// its word for anyone else would reach the host later, if ever, when that player may well be back.
export const canRelease = (f, p) => f.role === 'host' || p === f.host || (f.role === 'guest' && !!f.host && !f.away(f.host));

// For the screens: the players we wait for (of those we play with: dropped out, their seat kept, or still opening
// the game) → [{ name, left: ms until their place goes (f.hold; loading: until they go stale), why: 'link' | 'loading',
// release: «Не чекати» for them works from here (only for one who dropped out: canRelease) }]
export const waitingFor = (f, others) => others.flatMap(p => {
  const a = absence(f, p);
  return a ? [{ name: p, left: Math.max(0, f.hold - awayMs(f, p)), why: a.why, release: a.why === 'link' && canRelease(f, p) }] : [];
});

/* ---------- the round layer (round.js): a round record of the game's (rec: { id, seats, runner, on, saved, … }) ---------- */
// What our copy is in a round: 'run' (ours runs it: from its snapshot, have; or afresh, as it began, when its runner
// never saved it), 'watch' (another copy runs it; also ours without a seat in it), 'wait' (ours runs it and has no
// snapshot of it yet: one may still come, see snapshotLost), or null: no round on for us (none, it is over, or it is
// the one we quit). → 'run' | 'watch' | 'wait' | null
export function roundPart(rec, me, { quit, have }) {
  if (!rec || !rec.on || rec.id === quit) return null;
  if (rec.runner !== me) return 'watch';
  return have || !rec.saved ? 'run' : 'wait';
}
// The round's players whose place dropped for good: no longer in the room (left, «Не чекати», or 3 minutes away).
export const seatsGone = (f, rec) => rec.seats.filter(p => !f.players.includes(p));
// Whether every one of these players is here (none dropped out or still opening the game: policy startNeedsEveryone)
export const everyoneHere = (f, names) => names.every(p => !isAway(f, p));
// Who ends a round nobody else can (a seat gone with policy endWhenSeatGone): its runner while it is in the room
// (away or not: it says so when it is back, or whoever takes the round over does), else the first of its players
// who is here. Only that one writes the record (round.js, one writer). → a name | null
export const roundWriter = (f, rec) => f.players.includes(rec.runner) ? rec.runner : rec.seats.find(p => f.players.includes(p) && !isAway(f, p)) || null;
// The round's runner can no longer run it: does our copy run it on? Only the first of the round's players who is
// here with the game open (seated: they, the round's seats being frozen) takes it over —
//   - 'gone': at once, when its runner left the room for good (the room's word: nothing to prove; not while we look
//     for the room again, lookingAgain: our list is not the room's then), or
//   - as takeOver says ('company' | 'reached'): its runner away for `wait`, with proof that it was not us.
// A runner here with the game closed is not taken over: the round waits for its game (owner, decision 3).
// → 'gone' | 'company' | 'reached' | null
export function roundTaker(f, { rec, seated, inGame, since, now, wait, lookingAgain }) {
  if (!rec || !rec.on || rec.runner === f.me) return null;
  if (!f.players.includes(rec.runner)) return !lookingAgain && seated.find(p => !isAway(f, p)) === f.me ? 'gone' : null;
  return takeOver(f, { inGame, seated, runner: rec.runner, since, now, wait });
}
// A round our copy should run and whose snapshot it has not got (it was saved): is that snapshot on no device any
// more? Its runner sends each one to all of its players, whoever has one greets every newcomer with it, and passes it
// on to the round's other players once its runner left for good (round.js tick); so when every other player of the
// round is here (and would have sent it) or gone for good, nobody has it. One who is away may have it: the round waits
// for them (as long as their place is kept). (round.js: ends 'lost' after LOST_WAIT.)
export const snapshotLost = (f, rec) => rec.seats.every(p => p === f.me || !f.players.includes(p) || !isAway(f, p));
