/* =====================================================================
   The rounds of contract 4: the room's own snapshots (room.snapshot) and the event 'resume' (deprecated, README
   "Game API": a game on ihroteka.round, round.js, needs none of it). together.js holds one (legacyRounds: L) and gives
   each open game's channel its part (forGame: c.legacy); the contract step (docs/ROADMAP.md) takes this file away with
   the lines there that call it. Not here, as ihroteka.round reads them too: whose copy runs a game's round in the
   shared state (auth:<game>, together.js authOf: room.host and role) and its takeover (together.js watchRunner).
   - A round outlives the device that runs it: the game hands the library snapshots (room.snapshot) and every player
     keeps the latest. If the player whose copy runs the round has been away for AUTH_WAIT, the next one here runs it
     on from the snapshot (event 'resume'); whoever comes back simply plays on. A game closed mid-round (the room went
     to the shelf, a frame closed) waits too: opened again, the runner's copy goes on from the snapshot, if the same
     players are seated (owner, decision 3). A round is over for good when the game says so (snapshot(null)) or one
     of its players left the room for good: the snapshot becomes a tombstone ({ s: null } with its version), so an
     older copy that someone still keeps can never bring it back.
   - On the room: lib-snap { v: game, s: snapshot | null, c: version, a: writer, p: [players seated] }, a round's
     latest. together.js greet sends these after the round layer's records and snapshots and before the rest of the
     shared state, so the update that links a game already has the snapshot; the tab keeps them for its next page with
     the rest of the room (together.js keepRoom, adopt). (What a library from before does with it: together.js.)
   ===================================================================== */
import { validClock } from './roomstate.js';
import * as rules from './rules.js';
import * as trace from './trace.js';
import { bytes, copy, GAME_ID, json } from './values.js';

const { CAP } = rules;
const SEND_EVERY = 500;                                  // a round's snapshots go to its players at most this often (the latest)
const snapMsg = (v, s) => ({ t: 'lib-snap', v, s: s.s, c: s.c, ...(s.a !== undefined && { a: s.a }), ...(s.p && { p: s.p }) });

/**
 * The room's snapshots of contract 4 (together.js holds one). ctx: what it needs of together.js —
 *   room() → the room | null; st() → its shared state | null; send(m, to?) → a library message to one player or
 *   everyone; channel() → the open game's channel | null; lookingAgain() → we look for the room again (our list is
 *   not the room's); claim(c) → our copy runs c's round: the shared state says so (auth:<game>)
 * and of the open game's channel (c, together.js): id, seated, others, was, api (ihroteka.room), disposed, emit(name,
 *   ...a), listens(name), uses('v4'), refuse(why)
 */
export function legacyRounds(ctx) {
  const snaps = new Map();                              // game → { s, c, a, p }: a round's latest snapshot (s: null, a tombstone)
  return {
    // a new room, or none: nothing of the old one's
    clear() { snaps.clear(); },
    // (state(): game → the snapshot we keep)
    state: () => Object.fromEntries([...snaps].map(([v, x]) => [v, { s: x.s, c: x.c, a: x.a, p: x.p }])),
    // someone new, or back: the snapshots we keep, tombstones too → how many
    greet(p) { for (const [v, s] of snaps) ctx.send(snapMsg(v, s), p); return snaps.size; },
    // the snapshots as they travel: what the tab keeps for its next page (together.js keepRoom)
    keep: () => [...snaps].map(([v, x]) => snapMsg(v, x)),
    // A player's place went for good (they left, «Не чекати», or it ran out): every round they played in is over,
    // also in a game nobody has open (owner, decision 3: it waits for a closed game, not for a player who quit), so it
    // does not come back when they come in again. A tombstone, to everyone. The open game, if it plays that round with
    // them now, follows its own rule instead (forGame over: 'peer-gone').
    quit(p) {
      if (ctx.lookingAgain()) return;
      for (const [v, s] of snaps) {
        const ch = ctx.channel();
        if (s.s === null || !s.p || !s.p.includes(p) || (ch && ch.id === v && ch.was.includes(p))) continue;
        const t = { s: null, c: ctx.st().next(), a: ctx.room().me };
        snaps.set(v, t);
        trace.note('snapshot ' + v + ': over (' + p + ' left)');
        ctx.send(snapMsg(v, t));
      }
    },
    // A lib-snap from someone. Its version is a clock of the shared state (roomstate.js validClock: a wild one would
    // win over every later snapshot); its writer (none from an older library), a player of this room; whether it fits
    // the seats is asked when a round would go on from it (rules.snapFits).
    onSnap(m, from) {
      if (typeof m.v !== 'string' || !GAME_ID.test(m.v) || !validClock(m.c) || m.s === undefined) return;
      if (m.a !== undefined && !(typeof m.a === 'string' && ctx.room().players.includes(m.a))) return;
      ctx.st().seen(m.c);
      const cur = snaps.get(m.v);
      if (cur && cur.c >= m.c) return;
      trace.note('snapshot ' + m.v + ' ← ' + from + ': ' + (m.s === null ? 'over' : trace.size(m.s)), 'snap<' + from + m.v);
      snaps.set(m.v, { s: m.s, c: m.c, a: m.a, p: Array.isArray(m.p) && m.p.every(x => typeof x === 'string') ? m.p : undefined });   // (null: a tombstone)
      const c = ctx.channel();
      if (c && c.id === m.v) c.legacy.maybeResume();
    },

    /* ---------- the open game's part: room.snapshot and 'resume' (c: its channel, together.js) ---------- */
    forGame(c) {
      const id = c.id;
      let pending = null, sendTimer = null, lastSent = 0;   // the latest snapshot not sent yet (at most two a second)
      // the latest snapshot to whoever plays with us; a tombstone to everyone (whoever keeps the round, waiting for a
      // seat too, must learn it is over)
      const flush = () => {
        sendTimer = null;
        if (!pending || !ctx.room() || c.disposed) return;
        const s = pending; pending = null; lastSent = performance.now();
        if (s.s === null) ctx.send(snapMsg(id, s));
        else for (const p of c.others) ctx.send(snapMsg(id, s), p);
      };
      const f = {
        own: false,                                     // the round runs in this copy of the game (it heard 'resume', or saved
                                                        //   it): it hears no 'resume' (together.js: no longer when not host)
        // We run the round now, we play with someone, and this copy of the game has nothing of it: it goes on from the
        // snapshot, if the snapshot is of a round with the players seated now (not a tombstone, not someone else's; a
        // player of it who left the room for good since does not count, rules.snapFits: in a game for 3+ the round goes
        // on without them, and its snapshot names them until the runner takes the next one). (A game not listening yet
        // hears it when it starts to.)
        maybeResume() {
          const s = snaps.get(id), api = c.api;
          if (api.role === 'host' && api.linked && !f.own && s && s.s !== null && rules.snapFits(s, c.seated, ctx.room().players) && c.listens('resume')) { f.own = true; c.emit('resume', copy(s.s)); }
        },
        // The round is over for the game ('peer-gone'): its copy keeps nothing of it (so the next time we run it on, it
        // hears 'resume'). If one of its players left the room for good, it can never go on: a tombstone, for everyone.
        over(was) {
          f.own = false;
          const room = ctx.room();
          if (!room || ctx.lookingAgain() || !rules.goneForGood(was, room.players, room.me) || !snaps.has(id) || snaps.get(id).s === null) return;
          pending = { s: null, c: ctx.st().next(), a: room.me };
          snaps.set(id, pending);
          trace.note('snapshot ' + id + ': over (a player left)');
          flush();
        },
        // room.snapshot(s): the round as it is now, from the copy that runs it (a plain JSON-able value of up to CAP
        // bytes, kept as a copy; null: no round any more). Every player keeps the latest, so the round can go on
        // elsewhere (see the top). → whether it was taken
        snapshot(s) {
          const x = s === undefined || s === null ? null : json(s, 'room.snapshot');
          c.uses('v4');
          const api = c.api;
          if (api.role !== 'host' || !ctx.room()) return c.refuse('snapshot: only from the copy that runs the round (room.role host)');
          if (x !== null && bytes(x) > CAP) return c.refuse('snapshot: up to ' + CAP + ' bytes as JSON');
          // the round runs in our copy: we name it in the shared state (once), so a change of the room's order (a shaky
          // network may reorder it) cannot move the round to another copy; only a takeover does (together.js watchRunner)
          if (x !== null && api.linked) ctx.claim(c);
          f.own = true;
          const room = ctx.room(), v = { s: x === null ? null : JSON.parse(x), c: ctx.st().next(), a: room.me, p: c.seated.slice() };
          snaps.set(id, v);                             // (null: a tombstone)
          trace.note('snapshot ' + id + ': ' + (x === null ? 'over' : bytes(x) + ' B'), 'snap>' + id);
          pending = v;
          if (v.s === null || performance.now() - lastSent > SEND_EVERY) flush();
          else if (!sendTimer) sendTimer = setTimeout(flush, SEND_EVERY);
          return true;
        },
        // the latest snapshot, if it still waits for its turn to go (at most two a second): now (the game closes, the
        // page goes or is hidden: it may never come back to send it)
        snapNow() { clearTimeout(sendTimer); flush(); }
      };
      return f;
    }
  };
}
