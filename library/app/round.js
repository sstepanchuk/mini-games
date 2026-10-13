/* =====================================================================
   The round layer: ihroteka.round (phase 4, next to the room of contract 4, which stays as it is). A game's rounds
   are one shared record per game and a few mechanisms around it; which rules a game plays by is the game's own
   (owner: no default policies), so the library decides nothing a game did not ask for.

   The record: round:<game> in the room's shared state (roomstate.js; last writer wins, the same for everyone) =
     { id, seats, runner, on, by, reason, result, setup, saved, w, pol }
       id       the round's own (8 letters), new at each start
       seats    its players, by name, in seat order: frozen when it starts
       runner   whose copy runs it (steps it, saves it, ends it): the only one who writes the record
       on       it is on; false: it is over, `by` whom and why (reason: quit | over | gone | lost), with the
                game's result (over); a later start writes a new id over it
       setup    what start was given (the game's own: a mode, who goes first…)
       saved    its runner has saved it (so a copy that should run it on and has no snapshot waits for one, and
                never starts it over)
       w        the game's wire (game.json "wire") it is played with; another wire's round is not ours to see
       pol      the game's policies that the library applies even with the game closed: { endWhenSeatGone }
   Messages (besides lib-state): lib-save { v: game, r: round id, s: state, c: version, a: writer, w: wire }, a
   round's snapshot; lib-ask { v: game, q: 'start' | 'ok' | 'go' | 'quit', r: round id, n: nonce, setup, seats }, a
   request to the runner (below). A library from before phase 4 knows neither and drops round:<game> keys (it takes
   only those it knows, together.js): a game on this layer has a newer wire than any copy of it there, so they are
   never seated together; the room's own words (contract 4: auth:<game>, lib-snap, room.snapshot) stay as they were.

   Invariants (tests/app/round.test.js, tests/rules.test.js):
   1. One writer. Only the runner writes the record (an entry is taken only from the runner it names: validRecord),
      and only so: start (none, or one that is over → a new id, its runner the copy that started it), its first save
      (saved), its end (on → false, once: over, quit, gone, lost), a takeover (runner → the copy that runs it on). An
      end that the runner cannot write (it left for good: gone, lost; it is away: a quit that moved to the asker) is
      written by the copy that takes the round over, which names itself its runner.
   2. Seats are frozen. While a round is on, the game's seats go to its players who have it open, in its order, and
      to nobody else (rules.seating): a player away, or with the game closed, keeps their seat; anyone else who opens
      the game waits (watch), and gets a seat when the round is over.
   3. A snapshot belongs to one round and one runner. It carries the round's id, its writer and the wire, and is
      taken only from the runner the record names for that round (a copy passed on keeps its writer); a round goes on
      ('run') only from a snapshot of its own id and wire, and only while the record says it is on. So no round comes
      back with another round's state, nor after it was over: only a start turns a round on, with a new id. An end is
      final whatever its clock: two copies cut off from each other may both write the record (one ends the round, the
      other runs it on meanwhile, invariant 4), and whichever of them sees that round on again after it saw it over
      ends it again (merged: the end it saw, written anew), so it is over for everyone.
   4. The runner moves only as rules.roundTaker says: its runner away for AUTH_WAIT with proof (rules.takeOver), or
      at once when it left the room for good; the copy that runs it on signs the latest snapshot as its own (whoever
      keeps one passes it on to the round's other players once its runner left for good: the copy that runs it on may
      have none). A round that was saved and whose snapshot is on no device (rules.snapshotLost) ends 'lost' after
      LOST_WAIT (owner: 15 s). A game closed mid-round waits: opened again, the runner's copy hears 'run' with the
      snapshot.
   5. Requests. A start or a quit from a player whose copy does not run the round goes to the runner. A start names
      the round it follows (the record's id, or none) and expires: the runner offers ('ok'), and the asker takes the
      offer ('go') only within ASK_TTL of asking, by its own clock, so a start that waited in an outbox (an outage)
      starts nothing. A quit names its round and holds until that round is over: said again to its runner whenever
      we link with it, and if the round moves to our copy, ours ends it.
   6. Events, to the open game, once per round id: 'start' (a round has just begun: before its first save), then
      exactly one of 'run' (our copy runs it: state null when fresh, else its snapshot) or 'watch' (another copy runs
      it), told again only when the runner changes; 'rejoin' (we run it: one of its players has a new copy of the
      game); 'end' once (but 'closed', which says only that we lost sight of the round: our room closed, say; back in
      a room where it is still on, the game hears its part again, and later its end). A game that starts listening
      late hears its part (run or watch) before the messages kept for it, and while our copy waits for a round's
      snapshot ('wait'), the game's messages wait too.
   7. No policies but the game's. quit() ends the round for everyone because that is what it is for: a game whose
      round goes on without a player does not call it. Off by default, set by the game (round.policy):
        startNeedsEveryone  start is refused while a seated player is away or still opening the game
        endWhenSeatGone     the round ends ('gone') when one of its players' place drops for good (left, «Не
                            чекати», 3 minutes away); without it the game hears the room's 'leave' or 'peer-gone'
                            and decides
   ===================================================================== */
import { NAME, TIMING } from '../net/index.js';
import { validClock } from './roomstate.js';
import * as rules from './rules.js';
import * as trace from './trace.js';

const { CAP, SHARE_BYTES } = rules;
// (scaled as the room's TIMING: tests set window.__timeScale)
const SCALE = Number.isFinite(globalThis.__timeScale) && globalThis.__timeScale > 0 ? globalThis.__timeScale : 1;
export const LOST_WAIT = 15000 * SCALE;                 // a round whose snapshot is on no device ends this long after (owner)
export const ASK_TTL = 5000 * SCALE;                    // a start asked of the runner: taken only this soon after asking
const SAVE_EVERY = 500;                                  // a round's snapshots go to its players at most this often (the latest)
const REASONS = new Set(['quit', 'over', 'gone', 'lost']);
const ABC = 'abcdefghjkmnpqrstuvwxyz23456789';
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => ABC[b % ABC.length]).join('');
const RID = /^[a-z0-9]{8}$/, GAME = /^[a-z0-9-]{1,40}$/;
const UTF8 = new TextEncoder(), bytes = s => UTF8.encode(s).length;
const copy = v => v === undefined ? v : JSON.parse(JSON.stringify(v));
// a game's value as JSON; one that cannot be (a cycle, a BigInt) is a TypeError at the call
function json(v, what) {
  try { const x = JSON.stringify(v); return x === undefined ? 'null' : x; } catch (e) { throw new TypeError('ihroteka.round.' + what + ': not JSON (' + e.message + ')'); }
}
const KEY = game => 'round:' + game;

// A round record from the shared state, as it must look (invariant 1: its writer is the runner it names).
export function validRecord(k, e) {
  const v = e && e.v, names = a => Array.isArray(a) && a.length >= 1 && a.length <= 8 && a.every(p => typeof p === 'string' && NAME.test(p)) && new Set(a).size === a.length;
  return typeof k === 'string' && k.startsWith('round:') && GAME.test(k.slice(6)) && !!v && typeof v === 'object' && RID.test(v.id) && names(v.seats) &&
    typeof v.runner === 'string' && v.seats.includes(v.runner) && e.a === v.runner && typeof v.on === 'boolean' &&
    (v.on ? v.reason === null : REASONS.has(v.reason)) && (v.by === null || (typeof v.by === 'string' && NAME.test(v.by))) &&
    typeof v.saved === 'boolean' && Number.isSafeInteger(v.w) && v.w > 0 && (v.pol === undefined || (!!v.pol && typeof v.pol === 'object'));
}

/**
 * The library's rounds (together.js holds one). ctx: what it needs of together.js —
 *   room() → the room | null; st() → its shared state | null; publish(entry) → a change of ours, to everyone;
 *   send(m, to?) → a library message to one player or everyone; facts → the room as rules.js sees it;
 *   lookingAgain() → we look for the room again (our list is not the room's); wire(game) → our copy's wire number;
 *   frame() → the open game's channel | null; since() → since when we are online (rules.onlineSince);
 *   update() → tell the open game what changed; play(fn, ...a) → the game's code, called safely
 * and of the open game's channel (c, together.js): id, seated, others, inGame, api (ihroteka.room), disposed;
 *   later(key, fn), unlater(key, fn), heard(key) (late listeners: one replay pass with the room's), deliverKept() (the
 *   game's messages that waited), refuse(why, 'round') (a call refused: false), uses('round') (dev: v4 and round at once)
 */
export function rounds(ctx) {
  const saves = new Map();                              // game → { r, s, c, a, w }: the latest snapshot of its round we keep
  const quits = new Map();                              // game → the id of a round we quit that is not over yet (we say it again)
  const offers = new Map();                             // game → { n, from, r, setup, seats, until }: a start we offered (we run the rounds)
  const lostSince = new Map();                          // game → since when our copy should run its round and has no snapshot of it
  const passed = new Map();                             // game → the version of its snapshot we passed on, its runner gone (tick)
  const ended = new Map();                              // game → its rounds we know are over (the latest few): id → { by, reason, result }
  const me = () => ctx.room().me;
  // a round of the game is over (we ended it, or saw its end, whatever its clock: invariant 3)
  function noteEnd(game, { id, by, reason, result }) {
    if (!ended.has(game)) ended.set(game, new Map());
    const m = ended.get(game);
    m.delete(id); m.set(id, { by, reason, result });
    for (const k of m.keys()) { if (m.size <= 8) break; m.delete(k); }
  }
  // the game's round record, when it is of our copy's wire (another wire's round is not ours to see)
  const record = game => { const st = ctx.st(), v = st && st.get(KEY(game)); return v && v.w === ctx.wire(game) ? v : undefined; };
  // the snapshot we keep of this round, or null
  const snapOf = (game, rec) => { const s = saves.get(game); return s && rec && s.r === rec.id && s.w === rec.w ? s : null; };
  const saveMsg = (game, s) => ({ t: 'lib-save', v: game, r: s.r, s: s.s, c: s.c, a: s.a, w: s.w });
  // a snapshot of ours to the round's other players in the room (away ones too: their outbox keeps it)
  const sendSave = (game, rec, s) => { for (const p of rec.seats) if (p !== s.a && ctx.room().players.includes(p)) ctx.send(saveMsg(game, s), p); };
  function write(game, v, why) {
    trace.note('round ' + game + ' ' + v.id + ': ' + why);
    ctx.publish(ctx.st().set(KEY(game), v));
  }
  // a round begins: our copy runs it (we are the one who decides on starts: round.runner)
  function begin(c, { setup, seats, by }) {
    offers.delete(c.id); quits.delete(c.id); lostSince.delete(c.id);
    write(c.id, { id: newId(), seats, runner: me(), on: true, by, reason: null, result: null, setup, saved: false, w: ctx.wire(c.id), pol: c.round.pol() },
      'start by ' + by + ' (' + seats.join(', ') + ')');
    ctx.update();
  }
  // a round is over: ours to write, so we name ourselves its runner (we were, or nobody else can: lost, gone)
  function end(game, rec, { by, reason, result = null }) {
    quits.delete(game); lostSince.delete(game);
    noteEnd(game, { id: rec.id, by, reason, result });
    if (saves.get(game)?.r === rec.id) saves.delete(game);
    write(game, { ...rec, runner: me(), on: false, by, reason, result }, 'over: ' + reason + (by ? ' (' + by + ')' : ''));
    ctx.update();
  }
  // our copy runs the round on (rules.roundTaker): the record says so first, then the latest snapshot, signed as ours
  function takeover(game, rec, snap, why) {
    const v = { ...rec, runner: me() };
    write(game, v, 'runs on here (' + why + '; was ' + rec.runner + ')');
    if (snap) { const s = { ...snap, c: ctx.st().next(), a: me() }; saves.set(game, s); sendSave(game, v, s); }
    lostSince.delete(game);
    ctx.update();
  }
  // a quit of ours, said (again) to the round's runner
  const sayQuit = (game, rec) => ctx.send({ t: 'lib-ask', v: game, q: 'quit', r: rec.id }, rec.runner);

  const R = {
    record,
    // whose copy runs the game's round, as the record names it (none: undefined; the room of contract 4 reads it too)
    runnerOf: game => record(game)?.runner,
    // the seats of the game's round while it is on, else null (rules.seating: frozen)
    frozen: game => { const r = record(game); return r && r.on ? r.seats : null; },
    // a round's snapshot from someone (its runner, or passed on): taken only from the runner the record names for
    // that round (invariant 3); a newer one of the same writer, or the first of a new runner, replaces ours
    onSave(m) {
      if (!GAME.test(m.v) || !RID.test(m.r) || !validClock(m.c) || typeof m.a !== 'string' || m.s === undefined || m.s === null) return;
      const rec = record(m.v);
      if (!rec || !rec.on || rec.id !== m.r || rec.runner !== m.a || rec.w !== m.w) return;
      ctx.st().seen(m.c);
      const cur = saves.get(m.v);
      if (cur && cur.r === m.r && cur.a === m.a && cur.c >= m.c) return;
      saves.set(m.v, { r: m.r, s: m.s, c: m.c, a: m.a, w: m.w });
      trace.note('round ' + m.v + ' saved ← ' + m.a + ': ' + trace.size(m.s), 'save<' + m.v);
      const c = ctx.frame();
      if (c && c.id === m.v) ctx.update();              // (our copy may run it now: it waited for this)
    },
    // A request to the runner (invariant 5): a start (we offer it; it begins only when the asker takes the offer in
    // time), the asker taking our offer, our offer, a quit.
    onAsk(m, from) {
      if (!GAME.test(m.v) || typeof m.q !== 'string') return;
      if (m.q === 'quit') {
        const rec = record(m.v);
        if (rec && rec.on && rec.id === m.r && rec.runner === me() && rec.seats.includes(from)) end(m.v, rec, { by: from, reason: 'quit' });
        return;
      }
      const c = ctx.frame();
      if (!c || c.id !== m.v || c.disposed || typeof m.n !== 'string') return;
      if (m.q === 'ok') c.round.offered(m.n, from);
      else if (m.q === 'start' && c.round.mayStart(from, m)) {
        offers.set(m.v, { n: m.n, from, r: m.r, setup: m.setup, seats: m.seats, until: performance.now() + ASK_TTL });
        trace.note('round ' + m.v + ': a start asked by ' + from + ', offered');
        ctx.send({ t: 'lib-ask', v: m.v, q: 'ok', n: m.n }, from);
      } else if (m.q === 'go') {
        const o = offers.get(m.v);
        if (!o || o.n !== m.n || o.from !== from || performance.now() > o.until) return;
        offers.delete(m.v);
        if (c.round.mayStart(from, o)) begin(c, { setup: o.setup === undefined ? null : o.setup, seats: o.seats.slice(), by: from });
      }
    },
    // round records that changed (from others): a round that is over takes its snapshot and our quit of it along; a
    // round we quit hears it again from its runner (perhaps a new one). entries: all that came, the records that lost
    // to ours too: an end is final whatever its clock (invariant 3), so a round we know is over and see on, we end again.
    merged(keys, entries = []) {
      for (const [k, e] of entries) if (k.startsWith('round:') && !e.v.on) noteEnd(k.slice(6), e.v);
      for (const k of new Set([...keys, ...entries.map(([x]) => x)])) {
        if (!k.startsWith('round:')) continue;
        const game = k.slice(6), rec = record(game), x = rec && rec.on && ended.get(game)?.get(rec.id);
        if (x) { trace.note('round ' + game + ' ' + rec.id + ': on again, though it is over (' + x.reason + ')'); end(game, rec, x); }
      }
      for (const k of keys) {
        if (!k.startsWith('round:')) continue;
        const game = k.slice(6), rec = record(game), q = quits.get(game);
        if (!rec || !rec.on) { if (rec && saves.get(game)?.r === rec.id) saves.delete(game); if (!rec || q === rec.id) quits.delete(game); continue; }
        if (q !== undefined && q !== rec.id) quits.delete(game);
        else if (q === rec.id && rec.runner !== me()) sayQuit(game, rec);
      }
    },
    // we link with p (anew): a quit of ours whose round p runs, again
    met(p) {
      for (const [game, id] of quits) { const rec = record(game); if (rec && rec.on && rec.id === id && rec.runner === p) sayQuit(game, rec); }
    },
    // someone new, or back: the snapshots of the rounds that are on (the records come in the shared state, before these)
    greet(p) {
      const st = ctx.st();
      for (const [game, s] of saves) { const v = st.get(KEY(game)); if (v && v.on && v.id === s.r) ctx.send(saveMsg(game, s), p); }
    },
    // Every second (and when a player left): a round we quit that moved to us, we end; a seat gone with
    // endWhenSeatGone ends its round; a snapshot we keep of a round whose runner left for good goes to its other
    // players; in the open game, our copy runs a round on (takeover), or ends one whose snapshot is on no device
    // ('lost', after LOST_WAIT).
    tick(now = performance.now()) {
      const room = ctx.room(), st = ctx.st();
      if (!room || !st) return;
      const f = ctx.facts, c = ctx.frame();
      for (const [k] of st.entries()) {
        if (!k.startsWith('round:')) continue;
        const game = k.slice(6), rec = record(game);
        if (!rec || !rec.on) { lostSince.delete(game); continue; }
        if (quits.get(game) === rec.id && rec.runner === room.me) { end(game, rec, { by: room.me, reason: 'quit' }); continue; }
        if (ctx.lookingAgain()) continue;
        const gone = rules.seatsGone(f, rec);
        if (gone.length && rec.pol && rec.pol.endWhenSeatGone) {
          if (rules.roundWriter(f, rec) === room.me) end(game, rec, { by: gone[0], reason: 'gone' });
          continue;
        }
        // its runner left for good: the snapshot we keep goes to its other players here, once (the copy that runs it on
        // may have none: away when it was saved, say), so that a round is lost only when its snapshot is on no device
        const snap = snapOf(game, rec);
        if (snap && !room.players.includes(rec.runner) && passed.get(game) !== snap.c) {
          passed.set(game, snap.c);
          for (const p of rec.seats) if (p !== room.me && room.players.includes(p)) ctx.send(saveMsg(game, snap), p);
        }
        if (!c || c.id !== game || c.disposed) { lostSince.delete(game); continue; }
        let ours = rec.runner === room.me;
        if (!ours) {
          const why = rules.roundTaker(f, { rec, seated: c.seated, inGame: c.inGame, since: ctx.since(), now, wait: TIMING.AUTH_WAIT, lookingAgain: false });
          if (why && quits.get(game) === rec.id) { end(game, rec, { by: room.me, reason: 'quit' }); continue; }   // (it moves to us: ours ends it)
          if (why && (snap || !rec.saved)) { takeover(game, rec, snap, why); continue; }
          ours = !!why;
        }
        if (ours && rec.saved && !snap && rules.snapshotLost(f, rec)) {
          if (!lostSince.has(game)) { lostSince.set(game, now); trace.note('round ' + game + ' ' + rec.id + ': its snapshot is on no device here'); }
          else if (now - lostSince.get(game) >= LOST_WAIT) end(game, rec, { by: room.me, reason: 'lost' });
        } else lostSince.delete(game);
      }
    },
    // a new room, or none: nothing of the old one's rounds is ours any more
    clear() { saves.clear(); quits.clear(); offers.clear(); lostSince.clear(); passed.clear(); ended.clear(); },
    state: () => Object.fromEntries([...saves].map(([g, s]) => [g, { r: s.r, a: s.a, c: s.c, s: s.s }])),

    /* ---------- ihroteka.round: the open game's view of its round (c: its channel, together.js) ---------- */
    frame(c) {
      const handlers = new Map();
      let told = { id: null, part: null, runner: null, over: true, closed: false };   // what the game is told (or hears when it listens: replay)
      let ins = [];                                       // (our copy runs it) its other players in the game with us
      let asked = null;                                   // our start, asked of the runner: { n, to, until }
      let pending = null, timer = null, lastSent = 0;     // our latest save not sent yet (at most two a second)
      const room = () => c.disposed ? null : ctx.room();   // (a game closed: its round is nobody's to call)
      const rec = () => ctx.st() ? record(c.id) : undefined;
      const on = r => !!r && r.on && quits.get(c.id) !== r.id;   // a round on for us (not one we quit)
      const refuse = why => c.refuse(why, 'round');
      // (the trace: the round's id and a name or a reason; of a state, its size)
      const brief = { start: e => [e.id, 'by', e.by], run: e => [e.id, e.state === null ? 'fresh' : trace.size(e.state)], watch: e => [e.id, e.runner], end: e => [e.id, e.reason, e.by] };
      const emit = (name, a) => {
        trace.note('→ ' + c.id + ' round ' + name + ' ' + trace.args(brief[name] ? brief[name](a) : [a]));
        c.heard('round:' + name);
        for (const fn of (handlers.get(name) || []).slice()) ctx.play(fn, a);
      };
      const runOf = r => { const s = snapOf(c.id, r); return { id: r.id, seats: r.seats.slice(), setup: copy(r.setup), state: s ? copy(s.s) : null }; };
      const watchOf = r => ({ id: r.id, seats: r.seats.slice(), runner: r.runner });
      const endOf = (id, r) => r && r.id === id && !r.on ? { id, by: r.by, reason: r.reason, result: copy(r.result) }
        : quits.get(c.id) === id ? { id, by: room() && room().me, reason: 'quit', result: null }
        : { id, by: null, reason: 'closed', result: null };   // (our room closed, or its end never reached us)
      const seatsOk = s => Array.isArray(s) && s.length === c.seated.length && c.seated.every(p => s.includes(p));
      const flush = () => {
        clearTimeout(timer); timer = null;
        const s = pending, r = rec();
        pending = null;
        if (!s || !room() || !r || !r.on || r.id !== s.r || r.runner !== s.a) return;   // (over, or it runs elsewhere now)
        lastSent = performance.now();
        sendSave(c.id, r, s);
        if (!r.saved) write(c.id, { ...r, saved: true }, 'saved');
      };
      const round = {
        get active() { return on(rec()); },             // a round is on (for us: not after we quit it)
        get id() { const r = rec(); return on(r) ? r.id : null; },
        get seats() { const r = rec(); return on(r) ? r.seats.slice() : null; },   // its players, frozen at its start
        get mySeat() { const r = rec(); return on(r) && room() ? r.seats.indexOf(room().me) : -1; },
        seatOf: name => { const r = rec(); return on(r) ? r.seats.indexOf(name) : -1; },
        // whose copy runs it; between rounds, whose copy decides on the next start (null: nobody plays with us)
        get runner() { const r = rec(); return on(r) ? r.runner : c.others.length ? c.api.host : null; },
        // our copy runs it (it has heard 'run', or hears it now: the record names it, and its snapshot is here or there
        // is none yet); between rounds, ours decides on the next start
        get runs() { const r = rec(), me = room() && room().me; return on(r) ? rules.roundPart(r, me, { have: !!snapOf(c.id, r) }) === 'run' : !!me && round.runner === me; },
        // the game's own rules the library applies for it (invariant 7): none by default
        policy: { startNeedsEveryone: false, endWhenSeatGone: false },
        // A new round, of the players seated now (opts.seats: the same players in another order), with the game's
        // setup (JSON, up to SHARE_BYTES). Ours decides: it begins now; else we ask the copy that decides (invariant
        // 5). → whether it began or was asked; false while a round is on, with nobody to play with, or as the policy says
        start(setup, opts) {
          const x = setup === undefined ? 'null' : json(setup, 'start');
          c.uses('round');
          const r = rec(), seats = opts && opts.seats !== undefined ? opts.seats : c.seated.slice();
          if (!room() || !c.others.length) return refuse('start: only with someone to play with (room.linked)');
          if (on(r)) return refuse('start: a round is on (round.active): over() or quit() ends it');
          if (bytes(x) > SHARE_BYTES) return refuse('start: a setup of up to ' + SHARE_BYTES + ' bytes as JSON');
          if (!seatsOk(seats)) return refuse('start: seats are the players seated now (room.players), in any order');
          if (round.policy && round.policy.startNeedsEveryone && !rules.everyoneHere(ctx.facts, c.seated)) return refuse('start: a player is away or still opening the game (policy.startNeedsEveryone)');
          const runner = round.runner, me = room().me, now = performance.now();
          if (runner === me) { begin(c, { setup: JSON.parse(x), seats: seats.slice(), by: me }); return true; }
          if (rules.awayMs(ctx.facts, runner)) return refuse('start: the copy that starts rounds (round.runner) is away');
          if (asked && now < asked.until) return refuse('start: asked already (the round begins in a moment)');
          asked = { n: newId(), to: runner, until: now + ASK_TTL };
          trace.note('round ' + c.id + ': start asked of ' + runner);
          ctx.send({ t: 'lib-ask', v: c.id, q: 'start', r: r ? r.id : null, n: asked.n, setup: JSON.parse(x), seats: seats.slice() }, runner);
          return true;
        },
        // (our copy runs the round) the round as it is now, JSON, up to CAP bytes, taken as a copy: its players keep
        // the latest (sent at most twice a second; at once when the game closes or the page goes or hides), so it can
        // go on in another copy, or in ours after a reload. → whether it was taken
        save(state) {
          const x = state === undefined || state === null ? null : json(state, 'save');
          c.uses('round');
          const r = rec();
          if (!room() || !on(r) || !round.runs) return refuse('save: only from the copy that runs the round (round.runs)');
          if (x === null) return refuse('save: a state (JSON), not null (over() ends the round)');
          if (bytes(x) > CAP) return refuse('save: up to ' + CAP + ' bytes as JSON');
          const s = { r: r.id, s: JSON.parse(x), c: ctx.st().next(), a: room().me, w: r.w };
          saves.set(c.id, s);
          trace.note('round ' + c.id + ' saved: ' + bytes(x) + ' B', 'save>' + c.id);
          pending = s;
          if (performance.now() - lastSent > SAVE_EVERY) flush();
          else if (!timer) timer = setTimeout(flush, SAVE_EVERY);
          return true;
        },
        // (our copy runs the round) the game's rules ended it, with its result (JSON, up to SHARE_BYTES): everyone
        // hears 'end' { reason: 'over', result }. → whether it ended
        over(result) {
          const x = result === undefined ? 'null' : json(result, 'over');
          c.uses('round');
          const r = rec();
          if (!room() || !on(r) || !round.runs) return refuse('over: only from the copy that runs the round (round.runs)');
          if (bytes(x) > SHARE_BYTES) return refuse('over: a result of up to ' + SHARE_BYTES + ' bytes as JSON');
          pending = null;
          end(c.id, r, { by: room().me, reason: 'over', result: JSON.parse(x) });
          return true;
        },
        // (a player of the round) it ends, for everyone: at once for us ('end', reason 'quit'), and for the others as
        // soon as its runner hears it (invariant 5). → whether we were in a round to quit
        quit() {
          c.uses('round');
          const r = rec(), me = room() && room().me;
          if (!me || !on(r) || !r.seats.includes(me)) return refuse('quit: only a player of the round on (round.mySeat ≥ 0)');
          if (r.runner === me) { pending = null; end(c.id, r, { by: me, reason: 'quit' }); return true; }
          quits.set(c.id, r.id);
          trace.note('round ' + c.id + ' ' + r.id + ': quit, asked of ' + r.runner);
          sayQuit(c.id, r);
          hooks.update();
          return true;
        },
        on(name, fn) {
          if (c.disposed || typeof fn !== 'function') return round;
          if (!handlers.has(name)) handlers.set(name, []);
          handlers.get(name).push(fn);
          c.later('round:' + name, fn);                 // (late: the game hears its part when it listens, see replay)
          return round;
        },
        off(name, fn) {
          const l = handlers.get(name), i = l ? l.lastIndexOf(fn) : -1;
          if (i >= 0) l.splice(i, 1);
          c.unlater('round:' + name, fn);
          return round;
        }
      };
      // What changed of the round, told to the game (invariant 6; 'start' only while it was never saved: news then).
      function tell() {
        const r = room() ? rec() : undefined, me = room() && room().me;
        const part = r && me ? rules.roundPart(r, me, { quit: quits.get(c.id), have: !!snapOf(c.id, r) }) : null;
        if (told.id && !told.over && (!part || r.id !== told.id)) {
          const e = endOf(told.id, r);
          told.over = true; told.part = null; told.closed = e.reason === 'closed';
          emit('end', e);
        }
        if (!part) { ins = []; return; }
        if (r.id !== told.id) {
          told = { id: r.id, part: null, runner: null, over: false, closed: false };
          if (!r.saved) emit('start', { id: r.id, seats: r.seats.slice(), setup: copy(r.setup), by: r.by });
        } else if (told.over) {
          // its end we told was only that we lost sight of it ('closed': our room closed, say, and came back): it went on,
          // and we are in it again (its part now, its end still to come); any other end is final (invariant 3)
          if (!told.closed) { ins = []; return; }
          told.over = told.closed = false;
        }
        // its other players in the game with us whose copy is open (not one still opening it: rules.absence 'loading')
        const others = () => r.seats.filter(p => p !== me && c.others.includes(p) && !ctx.facts.loading.has(p));
        if (part !== 'wait' && (part !== told.part || r.runner !== told.runner)) {
          told.part = part; told.runner = r.runner;
          if (part === 'run') { ins = others(); emit('run', runOf(r)); } else { ins = []; emit('watch', watchOf(r)); }
        } else if (told.part === 'run') {
          const now = others();                         // one of its players (back) in the game with us: their copy is new
          for (const p of now) if (!ins.includes(p)) emit('rejoin', p);
          ins = now;
        }
      }
      // (together.js: what the channel asks of the open game's round; not the game's)
      const hooks = {
        api: round,
        pol: () => ({ endWhenSeatGone: !!(round.policy && round.policy.endWhenSeatGone) }),
        update() {
          if (c.disposed) return;
          tell();
          c.deliverKept();                              // (the messages that waited for our part, if they need wait no more)
        },
        // a player's link with us started over (together.js 'relinked'): their copy needs everything again (a new copy,
        // in a new tab or device or back in the game, is one more of its players in the game with us: tell)
        rejoin(p) {
          const r = rec(), me = room() && room().me;
          if (me && told.part === 'run' && !told.over && on(r) && r.id === told.id && r.seats.includes(p) && p !== me) emit('rejoin', p);
        },
        // the game listens late (together.js replay): its part in the round on, if it has one yet
        replay(to) {
          const r = rec();
          if (told.over || !told.part || !on(r) || r.id !== told.id) return;
          if (told.part === 'run') for (const fn of to('round:run')) ctx.play(fn, runOf(r));
          else for (const fn of to('round:watch')) ctx.play(fn, watchOf(r));
        },
        // the game's messages wait while a round is on and our copy has not been told its part (a snapshot to come)
        holds() { const r = rec(); return on(r) && (told.id !== r.id || !told.part) && [...handlers.values()].some(l => l.length > 0); },
        // whether we would begin the start p asks of us now (invariant 5)
        mayStart(p, m) {
          const r = rec();
          return !!room() && round.runner === room().me && c.others.includes(p) && !(r && r.on) && (r ? r.id : null) === (m.r ?? null) &&
            seatsOk(m.seats) && bytes(JSON.stringify(m.setup ?? null)) <= SHARE_BYTES &&
            !(round.policy && round.policy.startNeedsEveryone && !rules.everyoneHere(ctx.facts, c.seated));
        },
        // the runner offers the start we asked: we take it if we asked it, of them, and not too long ago
        offered(n, from) {
          if (!asked || asked.n !== n || asked.to !== from) return;
          if (performance.now() > asked.until) { trace.note('round ' + c.id + ': the start offered came too late (taken only within ' + ASK_TTL + ' ms)'); asked = null; return; }
          ctx.send({ t: 'lib-ask', v: c.id, q: 'go', n }, from);
          asked = null;
        },
        snapNow() { flush(); },
        dispose() { flush(); handlers.clear(); }
      };
      return hooks;
    }
  };
  return R;
}
