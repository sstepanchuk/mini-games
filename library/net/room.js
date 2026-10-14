// What every room has, however the players found each other: who is in it, the links between us, events, the
// game's policies and the public room object. internet.js and nearby.js add how players meet (the mode, below).
//
// Players are known by name: whoever comes in with a name is that player, from any tab, browser or device.
// The same name again takes the place over (the old tab or device is told so and steps aside; a name the player typed
// is asked about first while that device is still on the line: status 'taken', room.take); a player who drops out keeps
// their place for a while (HOLD) and gets it back by coming in with the same name. A name typed in the dialog is
// cleaned first (cleanName), and «*» (EVERYONE: everyone, on the wire) is nobody's own name (ownName).
//
// A room is a star: one host and up to max - 1 guests, each linked to the host only. (Over the internet the
// guests could reach each other too, but nearby they often cannot: one shape for both.) The host passes on what
// a guest sends to the others and keeps the list of players: who, in the order they came, and who is away
// (no link, or silent) since when. Everyone gets it. When the host goes away, the first player on the list who
// is here takes over (internet rooms, see internet.js); the old host keeps its place like anyone else.
//
// Room state is N; the link with each other tab is a peer P (link.js, rtc.js): a guest has one (with the host),
// the host one per guest. Links are by session (one per tab); places are by name. (Fields: Room, Peer below.)
//
// The places invariant. A place (an entry of N.members) is dropped in only three ways:
//   - its player leaves for good: a final bye (menu: 1: only from room.leave(true), and, nearby, from the host's
//     room.release) → the mode's byeFrom → dropMember (our host's: hostGone, gone); or, that bye lost, the same session
//     comes in under another name (a tab changes its name only by leaving: seatMember);
//   - someone presses «Не чекати»: room.release → dropMember on the host (a guest asks it with _x; for the host
//     itself, the mode's releaseHost). Over the internet the released tab is told nothing, as for HOLD: if it still
//     hears us, it is back as a new player once it is heard;
//   - HOLD runs out: holdOver, on the host.
// Anything else keeps every place: a link that ends (a closed tab or a reload: a bye without menu; a silent link; a
// link that starts over; another tab of the same player), and a mode that starts over (internet.js: discover,
// hostGone, dropAll say no final bye and keep the list; nearby.js: a host back from a reload takes the list back from
// the first guest that pairs again, adopt). Over the internet a page keeps its list in the tab, and a fresh page there
// that holds the room only because nobody answered takes those places back, away since they dropped out (restorePlaces:
// a reload while everyone else was away); two rooms on one code that merge keep the places of the one that gives way
// (internet.js keepAlong; a guest linked to a host missing from its list keeps its own, away, until the host's comes:
// guestMembers). A player who comes back from any session gets the same place (seatMember). The host's list is the
// room's: a guest takes it as sent (_r).
//
// The takeover invariant: a replaced tab never takes its place back by itself. Who comes in by the player's own act
// (a typed name, «Повернути сюди», a reload: a new room, until it has linked once: N.ever) is fresh and takes the
// place over (a typed name, N.ask, only once the player says it is them, if the device that holds the place is still on
// the line: 'taken', room.take); a tab that only says hello again by itself (internet.js: fresh: false) is told it was
// replaced if another session holds its place. The new session is seated before the old link goes (unlink, quiet), so
// nobody hears the player leave or the room fall apart for a moment.
//
// Roles (N.role, room.role; the library reads it when it needs it, there is no event for it):
//   null     looking for the room: internet, asking 'who'; nearby, before pairing
//   'host'   holds the room. Internet: nobody answered 'who' (or, still looking, we heard a 'who' from a greater
//            session), or our host is gone and we are the first player here (hostGone). Nearby: pair.offer().
//   'guest'  linked or linking to N.host. Internet: a host answered (also 'go', hostGone, giveWay, longSleep: a hello
//            to the same or another host). Nearby: pair.answer().
//   'out'    another tab of this player took our place (internet: 'moved', or a fresh hello with the host's own name;
//            nearby: a bye with moved: 1 from our host): final, the room is closed.
// Over the internet the roles change back and forth: null → 'host' | 'guest'; 'guest' → 'host' (hostGone), 'guest'
// (another host), null (6 hellos unanswered: discover); 'host' → 'guest' (two hosts on one code: giveWay; also after a
// sleep longer than HOST_WAIT, to whoever took the room over meanwhile); any → 'out'. Nearby, a room never changes
// kind: null → 'host' or null → 'guest', and pairing again keeps it; any → 'out'.
import { me, PROTO, pvOf, TIMING } from './config.js';
import { closeRtc } from './rtc.js';
import { deliver, diag, flushRelay, keepDirectAlive, kick, lag, refresh, resetPaths, send, stats, tendAlive, watch, wire } from './link.js';

// Messages of the link and the room itself: p (pulse), q (ping answer), ak (acknowledgement), bye; and _r (the
// players), _h (nearby hello), _x (a guest asks the host to let a player's place go). room.send refuses them, with a
// TypeError at the call (a mistake in the code, like a message that cannot become JSON): a message type must not
// start with '_' and be none of these. (The library wraps each game's messages in its own, 'lib-g', so a game may
// use any t. Every message, both modes: internet.js and nearby.js, at the top.)
const RESERVED = new Set(['p', 'q', 'ak', 'bye']);
// The room's status (room.status, event 'status'): what the dialog says while nobody plays with us yet. Each one the
// modes set (setStatus), and the library has a text for each (app/invite.js STATUS).
export const STATUSES = Object.freeze([
  'connecting',                                        // internet: on the way to the brokers and the room; nearby: a pairing links
  'unavailable',                                       // internet: no brokers: their client could not be loaded (no internet at
                                                       //   all), or the page has no Web Crypto (plain http: config.js secure)
  'no-signal',                                         // internet: no broker answers (alone: when linked, 'weak' says it)
  'waiting',                                           // internet: we hold the room, alone: friends find it by its code
  'joining',                                           // internet: a host answered, we say hello to it
  'taken',                                             // both: the name we came with holds a place whose device is still on the line;
                                                       //   room.take() takes it over, or leave and come in under another name
  'full',                                              // internet: no place left for us (we look again in 2 s)
  'pairing',                                           // nearby: a new room, to pair by codes
  'failed',                                            // nearby: a pairing did not link (room.pair.reason says why)
  'ready',                                             // both: a link works (someone else is here)
  'peer-left',                                         // both: the last link ended; we are alone (every place stays; internet: a host
                                                       //   whose last guest went, a guest whose host went and nobody is here)
  'version'                                            // both: another library version on our code, or pairing with us (PROTO): while
                                                       //   it is heard (otherVersion), then the status for where we are
]);
export const MAX_PLAYERS = 8;
export const HOLD = TIMING.HOLD;                       // how long a player who dropped out keeps their place
export const NAME = /^\S(?:.{0,22}\S)?$/u;             // a name: 1 to 24 characters, no spaces around

// Names (owner, q17). NAME is what the wire takes from anyone (an older page's names keep working); what this tab
// takes as its own name is stricter (ownName), and a name typed in the dialog is cleaned first (cleanName). The
// library's validName is ownName and nameShows.
export const EVERYONE = '*';                           // _t for everyone (sendRoom, arrive): so it is nobody's own name
export const ownName = n => typeof n === 'string' && NAME.test(n) && n !== EVERYONE;
// What gets dropped from a typed name: control characters (spaces among them become one space, below) and everything
// invisible (Default_Ignorable_Code_Point: the bidi controls, ZWSP, the word joiner, the BOM, a soft hyphen, the Hangul
// fillers…), but for what emoji need: ZWJ between two pictographs (👨‍👩‍👧, ❤️‍🔥), a variation selector right after a
// pictograph or a keycap's base (❤️, 1️⃣), and tags after a pictograph (🏴󠁧󠁢󠁳󠁣󠁴󠁿).
const PIC = '\\p{Extended_Pictographic}', TAG = '[\\u{E0020}-\\u{E007F}]';
const INVISIBLE = new RegExp('(?![\\t\\n\\v\\f\\r])\\p{Cc}' +
  `|(?<!${PIC}(?:\\uFE0F|\\p{Emoji_Modifier})?)\\u200D|\\u200D(?!${PIC})` +
  `|(?<![${PIC}#*0-9])[\\uFE00-\\uFE0F]|(?<!${PIC}${TAG}*)${TAG}` +
  `|(?![\\u200D\\uFE00-\\uFE0F\\u{E0020}-\\u{E007F}])\\p{Default_Ignorable_Code_Point}`, 'gu');
const APOSTROPHES = /['‘’ʼ`´′ʹʻ]/gu;                    // every apostrophe-like character → ’ (the library's texts use it)
// A typed name in the one spelling the room knows it by: nothing invisible (INVISIBLE), then NFC (a й typed in two parts
// is one letter), one apostrophe (’), one space between words and none around, a capital first letter (as phones type it;
// only where it stays one character: ß, ŉ stay). Latin look-alikes of Cyrillic letters are not mapped (owner). → the
// name, or '' (nothing left, or longer than NAME takes). Idempotent; never longer than typed (but for the few
// characters that NFC itself writes as two, such as क़). Only where a name is typed: a name in play is never changed.
export function cleanName(s) {
  let n = String(s).replace(INVISIBLE, '').normalize('NFC').replace(APOSTROPHES, '’').replace(/\s+/gu, ' ').trim();
  const c = n ? String.fromCodePoint(n.codePointAt(0)) : '', u = c.toLocaleUpperCase('uk');
  if (u !== c && [...u].length === 1) n = (u + n.slice(c.length)).normalize('NFC');
  return NAME.test(n) ? n : '';
}
// whether a name shows at all: a letter, a digit or an emoji once the invisible (and the blank Braille cell) are gone
// ('​', 'ㅤ', '⠀' and '***' do not)
export const nameShows = n => /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(String(n).replace(/[\p{Default_Ignorable_Code_Point}⠀]/gu, ''));

/**
 * The mode: what internet.js and nearby.js plug into a room. newRoom takes it as `mode` and puts each hook on N
 * (each one is the mode's closure over its N). A missing optional hook is a no-op; a missing required one throws.
 *
 * Required:
 *   peerGone(P)          link.js: P has been silent for N.lostAfter (HOLD). The link is over: unlink P (our host: move
 *                        on). Their place stays.
 *   restart(P)           link.js: more than OUTBOX_MAX of ours wait and none was acknowledged for STALL (or ten times
 *                        that many wait, or the link is overfull: P.overfull), so they cannot be hearing us. The link
 *                        starts over instead of ending (internet: a new attempt, both sides resync; nearby: the direct
 *                        link closes, as when it fails). Called each tick until it has. Nothing moves on: silence still
 *                        decides that (HOST_WAIT, HOLD).
 *   byeFrom(P, final, moved)   link.js: a 'bye' from P on the link (at once, ahead of anything still missing;
 *                        internet.js also on the topic). final (menu: 1): the player left for good, their place goes
 *                        (dropMember); else only their tab closed (a reload, say): the place is kept (internet: unlink P;
 *                        from our host: move on, hostGone; nearby: the direct link closes and the player is away until
 *                        paired again). moved (moved: 1, nearby, from our host): another device took our place.
 * Required in rooms with brokers (relay; brokers.js calls them):
 *   onConnected(client)  a broker connected and listens to the room's topic
 *   onMessage(m, client) a message on the room's topic or in our mailbox (copies through other brokers dropped)
 *   onDown()             a broker that worked went down
 * Optional:
 *   onLegacy(m)          brokers.js: a plain message from a library before PROTO 2, on its topic for our code (internet.js:
 *                        the door)
 *   close(final, out)    the room closes (N.shut: room.leave(), after the links said bye; or out: another tab of ours
 *                        took our place, nothing more is said), before the links close: the mode's goodbye (not when
 *                        out) and cleanup (its timers and listeners: always)
 *   bye()                the tab closes (pagehide; our place is kept): a goodbye by the mode's own path too
 *   back()               the page is back from the back-forward cache after its pagehide said bye (internet: a guest
 *                        says hello again at once, a host asks who holds the room)
 *   deafBack(gap)        brokers.js: the brokers were silent longer than HOST_WAIT (gap ms) and are back
 *   onUnlink(P)          unlink(): the link with P is over, just before P leaves N.peers (internet: stop listening)
 *   probe(P, now)        each watchdog tick, for each linked P (internet: a guest asks a quiet host 'here')
 *   hubCheck(now)        each watchdog tick (internet: a guest whose host has been away HOST_WAIT moves on)
 *   longSleep(gap)       our tab slept gap ms, longer than HOST_WAIT: the others may have moved on without us. → true:
 *                        the mode started over, and the rest of that tick is skipped (internet: a guest away longer than
 *                        HOLD says hello again); falsy: the tick goes on (internet: a host asks who holds the room, and
 *                        for a while gives way to whoever does; nearby, longer than HOLD: the others are away from now
 *                        on instead of here for GRACE, they have let us go by now)
 *   releaseHost()        a guest's room.release(n) for its own host (internet: hostGone, the host's place goes)
 *   take()               room.take(), after status 'taken': this player takes the place over from the device that holds it
 *                        (N.took; internet: a hello again at once, with take: 1)
 *   onDirect(P, open)    rtc.js: P's direct channels both opened (true), or one closed (false) (nearby: say _h)
 *   onHello(P, m)        rtc.js, rooms without brokers: an _h on a direct link that does not count yet
 * Also on N, from newRoom for link.js, rtc.js and the mode (not the mode's): emit, streaming(), playing(), pulse(now),
 * refresh(P), arrive(P, m, reliable), roomStats(), shut(final, out).
 */
const REQUIRED = ['peerGone', 'restart', 'byeFrom'], BROKER_HOOKS = ['onConnected', 'onMessage', 'onDown'];
const HOOKS = [...REQUIRED, ...BROKER_HOOKS, 'onLegacy', 'close', 'bye', 'back', 'deafBack', 'onUnlink', 'probe', 'hubCheck', 'longSleep', 'releaseHost',
  'take', 'onDirect', 'onHello'];
function modeHooks(mode, relay) {
  for (const k of Object.keys(mode)) if (!HOOKS.includes(k) || (mode[k] != null && typeof mode[k] !== 'function')) throw new Error('room: not a mode hook (or not a function): ' + k);
  for (const k of relay ? [...REQUIRED, ...BROKER_HOOKS] : REQUIRED) if (!mode[k]) throw new Error('room: the mode needs ' + k);
  return Object.fromEntries(HOOKS.map(k => [k, mode[k] || (() => {})]));
}

/**
 * N, a room's state (one per room, in this tab). Fields by purpose; the mode's hooks are above.
 * @typedef {object} Room
 * What it is (newRoom):
 * @property {string} game           the game: rooms of different games never meet
 * @property {string} code           the room code ('' nearby)
 * @property {string} name           our player's name
 * @property {boolean} ask            we came with a typed name: before taking a place whose device is still on the line, the
 *                                   room asks (status 'taken'; room.take()). took: the player said it is them (room.take).
 *                                   asked: internet, our host asked (taken) and the player has not answered yet: until then a
 *                                   status for where we are says 'taken', not 'joining' (setStatus: a blip, a version passing by)
 * @property {boolean} took
 * @property {boolean} asked
 * @property {boolean} relay         true: the brokers carry data when the direct link cannot (internet rooms)
 * @property {number} max            players at most, the host included (2…MAX_PLAYERS)
 * @property {number} lostAfter      HOLD: a link silent this long is gone (and so are we, to the others, after a sleep this long)
 * @property {boolean} closed        we left, or another tab took our place: nothing goes out any more
 * @property {Function} emit         (event, ...args): to the room's listeners
 * @property {string} status         the status the listeners last heard ('' before the first; setStatus)
 * @property {?number} mismatch      another library version we met (config.js PROTO), until we link with someone or
 *                                   it is not heard for TIMING.VERSION (otherVersion)
 * Brokers (internet rooms, brokers.js; sealed: seal.js):
 * @property {?object} keys          the room's keys (seal.js roomKeys), once made; keyMs: how long that took (diag)
 * @property {?number} keyMs
 * @property {string} topic          the room's topic (from its key)
 * @property {string} legacy         the topic a library before PROTO 2 uses for our code (internet.js, the door)
 * @property {Array} clients         per broker, its MQTT client (null while it waits to retry); c._ok: subscribed,
 *                                   c._rx: last heard, c._lat: echo delay, c._echo: it echoes us, c._in: its opening chain
 * @property {Array} br              per broker: { state: 'connecting' | 'ok' | 'wait', since, fails, timer }
 * @property {number} seq            our last message number on the brokers (from the clock, and never below one this page
 *                                   used before: brokers.js seqHi)
 * @property {Promise} out           the sealing chain: what we publish, in order
 * @property {Set} wait              what is in it, not sealed yet ({ link, gone }: brokers.js post, lastWords)
 * @property {Map} kq                our echo tests on their way: number → when it went ('k')
 * @property {?object} spare         one packet's worth sealed at once, ready for the last words (seal.js spare)
 * @property {?Map} stash            while the page goes: session → [k, link messages], for the last words
 * @property {boolean} hid           our pagehide said bye: a pageshow from the back-forward cache brings us back (N.back)
 * @property {object} door           { id, q }: the session (and its numbers) we answer an older library as, at the door
 * @property {Map} last              sender → its replay window (seal.js: a copy through another broker, or one sent again,
 *                                   is dropped); the page keeps them per room, for when it comes back (brokers.js windows)
 * @property {boolean} ready         a broker has connected: we looked for the room
 * @property {boolean} up            some broker works (as the status last said)
 * @property {number} kickAt         when the brokers were last checked at once (kickBrokers: at most every 3 s, but at once
 *                                   when the browser is online again or its network type changed)
 * @property {number} kAt            when the last echo test went ('k', every 5 s); kPrev: the one before it
 * @property {number} kPrev
 * @property {number} rxAt           when any broker last delivered anything (a message, or a subscription that took)
 * @property {number} winAt          when the brokers' scores were last halved (every 2 s)
 * @property {number} pubN           data messages sent (every 24th goes through every broker)
 * Role and players:
 * @property {?string} role          null, 'host', 'guest' or 'out' (see the top)
 * @property {?string} host          a guest's host: its session (null for the host)
 * @property {Map<string, Peer>} peers   session → the link with that tab
 * @property {Array<{n: string, s: string, a: number}>} members   the places in the order they came: name, session
 *                                   (ours: me), away since (performance.now(); 0 while here). A guest's a is as the host
 *                                   says, the host's own as our link to it; awaySince adds what a guest cannot vouch for
 * @property {number} cutAt          a guest: since when our link to the host is missing or weak (0: it works)
 * @property {?Array} along          internet, a guest that came over from a room that gave way (giveWay, 'go'): that room's
 *                                   list as it travels ([[name, session, away ms], …]), in our hellos until the host answers
 *                                   (the host keeps the places it lacks: internet.js keepAlong); null otherwise
 * @property {boolean} ever          we have linked with someone in this room: what we say by ourselves now is no longer
 *                                   the player's own act (internet.js: a hello is not fresh)
 * @property {string} sent           the host: the list as last sent (_r), so an unchanged one does not go again
 * @property {Array} told            the list as the game last heard it (tell)
 * @property {Map} strangers         session → when we last told it we are not linked, or our version at the door
 *                                   (internet.js: stranger, door; due)
 * @property {number} yieldUntil     internet, a host awake from a long sleep: until then it gives way to any other host
 * @property {?object} kept          internet: the places the page before this one in the tab kept for this room ({ at, m },
 *                                   keptPlaces), until a fresh page that nobody answered takes them back (restorePlaces)
 * @property {boolean} restored      it did (room.restored, event 'restored')
 * @property {number} heirAt         internet, a guest: when another session last asked for the room with our host's name
 *                                   (internet.js heir: that player went on there; once the host is quiet, we move on)
 * The room as a whole:
 * @property {boolean} linked        someone else is here and we hear each other
 * @property {boolean} weak          someone linked went quiet: the game pauses
 * @property {boolean} statsDue      a 'stats' event is due at the next tick
 * @property {boolean} budgetSaid    the room said 'budget' (fast messages waited for the relay budget, link.js): once
 * Watchdog (link.js):
 * @property {number} lastWatch      its last tick
 * @property {number} watchMs        its pace now: 200 ms while linked, 1000 not
 * @property {number} graceUntil     after our own sleep: nobody is judged before this
 * @property {number} heardAt        when a linked player's message last came (link.js deliver), or the last tick
 * @property {number} stall          the longest the page heard nothing since the last tick: a late tick with it short
 *                                   was only our timers held back (a hidden tab), not a sleep
 * Timers (stop(N, ...) clears them):
 * @property {*} whoTimer            internet: nobody answered 'who', we hold the room
 * @property {*} annTimer            internet: the host says it is here
 * @property {*} helloTimer          internet: a guest says hello until it is linked
 * @property {*} failTimer           internet: no broker within 6 s; nearby: the pairing under way gives up
 * @property {*} fullTimer           internet: the room was full, look again
 * @property {*} watchTimer          the watchdog
 * @property {*} aliveTimer          while a game is played here: a quiet direct link is asked about at once (link.js tendAlive)
 * @property {*} versionTimer        another library version is forgotten (otherVersion)
 */

/**
 * P, the link with one other tab (a peer). Fields by purpose:
 * @typedef {object} Peer
 * Who:
 * @property {Room} N                our room
 * @property {string} id             their session (nearby: 'pairing.…' until their _h says)
 * @property {string} name           their player's name, once known ('' until then)
 * @property {number} [k]            internet: the guest's hello attempt this link belongs to (each 'd' carries it)
 * @property {number} [helloQ]       internet: the number q of the hello that set this link's attempt k (an older hello is
 *                                   ignored)
 * @property {boolean} [again]       internet: a guest's link started over (restart): 'relinked' is due when the host answers
 * @property {boolean} [said]        nearby: our _h went out on this link
 * @property {number} [probeAt]      internet: when a guest last asked its quiet host 'here'
 * The link:
 * @property {boolean} linked        it counts: we hear each other
 * @property {boolean} weak          they went quiet (TIMING.WEAK): the game pauses
 * @property {number} weakAt         silent since (0 while not weak)
 * @property {number} lastSeen       when anything of theirs last came, by either path
 * @property {Array} early           what came a moment before the link counted (≤ 64), delivered once it does
 * Brokers (internet rooms):
 * @property {boolean} heard         we listen to their mailbox
 * @property {number[]} win          per broker: how often it brought their data first (halved every 2 s)
 * @property {number[]} peerBest     the brokers that bring our data to them first, as they say (w; ≤ 2)
 * @property {number} peerBestAt     when they said so
 * Paths, numbering and ping (link.js; resetPaths starts the numbering and the measurements over):
 * @property {string} via            the path in use: 'p2p' (direct) or 'relay' (the brokers)
 * @property {number} viaAt          when it was last chosen
 * @property {Array} q               messages waiting to go through the brokers (a flush: as few 'd' as RELAY_BYTES allows)
 * @property {boolean} qSoon         a flush is due at the end of this task (reliable messages through the brokers: soon)
 * @property {Map} qLatest           stream → the newest 'latest' message waiting for the brokers
 * @property {number} relayAt        when the 'latest' streams last went through the brokers
 * @property {number} qFast          fast messages (not 'latest') waiting in q; fastAt: when such ones last went (the relay budget)
 * @property {number} fastAt
 * @property {*} qTimer              the next flush (qDue: when)
 * @property {number} qDue
 * @property {*} ackTimer            an 'ak', due
 * @property {number} pingAt         when the last pulse went
 * @property {number} pN             pulses sent (every 6th through the brokers too)
 * @property {number} nudged         when a quiet direct link was last checked through the brokers (keepDirectAlive)
 * @property {number} tx             the last reliable number we gave (_x)
 * @property {Array} outbox          reliable messages not acknowledged yet: { m, at: last sent, n: times sent, b: bytes }
 * @property {number} ackAt          when the outbox last moved: something of ours acknowledged, or the first one waiting
 * @property {number} resendAt       while they are quiet: when the last probe went (one message sent again)
 * @property {boolean} overfull      the link starts over (internet: the host's restart): no new reliable message is kept
 *                                   for it and nothing goes again, until resetPaths
 * @property {number} rxNext         the next reliable number we expect from them
 * @property {Map} rxHold            number → a reliable message that overtook a missing one
 * @property {number} byeX           the number of the bye we already acted on
 * @property {number} pts            their last pulse counted (its copy by the other path is not)
 * @property {number} suspect        when they last said they cannot hear us directly (r: 1)
 * @property {?number} rD            round trip of the direct path (the median of sD); rR: through the brokers (sR)
 * @property {?number} rR
 * @property {number[]} sD           the last few samples of each path
 * @property {number[]} sR
 * @property {number} qD             the last ping answer counted on each path
 * @property {number} qR
 * @property {boolean} slowDirect    the direct link works but the brokers are clearly faster: use them
 * @property {?number} peerRtt       their ping as they measure it
 * @property {number} aliveAt        when they last reached us through the brokers and not the direct link
 * Direct link (rtc.js):
 * @property {?RTCPeerConnection} pc
 * @property {?RTCDataChannel} dcF   'fast': unordered, no resends
 * @property {?RTCDataChannel} dcC   'ctl': ordered, reliable
 * @property {number} dcSeen         when something last came through it (0: nothing yet)
 * @property {number} dcBorn         when both channels opened
 * @property {Array} iceQ            candidates that came before their offer: { k, c }
 * @property {?number} rtcK          the attempt under way
 * @property {number} rtcNext        a guest's next attempt, not before
 * @property {number} rtcTries       attempts so far (the pause between them grows)
 * @property {*} rtcTimer            the attempt gives up (15 s)
 * @property {?boolean} turn         through a TURN relay (null: not known)
 * @property {string} cand           the candidate pair in use (diag)
 * @property {?number} iceRtt        the browser's own round trip, ms
 * @property {number} statsAt        when the browser was last asked (probeLink)
 * @property {boolean} failing       nearby: a failed pairing is being described
 * @property {boolean} iceUp         nearby: the devices reached each other (ICE connected): a pairing that fails after
 *                                   that says 'closed' (the other phone gave up), not that the network keeps them apart
 * @property {boolean} taken         nearby, a guest: the host asked whether it is us (status 'taken'); room.take() says
 *                                   hello again on this link, with take: 1
 */

/**
 * A new room → { N, room }.
 *   game, code   which room (code: internet rooms)
 *   name         this player's name
 *   relay        true: the brokers carry data when the direct link cannot (internet rooms)
 *   max          players in the room, the host included (2…MAX_PLAYERS)
 *   ask          true: a name the player typed: a place of that name whose device is still on the line is not taken
 *                before the player says so (status 'taken', room.take()); false (default): taken as ever (a reload, a
 *                return: the same player)
 *   mode         the mode's hooks (above)
 */
export function newRoom({ game, code = '', name, relay, max = MAX_PLAYERS, ask = false, mode = {} }) {
  if (!ownName(name)) throw new Error('room: a name of 1 to 24 characters (not «*»)');
  const hooks = modeHooks(mode, relay);
  const ev = emitter();
  const N = {
    game, code, name, relay, ask: !!ask, took: false, asked: false, lostAfter: HOLD, max: Math.max(2, Math.min(MAX_PLAYERS, max | 0 || MAX_PLAYERS)), closed: false,
    // brokers (brokers.js); seq starts from the clock, so numbers of a new connection never collide with what
    // the other players remember from our previous one (and, in this page, never below them: brokers.js seqHi)
    keys: null, keyMs: null, topic: '', legacy: '', clients: [], br: [], seq: Date.now(), out: Promise.resolve(), wait: new Set(), kq: new Map(), spare: null,
    stash: null, hid: false, door: null, last: new Map(), ready: false, up: false, kickAt: -1e9, kAt: 0, kPrev: 0, rxAt: 0, winAt: 0, pubN: 0,
    // our role, the host's session (when we are a guest), the links (session → peer), the players
    // ({ n: name, s: session, a: away since, 0 while here }, in the order they came; ours has s = me)
    role: null, host: null, peers: new Map(), members: [{ n: name, s: me, a: 0 }], sent: '', told: [], cutAt: 0, ever: false, along: null,
    kept: relay ? keptPlaces(code, name) : null, restored: false,
    linked: false, weak: false, statsDue: false, budgetSaid: false, strangers: new Map(), yieldUntil: 0, heirAt: 0, status: '', mismatch: null,
    // the watchdog (link.js)
    lastWatch: 0, watchMs: 0, graceUntil: 0, heardAt: 0, stall: 0,
    // timers
    whoTimer: null, annTimer: null, helloTimer: null, failTimer: null, fullTimer: null, watchTimer: null, versionTimer: null, aliveTimer: null
  };

  const room = {
    get code() { return code; },
    get me() { return name; },                         // our name
    get role() { return N.role; },                     // null until known, then 'host' or 'guest' ('out' when replaced)
    get host() { return N.role === 'host' ? name : (hostPeer(N) || {}).name || null; },
    get players() { return N.members.map(m => m.n); }, // everyone in the room, us included, in the order they came
    // a player who dropped out (their place is kept): for how long, ms; 0 while they are here
    away: n => { const m = memberOf(N, n), a = m ? awaySince(N, m) : 0; return a ? performance.now() - a : 0; },
    get max() { return N.max; },
    get linked() { return N.linked; },                 // someone else is here and we hear each other
    get weak() { return N.weak; },                     // someone linked went quiet
    get direct() { const l = linkedPeers(N); return l.length > 0 && l.every(P => P.via === 'p2p'); },
    get nearby() { return !relay; },                   // a nearby room (no internet involved)
    get kind() { return relay ? 'internet' : 'nearby'; },
    get status() { return N.status; },                 // the last status the listeners heard (STATUSES; '' before the first)
    // a fresh page alone in the room took back the places the page before it in this tab kept ('restored', once)
    get restored() { return N.restored; },
    // a broker answers us: connected and heard lately (it echoes us every 5 s); a nearby room has none: always
    get online() { const t = performance.now(); return !relay || N.clients.some(c => c && c._ok && t - c._rx < 7000); },
    // The policies of whoever plays on the room (the library sets them for the open game; replace these functions):
    streaming: () => false,                            // the host streams state every frame (a direct link counts as dead sooner)
    pulse: null,                                       // (now) => object: extra fields for the pulse sent 5 times a second
    playing: () => false,                              // a game is being played here: the room watches its direct links closely (link.js tendAlive)
    // another library version that we met (config.js PROTO): its number, until we link with someone or it is not
    // heard for a while (otherVersion); else null
    get versionMismatch() { return N.mismatch; },
    on(name, fn) { ev.on(name, fn); return room; },
    // To everyone else, or { to: name }; also { fast, latest } (see link.js). A TypeError at the call, whether
    // anyone is linked or not: one of the room's own types (RESERVED), or a reliable message that cannot become JSON.
    // (A reliable one is looked at as it goes out, its JSON: a toJSON cannot turn it into one of the room's own.)
    send(msg, { to, ...opts } = {}) {
      if (!opts.fast && msg && typeof msg === 'object') msg = wire(msg);   // (each link reads it back once more: what it numbers is its own)
      if (!msg || typeof msg.t !== 'string' || RESERVED.has(msg.t) || msg.t[0] === '_') throw new TypeError('room: a message needs a string t, not starting with _ and other than ' + [...RESERVED].join(', '));
      if (to !== name) sendRoom(N, msg, to, opts);
    },
    // let the place of a player who dropped out go now (nobody wants to wait any longer)
    release: n => release(N, n),
    // after status 'taken' (the player said it is them): take the place over from the device that holds it
    take: () => { if (!N.closed) { N.took = true; N.take(); } },
    lag: n => pick(N, n, lag, Math.max, 0),            // one-way delay estimate, ms (to one player, or the slowest)
    stats: n => roomStats(N, n),                       // { rtt, peerRtt, direct, relayed, turn, weak }
    diag: () => diag(N),                               // multi-line connection report
    frame: () => keepDirectAlive(N),                   // optional, every animation frame (while playing the room does it itself: tendAlive)
    kick: () => kick(N),                               // the network may have changed: check the brokers now (the room does it itself
                                                       //   when the page is shown, the browser is online again or its network changes)
    // Final (default): we left for good, our place goes. Not final: as if the tab closed, our place is kept
    // (this player goes on in another tab or device).
    leave(final = true) {
      if (N.closed) return;
      for (const P of linkedPeers(N)) try { send(P, final ? { t: 'bye', menu: 1 } : { t: 'bye' }); if (N.relay) flushRelay(P); } catch (e) {}
      shut(final, false);                              // (the byes went first: shut closes the links, and what waits with them)
    }
  };
  // The room closes: we left (final: for good), or (out) another tab of this player took our place, and nothing more
  // is said. One teardown either way: the mode's (its goodbye unless out, its own timers and listeners), the links,
  // our timers and the page's listeners.
  const shut = (final, out) => {
    if (N.closed) return;
    if (final) forgetPlaces(N);                        // (we left for good: the next page here does not come back to them)
    N.closed = true; N.linked = false; N.weak = false;
    N.close(final, out);
    stop(N, 'watchTimer', 'versionTimer', 'aliveTimer');
    for (const P of N.peers.values()) { P.linked = false; closePeer(P); }
    N.peers.clear();
    removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onShow);
    removeEventListener('pageshow', onPageShow);
  };
  Object.assign(N, {
    emit: ev.emit,
    streaming: () => safe(room.streaming),
    playing: () => safe(room.playing),
    pulse: now => { try { return room.pulse && room.pulse(now); } catch (e) { console.error(e); return null; } },
    refresh: P => { refresh(P); N.statsDue = true; },
    arrive: (P, m, reliable) => arrive(N, P, m, reliable),
    roomStats: () => roomStats(N),
    shut
  }, hooks);

  // closing the tab: say goodbye by every path we still can (our place is kept: maybe it was a reload). What the links
  // send through the brokers goes now, before the mode's goodbye, which takes it along (internet: the last words)
  const onPageHide = () => {
    if (N.closed) return;
    N.hid = true;
    keepPlaces(N);                                     // (for the next page in this tab: a reload)
    for (const P of linkedPeers(N)) try { send(P, { t: 'bye' }); if (N.relay) flushRelay(P); } catch (e) {}
    try { N.bye(); } catch (e) {}
  };
  addEventListener('pagehide', onPageHide);
  // Back from the back-forward cache (Safari: its sockets closed, the page frozen) after our pagehide said bye: the others
  // let our links go, or moved on (the mode's back). That bye must not go again (what is not acknowledged goes again,
  // link.js): it becomes nothing, keeping its number (arrive drops '_'; without it, everything after it would wait).
  const onPageShow = e => {
    if (e && e.persisted && N.hid && !N.closed) {
      N.hid = false;
      for (const P of N.peers.values()) for (const o of P.outbox) if (o.m.t === 'bye' && o.m.menu !== 1) o.m = { t: '_', _x: o.m._x };
      try { N.back(); } catch (x) { console.error(x); }
    }
    onShow();
  };
  // back on screen (a background tab may have been throttled to a timer a second, too little to count as sleep); and
  // out of sight: no watching the direct link closely (tendAlive)
  const onShow = () => { tendAlive(N); if (!document.hidden) kick(N); else keepPlaces(N); };
  document.addEventListener('visibilitychange', onShow);
  addEventListener('pageshow', onPageShow);
  return { N, room };
}

/* ---------- links ---------- */
export const linkedPeers = N => { const out = []; for (const P of N.peers.values()) if (P.linked) out.push(P); return out; };
export const hostPeer = N => N.host ? N.peers.get(N.host) || null : null;

// the link with one other tab (its fields: link.js and rtc.js); name: whose tab, once known
export function newPeer(N, id, name = '') {
  const P = {
    N, id, name, linked: false, weak: false, weakAt: 0, lastSeen: performance.now(), early: [],
    // brokers: whether we listen to their mailbox, which brokers bring their data first, which bring ours to them
    heard: false, win: [], peerBest: [], peerBestAt: -1e9,
    // paths, numbering and ping (link.js)
    via: 'relay', viaAt: 0, q: [], qSoon: false, qLatest: new Map(), relayAt: 0, qFast: 0, fastAt: 0, qTimer: null, qDue: 0, ackTimer: null, pingAt: 0, pN: 0,
    nudged: 0,
    // direct link (rtc.js)
    pc: null, dcF: null, dcC: null, dcSeen: 0, dcBorn: 0, iceQ: [], rtcK: null, rtcNext: 0, rtcTries: 0, rtcTimer: null,
    turn: null, cand: '', iceRtt: null, statsAt: 0, failing: false
  };
  resetPaths(P);
  N.peers.set(id, P);
  return P;
}
// the player goes on in another tab: the link carries on under the new session
export function renamePeer(N, P, id) {
  N.peers = new Map([...N.peers].map(([k, v]) => v === P ? [id, v] : [k, v]));
  if (N.host === P.id) N.host = id;
  P.id = id;
}
// Its timers and its direct link close, and what waits for the brokers is dropped, not flushed: internet.js resync sets
// the new attempt's k and then closes the peer, so what was queued for the old attempt (numbered by it) must go nowhere,
// least of all under the new k. That order (P.k, then closePeer clearing P.q) is load-bearing. (A link that ends flushes
// first: unlink.)
export function closePeer(P) {
  stop(P, 'qTimer'); stop(P, 'ackTimer');
  P.q = []; P.qLatest.clear(); P.qFast = 0; P.qSoon = false;
  closeRtc(P);
}

// A handshake (internet: who, host, hello, hi; nearby: _h) from another library version (config.js PROTO), or with
// a pv that is not a version: true, and the mode ignores it (no link with them). The room says 'version' (unless it
// already does; also while linked: the add-player screen says why a third player cannot join) and keeps their number
// as room.versionMismatch, until we link with someone or have not heard that version for TIMING.VERSION (it left: a
// tab of it still on our code says so at least every 10 s, as a host); then the status says where we are again: ready
// (linked), waiting (a host alone), joining (a guest), connecting (still looking). (A nearby room not linked keeps
// 'version': its pairing ended for that.)
export function otherVersion(N, m) {
  const v = pvOf(m);
  if (v === PROTO) return false;
  if (v !== null && !N.closed) {
    N.mismatch = v;
    stop(N, 'versionTimer');
    N.versionTimer = setTimeout(() => {
      N.versionTimer = null; N.mismatch = null;
      if (!N.closed && N.status === 'version' && (N.linked || N.relay)) {
        setStatus(N, N.linked ? 'ready' : N.role === 'host' ? 'waiting' : N.role === 'guest' ? 'joining' : 'connecting');
      }
    }, TIMING.VERSION);
    setStatus(N, 'version');
  }
  return true;
}

// the link with P works: both hear each other (and whatever version we met before, we have found our own)
export function markLinked(P) {
  const N = P.N, first = !N.linked;
  P.linked = true; N.linked = true; N.ever = true; N.mismatch = null; stop(N, 'versionTimer');
  P.lastSeen = performance.now();
  P.weak = false; P.weakAt = 0; P.rtcTries = 0; P.rtcNext = performance.now() + 300;
  resetPaths(P);
  if (N.watchTimer) startWatch(N);                     // at full pace from now on
  setStatus(N, 'ready');
  N.refresh(P);
  if (first) N.emit('linked');
  presence(N);
  const early = P.early;                               // what arrived a moment before the link opened
  P.early = [];
  for (const m of early) deliver(P, m, N.relay);
}

// The link with P is over (the tab is gone, or silent for too long). The player's place is not: see dropMember.
// quiet: the player goes on in another link (seat that one first): nobody hears that anyone left. linger (ms): the
// direct link closes only this much later, so that what we just sent on it gets out (nearby: a bye with moved).
export function unlink(P, { quiet = false, linger = 0 } = {}) {
  const N = P.N;
  if (N.peers.get(P.id) !== P) return;
  const was = P.linked;
  if (was && N.relay) flushRelay(P);                   // (what this task said to them goes first: a bye, say; link.js soon)
  P.linked = false;
  if (linger) { const { pc, dcF, dcC } = P; P.pc = P.dcF = P.dcC = null; closePeer(P); setTimeout(() => closePeer(Object.assign(P, { pc, dcF, dcC })), linger); }
  else closePeer(P);
  N.onUnlink(P);                                       // e.g. stop listening to their mailbox
  N.peers.delete(P.id);
  if (!was) return;
  N.linked = linkedPeers(N).length > 0;
  if (!N.linked && !quiet) {
    if (N.relay && N.role === 'host') setStatus(N, 'peer-left');   // (internet: a host left alone; a guest: hostGone; nearby: ended)
    N.emit('peer-gone');
  }
  weakChanged(N);
  N.statsDue = true;
}

/* ---------- the players ---------- */
export const memberOf = (N, n) => N.members.find(m => m.n === n) || null;

// Who is here now. The host: a player is here while a link to their tab works and is not silent, away since the
// moment it is not; when that changes, everyone hears it. A guest: as the host says, except the host itself,
// away while our link to it is (we see that first); and while that link is missing or weak we cannot vouch for anyone
// else either (the host's word is old): every other player counts as away since then (awaySince), so that a guest cut
// off from the host never takes a round over on the word of players it only hears through it.
export function presence(N) {
  const now = performance.now();
  if (N.role === 'host') {
    N.cutAt = 0;
    for (const m of N.members) {
      if (m.s === me) { m.a = 0; continue; }
      const P = N.peers.get(m.s), here = !!P && P.linked && !P.weak;
      if (here) m.a = 0; else if (!m.a) m.a = P && P.weakAt ? P.weakAt : now;
    }
    const wire = N.members.map(m => [m.n, m.s, m.a ? Math.round(now - m.a) : 0]);
    const key = JSON.stringify(wire.map(([n, s, a]) => [n, s, !!a]));
    if (key !== N.sent) { N.sent = key; for (const P of linkedPeers(N)) send(P, { t: '_r', m: wire }); }
  } else {
    const H = hostPeer(N), hm = H && N.members.find(m => m.s === H.id), cut = !H || !H.linked || H.weak;
    if (hm) { if (cut && !hm.a) hm.a = H.weakAt || now; else if (!cut) hm.a = 0; }
    N.cutAt = !cut ? 0 : N.cutAt || (H && H.weakAt) || now;
  }
  tell(N);
}
// since when a player is away (performance.now(); 0: here), as this tab can tell (see presence)
export const awaySince = (N, m) => m.a || (N.role !== 'host' && m.n !== N.name ? N.cutAt : 0);
// A player comes in (or back, from any tab): their place, now on this session. Another place on the same session goes:
// that tab's player left for good (a tab changes its name only by leaving; its final bye was lost).
export function seatMember(N, n, s) {
  N.members = N.members.filter(x => x.n === n || x.s !== s);
  const m = memberOf(N, n);
  if (m) { m.s = s; m.a = 0; delete m.along; } else N.members.push({ n, s, a: 0 });
  presence(N);
}
// a player's place goes (they left for good, nobody waits for them any more, or HOLD is over)
export function dropMember(N, n) {
  const m = memberOf(N, n);
  if (!m || m.s === me) return;
  N.members = N.members.filter(x => x !== m);
  const P = N.peers.get(m.s);
  if (P) unlink(P);
  presence(N);
}
// the host: places kept for longer than HOLD go
export function holdOver(N, now) {
  if (N.role !== 'host') return;
  for (const m of [...N.members]) if (m.a && now - m.a > HOLD) dropMember(N, m.n);
}
// The places an internet room's page keeps in its tab, for the next page there (a reload: owner, q29): sessionStorage
// PLACES = { room: [kind, code, our name], at: Date.now(), m: [[name, session, away ms], …] } (as the list travels:
// validWire), written whenever the list or an away flag changes (tell), as the page is hidden and as it goes (pagehide),
// and forgotten when we leave for good. Read and written as the browser lets us (site data may be blocked: it throws);
// what it cannot keep is simply not there for the next page.
const PLACES = 'ihroteka-places';
const placesOf = (code, name) => ['internet', code, name];
const keptOf = (code, name) => { const k = JSON.parse(sessionStorage.getItem(PLACES)); return k && JSON.stringify(k.room) === JSON.stringify(placesOf(code, name)) ? k : null; };
function keepPlaces(N) {
  if (!N.relay || N.closed || N.role === null) return;   // (still looking: our list is not the room's)
  const now = performance.now(), m = N.members.map(x => { const a = awaySince(N, x); return [x.n, x.s, a ? Math.max(1, Math.round(now - a)) : 0]; });
  try { sessionStorage.setItem(PLACES, JSON.stringify({ room: placesOf(N.code, N.name), at: Date.now(), m })); } catch (e) {}
}
function forgetPlaces(N) {
  try { if (N.relay && keptOf(N.code, N.name)) sessionStorage.removeItem(PLACES); } catch (e) {}
}
// what the page before this one in the tab kept for this room as this player → { at, m } | null
function keptPlaces(code, name) {
  try { const k = keptOf(code, name); return k && Number.isFinite(k.at) && validWire(k.m) ? { at: k.at, m: k.m } : null; } catch (e) { return null; }
}
// A fresh page (nothing linked yet) holds the room only because nobody answered (internet.js discover): the other
// players the page before it kept are its places again, in their order, away since they dropped out there (the time
// since it kept them counts too: their HOLD runs from the drop, not from the reload), but for one past HOLD by now.
// From here on each is held as any place (holdOver, «Не чекати», their hello: seatMember, two rooms: giveWay). A host
// that answers wins: then nothing is taken back. → whether any was (the room says 'restored': the library takes back
// what it kept too)
export function restorePlaces(N) {
  const k = N.kept;
  N.kept = null;
  if (!k || N.ever || N.members.length !== 1) return false;
  const now = performance.now(), since = Math.max(0, Date.now() - k.at), seen = new Set(), list = [];
  let room = N.max - 1;
  for (const [n, s, a] of k.m) {
    if (seen.has(n)) continue;
    seen.add(n);
    const away = Math.max(1, a) + since;
    if (n === N.name) list.push(N.members[0]);
    else if (s !== me && away <= HOLD && room > 0) { list.push({ n, s, a: now - away }); room--; }
  }
  if (!seen.has(N.name) || list.length < 2) return false;
  N.members = list;
  N.restored = true;
  return true;
}

// The game hears who came, who left, who dropped out or is back, and who goes on in a new tab.
function tell(N) {
  const before = N.told, after = N.members.map(m => ({ n: m.n, s: m.s, away: !!awaySince(N, m) }));
  N.told = after;
  if (JSON.stringify(before) !== JSON.stringify(after)) keepPlaces(N);
  for (const b of before) if (!after.some(a => a.n === b.n)) N.emit('leave', b.n);
  for (const a of after) {
    const b = before.find(x => x.n === a.n);
    if (!b) { if (a.n !== N.name) N.emit('join', a.n); continue; }
    if (b.s !== a.s && a.n !== N.name) N.emit('relinked', a.n, true);   // (true: a new session — a new tab or device)
    if (b.away !== a.away) N.emit('away', a.n, a.away);
  }
  if (before.map(x => x.n).join('\n') !== after.map(x => x.n).join('\n')) N.emit('players', after.map(x => x.n));
}
// a guest: the players as the host sent them (we are in it; if not yet, we add ourselves for now)
function setMembers(N, wire) {
  const now = performance.now();
  N.members = wire.map(([n, s, a]) => ({ n, s, a: a ? now - a : 0 }));
  if (!memberOf(N, N.name)) N.members.push({ n: N.name, s: me, a: 0 });
  presence(N);
}
// A guest just linked with the host: until it sends the players, the list we had, the host here now (on its session);
// a host missing from it (we came over from a room that gave way to this host's: internet.js giveWay, 'go') goes in
// front, and the others count as away until its list comes (we cannot vouch for them; nobody hears anyone leave).
export function guestMembers(N, hostName) {
  const h = memberOf(N, hostName), now = performance.now();
  if (h) { h.s = N.host; h.a = 0; }
  else N.members = [{ n: hostName, s: N.host, a: 0 }, ...N.members.filter(x => x.s !== N.host).map(x => x.s === me ? x : { ...x, a: x.a || now })];
  presence(N);
}
// a list of players as it travels: [[name, session, away ms], …] (_r; nearby.js, a guest's _h)
export const validWire = w => Array.isArray(w) && w.length <= MAX_PLAYERS && w.every(x => Array.isArray(x) && typeof x[0] === 'string' && NAME.test(x[0]) && typeof x[1] === 'string' && x[1].length < 64 && Number.isFinite(x[2]));

// Let a player's place go: the host does it; a guest asks the host. For the host itself, a guest moves on
// (internet.js: releaseHost).
function release(N, n) {
  if (n === N.name) return;
  if (N.role === 'host') {
    const m = memberOf(N, n), P = m && N.peers.get(m.s);
    // nearby: if it is still there, it is not in the room any more (it pairs again). Over the internet its tab, if alive,
    // is told nothing (a final bye from its host would say the HOST left): as when HOLD runs out, it is a stranger to us
    // now and comes back as a new player when it next talks to us (internet.js: stranger, 'host' u: 1 → hello)
    if (P && P.linked && !N.relay) send(P, { t: 'bye', menu: 1 });
    dropMember(N, n);
    return;
  }
  const H = hostPeer(N);
  if (H && H.name === n) { N.releaseHost(); return; }
  if (H && H.linked) send(H, { t: '_x', n });
}

/* ---------- messages ---------- */
// to everyone else (to: undefined) or one player by name. A guest sends everything to the host, which passes it on.
function sendRoom(N, msg, to, opts) {
  if (N.role === 'host') {
    for (const P of linkedPeers(N)) if (to === undefined || P.name === to) send(P, msg, opts);
    return;
  }
  const H = hostPeer(N);
  if (!H || !H.linked) return;
  send(H, to === H.name ? msg : { ...msg, _t: to === undefined ? EVERYONE : to }, opts);
}

// A message from P (reliable: it was numbered, see link.js). The host passes on what a guest sent to others:
// _t says to whom (EVERYONE: everyone), _f (only from the host) who wrote it.
function arrive(N, P, m, reliable) {
  if (m.t === '_r') {                                  // the players, from the host
    if (N.role === 'guest' && P.id === N.host && validWire(m.m)) setMembers(N, m.m);
    return;
  }
  if (m.t === '_x') {                                  // a guest: let this player's place go (only if they are away)
    if (N.role === 'host' && typeof m.n === 'string') { const t = memberOf(N, m.n); if (t && t.a) release(N, m.n); }
    return;
  }
  if (m.t[0] === '_') return;
  const to = m._t, from = N.role === 'host' ? P.name : typeof m._f === 'string' ? m._f : P.name;
  delete m._t; delete m._f;
  if (N.role === 'host' && to !== undefined) {
    for (const Q of linkedPeers(N)) if (Q !== P && (to === EVERYONE || Q.name === to)) send(Q, { ...m, _f: from }, { fast: !reliable });
    if (to !== EVERYONE && to !== N.name) return;
  }
  N.emit('message', m, from, reliable);              // (reliable: numbered, so a game's copy that holds it keeps it all)
}

/* ---------- several links, one room ---------- */
// one player's figure, or the room's: the worst of all (a game waits for its slowest player). (merge gets two figures
// at a time: reduce's own index and array would make Math.max NaN.)
function pick(N, n, fn, merge, none) {
  const ps = n === undefined ? linkedPeers(N) : linkedPeers(N).filter(P => P.name === n);
  return ps.length ? ps.map(fn).reduce((a, b) => merge(a, b)) : none;
}
// One player's link, or all of them: the worst. A player who dropped out counts as weak.
function roomStats(N, n) {
  const ps = n === undefined ? linkedPeers(N) : linkedPeers(N).filter(P => P.name === n);
  const m = n !== undefined && memberOf(N, n), away = !!m && !!awaySince(N, m);
  if (!ps.length) return { rtt: null, peerRtt: null, direct: false, relayed: false, turn: null, weak: away };
  const all = ps.map(stats), worst = (k, f) => { const v = all.map(s => s[k]).filter(x => x != null); return v.length ? f(...v) : null; };
  return { rtt: worst('rtt', Math.max), peerRtt: worst('peerRtt', Math.max), direct: all.every(s => s.direct), relayed: all.some(s => s.relayed),
    turn: all.some(s => s.turn === true) ? true : all.every(s => s.turn === false) ? false : null, weak: away || ps.some(P => P.weak) };
}
// the room is "weak" while anyone linked is: the game waits for them
export function weakChanged(N) {
  const v = linkedPeers(N).some(P => P.weak);
  if (v !== N.weak) { N.weak = v; N.emit('weak', v); }
  presence(N);
}

// The watchdog (link.js): 5 times a second while linked, once a second while not (there is only broker upkeep
// to do then). It changes pace by itself; the time before its first tick is not sleep.
const pace = N => N.linked ? 200 : 1000;
export function startWatch(N) {
  stop(N, 'watchTimer');
  N.watchMs = pace(N); N.lastWatch = performance.now();
  N.watchTimer = setInterval(() => { watch(N); if (!N.closed && pace(N) !== N.watchMs) startWatch(N); }, N.watchMs);
}

// The room's status changes (STATUSES): the listeners hear it once, never the same one twice in a row. A room alone,
// while a player of another library version is on its code (otherVersion), says 'version' instead of 'waiting' or
// 'peer-left': what the players need to know is that one of them must update the page.
export function setStatus(N, s) {
  if (!STATUSES.includes(s)) throw new Error('room: not a status: ' + s);
  if ((s === 'waiting' || s === 'peer-left') && N.mismatch !== null && !N.linked) s = 'version';
  if (s === 'joining' && N.asked && !N.took) s = 'taken';   // (asked: the hellos wait for the player's answer, room.take)
  if (s === N.status) return;
  N.status = s;
  N.emit('status', s);
}

// A tiny event emitter. A throwing listener is reported and does not stop the others
// (nor the network code that emitted the event).
function emitter() {
  const handlers = new Map();
  return {
    on(name, fn) { if (!handlers.has(name)) handlers.set(name, []); handlers.get(name).push(fn); },
    emit(name, ...args) {
      for (const fn of handlers.get(name) || []) { try { fn(...args); } catch (e) { console.error(e); } }
    }
  };
}

// timeouts and intervals share one id space, so clearTimeout stops either
export const stop = (o, ...timers) => { for (const k of timers) { clearTimeout(o[k]); o[k] = null; } };
function safe(fn) { try { return !!fn(); } catch (e) { return false; } }
