# 🎲 Ihroteka

A tiny private game library. The library is public; its games are end-to-end encrypted and open with a
password. Play alone, together over the internet, or side by side with no internet at all. Installs as an app
and works offline. Hosted on GitHub Pages.

**[Open](https://sstepanchuk.github.io/mini-games/)** · [🐉 Two Dragons](https://sstepanchuk.github.io/mini-games/dragons/) ·
[❌ Хрестики-нулики](https://sstepanchuk.github.io/mini-games/tic-tac-toe/)

## How it works

- **One page.** The library is a single page: the shelf, and the open game in a frame. Leaving a game never
  reloads the library, so the connection with a friend lives on from game to game.
- **Encrypted games.** Each game and its sources are sealed with one library key (AES-256-GCM). Each person has
  a password and an ECDH P-256 key pair; the password unlocks their private key, which unlocks the library key.
  Removing someone rotates the library key and re-encrypts every game. A game is gzipped before it is sealed; where
  the browser cannot gunzip (Safari before 16.4: iPhones on iOS 15–16.3), a small gunzip (`lib/inflate.js`, from
  fflate) loads for it, and only there, so iOS 15 is the lowest (whether the internet rooms' MQTT client runs there is
  not checked). A game that does not open says why over it, with «Спробувати ще», which opens it again on this device
  only. A password cancelled in a room takes everyone back to the shelf only from the player who opened the game; anyone
  else stays over it, with «Цю гру відкрили в кімнаті. Щоб грати, потрібен пароль.» and «Ввести пароль».
- **Together.** "Грати разом" connects up to 8 players for the whole library: whatever one opens, everyone's library
  opens too. A player is the name they type on entering a room, in one spelling: apostrophes become ’, invisible and
  control characters go (emoji stay), several spaces become one, the first letter a capital; a name with no letter,
  digit or emoji, or «*», is refused («Ім’я має містити літери, цифри чи емодзі»), and a name already in play is never
  changed. In a sentence of a dialog a name cannot turn the line around. The same name from another tab, browser or
  device takes that player's place: another tab of the same browser at once; another browser or device, while the old
  one is still on the line, asks first («Богдан уже грає в кімнаті з іншого пристрою. Це ти?» — «Так, грати тут» or
  «Інше ім’я»), and the old one says what happened («Під іменем «Богдан» щойно увійшли з іншої вкладки або з іншого
  пристрою, тож гра продовжується там. Якщо це не ти — увійди під іншим ім’ям», with «Інше ім’я», over the internet
  also «Повернути сюди»); coming back after the line broke asks nothing. A player who drops out keeps their place
  for 3 minutes; meanwhile the game pauses and the library says whom the others wait for and why, in the game's own
  waiting screen (`<ihroteka-wait>`), or in its card over a game that has none: one who dropped out, the time left and
  «Не чекати» (nearby, for the phone that holds the room, «Не чекати» ends the room on this phone: «Кімнату поруч
  тримав телефон, на якому грає X: без нього вона далі не може»), or one who is only opening the game again, in a new
  tab or device («X повертається в гру», nothing to press); a player of the round whose game is closed (named also
  while the others play on), a seat to wait for and who plays now, a round coming back after a reload (ours, or «Аня
  повертає гру з того місця, де ви зупинилися…»), too: every name in the nominative, which never turns its line round
  (see "Waiting screens"). If the copy of the game that runs a
  round is gone for 10 s, the round goes on in another player's copy from its last snapshot, when that player can tell
  it was not them who dropped out (two phones nearby that lose each other wait for the runner instead). The dialog
  first checks by itself whether there is internet (whether a broker answers: `navigator.onLine` also says yes on a
  hotspot without data). With internet there are two ways: a link (public MQTT brokers find the friend; WebRTC goes
  direct when it can), or nearby. Without it, only nearby: two devices on the same Wi-Fi or hotspot, one shows a QR
  code and the other scans it, then the other way round (the first one adds more players the same way). The camera
  goes on at the first step already (with it iPhones and Chrome offer the devices' real addresses, so phones nearby
  link more often), and the dialog says so («Браузер може спитати дозволу на камеру: вона знадобиться на кроці 2, і з
  нею пристрої поруч з’єднуються надійніше»); it is off while the page is hidden and on again when the player is back.
  A guest that shows its code waits for it to be read as long as the two devices reach each other: after 90 s it says
  «Друг ще не зчитав твій код — хай наведе на нього камеру», and a late scan still links. If a nearby link is
  impossible, the dialog says why (e.g. a phone sharing its hotspot cannot see that network in its browser, the
  newcomer has the name of the phone that holds the room: «Це ім’я вже в кімнаті», or the other phone gave up or closed
  its page: «Друг скасував з’єднання або закрив сторінку. Спробуйте ще раз.») and offers a report for debugging; a
  browser that cannot link directly (no WebRTC, as Tor Browser) is told so up front on the nearby screen: «Цей браузер
  не вміє з’єднуватися напряму: відкрий Ігротеку в Chrome, Safari чи Firefox». Friends whose libraries (or copies of a
  game) are different versions are not linked (or not seated together), and each page says its own part while that
  version is heard: the older «У друга новіша версія — онови сторінку», with «Оновити» (over the game and in «Грати
  разом»), the newer «У друга старіша версія — хай оновить сторінку»; the older page updates itself when that disturbs
  nobody (no game open, no password being typed), never in a nearby room (see Versions, under Game API). Whoever holds
  a room by link and is alone again sees «Друг вийшов. Посилання діє
  далі — чекаю…» in «Грати разом» (not «Ви разом.»). The library's dialogs leave a game's fullscreen as they open (and
  so does the card «Чекаємо…» over a game without screens of its own); its notes at the bottom stack in a column (up to
  three, the same one never twice); «Далі» with no name says «Напиши своє ім’я» under the field.
- **Offline.** A service worker keeps one complete copy of the site per version, all of that version (a copy that
  mixes two is not installed), and never deletes the copy in use for a newer one; the shelf, the games and nearby
  play work without a network. On a phone it installs as an app. A library that does not open (no network and no
  offline copy yet, the site not answering) says why instead of turning for ever, with «Спробувати ще», and tries
  again by itself as soon as the network is back.

## Layout

```
library/   everything that runs in the browser
  app/       the library page: shell, password, together (+ rules: who plays, who runs a round; round: ihroteka.round,
             a game's rounds; waiting, screens: the waiting screens a game puts in itself; trace: what happened
             lately, for bug reports), offline copy, page template, icons; inflate: a gunzip for Safari before 16.4
             (built as lib/inflate.js, loaded only there)
  net/       rooms for up to 8 players: internet (MQTT, sealed with the room's code, + WebRTC) and nearby (QR-paired
             WebRTC)
  crypto.js  keyring and sealed files (browser and Node)
  game-api.js  window.ihroteka, injected into every game
tools/     cli.js (commands) · repo.js (keys, sealed files) · build.js (bundling, site, checks) · dev.js (local server)
           · devnet.js (the dev server's fake network) · migrate.js (keyring format steps) · perf.js (a performance
           report) · png.js (covers) · prompt.js (questions at the terminal) · template/ (a new game: cli new)
tests/     unit tests (npm test); api-surface.json: the Game API, pinned; e2e/: browser scenarios (prod/: the
           assembled site; fixtures/probe: an open game for them)
docs/      ROADMAP.md: the plan and the owner's decisions (in Ukrainian)
vault/     what the repository keeps: keyring.json, and per game game.json, its cover,
           game.bin (the built game, encrypted) and source.bin (its sources but the public cover beside it, encrypted)
games/     plaintext game sources (local only, git-ignored)
site/      the site, assembled from library/ and vault/ (git-ignored; CI assembles it on every push)
```

## Usage

```sh
npm install                 # Node 22 or newer (as CI)
npm run unlock              # decrypt game sources into games/; after git pull, it updates them and keeps your edits
npm run dev                 # the library with your plaintext games at localhost:8000
npm run dev -- --devnet     #   the same, and tabs play together without internet (?devnet in the address does it too)
npm run new -- <id>         # a new game in games/<id>, from tools/template (see "Adding a game")
npm run build               # run each game's own tests, bundle and encrypt the games into vault/, then assemble site/
                            #   (a game whose tests fail is not sealed; -- --no-tests skips them; a vault/<id> that
                            #   changed since your last unlock or build is not sealed over: npm run unlock, or -- --force)
npm run site                # assemble site/ from library/ and vault/ (no password)
npm run dev -- site         # serve the assembled site/ at localhost:8001 (its offline copy stays off :8000)
npm run check               # validate vault/ (no password)
npm run lint && npm test
npm run e2e                 # browser scenarios against a running dev server (tests/e2e/README.md; -- @ci: CI's set)
npm run e2e -- --prod       # the production path: the assembled site, online and offline (npm run dev -- site)
npm run test:games          # every game's own unit tests (games/*/test/*.test.js, sealed with it; after npm run unlock)
npm run test:games:e2e      # every game's browser scenarios (games/*/test/e2e, against the dev server; -- <id>: one)
npm run perf -- dragons     # a performance report next to docs/perf-reference.json (-- --profile wifi; not a gate)
npm run migrate             # bring an old vault/keyring.json up to today's format

npm run user -- list | add <name> | remove <name> | passwd
node tools/cli.js remove-game <id> --yes   # off the shelf: vault/<id> deleted, games/<id> kept in games/.removed/
```

Set `VAULT_PASSWORD` to skip the prompt. A change to `library/` needs no password at all: commit it, and CI
assembles the site again. CI also runs the browser scenarios, in Chromium and in WebKit, as a workflow of its own
(`.github/workflows/e2e.yml`) that does not hold up the deploy: with no password there, the dev server serves an open
probe game (`npm run dev -- --probe`) and the production path runs without opening a sealed game.

**Building together.** `games/` is each person's own; `vault/` is shared through git. After `git pull`, `npm run
unlock` brings `games/` up to date with what someone else built and keeps your own edits (it names them, and leaves a
game you both changed as it is: `npm run unlock -- --force` takes the vault's; the same edit on both sides is no
conflict). Each `games/<id>/.vault-base` (local,
never sealed) records which version that folder was last unlocked or built from, so `npm run build` refuses to seal a
`games/<id>` that is behind `vault/<id>` over it; `npm run build -- --force` seals yours anyway. A folder from before
`.vault-base` is recorded by the next build while it matches the vault; one that differs is refused until you take a
side (`npm run unlock -- --force`, or `npm run build -- --force`).

**devnet.** Playing together needs the public brokers, so with no internet the dev server can fake them: `npm run dev
-- --devnet` (every library page), or `?devnet` in the address (that browser from then on, until `?devnet=0`). The
fake brokers (`tools/devnet.js`) link the tabs of one browser; direct links stay real WebRTC. A «devnet» tag in the
corner says it is on. Only the dev server puts it into a page: the assembled site never has it (`tests/devnet.test.js`).

The dev server (games mode) registers no service worker, and answers `/sw.js` with one that removes itself: an
offline copy left on the same address by `dev -- site` cannot hide your edits. Every link it prints has one origin,
`http://localhost:<port>/` (a page's storage, its sign-in and offline copy, is per origin). A `game.json` that does not
read leaves only that game off the shelf (the console says why; its own page, `/<id>/`, answers with the reason). A
port can be given (`npm run dev -- 8002`, `npm run dev -- site 8003`). `--lan` serves to your network over plain
http, where browsers turn off the camera (no QR scanning; a code can be typed) and Web Crypto: a page without it plays
nearby only, and «Грати разом» says why (no internet room: it could neither find the room's topic nor seal its
traffic). To try a real phone, forward the port instead and open `http://localhost:8000/` on it: localhost counts as
secure. Android: `adb reverse tcp:8000 tcp:8000` (or chrome://inspect → Port forwarding).

## Adding a game

From nothing to two players on screen, then on the shelf:

1. `npm run unlock`: the plaintext sources of the games already on the shelf (the build seals every game at once).
2. `npm run new -- <id> --title "Назва"` (`--players 2-4` for more than two): `games/<id>/` from `tools/template`, a
   small turn-based game that plays alone on one device or together. `<id>` becomes the URL, `/<id>/`.
3. `npm run dev`, then `http://localhost:8000/<id>/`: the game in the library, on one device.
4. Two players, no internet needed: `npm run dev -- --devnet`, the same address in two tabs; in one, «Грати разом» →
   «Через посилання», open its link in the other. The game opens on both. (A real phone: forward the port, see
   Usage.)
5. The rules: `rules.js`, with no page and no network, so `test/*.test.js` (node:test) checks them:
   `npm run test:games`.
6. The page: `index.html`, `style.css`, `main.js`. `main.js` shows how a game lives on its rounds (`ihroteka.round`,
   "Game API" below): one copy runs the round (`round.runs`) and sends its state (the others show only what that copy
   sends), the others send their moves; it saves the round after each move (`round.save`) and ends it with
   `round.over`, goes on from the snapshot `run` brings, sends a new copy of a player everything on `rejoin`, and sets
   its one rule (`round.policy.endWhenSeatGone`: a player gone for good ends the round, as their turn would never
   come). Buttons rather than a canvas where you can: they work with a keyboard and a screen reader. Where the page
   should say whom it waits for, it has `<ihroteka-wait></ihroteka-wait>` (the template's is under its title, seen
   in the lobby and in a round): the library fills it; draw no such message yourself (see "Waiting screens").
7. `game.json` (validated by the dev server and the build):
   - `title`, `tagline`, `description`, `image`; optional `shareTitle`, `shareDescription`, `imageAlt`, `emoji`,
     `theme`, `players` (`"2"` or `"2-4"`; 2 when not given);
   - `wire`: the version of the game's messages and snapshots, 1 when not given: raise it by hand when they change
     (see "Game API");
   - `api`: the Game API version it is written for (`new` writes the library's); `camera: true` only if the game
     itself uses the camera, `microphone: true` only if it uses the microphone (see Trust).
8. `preview.png`: replace the placeholder with a 1200×630 picture of the game (the shelf, and link previews).
9. `npm run build` (the password): the game's tests first (a game whose tests fail is not sealed), then one page per
   game, sealed into `vault/<id>/`. Try the assembled site: `npm run dev -- site` (its Content-Security-Policy, its
   offline copy) and `npm run e2e -- --prod`.
10. Commit `vault/` (never `games/`: it is git-ignored, its sources go sealed into `vault/<id>/source.bin`) and push:
    CI checks the vault, assembles the site and deploys it. To take a game off the shelf again: `node tools/cli.js
    remove-game <id> --yes` (its plaintext sources are kept in `games/.removed/`).

```
games/<id>/          <id> becomes the URL: /<id>/
  game.json          as in 7
  index.html         <script type="module">, <style> and <link rel="stylesheet"> are bundled inline
  preview.png        1200×630, used on the shelf and in link previews
  test/*.test.js     the game's own tests (node:test), sealed with it
```

The build inlines everything into one page: start with `<!doctype html>`, keep assets next to `index.html`, and let
modules import what they use. Module scripts (from a file or inline) and styles (`<style>` and `<link
rel="stylesheet">`) are bundled; a relative URL in the page's own markup (`src`, `href`, `xlink:href`, `poster`,
`background`, `data`, a `style="…url(…)"`) becomes a `data:` URL when it names a media file next to the page, and fails the build
otherwise (and so do a `srcset` of local files, use `src`, and a `<script src>` from elsewhere: the site's policy
refuses it, see Trust). What is inside a script or a style is code, not markup: a string in it that names a file next
to the game (`'img/hero.png'`) is not there on the site, and the build warns about it. The build also names a cover
that is not 1200×630, or is still the placeholder of `npm run new`.

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
ihroteka.round       // the game's rounds: who plays one, whose copy runs it, its snapshots (below, "The round")
<ihroteka-wait>      // where the library says whom we wait for (below, "Waiting screens")
```

`game.wire` is the version of the game's messages and snapshots (game.json `"wire"`, 1 when not given). Raise it by
hand, only when they change meaning (never per build): copies of the game with different numbers are not seated
together. The library does the same for its own version (`PROTO` in `library/net/config.js`: those rooms do not even
link). A library from before the numbers says none: it counts as version 1. The number that counts is that of the
game's code that runs in the frame (`ihroteka.game.wire`: its page's own, built into it; a `game.bin` from before the
numbers speaks 1): a page left open over a deploy is seated by the copy it runs, not by the number its shelf had; the
shelf's counts only for a page that says none.

**Versions.** While another version is heard, each page says its own part (owner, decisions 9 and 37): the older «У
друга новіша версія — онови сторінку», with «Оновити» (over the game, and in «Грати разом»), the newer «У друга старіша
версія — хай оновить сторінку»; nearby, where no update can come, both add «…, коли буде інтернет». Over a game only a
gap in that game or in the library is said; another game's is said on the shelf (decision 35: a note, once per gap in
a room, and the chip in short words). A game that one of the
shelves has and the other not (a deploy added it or took it off), open in the room, is a version gap too, and which
page is the older the site says, not the shelf (the shell asks whether the site has a newer version than the page:
decision 36): over the game, the page that has it says «Богдан не може відкрити цю гру: там інша версія Ігротеки» (naming
whoever lacks it), and Богдан's, on its shelf, «У кімнаті відкрили гру, якої тут немає». The older page updates itself (its offline copy,
then a reload back into the room) when no game is open there (a round may run in one, even alone), the password
dialog is not open (a reload would throw away what is typed: the game opens on the old version, with «Оновити»;
decision 38) and the room is not nearby, at most once per version in a session. It reloads only once the newer copy is
in place: an update that cannot be stored or fetched leaves the page as it is and says why, «Бракує місця на пристрої
для нової версії Ігротеки: звільни трохи місця й натисни «Спробувати ще»» or «Не вдалося завантажити нову версію:
перевір інтернет», with «Спробувати ще» (that version is not tried again by itself); when the site has nothing newer
yet, it tries again by itself a minute later. And a page whose offline copy was updated under it (a deploy while it
stayed open) reloads into the new one as soon as that disturbs nobody: on the shelf, no dialog open, and no room or an
internet one, which it comes straight back into (the others see it «повертається» for a moment); never nearby, where a
reload would end the room.

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
    .on('peer-gone', () => …)         // (deprecated as a round's end: ihroteka.round) nobody to play with any more: our
                                      //   partner (or the runner) is gone, left for good or closed the game
    .on('relinked', name => …)        // (deprecated: round 'rejoin') a player's copy of the game is new (a new tab or
                                      //   device) or its link started over: send them the full state
    .on('role', r => …)               // (deprecated: round 'run'/'watch') the round now runs in another copy: 'host' (ours) or 'guest'
    .on('resume', snap => …)          // (deprecated: round 'run') we run the round now: go on from its last snapshot (before 'linked')
    .on('shared', (key, value) => …)  // a shared value changed, ours too (below)
    .on('pulse', (g, from) => …)      // what another player's room.pulse returned (below)
    .on('stats', s => …)              // the links changed: room.stats() (the slowest player we play with)
    .on('tick', now => …);            // 5 times a second while linked (now: performance.now())
room.me, room.players, room.waiting   // names: us, who plays (in seat order), who waits for a seat
room.seats, room.seated               // how many seats the game has; whether we have one
room.linked, room.weak                // we play with someone now; someone we play with is away or quiet (pause)
room.role, room.host                  // (deprecated: round.runs, round.runner) 'host' (our copy runs the round), 'guest', or
                                      //   null (waiting); whose copy runs it
room.away(name)                       // a player we wait for (dropped out, their place kept; or opening the game): for how long, ms
room.snapshot(state)                  // (deprecated: round.save) (the runner, about once a second) the round as it is,
                                      //   JSON-able; null: it is over
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
its part in a round of `ihroteka.round` that is on (`run` or `watch`), then `resume` (if its copy runs a round of
`room.snapshot` on), then `linked`, then `weak` (true), then the `end` of a round it was in and has not heard (below,
"The round": last, as live, so that what a game shows of it is not wiped by its `linked`), then the messages kept for
it, in order: every reliable one (up
to 8 × 32 KB of them: past that the newest are dropped, and the trace says so, as the dev console does once) and the
newest 64 fast ones. `resume` comes before `linked` live too, and only while we play with someone: a game that hears
`linked` already knows whether it goes on with a round or starts afresh.

**Deprecated.** `room.host`, `room.role`, `room.snapshot` and the events `resume`, `role` and `relinked` (and
`peer-gone` as the end of a round) are the rounds of contract 4, kept as they are for the games that use them (today
only the browser scenarios' probe, `tests/e2e/fixtures/probe`, which keeps them tested in CI; both games on the shelf
and `cli new`'s template keep their rounds with `ihroteka.round`): a new game keeps its rounds with `ihroteka.round`
(below), which says the same things per round. They go in a later
step of the contract (docs/ROADMAP.md, phase 5); the two kinds of round do not know of each other, so a game keeps its
rounds one way (on the dev server, the console says so once if it calls both).

Seats come from the room's order (`room.players`), not from who runs the round (while a round of `ihroteka.round` is
on, from that round: below); the same two players in another order (a shaky network may reorder the room) are still the
same round. Whose copy runs a round is shared by the whole room
(that copy names itself with the round's first snapshot, so the room's order does not move it). It moves only when
that copy has been gone for 10 s, and only with proof that it was the runner who dropped out, not us: another player
who has the game open (seated, or waiting for a seat) is here with us, or (over the internet) the brokers have
answered us all that time; and only while we are the room's host or hear it (a player cut off from the room's host
knows the others only as the host last told it: it vouches for nobody until it hears a host again). Then the first
seated player still here takes over: its copy hears `role` ('host') and, at once (in the same task), `resume` with the
latest snapshot (no `resume`: there is no round to go on, show the lobby); the others see the
change in `room.host`. Two phones nearby that lose each other cannot tell which of them dropped out, so there the
round waits for its runner. A runner who comes back after the round went on elsewhere plays on as a guest (`role` →
'guest').

**Snapshots.** A game closed mid-round (the room went back to the shelf, a frame was closed or reloaded) waits: when
it is open again, the copy that runs the round hears `resume` with the snapshot, if the players seated are the same
as when it was taken, but for those who have left the room since (a game for three goes on with the two still here; a
snapshot never goes on with someone else in a seat). A round is over for good when its runner
says so (`room.snapshot(null)`) or one of its players left the room for good (with the game open or not: back later,
they start a new round; a game for more than two that has it open hears `leave` instead and decides for itself: it
may end the round, `room.snapshot(null)`): then every player keeps a tombstone in its place, so no older copy (say,
kept by a player who waited for a seat) can bring it back. The others get the runner's snapshots at most twice a
second, and the latest at once when the game closes or the page goes or is hidden: a reload goes on from the last
move (a page that is killed, with no goodbye, may still lose its last half second). What a page that goes still has
to send leaves in its last words, one packet of about 64 KB (`library/net/brokers.js`): with 3 or more players, a
snapshot over about 32.6 KB (3 players) or 21.7 KB (4) fits there only for the first of the others, in seat order;
the first of them is the one who takes the round over, and the round's snapshots go to everyone from there (the same
for `ihroteka.round`'s saves).

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
hidden and shown, errors by type and place; never what a message, a snapshot, a shared value or an error said; a
flag that keeps flipping, a link that flaps, is one line, counted; errors outlast the other lines);
`room.direct`: every player we play with is on a direct link; `room.nearby`: a nearby room (no internet). While a
game is played over the internet, the library itself asks about a quiet direct link (every 50 ms, only while the page
is visible), and the game does nothing for it: one gone silent moves to the brokers in about 0.7 s (1.4 s when the
game does not say `streaming`, below).
The public brokers ban whoever floods them, so the room keeps a **relay budget**: through the brokers, each `latest`
stream goes about 30 times a second at most, and the other fast messages start at most 30 publishes a second per
player (more wait and go together, none dropped; on the dev server the console says so, once). Reliable messages
through the brokers go together at the end of the task that sent them (a burst of 2000 is a few publishes), with
whatever else waits for that player, in order, in publishes of at most ~16 KB of JSON (bytes of UTF-8; one bigger
message goes alone: a broker drops a packet over its limit whole); the link's own (acknowledgements, pings) go at once.
What is not acknowledged goes again together, at most 32 KB a tick; to a player we no longer hear, only a probe now and
then (the oldest one), and everything they missed as soon as they are heard again. More than 5000 waiting with none
acknowledged for 3 s (they cannot be hearing us), or 50 000 waiting at all, starts the link over (`relinked`: the full
picture again); a host keeps no new reliable message for that link until it has. A game that streams state sends it
with `latest`: through the brokers, Two Dragons sends ≈ 30 states a second (the runner) and ≈ 8 aims (the other
player) that way.

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
(what a game sees; the rules of who plays and who runs a round are in `library/app/rules.js`; `ihroteka.round` is
`library/app/round.js`).

### The round: `ihroteka.round`

The room carries messages; the round says who plays a round, whose copy runs it and where it stands, the same for every
player and through reloads (`library/app/round.js`, its invariants at its top). Every game gets it (game.json `api` 4);
a game that keeps its rounds with `room.snapshot` needs none of it.

```js
const round = ihroteka.round;
round.on('start', ({ id, seats, setup, by }) => …)   // a round has just begun (before its first save), to every copy
     .on('run', ({ id, seats, setup, state }) => …)  // our copy runs it: state null, fresh (begin it from seats and
                                                     //   setup); else go on from its snapshot
     .on('watch', ({ id, seats, runner }) => …)      // another copy runs it (also one without a seat in it: mySeat -1)
     .on('rejoin', name => …)                        // (our copy runs it) one of its players has a new copy of the
                                                     //   game (a new tab or device, back in the game, a new link): send
                                                     //   them everything
     .on('end', ({ id, by, reason, result }) => …);  // it is over: 'over' (the runner's over(result)), 'quit' (by whom),
                                                     //   'gone' (by: the player whose place went; policy below), 'lost'
                                                     //   (its snapshot on no device), 'closed' (our room closed, its end
                                                     //   never reached us, or another round replaced it: below); also
                                                     //   once to a copy opened after it (below, Events)
round.off('run', fn)                                 // that listener no more (on and off return the round: they chain)
round.active, round.id                               // a round is on (for us: not one we quit); its id (null between rounds)
round.seats, round.mySeat, round.seatOf(name)        // its players by name, in seat order, frozen at its start (null
                                                     //   between rounds); our seat, theirs: -1 when not in it
round.runner, round.runs                             // whose copy runs it; ours does. Between rounds: whose copy starts
                                                     //   the next one (null while nobody plays with us)
round.start(setup?, { seats }?)                      // a new round of the players seated now (seats: the same players in
                                                     //   another order), with the game's setup (JSON, up to 8 000 bytes)
round.save(state)                                    // (round.runs) the round as it is, JSON, up to 32 KB: kept by its players
round.over(result?)                                  // (round.runs) its rules ended it: 'end' { reason: 'over', result }
round.quit()                                         // (one of its players) it ends for everyone: 'end' { reason: 'quit', by }
round.policy.startNeedsEveryone = true               // rules for the library to apply for the game (below): none by default
round.policy.endWhenSeatGone = true
// start, save, over, quit → true when done (start: or asked of round.runner), false when refused (a round is on or
// not, nobody to play with, not ours to call, too big, a policy says no…; on the dev server the console says why, once)
```

**Events.** Each round tells a copy of the game `start` once, while it has not been saved yet (a copy that comes later
does not hear it), then exactly one of `run` and `watch`, told again only when the round moves to another copy, and
`end` once (an end is final for everyone, whatever happened meanwhile; only `closed` says we lost sight of the round:
back in a room where it is still on, the game hears its part again, and its end later). A copy of the game that opens
after the end of a round it had a part in (the page reloaded meanwhile, or the game was closed and opened again), or
whose code did not listen to `end` yet when it came, hears that `end` once, with its `by`, `reason` and `result`
(owner, decision 49): after `players` and, when it plays with someone, after `linked` (Two Dragons wipes its note
there), else a second later. The tab remembers which round its game had a part in (sessionStorage `ihroteka-heard`,
with the room and the name), so a new tab or another device does not hear it, and nothing is heard twice. A game that
starts listening late hears its part (`run` or `watch`) once, after `players` and before `linked` and the messages kept
for it (see Listening late); and while our copy should run a round but has no snapshot
of it yet (its page reloaded: the others' copies are on their way), the game hears nothing of it, messages included,
until `run` with the snapshot: never a fresh `run` for a round that was saved. So `round.active` true before `run` or
`watch` means a round is coming back (after 1 s the screens say «Повертаю гру…», `restoring`): offer no start then
(`start` is refused while a round is on).

**One record, one writer.** A round is one record the whole room shares (`round:<game>`: its id, players, runner,
whether it is on); only the copy that runs it writes it. A start or a quit from another player is a request to that
copy: a start names the round it follows and is taken only if the runner's answer comes back within 5 s of asking, by
the asker's clock (a start that waited out an outage starts nothing); a quit names its round and holds until that round
is over (said again whenever we link with its runner, and every 2 s while its runner is here: what the room's host was
passing on is lost when a link starts over; if the round moves to our copy, ours ends it). A quit follows the player
(owner, decisions 24 and 50): it is the player's own key in the room's shared state (`quit:<name>` = { game: round id },
written only by them), so whoever holds the room keeps it for them, the runner back ends that round (and a copy the
round moves to ends it rather than run it on), and the player's other tab or device takes it as theirs; and the browser
keeps it (localStorage `ihroteka-quits`: one entry per room and name, for every tab of the browser), so a page back in
that room as that player, a reload or a new tab, says it again (its game hears nothing of that round: it heard its end
before). The honest limit: two players, the quit said while the runner is away, then the player goes on on another
device: nobody else holds it, and the round comes back on with its runner. So the browser keeps every end our copy
writes (quit, over, gone, lost), until another copy shows it back to us (each copy whose record it changed sends it
back to its writer): a page that reloads before anyone else has it knows that round is over, and ends it again as soon
as it sees it on. (Only a player of a round ends it again so; a copy that watches leaves it to them.) The round moves as
the room's runner does (above): its runner away for 10 s with proof, or at once when its player left the room for good;
the copy that runs it on hears `run` with the latest snapshot and signs it as its own. Cut off from each other, one
side's runner may end a round and begin the next while the other side runs the old one on (or ends it its own way):
together again, the newer round stays, whatever the clocks (decision 46), and its record says how the round before it
ended (`prev`), so the copy that ran the old one on hears its real end (`end` 'quit' by Аня, say; never `closed`), then
watches the new one. (Only a round it knew was over comes back as the older one: a runner cut off while its round was
run on, ended and followed by others never writes its round over them when it is back.) Two halves of a room may also each start a round, if each has players to start one with (3 or more
with the game open, say): together again, one record wins, and the other round ends for its players as `closed`: it
does not come back (rare: decision 47).

**Seats are frozen.** While a round is on, the game's seats (`room.players`) are its players who have the game open, in
its order, and nobody else's: a player away or with the game closed keeps their seat, and anyone else who opens the game
waits (`watch`, `mySeat` -1) and gets a seat when the round is over. The room's order (a shaky network may change it)
moves nothing. Between rounds, seats come from the room's order, as above. A copy that watches without a seat has the
round's getters and events, but none of the game's messages (they reach only who plays); a message to everyone with the
game open, spectators too, is reserved for later (docs/ROADMAP.md, phase 5).

**Snapshots.** `save(state)` (taken as a copy) goes to the round's players at most twice a second (the latest; at once
when the game closes or the page goes or is hidden), tagged with the round's id, its writer and the game's `wire`. A
copy keeps one only from the runner its record names, and runs a round on only from a snapshot of that round: a round
never comes back with another round's state, nor after it is over. A game closed mid-round waits: opened again, the
runner's copy hears `run` with the snapshot (and `rejoin` for each player whose copy opens after its own). A round that
was saved and whose snapshot is on no device any more (every other player of it is here without one, or gone for good;
one who is away may have it; whoever keeps one passes it on when its runner left for good) ends after 15 s, `lost`. A round never saved goes on fresh in whatever copy runs it.

**No rules but the game's.** The library decides nothing a game did not ask for. `quit()` ends the round for everyone
because that is what it is for: a game whose round goes on when a player leaves does not call it. Everything else is
off until the game sets it in `round.policy` (in every copy, before a round starts):
- `startNeedsEveryone`: `start` is refused while a seated player is away or still opening the game (the runner refuses
  such a request too). Two Dragons' rule.
- `endWhenSeatGone`: a round ends (`end` { reason: 'gone', by: that player }) as soon as one of its players' place goes
  for good (they left, «Не чекати», or 3 minutes away), also while nobody has the game open. Without it the round stays
  on, the game hears the room's `leave` (more than two seats) or `peer-gone`, and decides: `over()`, or wait (the same
  name back is the same player, in the same seat).

A countdown, a series score, who goes first: the game's own (`setup`, `room.share`).

**A turn-based game on the round** (the way Хрестики-нулики does it; the rules are a pure module with its tests):

```js
const lib = window.ihroteka, round = lib && lib.round;   // undefined outside the library: play on one device
let G = null;                                            // the board, or null: the lobby
round.on('run', ({ seats, setup, state }) => { G = state ?? newGame(seats, setup); share(); })
     .on('watch', () => { G = null; draw(); })           // the runner's copy sends the board
     .on('rejoin', name => lib.room.send({ t: 'board', g: G }, { to: name }))
     .on('end', ({ reason, result }) => { G = null; lobby(reason, result); });
lib.room.on('message', (m, from) => {
  if (round.runs && m.t === 'move') play(round.seatOf(from), m.cell);   // a move counts for the seat of who sent it
  else if (m.t === 'board' && from === round.runner) { G = m.g; draw(); }
});
const move = cell => round.runs ? play(round.mySeat, cell) : lib.room.send({ t: 'move', cell });
function play(seat, cell) {
  const next = place(G, seat, cell);                     // null: not that seat's turn, or not a free cell
  if (next) { G = next; share(); if (winner(G) !== null) round.over({ winner: winner(G) }); }
}
function share() { round.save(G); lib.room.send({ t: 'board', g: G }); draw(); }
startButton.onclick = () => round.start();               // false while a round is on
```

### Waiting screens: `<ihroteka-wait>`

Whom a game waits for, and why, the library says, in the same words and with the same buttons for every game (owner,
decision 6 (c), «Спільний набір екранів»): in the game's own page, where the game puts `<ihroteka-wait></ihroteka-wait>`,
or, for a game that has none, in the library's card over the game. Never both, and never next to a line of the game's
own that says the same: at most one waiting message at any moment. The library decides the words, the facts and the
buttons; the game decides where the screen sits and how it looks. It is part of contract 4 (additive, as
`ihroteka.round` was: `ihroteka.version` stays 4): `game-api.js` defines the element in the game's own window before its
page is parsed (`library/app/screens.js` does the rest); outside the library it is never defined, an empty unknown
element that shows nothing.

| kind        | what it says                                                       | buttons                                                    |
|-------------|--------------------------------------------------------------------|------------------------------------------------------------|
| `link`      | «Чекаємо, поки повернеться X… 2:45»: X dropped out, their place kept that long. Nearby, where pairing again works (on the phone that holds the room; on a guest whose own link to it broke): «Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.»; a guest cut off from that phone, with others in the room, has only its row, «Кімнату поруч тримає телефон, на якому грає X: без нього не чути й інших.»; another guest sees the cut-off one's row with «Кіра і Ганна мають з’єднатися ще раз кодами.»; a guest waiting for a seat gets the row of the phone that holds the room too | «З’єднатися знову» (pairing again) only where it works; «Не чекати» (their place goes) where it works from here |
| `loading`   | «X повертається в гру»: back in a new tab or device, their game not open there yet | none (owner, decision 4) |
| `closed`    | «X зараз не в грі — чекаємо»: a player of our round, in the room, whose game is closed (after 2 s: following the room into a game takes a moment), while nobody we play with has it open, or it is the round's runner; «X зараз не в грі» while others play on with us (a game for 3+: whether the round goes on without them is the game's rule; decision 52) | none: the game's own quit (`round.quit()`) is the way out |
| `restoring` | «Повертаю гру з того місця, де ви зупинилися…»: our copy runs a saved round (a reload) and its snapshot has not come for 1 s; «Аня повертає гру з того місця, де ви зупинилися…»: Аня's copy, the round's runner, waits so for it while ours has none to send (when it comes, the round runs on; one on no device ends it, `lost`, after 15 s) | none |
| `seat`      | «Ти чекаєш на місце», and «Грають зараз: Аня і Богдан.» (while a round is on, its players still in the room) | none |
| `version`   | each page its own part (see Versions): «У друга новіша версія — онови сторінку», «У друга старіша версія — хай оновить сторінку» (nearby «…, коли буде інтернет»); why our update did not happen («Бракує місця…», «Не вдалося завантажити нову версію: перевір інтернет»); a game one shelf lacks: «Аня не може відкрити цю гру: там інша версія Ігротеки» | «Оновити» on the older page (not nearby); «Спробувати ще» after an update that did not happen |

Rows come in that order (players we play with, then the round's own, then the rest); names are joined «Аня», «Аня і
Богдан», «Аня, Богдан і Віра». A name always stands in the nominative (a name cannot be declined, and the words have no
gender: decision 42), without direction controls, and each name in a row is isolated (`<bdi>`): one written right to
left never turns the rest of its line round, the time included. A screen reader hears the rows (never the time) from
one live region of the library's page, wherever they show, also while a library dialog is open; each second only the
time changes.

**Where it shows.** Put a copy wherever the player looks in each state of the game (in each menu panel, over the field):
any number of copies, in static HTML or made later (`document.createElement('ihroteka-wait')`). The library puts its
rows into one of them at a time, the holder: the one that holds them while it is still seen, else the first seen copy
in document order. Seen: visible (not `display:none`, `visibility:hidden` or `opacity:0`, on every engine), in the
frame's view, and on top at the centre of its first row and of each of its buttons in view (a copy under the game's own
overlay is not, nor one whose «Не чекати» a bar of the game's covers: it could not be pressed). Every other copy stays
empty, and an empty copy takes no room. When no copy is seen, the card over the game says every row instead; a game
that never placed the element gets the card as it always was (`link` and `loading` of whom we play with, and
`version`), so a game built before the screens is never doubled. Until the game's page has parsed (`DOMContentLoaded`),
only the version shows, on the card. While a library dialog is open, the holder stays as it is. The card stands 16 px
above the bottom edge of the game, on an iPhone with a home bar too. The library looks again when a copy comes or goes
and when a copy or its parent changes size (a menu panel around it shown or hidden), in the game's next animation
frame, and each second for what no observer sees (a layer over the holder, scrolling); it observes nothing anew and
resizes nothing inside the browser's delivery of size changes, so a copy may come and go anywhere, in the game's own
`ResizeObserver` callback or a `showing` listener too, and the browser has no «ResizeObserver loop» to report.

**What it says now.** On every copy, the attribute `showing` is the kinds said now, each once, in row order
(`showing="link version"`), wherever they show (this copy, another one, or the card); absent when nothing is said. Read
it as the game's code starts (it is there by then); the event `showing` (a plain `Event` of the game's window, on every
copy, no bubbling) fires when what is said changes (a row came or went, its who, why, buttons or players changed;
never for the time), after the rows are in place: a listener sees the final page, and may move focus or show another
copy. It waits for the game's page to have parsed: what is said as the game opens is heard then, once (a listener added
as the game's scripts run hears it). A game quiets its own waiting lines with one selector:

```js
const libSays = () => !!document.querySelector('ihroteka-wait[showing]:not([showing=version])');   // players, the round, a seat
for (const w of document.querySelectorAll('ihroteka-wait')) w.addEventListener('showing', draw);
```

**The markup** the library puts into the holder (the same as its card's; these hooks are pinned in
`tests/api-surface.json` "screens"):

```html
<div class="wait-row" data-kind="link" data-name="Богдан">          <!-- data-name: a row about a player -->
  <p>Чекаємо, поки повернеться <bdi>Богдан</bdi>… <span class="wait-time">2:45</span></p>   <!-- .wait-time: link only -->
  <p class="fine">Зв’язок поруч сам не відновиться: з’єднайтеся ще раз кодами.</p>   <!-- nearby link; seat -->
  <button type="button" class="btn">З’єднатися знову</button>
  <button type="button" class="btn ghost" aria-label="Не чекати, поки повернеться Богдан">Не чекати</button>
</div>
```

Its look is the game's: `.wait-row`, `.wait-time`, `.fine`, `.btn`, `.btn.ghost`, `data-kind`, `data-name` and
`[showing~=seat]` for its own CSS (font, colour and box are inherited from where the copy sits), say `.wait
[data-kind=seat] .fine{display:none}` to hide a line the game already shows. The library adds one `<style
data-ihroteka-wait>` to the game's `<head>`: `ihroteka-wait:empty{display:none!important}`, and at zero specificity
(`:where`: any rule of the game's wins) a block, rows that wrap and centre with a small gap, paragraphs without
margins, a time that never breaks, and the small line on a line of its own. That style is there only inside the
library: a game that gives the element a box (padding, a border, a background) also says
`ihroteka-wait:empty{display:none}` itself (without `!important`), so its page opened on its own shows no empty box.

**Rules for a game:**
1. Leave the element empty: the library replaces anything put in it.
2. Never set `display` with `!important`, or `display:contents`, on the element, nor `pointer-events:none` on it or
   around it: the library would count it as unseen, and the card would say it instead.
3. Put a copy where the player looks in each state. A copy under the game's own overlay counts as unseen, so the next
   copy (or the card) takes the rows: a copy inside the layer that covers the others is found at once, and a layer
   that appears over the holder without holding a copy is noticed within a second.
4. Draw none of the six kinds yourself: hide your own pause or waiting lines while
   `ihroteka-wait[showing]:not([showing=version])` exists (a version note alone is no waiting message).
5. Keep it out of a `role=dialog aria-modal` layer unless a copy is inside that dialog, or a screen reader cannot reach
   its buttons.

A real-time game, the way Two Dragons does it: a copy in each menu panel, in flow, and one over the field, below the
menu's overlay (positioned where a banner would be): with the menu open, the field's copy is covered and the open
panel's holds the rows; with it closed, the field's. Its pause banner shows only its own reasons, and only while the
library says nothing (`libSays()`), redrawn on `showing`. A turn-based one, the way Хрестики-нулики does: one copy right
under its status line; the status says nothing of waiting for a seat or for a closed game, and the page redraws on
`showing` (which also puts the focus back where it belongs).

**Accessibility.** The copies are plain text and buttons in the game's reading and Tab order; what is said is
announced once, from the library page's live region (the game's own status lines go quiet, which announces nothing).
A row stays while only its time changes, so a focused «Не чекати» keeps its focus; a row that goes takes its focus
with it (to the game's `<body>`): the `showing` event lets the game put it back. When the rows move between a copy and
the card (a layer of the game's covers the copy, or goes), a focused button's focus goes with them, to the same button
of the same row (unless a `showing` listener put it elsewhere). For a screen reader «Не чекати» is «Не чекати, поки повернеться X»
(its `aria-label`, the name in the nominative as in the row; the words on it stay). A screen that appears never takes the focus, and Esc does nothing to it
(owner, decision 8). A game that moves the focus on `showing` does so only while `document.hasFocus()` (the page may
be in another window, or a library dialog over it), and puts it back on the window's `focus` too; it listens on one
copy that stays (the event fires on every copy).

**On the dev server** the console says so, once: `ihroteka-wait: leave it empty: the library fills it` (something was
put in a copy), and `ihroteka-wait: none of this game's waiting screens is seen (hidden, covered or out of view): the
library's card over the game says it instead`.

### A multiplayer game on it, the way Two Dragons does it

- **One copy runs the round** (`round.runs`): it steps the game at a fixed rate and sends the whole state to the
  others with `{ fast: true, latest: 's' }`. Make each state self-contained (or repeat the last few changes in it), so
  a lost one costs nothing. The others send only their input (`fast`, numbered, repeated in `room.pulse`; Two Dragons
  sends it as a `latest` stream of its own too). Starting and quitting are the round's (`round.start`, `round.quit`),
  not messages of the game's own. Through the brokers, the relay budget (see Links) lets 30 states a second through:
  step as fast as you like, the newest goes.
- **Seats are the round's**: draw and steer by `round.mySeat`, credit input by `round.seatOf(from)`, and write
  `round.seats` into the round's own state when it begins: the room's order may change on a shaky network, a round's
  seats do not. A player waiting for a seat hears `watch` with `mySeat` -1: show them who plays, never them on a seat.
- **Save the round** about once a second (`round.save`) from the runner, and `round.over()` when its rules end it.
  On `run`, go on from `state` (null: begin it from `seats` and `setup`); on `watch`, drop your copy of it and take
  pictures only from that runner (an old runner back after the round was quit must not pull you back in); on `rejoin`,
  send that player the full picture. A copy that runs the round on after a reload numbers its pictures above the old
  copy's (Two Dragons: from the snapshot's, plus a margin), so the others take them.
- **Pause on `weak`**. Whom the round waits for, and why, the library says itself, in the game's `<ihroteka-wait>`
  (or its card over a game that has none: «Чекаємо, поки повернеться …», with «Не чекати» when it makes sense; see "Waiting
  screens"): draw no waiting message of your own, only your own reasons to pause (a hidden tab, a countdown, or a pause
  the runner's room sees and yours does not: Two Dragons says the link is weak), and those only while the library says
  nothing. A partner whose game closed mid-round (`room.linked` false, `round.active` true): the screen says «X зараз не
  в грі — чекаємо» (after 2 s); the round stands still and goes on when they are back.
- **Show the others a little ahead**: predict both players to the moment your own input will reach the round
  (`room.lag()` is the one-way delay), and when a new state corrects the prediction, let the difference fade
  over ~0.1 s instead of jumping. The runner delays its own input and picture by `room.lag()`, so the round
  feels the same for everyone.
- **Keep settings in `room.share`** (the chosen mode, a series score): everyone sees the same, through reloads; pass
  the mode a round is played in as its `setup`.
- **Say your rules** in `round.policy`, in every copy: Two Dragons and Хрестики-нулики set `startNeedsEveryone` (no
  start while a player is away) and `endWhenSeatGone` (a player gone for good ends the round), and quit with
  `round.quit()` (the round ends for both, also when the quit reaches a runner whose copy is reopening: the library
  says it again).
- **Keep the game's tests with the game** (`games/<id>/test/`): they are sealed with its sources, so a private game
  keeps them private, and `npm run build` runs its `test/*.test.js` (node:test, no browser) first: a game whose tests
  fail is not sealed. Both games do; their browser scenarios are in `test/e2e/` too, each with its `run.cjs` (`npm run
  test:games:e2e` runs every game's; `-- tic-tac-toe pair`: one game's, some of them).

### Under it: one room for the whole library

A room is a star: everyone is linked to the room's host, which passes on what guests send. Reliable messages stay in
the sender's outbox until acknowledged and go again by whatever path works (direct, or the brokers), so a network
switch or a minute offline loses nothing; a player who goes quiet pauses the game for everyone after 1.5 s, and a
silence the other path does not explain (a busy phone) never drops the direct link. A player who drops out keeps their
place for 3 minutes (or until someone presses «Не чекати»; a player cut off from the room's host has it only for the
host: their word for anyone else could not reach it). A reload or a closed tab is dropping out too: of a player's own
acts, only leaving the room gives the place up. One who comes back after their place went counts as opening the game
until their page says which game it has open: the game waits for them, then hears `relinked`. «Не чекати» over the
internet for a player whose page is still open (it hears the room, the room does not hear it) tells that page nothing:
while it is not heard it waits for the room as before, and once it is heard again it comes back as a new player, as
after 3 minutes away; a round stays with whoever ran it. A page reloaded while every other player is away remembers
the room (internet rooms: its tab keeps who was in it, their places and the round, in sessionStorage): when nobody
answers it, it takes them back as away, their 3 minutes counted from when they dropped out, so its screens wait for
them with «Не чекати» and the round stays paused, not a new game on one device. Over the internet, if the room's host
is gone for 10 s, the first player still here takes over and the others follow; when the host's player comes in from
another device while the old one is offline, the others go over to it at once (~0.3 s; a round's runner still moves
only by its own rule); when the old host comes back, it joins as a guest, and so does a player who was offline and
held the room alone meanwhile (in a room of two, the side that was offline comes back as a guest). Two rooms on one
code that grew apart merge, and the one that gives way brings its places along (those a reloaded page took back too):
a player away in it is away in the merged room, their place held for the rest of their 3 minutes, so nobody sees the
others leave and a round goes on. The room checks its brokers at once when the browser says it is online again or its
network type changed, even if it checked them a moment before. A page Safari restores from its back-forward cache (its
sockets closed, its goodbye said) is in its internet room again at once: a guest says hello again, a host joins
whoever took the room over meanwhile (or goes on, if nobody did). A hidden tab whose timers the browser holds back (a
tick a minute) still notices a player who went silent, as long as it hears someone else: that shows the page itself
ran. Nearby (no internet), the host pairs with each guest in turn; the guests hear each other through it, and no one
else can take the host's part: the room waits for the host's phone («Не чекати» for it ends the room on the phone
where it is pressed). A phone whose page reloads pairs again («З’єднатися знову») and is back in its place; the host's
phone too, also one whose page crashed (a guest pairs again as soon as its old link is broken or silent, though the
browser may keep its channels open a while): each guest pairs with it again, and the room goes on.

## Trust

A game is fully trusted code. Its page runs in a frame of the library's own origin, not sandboxed (on the site a
`srcdoc` frame, on the dev server its own address, `/<id>/?frame`), so it can do anything the library page can: read
and change what the library keeps on the device (IndexedDB with the key that opens the games, the offline copy, local
storage), call the library page directly (`parent.__ihroteka`, anything on `parent`), act as its player in the room,
and send whatever it likes wherever it likes. `window.ihroteka` is a convenience, not a boundary. Only games of the
library's own people belong on it. Sandboxed frames with a message API are an open decision, for when games come from
other authors ([docs/ROADMAP.md](docs/ROADMAP.md), 23). The trust goes the other way too: the library page writes into
the game's document (the rows of its waiting screens, one `<style data-ihroteka-wait>`, the `showing` attribute: see
"Waiting screens"), as same-origin trusted code; the policy below has no `style-src`, so that style is allowed.

What the page does close, against mistakes rather than against a game:
- **Scripts.** The page's Content-Security-Policy (a `<meta>` in `library/app/page.html`; a game's `srcdoc` frame
  inherits it) runs the site's own scripts, inline ones and `blob:` ones the page makes, and from elsewhere only the
  pinned MQTT client (the two URLs of `MQTT_LIB` in `library/net/config.js`: upgrade both together, `npm test` fails
  while they differ). Workers come from the site or from `blob:` (the MQTT client keeps its timers in one); `blob:` is
  in `script-src` too because Safari before 15.5 (older iPhones) knows no `worker-src` and judges a worker by
  `script-src` (it adds nothing a page that runs inline code could not do). No `eval`, `new Function`, `setTimeout`
  with a string, or WebAssembly; no `<object>` or `<embed>`; no `<base>` pointing elsewhere. Styles, images, fonts,
  media and connections are not limited. A game that makes code from strings is refused (the console says what), and
  one with a `<script src>` from elsewhere does not build: bundle it instead (the build inlines module scripts and what
  they import). The dev server gives its pages the same policy (a game's page there, `/<id>/?frame`, comes from its
  own address: it gets the policy as a header), so what the site refuses fails in dev too.
- **The camera and the microphone.** A game's frame may use fullscreen, the screen wake lock, autoplay and gamepads;
  the camera only when its `game.json` says `"camera": true`, and the microphone only when it says
  `"microphone": true` (no game does: the library's own QR scanner runs in the library page). Otherwise the frame says
  `camera 'none'` and `microphone 'none'`: a frame of the same origin has both unless told otherwise.

## Security notes

- The keyring and sealed games are public; strength rests on the passwords (12+ characters, generated by default,
  PBKDF2-SHA-256 × 600 000 with a salt per person, so every guess costs that much per person).
  Who has access (the names in the keyring) and the list of games are public too.
- A leaked password: `npm run user -- passwd` replaces that person's keys and rotates the library key (the old
  keyring stays in git history); `remove` rotates it too. Everyone else's devices keep working without a password.
- Signed-in devices keep a non-extractable key in IndexedDB. Anything served from the same origin
  (`*.github.io` of this account) could use it, so host no untrusted pages there and don't load third-party scripts in games.
- A device is asked for the password once, as long as it keeps the key: not in a private window, and Safari forgets a
  site not added to the home screen after 7 days without a visit. Storage that does not answer in time (Safari, now and
  then) is not taken for «nothing remembered»: the dialog shows, keeps asking the storage (for about a minute), and
  closes by itself, opening the game, when the key comes after all. While the password is checked (a cheap phone may
  take seconds) the dialog says «Відмикаю…», and after a second «Відмикаю… Це може тривати кілька секунд.» (a status line,
  there and empty before, so a screen reader hears the first words too); «Скасувати»
  (or Escape, or a tap outside) meanwhile stores nothing. «Забути пароль на цьому пристрої» marks the device first: if
  its storage did not answer, the next page finishes the forgetting; if neither could be written, the button stays, with
  «Не вдалося забути пароль. Закрий вкладку й спробуй ще раз.». A person removed from the keyring can open no game
  sealed after that (their device's offline copy keeps opening the games it already has until it updates); once their
  device sees the new keyring, it forgets the key and its dialog says «Доступ до ігор із цим паролем закрили. Якщо тобі
  дали новий пароль — введи його.», and a device whose person's password was changed «Твій пароль змінили. Введи
  новий.», until a password fits or the player forgets it.
- A report (`room.diag()`, «Скопіювати звіт») names the room's players; the report of a nearby pairing («Скопіювати
  звіт для розробника») says the browser and the devices' local network addresses. Share one as you would those.
- Play together over the internet is sealed end to end (`library/net/seal.js`, owner's decision 10): the room's code
  is its key. PBKDF2-SHA-256 × 40 000 of the code (salt: `ihroteka room ihroteka`, the same for every room of the
  library) gives, through HKDF, the room's topic on the brokers and its AES-256-GCM key; every packet is sealed and
  bound to its topic, its sender and its number. A player drops a packet that does not open, one whose number it has
  taken already, and one far older than what that sender sent since (a window of 2048 numbers per sender, kept as long
  as the page lives: one back in its room takes nothing again). Whoever watches the public brokers (their operators
  too) sees which topics are busy, random per-tab sessions, the numbers, sizes and timing of the packets, and the
  addresses that connect; not the code, the names, the messages or the addresses in a direct link's offer, and a
  packet they make or alter is dropped. What they can still do: send a recorded packet again to a player who never
  heard its sender (one who came later); so a host's announcement to everyone is only answered, never followed, and a
  stranger cannot move a room that way. Direct links are WebRTC's own DTLS; nearby rooms use no brokers. A page
  without Web Crypto (plain http) makes no internet room at all.
- Whoever has a room's link is in the room: the code is the only secret. New codes have 8 characters of 31 (8.5·10^11);
  one key costs a cheap phone about 0.1 s (an estimate: 21 ms in Node on a 2.8 GHz server core, `room.diag()` says
  what it took on a device), and one high-end GPU about 2·10^5 codes a second, so a table of every 8-character code
  takes it about 45 days, and would open every room with such a code at once (one salt for all). A link of a room from
  before (6 characters, still taken) falls in about an hour: «Грати разом» makes a new code rather than reuse one that
  short.
- A page of the library from before the seal (`PROTO` 1) on the same code meets nobody: each page listens to every topic
  of that older kind (one wildcard for all rooms, which says nothing about its own), and only when such a page speaks on
  its room's one does it answer there, in plain: its version, from a session of its own, nothing else. The older page
  then says (in its release's words) «Онови сторінку — у друга інша версія» and updates itself. (That page's own topic
  is a plain hash of its code: its traffic was readable before the seal, and is until it updates; and one GPU reverses
  that hash for every 8-character code in minutes, so while such a page speaks on a code, whoever watches can learn the
  code, and with it open the sealed room on it too.)
- The MQTT client comes from a CDN, pinned to one version and checked with Subresource Integrity.
- A game is fully trusted code (see **Trust** above): only games of the library's own people belong on it.
- CI runs only actions pinned to a commit, and keeps no git credentials after checkout.

**Deploy:** on every push to `main`, GitHub Actions lints, tests and checks, assembles `site/` and publishes it
(Settings → Pages → Source: *GitHub Actions*). To undo a bad deploy: `git revert` and push; open pages fetch
that version when shown again or within half an hour, and reload into it when that disturbs nobody (on the shelf, no
dialog open, and no room or an internet one, which the page comes straight back into; never nearby).

**What next:** [docs/ROADMAP.md](docs/ROADMAP.md) (in Ukrainian): the phases after this one, and the decisions
they need.

## Releases

Each fix deploys on its own, with its test. A commit known to be good is tagged at the end of each phase (`git tag
phase-N`): `phase-0` … `phase-5` are in the local repository (`phase-1b` … `phase-5` at 5dcc8f7, cda3312, da117f3,
63e7fe6, 1a26d49 and 83c352a), but GitHub refused tags pushed from a Claude session (403): the owner pushes them (`git
push origin --tags`), and until then a rollback to a tag works only in a clone that has them. The mixed-version
tests (`tests/app/release.test.js`, `tests/net/version.test.js`: an earlier library against this one) take that
library from `main`'s history (the one before the library's last change; a library edited and not committed yet
plays against `HEAD`'s, the one it replaces), so they need no tag; CI fetches the whole history for them and fails
if its history is shallow (locally, a shallow clone skips them and says why). Reports start with the site's version, `Ігротека <commit>
<build day>` (`dev` on the dev server): `room.diag()` (and «Скопіювати звіт» over a game that broke: the same report),
and `site` in `__ihroteka.state()`; the trace that ends a report is also `__ihroteka.trace()`. Rollback: `git revert`
(back to a tag: `git revert --no-commit phase-N..HEAD && git commit`) and push; devices take it when idle, as under
**Deploy** above.
