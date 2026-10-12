/* =====================================================================
   The room's rules for an open game, as pure functions: who plays it and who waits, whose copy runs the round,
   who is away and why, when the round moves to another copy, and what the game hears when its players change.
   together.js holds the state and calls these with it; tests/rules.test.js pins them (with the known bugs).
   No DOM, no state of its own: everything comes in as arguments. `f` is the room as it is now:
     me, players          our name; everyone in the room, in the order they came (ours too)
     here(p)              the game p has open (their here: key in the shared state; null/undefined: none)
     stale                names whose new tab or device did not open their game for as long as a place is kept
     loading              name → since when (ms): back in a new tab or device, their game not open there yet
     away(p)              the room's word: p dropped out (their place is kept), for how long, ms (0: here)
     weak(p)              p's link went quiet
     nearby, role, host   a nearby room (no internet); 'host' or 'guest' in the room; the room's host (a name)
     now                  the clock of `loading` (performance.now()); away(p) is already a duration
   ===================================================================== */

// Who has the game open, in the room's order (whoever came first, first): we do while we have it open (mine);
// anyone else while their here: names it and is not stale. A player who dropped out keeps their place here too.
export function inGame(f, game, mine) {
  if (mine !== game) return [];
  return f.players.filter(p => p === f.me || (f.here(p) === game && !f.stale.has(p)));
}

// The first `seats` of them play; anyone after them waits for a seat. We play with the others who are seated,
// and with nobody while we wait ourselves.
export function seating(all, seats, me) {
  const seated = all.slice(0, seats);
  return { inGame: all, seated, waiting: all.slice(seats), others: seated.includes(me) ? seated.filter(p => p !== me) : [] };
}

// Whose copy runs the round: the one the shared state names (auth:<game>), if they play; else the first who plays.
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
// someone is left) when whoever ran it is gone for good, or in a game for two when the other player is someone
// else now; otherwise players coming and going are 'join' and 'leave'. → [[event, ...args]] in order
export function playersChange(seats, was, now, wasRunner) {
  if (now.join() === was.join()) return [];
  const partner = seats === 2 && now.length && was.length && now.join() !== was.join();
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

// For the screens: the players we wait for (of those we play with: dropped out, their seat kept, or still opening
// the game) → [{ name, left: ms until their place goes (hold) }]
export const waitingFor = (f, others, hold) => others.filter(p => isAway(f, p)).map(p => ({ name: p, left: Math.max(0, hold - awayMs(f, p)) }));
