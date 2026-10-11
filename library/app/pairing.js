/* =====================================================================
   Pairing two devices, automatically. Both open "Грати разом"; each shows its own code (as a QR code)
   and reads the other's with the camera, so phones held face to face pair by themselves. Nobody picks
   a role, nobody picks internet or not:
   - every device offers a direct link (its code) and, in the background, waits in its own internet room;
   - reading the other's offer, a device answers it (shows the answer instead of its offer) — but only the
     one with the smaller code does so at once: the other waits a moment for that answer, and answers itself
     only if none comes (when the cameras only see one way);
   - reading an answer to its own offer, a device completes the link;
   - over the internet both meet in the room of the smaller code;
   - whatever links first wins; if two direct links open at once, both keep the one the smaller code offered.
   The code shown is a link (…?room=<room>#p=<offer>): a friend can also read it with the phone's own camera.
   ===================================================================== */
import { ANSWER, OFFER, joinNearby, readCode } from '../net/index.js';
import { root, safe } from './dom.js';
import { adopt, current, onChange, startInternet } from './together.js';

const GAME = 'ihroteka', WAIT_FOR_ANSWER = 4000, PREFERRED_GRACE = 1500;

/**
 * ready              a promise to wait for before making our offer (the camera: see app/qr.js)
 * show(code, step)   draw this code; step: 'offer' (ours) | 'answer' (to the friend's offer)
 * note(event, info)  'connecting' | 'failed' ({ reason, report }) | 'no-network' (this device has nothing to offer) | 'linked'
 * Returns { read(text) → bool (a code of ours? then it is used), stop() }.
 */
export function startPairing({ ready, show, note }) {
  const mine = joinNearby({ game: GAME });             // our offer
  let id = '', offer = '', guest = null, answered = '', waiting = null, done = false;
  const rooms = [mine];
  const link = () => new URL('?room=' + id + '#p=' + offer, root).href;

  // our offer, and our internet room under the same code
  (async () => {
    await ready;
    offer = await mine.pair.offer();
    id = mine.pair.fallback;
    if (!mine.pair.local) note('no-network');
    if (!current() || current().kind !== 'internet') startInternet(id);
    if (!done) show(link(), 'offer');
  })().catch(e => { console.error(e); fail(mine); });

  // any link that opens: the first wins (but two direct ones at once settle on the same one on both sides)
  const onLinked = r => {
    if (done) return;
    const preferred = !guest || preferredOf() === r;
    if (preferred) finish(r);
    else setTimeout(() => { if (!done && r.linked) finish(preferredOf().linked ? preferredOf() : r); }, PREFERRED_GRACE);
  };
  const preferredOf = () => (id < guest.peer ? mine : guest);   // the link offered by the smaller code
  const finish = r => {
    done = true;
    clearTimeout(waiting);
    for (const x of rooms) if (x !== r) x.leave();
    adopt(r);
    note('linked');
  };
  const watch = r => {
    r.on('linked', () => onLinked(r));
    r.on('status', s => { if (s === 'connecting') note('connecting'); if (s === 'failed') fail(r); });
  };
  watch(mine);
  // the internet room linked first: the direct attempts are no longer needed
  const off = onChange(what => { if (what === 'linked' && !done && current().kind === 'internet') { stop(); note('linked'); } });

  function fail(r) {
    if (done) return;
    note('failed', { reason: r.pair.reason, report: r.pair.report() });
  }

  // answer the friend's offer: show our answer instead of our offer, and meet in the smaller code's room
  async function answer(text, peer) {
    if (guest) return;
    clearTimeout(waiting);
    guest = joinNearby({ game: GAME });
    guest.peer = peer;
    rooms.push(guest);
    watch(guest);
    const meet = id && id < peer ? id : peer;
    if (meet !== id || !current()) startInternet(meet);
    const code = await guest.pair.answer(text, meet);
    if (!done) show(code, 'answer');
  }

  return {
    read(text) {
      if (done) return true;
      let d;
      try { d = readCode(text, GAME); } catch (e) { return false; }
      if (d.kind === OFFER) {
        if (d.room === id || answered === text) return true;           // our own code (a mirror?) or already handled
        answered = text;
        if (!id || d.room < id) answer(text, d.room).catch(e => { console.error(e); fail(guest || mine); });
        else waiting = setTimeout(() => { if (!done) answer(text, d.room).catch(e => console.error(e)); }, WAIT_FOR_ANSWER);
        return true;
      }
      if (d.kind === ANSWER) {
        if (!offer || answered === text) return true;
        answered = text;
        clearTimeout(waiting);                           // the friend answered us: no need to answer them
        const c = current();                             // and over the internet we meet where the answer says
        if (d.room && !(c && c.kind === 'internet' && c.code === d.room)) startInternet(d.room);
        mine.pair.finish(text).catch(e => console.error(e));
        return true;
      }
      return false;
    },
    stop
  };

  function stop() {
    off();
    clearTimeout(waiting);
    if (!done) for (const r of rooms) safe(() => r.leave());
    done = true;
  }
}

// a code read by the phone's own camera opened the library: …#p=<code>
export const codeInAddress = () => { const m = location.hash.match(/^#p=([A-Za-z2-7]{40,400})$/); return m ? m[1] : null; };
