// What the players of a room share, the same for everyone: a few keys, each with the version that set it.
// A version is a Lamport clock (it starts from the wall clock, so a player's new tab writes after its old one)
// and, between equal clocks, the writer's name. Whoever has the higher version for a key has its value, so
// everyone ends up with the same, whatever order the changes arrive in, and nothing depends on who passes the
// messages on. Pure data: together.js sends the changes around.
//
//   view           the game everyone looks at (null: the shelf)
//   here:<name>    the game this player has open (null: none); only they write it
//   auth:<game>    whose copy of the game runs the round, once it moved (see together.js)
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
        if (typeof k !== 'string' || !e || !Number.isFinite(e.c) || typeof e.a !== 'string') continue;
        if (e.c > clock) clock = e.c;
        if (newer(e, doc.get(k))) { doc.set(k, { v: e.v, c: e.c, a: e.a }); changed.push(k); }
      }
      return changed;
    },
    entries: () => [...doc],
    // a version for something else shared (a snapshot): after everything we have seen
    next: () => ++clock,
    seen(c) { if (Number.isFinite(c) && c > clock) clock = c; }
  };
}
