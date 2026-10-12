/* =====================================================================
   The room's rules for an open game, as pure functions: who plays it and who waits, whose copy runs the round,
   who is away and why, when the round moves to another copy, and what the game hears when its players change.
   together.js holds the state and calls these with it; tests/rules.test.js pins them (with the known bugs).
   No DOM, no state of its own: everything comes in as arguments. `f` is the room as it is now:
     me, players          our name; everyone in the room, in the order they came (ours too)
     here(p)              the game p has open (their here: key in the shared state; null/undefined: none)
     wire(p, game)        the wire number of p's copy of that game (their wire: key; ours from our shelf), undefined
                          when their library does not say (older than the number: wire 1, see sameWire)
     stale                names whose new tab or device did not open their game for as long as a place is kept
     loading              name → since when (ms): back in a new tab or device, their game not open there yet
     away(p)              the room's word: p dropped out (their place is kept), for how long, ms (0: here)
     weak(p)              p's link went quiet
     nearby, role, host   a nearby room (no internet); 'host' or 'guest' in the room; the room's host (a name)
     now                  the clock of `loading` (performance.now()); away(p) is already a duration
   ===================================================================== */

// What a game may hand the library, in bytes of its JSON (UTF-8: Cyrillic takes 2 a letter): a reliable message and a
// snapshot up to CAP (docs/ROADMAP.md, decision 18: the brokers' and WebKit's own limits are still to be measured); a
// shared value up to SHARE_BYTES, and SHARE_KEYS keys per game. The library's own messages go in chunks of up to CAP.
export const CAP = 32 * 1024, SHARE_BYTES = 8000, SHARE_KEYS = 32;

// Who has the game open, in the room's order (whoever came first, first): we do while we have it open (mine);
// anyone else while their here: names it, they are not stale, and their copy speaks our wire. A player who dropped
// out keeps their place here too.
export function inGame(f, game, mine) {
  if (mine !== game) return [];
  return f.players.filter(p => p === f.me || (f.here(p) === game && !f.stale.has(p) && sameWire(f.wire(f.me, game), f.wire(p, game))));
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
// and with nobody while we wait ourselves.
export function seating(all, seats, me) {
  const seated = all.slice(0, seats);
  return { inGame: all, seated, waiting: all.slice(seats), others: seated.includes(me) ? seated.filter(p => p !== me) : [] };
}

// Whose copy runs the round: the one the shared state names (auth:<game>), if they play; else the first who plays.
// (The runner names itself with its round's first snapshot, together.js: so the room's order, which a shaky network
// may change, does not move a round; only a takeover does.)
export const runnerOf = (seated, auth) => auth && seated.includes(auth) ? auth : seated[0] || null;
// ours: 'host' (our copy runs it), 'guest', or null (we have no seat)
export const roleOf = (seated, me, auth) => !seated.includes(me) ? null : runnerOf(seated, auth) === me ? 'host' : 'guest';

// Why a player is not here: dropped out ('link': the room keeps their place) or back in a new tab or device whose
// game is not open yet ('loading'); for how long, ms (at least 1). We are always here. → null | { ms, why }
export function absence(f, p) {
  if (p === f.me) return null;
  const ms = f.away(p);
  if (ms) return { ms, why: 'link' };
  return f.loading.has(p) ? { ms: Math.max(1, f.now - f.loading.get(p)), why: 'loading' } : null;
}
export const awayMs = (f, p) => { const a = absence(f, p); return a ? a.ms : 0; };
const isAway = (f, p) => awayMs(f, p) > 0;

// Whether a player who comes in counts as loading (their game not open on that device yet: they keep their seat
// and the game waits) until their new here: arrives. Today only a player back in a new tab or device whose link
// started over ('relinked', fresh) while the shared state says they have a game open. A 'join' (back after their
// place dropped) with an old here: is seated at once: a known bug (tests/rules.test.js).
export const arrivesLoading = (f, p, event, fresh) => event === 'relinked' && !!fresh && !!f.here(p);
// players loading for longer than a place is kept (hold): their new tab never opened the game, they go stale
export const loadingTooLong = (loading, now, hold) => [...loading].filter(([, t]) => now - t > hold).map(([p]) => p);

// The game pauses while one of the players we play with went quiet or is still opening the game.
export const paused = (f, others) => others.some(p => f.weak(p) || f.loading.has(p));

// Since when we are online (the brokers answer us), on the clock of `now`; 0 while we are not.
export const onlineSince = (since, online, now) => online ? since || now : 0;

// The round's runner has been away for `wait`: do we run it on? Only the first seated player who is here takes
// over (only that one writes it; everyone sees it in the shared state). Silence has two ends, though: only a
// player who can show it is not them who dropped out takes over —
//   - 'company': someone else (not the runner) in the room is here with us, or
//   - 'reached': through the internet, the brokers have answered us for `wait` (since: onlineSince, on the clock
//     of `now`), and we are the room's host or hear it.
// Two phones nearby that lose each other cannot tell which of them it was: the round waits for its runner (on
// either phone, taking over would split it in two, each going on alone). → 'company' | 'reached' | null
export function takeOver(f, { seated, runner, since, now, wait }) {
  if (!runner || runner === f.me || awayMs(f, runner) < wait) return null;
  const company = f.players.some(p => p !== f.me && p !== runner && !isAway(f, p));
  const reached = !f.nearby && since && now - since >= wait && (f.role === 'host' || (!!f.host && !isAway(f, f.host)));
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

// For the screens: the players we wait for (of those we play with: dropped out, their seat kept, or still opening
// the game) → [{ name, left: ms until their place goes (hold) }]
export const waitingFor = (f, others, hold) => others.filter(p => isAway(f, p)).map(p => ({ name: p, left: Math.max(0, hold - awayMs(f, p)) }));
