// What the players of a room share, the same for everyone: a few keys, each with the version that set it.
// A version is a Lamport clock and, between equal clocks, the writer's name. The clock starts at the wall clock (so a
// player's new tab writes after its old one) and follows the highest it merged: with a device in the room whose clock
// runs ahead, a player's new page writes below its old page's entries until it has merged them, so together.js writes
// the player's own keys again once merged (staleHere, staleWires). Whoever has the higher version for a key has its
// value, so everyone ends up with the same, whatever order the changes arrive in, and nothing depends on who passes
// the messages on. Pure data: together.js sends the changes around.
//
//   view           the game everyone looks at (null: the shelf)
//   here:<name>    the game this player has open (null: none); only they write it
//   auth:<game>    whose copy of the game runs the round, once it moved (see together.js)
//
// A clock from elsewhere counts only if it is a whole number (a safe integer) at most a year ahead of our own wall
// clock: one wild value (1e300, or 2^52 - 1, from a broken or hostile library) would otherwise carry every clock
// with it to where nothing can come after, and no later change could win. A device whose clock runs days or months
// fast still counts; one more than a year fast is not heard (its changes are ignored; tell its player to set the date).
const YEAR = 365 * 24 * 3600 * 1000;
export const validClock = c => Number.isSafeInteger(c) && c <= Date.now() + YEAR;
const newer = (a, b) => !b || a.c > b.c || (a.c === b.c && a.a > b.a);

export function roomState(me) {
  const doc = new Map();                                 // key → { v: value, c: clock, a: who wrote it }
  let clock = Date.now();
  return {
    get: k => doc.has(k) ? doc.get(k).v : undefined,
    // our change → the entry to send to the others
    set(k, v) {
      const e = { v, c: ++clock, a: me };
      doc.set(k, e);
      return [k, e];
    },
    // someone's change (or everything they know) → the keys that changed here
    merge(entries) {
      const changed = [];
      for (const [k, e] of entries) {
        if (typeof k !== 'string' || !e || !validClock(e.c) || typeof e.a !== 'string') continue;
        if (e.c > clock) clock = e.c;
        if (newer(e, doc.get(k))) { doc.set(k, { v: e.v, c: e.c, a: e.a }); changed.push(k); }
      }
      return changed;
    },
    entries: () => [...doc],
    // a version for something else shared (a snapshot): after everything we have seen
    next: () => ++clock,
    seen(c) { if (validClock(c) && c > clock) clock = c; }
  };
}
