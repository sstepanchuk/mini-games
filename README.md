# 🎲 Ihroteka

A tiny private game library. The library is public; its games are end-to-end encrypted and open with a
password. Play alone, together over the internet, or side by side with no internet at all. Installs as an app
and works offline. Hosted on GitHub Pages.

**[Open](https://sstepanchuk.github.io/mini-games/)** · [🐉 Two Dragons](https://sstepanchuk.github.io/mini-games/dragons/)

## How it works

- **One page.** The library is a single page: the shelf, and the open game in a frame. Leaving a game never
  reloads the library, so the connection with a friend lives on from game to game.
- **Encrypted games.** Each game and its sources are sealed with one library key (AES-256-GCM). Each person has
  a password and an ECDH P-256 key pair; the password unlocks their private key, which unlocks the library key.
  Removing someone rotates the library key and re-encrypts every game.
- **Together.** "Грати разом" connects up to 8 players for the whole library: whatever one opens, everyone's library
  opens too. A player is the name they type on entering a room: the same name from another tab, browser or device
  takes that player's place (the old one steps aside and can take it back with «Повернути сюди»). A player who drops
  out keeps their place for 3 minutes; meanwhile the game pauses and a card over it says whom the others wait for and
  why: one who dropped out, the time left and «Не чекати» (nearby, for the phone that holds the room, «Не чекати» ends
  the room on this phone: «Без телефона X кімната поруч далі не може»), or one who is only opening the game again, in
  a new tab or device («Чекаємо на X — повертається в гру», nothing to press). If the copy of the game that runs a
  round is gone for 10 s, the round goes on in another player's copy from its last snapshot, when that player can tell
  it was not them who dropped out (two phones nearby that lose each other wait for the runner instead). The dialog
  first checks by itself whether there is internet (whether a broker answers: `navigator.onLine` also says yes on a
  hotspot without data). With internet there are two ways: a link (public MQTT brokers find the friend; WebRTC goes
  direct when it can), or nearby. Without it, only nearby: two devices on the same Wi-Fi or hotspot, one shows a QR
  code and the other scans it, then the other way round (the first one adds more players the same way). If a nearby
  link is impossible, the dialog says why (e.g. a phone sharing its hotspot cannot see that network in its browser, or
  the newcomer has the name of the phone that holds the room: «Це ім’я вже в кімнаті») and offers a report for
  debugging. Friends whose libraries (or copies of a game) are different versions are not linked (or not seated
  together) and see «Онови сторінку — у друга інша версія»; the older page updates itself when no game is open there
  (else its note offers «Оновити»), never in a nearby room.
- **Offline.** A service worker keeps one complete copy of the site per version; the shelf, the games and nearby
  play work without a network. On a phone it installs as an app.

## Layout

```
library/   everything that runs in the browser
  app/       the library page: shell, password, together (+ rules: who plays, who runs a round; trace: what
             happened lately, for bug reports), offline copy, page template, icons
  net/       rooms for up to 8 players: internet (MQTT + WebRTC) and nearby (QR-paired WebRTC)
  crypto.js  keyring and sealed files (browser and Node)
  game-api.js  window.ihroteka, injected into every game
tools/     cli.js (commands) · repo.js (keys, sealed files) · build.js (bundling, site, checks) · dev.js (local server)
           · migrate.js (keyring format steps)
tests/     unit tests (npm test); api-surface.json: the Game API, pinned; e2e/: browser scenarios
docs/      ROADMAP.md: the plan and the owner's decisions (in Ukrainian)
vault/     what the repository keeps: keyring.json, and per game game.json, its cover,
           game.bin (the built game, encrypted) and source.bin (its sources, encrypted)
games/     plaintext game sources (local only, git-ignored)
site/      the site, assembled from library/ and vault/ (git-ignored; CI assembles it on every push)
```

## Usage

```sh
npm install
npm run unlock              # decrypt game sources into games/
npm run dev                 # the library with your plaintext games at localhost:8000
npm run build               # run each game's own tests, bundle and encrypt the games into vault/, then assemble site/
                            #   (a game whose tests fail is not sealed; -- --no-tests skips them)
npm run site                # assemble site/ from library/ and vault/ (no password)
npm run dev -- site         # serve the assembled site/ at localhost:8001 (its offline copy stays off :8000)
npm run check               # validate vault/ (no password)
npm run lint && npm test
npm run e2e                 # browser scenarios against a running dev server (tests/e2e/README.md)
npm run test:games          # every game's own unit tests (games/*/test/*.test.js, sealed with it; after npm run unlock)
npm run test:games:e2e      # Two Dragons' browser scenarios (games/dragons/test/e2e, against the dev server)
npm run migrate             # bring an old vault/keyring.json up to today's format

npm run user -- list | add <name> | remove <name> | passwd
```

Set `VAULT_PASSWORD` to skip the prompt. A change to `library/` needs no password at all: commit it, and CI
assembles the site again.

The dev server (games mode) registers no service worker, and answers `/sw.js` with one that removes itself: an
offline copy left on the same address by `dev -- site` cannot hide your edits. A port can be given (`npm run dev
-- 8002`, `npm run dev -- site 8003`). `--lan` serves to your network over plain http, where browsers turn off the
camera (no QR scanning) and Web Crypto (an internet room there never meets the https devices). To try a real phone,
forward the port instead and open `http://localhost:8000/` on it: localhost counts as secure. Android: `adb
reverse tcp:8000 tcp:8000` (or chrome://inspect → Port forwarding).

## Adding a game

```
games/<id>/          <id> becomes the URL: /<id>/
  game.json          title, tagline, description, image (+ optional shareTitle,
                     shareDescription, imageAlt, emoji, theme, players: "2" or "2-4",
                     wire: a whole number, 1 when not given; see "Game API") — validated on build
  index.html         <script type="module"> and <link rel="stylesheet"> are bundled inline
  preview.png        1200×630, used on the shelf and in link previews
```

Then `npm run build`, commit `vault/`, push. The build inlines everything into one page: start with `<!doctype html>`,
keep assets next to `index.html` (relative links to anything that is not a style, module script or media file
fail the build).

## Game API

The library runs each game in a frame and gives it `window.ihroteka` before the game's code runs
(`undefined` when a game page is opened on its own, so treat it as optional). Everything below is pinned by
`tests/api-surface.json`: a member or event added, renamed or removed fails `npm test` until that file and this
section say the same.

```js
ihroteka.version     // 4
ihroteka.game        // { id, title, players: { min, max }, wire }   (game.json "players": "2", "2-4", …; "wire": 1, 2, …)
ihroteka.libraryUrl  // the library's absolute address (its shelf)
ihroteka.home()      // back to the shelf
ihroteka.invite()    // the library's "play together" dialog (room.invite() is the same)
ihroteka.room        // the other players (below)
```

`game.wire` is the version of the game's messages and snapshots (game.json `"wire"`, 1 when not given). Raise it by
hand, only when they change meaning (never per build): copies of the game with different numbers are not seated
together, the players see «Онови сторінку — у друга інша версія», and the page with the lower number updates itself
(its offline copy, then a reload back into the room) when no game is open there (a round may run in one, even alone:
over a game the note offers «Оновити») and the room is not nearby, at most once per version in a session. The library
does the same for its own version (`PROTO` in `library/net/config.js`: those rooms do not even link). A library from
before the numbers says none: it counts as version 1.

A room holds up to 8 players, each known by name. A game gets as many seats as its `players` says (2 when not
given): the first players to have it open play, in the room's order; anyone else who opens it waits for a seat
(`room.waiting`) and gets one as soon as a player leaves. `ihroteka.room` is linked (`room.linked`) while we have
a seat and someone else does too:

```js
const room = ihroteka.room;
room.on('linked', () => …)            // we play with someone now (also fires for a listener added later)
    .on('message', (m, from) => …)    // what another player sent, and who (a name); kept until the first listener
    .on('join', name => …)            // one more player (games for more than two; in a game for two,
    .on('leave', name => …)           //   another partner is 'peer-gone' and then 'linked' again)
    .on('players', names => …)        // who plays now, in seat order (also when only who waits changed)
    .on('weak', v => …)               // a player dropped out, went quiet or is opening the game (in a new tab, or back
                                      //   after their place dropped) / is back: pause
    .on('peer-gone', () => …)         // the round stops: our partner (or the runner) is gone, left for good or closed the game
    .on('relinked', name => …)        // a player's copy of the game is new (a new tab or device) or its link started over:
                                      //   send them the full state
    .on('role', r => …)               // the round now runs in another copy: 'host' (ours) or 'guest'
    .on('resume', snap => …)          // we run the round now: go on from its last snapshot (before 'linked', below)
    .on('shared', (key, value) => …)  // a shared value changed, ours too (below)
    .on('pulse', (g, from) => …)      // what another player's room.pulse returned (below)
    .on('stats', s => …)              // the links changed: room.stats() (the slowest player we play with)
    .on('tick', now => …);            // 5 times a second while linked (now: performance.now())
room.me, room.players, room.waiting   // names: us, who plays (in seat order), who waits for a seat
room.seats, room.seated               // how many seats the game has; whether we have one
room.linked, room.weak                // we play with someone now; someone we play with is away or quiet (pause)
room.role, room.host                  // 'host' (our copy runs the round), 'guest', or null (waiting); whose copy runs it
room.away(name)                       // a player we wait for (dropped out, their place kept; or opening the game): for how long, ms
room.snapshot(state)                  // (the runner, about once a second) the round as it is, JSON-able; null: it is over
room.shared('mode'), room.share('mode', 'race')   // what the game's players share: the same for everyone, whoever
                                      //   passes it on and whoever reloads (a chosen mode, a series score…)
room.send({ t: 'move', … });                  // to everyone who plays; reliable: exactly once, in order, even across an outage
room.send({ t: 'pos', … }, { fast: true });   // may be lost or reordered: number it yourself (through the brokers, ≤ 30
                                              //   publishes a second: more wait and go together, see Links)
room.send({ t: 's', … }, { fast: true, latest: 's' })   // each one makes the previous one of stream 's' useless (a full
                                              //   state): through the brokers only the newest goes, ≤ 30 a second
room.send({ t: 'card', … }, { to: name });    // to one player
// send, share and snapshot → true when done, false when refused (not linked, no seat, too big…)
```

**Listening late.** A game that starts listening after things happened (it often does: the room may be linked
before the game's code runs) still hears what it missed, once, in the order the room tells it live: `players`, then
`resume` (if its copy runs a round on), then `linked`, then `weak` (true), then the messages kept for it (up to 64,
in order). `resume` comes before `linked` live too, and only while we play with someone: a game that hears `linked`
already knows whether it goes on with a round or starts afresh.

Seats come from the room's order (`room.players`), not from who runs the round; the same two players in another order
(a shaky network may reorder the room) are still the same round. Whose copy runs a round is shared by the whole room
(that copy names itself with the round's first snapshot, so the room's order does not move it). It moves only when
that copy has been gone for 10 s, and only with proof that it was the runner who dropped out, not us: another player
who has the game open (seated, or waiting for a seat) is here with us, or (over the internet) the brokers have
answered us all that time; and only while we are the room's host or hear it (a player cut off from the room's host
knows the others only as the host last told it: it vouches for nobody until it hears a host again). Then the first
seated player still here takes over and gets `resume` with the latest snapshot; everyone else gets `role`. Two phones
nearby that lose each other cannot tell which of them dropped out, so there the round waits for its runner. A runner
who comes back after the round went on elsewhere plays on as a guest (`role` → 'guest').

**Snapshots.** A game closed mid-round (the room went back to the shelf, a frame was closed or reloaded) waits: when
it is open again, the copy that runs the round hears `resume` with the snapshot, if the players seated are the same
as when it was taken (a snapshot never goes on with someone else's seats). A round is over for good when its runner
says so (`room.snapshot(null)`) or one of its players left the room for good (with the game open or not: back later,
they start a new round): then every player keeps a tombstone in its place, so no older copy (say, kept by a player
who waited for a seat) can bring it back.

**Messages.** A message is a plain JSON-able object with a string `t`; any `t` will do (the library wraps a game's
messages in its own, so the room's own types never clash with them). `send` does nothing (→ false) while
`room.linked` is false. `latest` counts only with `fast`, per player: `true` is one stream, a name is a stream of its
own. The limits are at the call, in bytes of the value's JSON (UTF-8: a Cyrillic letter takes 2): a reliable message
and a snapshot up to 32 KB (32 768 bytes), a shared value up to 8 000 bytes, and up to 32 keys per game (an old key
may always change); over them, the call returns false and nothing goes out (on the dev server the console says why,
once). A reliable message, a snapshot or a shared value that cannot become JSON (a cycle, a BigInt) is a
`TypeError` at the call; each is taken as a copy, so changing the object afterwards changes nothing (and what the room
hands the game, `resume`'s snapshot and shared values, is a copy of its own too). (A fast message is neither copied
nor measured, as it may be lost anyway: hand it a value you will not change.) `share` takes keys of up to 40 letters,
digits, `_` or `-`, and only from a player with a seat.

**Links.** `room.lag(name?)` is the one-way delay in ms (to that player, or the slowest we play with);
`room.stats(name?)` is `{ rtt, peerRtt, direct, relayed, turn, weak }` for that player's link, or the worst of
them; `room.diag()` is a report to copy into a bug report: the site's version, the connection, then the last 40 lines
of what happened (the room's events, what the game was told, the shared keys that changed, snapshot sizes, the page
hidden and shown, errors by type and place; never what a message, a snapshot, a shared value or an error said);
`room.direct`: every player we play with is on a direct link; `room.nearby`: a nearby room (no internet). While a
game is played over the internet, the library itself asks about a quiet direct link (every 50 ms, only while the page
is visible), and the game does nothing for it: one gone silent moves to the brokers in about 0.7 s (1.4 s when the
game does not say `streaming`, below).
The public brokers ban whoever floods them, so the room keeps a **relay budget**: through the brokers, each `latest`
stream goes about 30 times a second at most, and the other fast messages start at most 30 publishes a second per
player (more wait and go together, none dropped; on the dev server the console says so, once). Reliable messages go
at once, and whatever waits rides along. A game that streams state sends it with `latest`: through the brokers, Two
Dragons sends ≈ 30 states a second (the runner) and ≈ 8 aims (the other player) that way.

**Policies and hints** (what a real-time game may set or call; a turn-based one needs none):
- `room.streaming = () => bool`: while it says true, a direct link quiet for 0.35 s (instead of 1.3 s) is doubted:
  if the other player still reaches us through the brokers, messages go that way too (internet rooms). Say true
  while you stream state every frame.
- `room.pulse = now => object | null`: a few fields that ride on the room's pulse, 5 times a second; the other
  side gets them as `pulse`. Pulses are not passed on: in a room of three or more, guests hear only the room's host.
- `room.frame(now)`: an optional hint, every animation frame while playing: a direct link silent for 0.35 s is asked
  about through the brokers at once (internet rooms; `now` is not read: a frame's clock is its own). The library does
  the same by itself while a game is played (see Links), so a game needs it no more.
- `room.kick()`: does nothing, kept for games that call it: the room checks its network by itself when the page is
  shown again, the browser is back online or its network changes.

**A game that breaks.** What a game's window throws (or a promise it leaves rejected), and what its listeners throw,
goes into the trace of `room.diag()`. One that does so while it starts (before its page loaded, or within 5 s after)
leaves no empty screen: the library covers it with «Гра зламалася», a button «Скопіювати звіт» (the report of
`room.diag()`) and «До бібліотеки». (A browser's notice that comes as an error with nothing thrown, a ResizeObserver
loop as the layout settles, is only a line in the trace; so is a promise left rejected because the browser refused or
cut short what the game asked, a `DOMException` `NotAllowedError` or `AbortError`: a sound played before any tap.)

The room's code is `library/net/` (`room.js` describes the room and its rules) and `library/app/together.js`
(what a game sees; the rules of who plays and who runs a round are in `library/app/rules.js`).

### A multiplayer game on it, the way Two Dragons does it

- **One copy runs the round** (`room.role === 'host'`): it steps the game at a fixed rate and sends the whole
  state to the others with `{ fast: true, latest: 's' }`. Make each state self-contained (or repeat the last few
  changes in it), so a lost one costs nothing. The others send only their input (`fast`, numbered, repeated in
  `room.pulse`; Two Dragons sends it as a `latest` stream of its own too), and commands that must arrive (start,
  quit) as plain reliable messages. Through the brokers, the relay budget (see Links) lets 30 states a second through:
  step as fast as you like, the newest goes.
- **Write who plays what into the round** when it starts (names per seat) and read your seat from there: the
  room's order may change on a shaky network, a round's seats must not.
- **Snapshot the round** about once a second (`room.snapshot`) from the runner; on `resume`, go on from it; on
  `role` → 'guest', drop your copy and ask for the full state; on `role` → 'host' with no `resume` right after it (no
  snapshot of the round reached you), there is no round to go on: leave no frozen picture of it.
- **Pause on `weak`**, and send the full state on `relinked` and to a guest who asks. Whom the round waits for, and why,
  the library says itself, in one card over the game («Чекаємо на …», with «Не чекати» when it makes sense): draw no
  waiting message of your own, only your own reasons to pause (a hidden tab, a countdown, or a pause the runner's room
  sees and yours does not: Two Dragons says the link is weak).
- **Show the others a little ahead**: predict both players to the moment your own input will reach the round
  (`room.lag()` is the one-way delay), and when a new state corrects the prediction, let the difference fade
  over ~0.1 s instead of jumping. The runner delays its own input and picture by `room.lag()`, so the round
  feels the same for everyone.
- **Keep settings in `room.share`** (the chosen mode, a series score): everyone sees the same, through reloads.
- **Quitting mid-round ends it for everyone** (send a reliable message, the runner tells the rest). It may miss a runner
  whose copy is reopening (a new tab hears nothing until its game is open), and the round then goes on from its
  snapshot, there or in your copy: remember the round you quit (its players and step) until the runner says it is over,
  say it again when that round's state comes back, and end it with `room.snapshot(null)` if it moves to you.
- **Keep the game's tests with the game** (`games/<id>/test/`): they are sealed with its sources, so a private game
  keeps them private, and `npm run build` runs its `test/*.test.js` (node:test, no browser) first: a game whose tests
  fail is not sealed. Two Dragons does.

### Under it: one room for the whole library

A room is a star: everyone is linked to the room's host, which passes on what guests send. Reliable
messages stay in the sender's outbox until acknowledged and go again by whatever path works (direct, or the
brokers), so a network switch or a minute offline loses nothing; a player who goes quiet pauses the game for
everyone after 1.5 s, and a silence the other path does not explain (a busy phone) never drops the direct link.
A player who drops out keeps their place for 3 minutes (or until someone presses «Не чекати»; a player cut off from
the room's host has it only for the host: their word for anyone else could not reach it). A reload or a closed tab is
dropping out too: of a player's own acts, only leaving the room gives the place up. One who comes back after their
place went counts as opening the game until their page says which game it has open: the game waits for them, then
hears `relinked`. Over the internet, if the room's host is gone for 10 s, the first player still here takes over and
the others follow; when the old host comes back, it joins as a guest. Nearby (no internet), the host pairs with each
guest in turn; the guests hear each other through it, and no one else can take the host's part: the room waits for
the host's phone («Не чекати» for it ends the room on the phone where it is pressed). A phone whose page reloads pairs
again («З’єднатися знову») and is back in its place; the host's phone too: each guest pairs with it again, and the
room goes on.

## Security notes

- The keyring and sealed games are public; strength rests on the passwords (12+ characters, generated by default,
  PBKDF2-SHA-256 × 600 000 with a salt per person, so every guess costs that much per person).
  Who has access (the names in the keyring) and the list of games are public too.
- A leaked password: `npm run user -- passwd` replaces that person's keys and rotates the library key (the old
  keyring stays in git history); `remove` rotates it too. Everyone else's devices keep working without a password.
- Signed-in devices keep a non-extractable key in IndexedDB. Anything served from the same origin
  (`*.github.io` of this account) could use it, so host no untrusted pages there and don't load third-party scripts in games.
- Play together is not encrypted beyond WebRTC's own DTLS; through the brokers, messages are plain and not signed.
  Room topics are hashed, so a room's code is not on the brokers (a page without Web Crypto, plain http, uses the
  code as it is), but whoever watches a room's topic can read it, join it or disturb it. (Sealing it is an open
  decision in [docs/ROADMAP.md](docs/ROADMAP.md).)
  The MQTT client comes from a CDN, pinned to one version and checked with Subresource Integrity.
- A game is trusted code: it runs in a frame on the library's own origin (not sandboxed, with the camera
  allowed), so it can do anything the library page can. Only games of the library's own people belong on it.
- CI runs only actions pinned to a commit, and keeps no git credentials after checkout.

**Deploy:** on every push to `main`, GitHub Actions lints, tests and checks, assembles `site/` and publishes it
(Settings → Pages → Source: *GitHub Actions*). To undo a bad deploy: `git revert` and push; open pages fetch
that version when shown again or within half an hour, and reload into it when that disturbs nobody (on the shelf,
not in a room, no dialog open).

**What next:** [docs/ROADMAP.md](docs/ROADMAP.md) (in Ukrainian): the phases after this one, and the decisions
they need.

## Releases

Each fix deploys on its own, with its test. A commit known to be good is tagged at the end of each phase (`git tag
phase-N`, `git push origin phase-N`). Reports start with the site's version, `Ігротека <commit> <build day>` (`dev` on
the dev server): `room.diag()` (and «Скопіювати звіт» over a game that broke: the same report), and `site` in
`__ihroteka.state()`; the trace that ends a report is also `__ihroteka.trace()`. Rollback: `git revert` (back to a tag: `git revert
--no-commit phase-N..HEAD && git commit`) and push; devices take it when idle, as under **Deploy** above.
