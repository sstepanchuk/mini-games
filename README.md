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
- **Together.** "Грати разом" connects up to 8 players for the whole library: whatever one opens, everyone's
  library opens too. A player is the name they type on entering a room: the same name from another tab, browser
  or device takes that player's place (the old one steps aside and can take it back with «Повернути сюди»). A
  player who drops out keeps their place for 3 minutes; meanwhile the game pauses and the others see who they wait
  for, the time left and «Не чекати». If the copy of the game that runs a round is gone for 10 s, the round goes
  on in another player's copy from its last snapshot, when that player can tell it was not them who dropped out
  (two phones nearby that lose each other wait for the runner instead). The dialog first checks by itself whether
  there is internet (whether a broker answers: `navigator.onLine` also says yes on a hotspot without data). With
  internet there are two ways: a link (public MQTT brokers find the friend; WebRTC goes direct when it can), or
  nearby. Without it, only nearby: two devices on the same Wi-Fi or hotspot, one shows a QR code and the other
  scans it, then the other way round (the first one adds more players the same way). If a nearby link is
  impossible, the dialog says why (e.g. a phone sharing its hotspot cannot see that network in its browser) and
  offers a report for debugging.
- **Offline.** A service worker keeps one complete copy of the site per version; the shelf, the games and nearby
  play work without a network. On a phone it installs as an app.

## Layout

```
library/   everything that runs in the browser
  app/       the library page: shell, password, together (+ rules: who plays, who runs a round), offline copy,
             page template, icons
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
npm run build               # bundle and encrypt the games into vault/, then assemble site/
npm run site                # assemble site/ from library/ and vault/ (no password)
npm run dev -- site         # serve the assembled site/ at localhost:8001 (its offline copy stays off :8000)
npm run check               # validate vault/ (no password)
npm run lint && npm test
npm run e2e                 # browser scenarios against a running dev server (tests/e2e/README.md)
npm run test:games          # Two Dragons' own, sealed with the game (games/dragons/test, after npm run unlock)
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
                     shareDescription, imageAlt, emoji, theme, players: "2" or "2-4")
                     — validated on build
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
ihroteka.game        // { id, title, players: { min, max } }   (game.json "players": "2", "2-4", …)
ihroteka.libraryUrl  // the library's absolute address (its shelf)
ihroteka.home()      // back to the shelf
ihroteka.invite()    // the library's "play together" dialog (room.invite() is the same)
ihroteka.room        // the other players (below)
```

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
    .on('weak', v => …)               // a player dropped out, went quiet or is opening the game in a new tab / is back: pause
    .on('peer-gone', () => …)         // the round is over: our partner left for good, or the runner did
    .on('relinked', name => …)        // a player's copy of the game is new (a new tab or device) or its link started over:
                                      //   send them the full state
    .on('role', r => …)               // the round now runs in another copy: 'host' (ours) or 'guest'
    .on('resume', snap => …)          // we run the round now: go on from its last snapshot
    .on('shared', (key, value) => …)  // a shared value changed, ours too (below)
    .on('pulse', (g, from) => …)      // what another player's room.pulse returned (below)
    .on('stats', s => …)              // the links changed: room.stats() (the slowest player we play with)
    .on('tick', now => …);            // 5 times a second while linked (now: performance.now())
room.me, room.players, room.waiting   // names: us, who plays (in seat order), who waits for a seat
room.seats, room.seated               // how many seats the game has; whether we have one
room.linked, room.weak                // we play with someone now; someone we play with is away or quiet (pause)
room.role, room.host                  // 'host' (our copy runs the round), 'guest', or null (waiting); whose copy runs it
room.away(name)                       // a player who dropped out (their place is kept): for how long, ms
room.snapshot(state)                  // (the runner, about once a second) the round as it is, JSON-able; null: no round
room.shared('mode'), room.share('mode', 'race')   // what the game's players share: the same for everyone, whoever
                                      //   passes it on and whoever reloads (a chosen mode, a series score…)
room.send({ t: 'move', … });                  // to everyone who plays; reliable: exactly once, in order, even across an outage
room.send({ t: 'pos', … }, { fast: true });   // may be lost or reordered: number it yourself
room.send({ t: 's', … }, { fast: true, latest: 's' })   // each one makes the previous one of stream 's' useless (a full
                                              //   state): through the brokers only the newest goes, ≤ 30 a second
room.send({ t: 'card', … }, { to: name });    // to one player
```

Seats come from the room's order (`room.players`), not from who runs the round. Whose copy runs a round is
shared by the whole room. It moves only when that copy has been gone for 10 s, and only with proof that it was the
runner who dropped out, not us: another player is here with us, or (over the internet) the brokers have answered us
all that time and we are the room's host or hear it. Then the first seated player still here takes over and gets
`resume` with the latest snapshot; everyone else gets `role`. Two phones nearby that lose each other cannot tell
which of them dropped out, so there the round waits for its runner. A runner who comes back after the round went
on elsewhere plays on as a guest (`role` → 'guest').

**Messages.** A message is a plain JSON-able object with a string `t`; any `t` will do (the library wraps a game's
messages in its own, so the room's own types never clash with them). `send` does nothing while `room.linked` is
false. `latest` counts only with `fast`, per player: `true` is one stream, a name is a stream of its own. Hand
`send` and `snapshot` a value you will not change afterwards: neither copies it, a reliable message is sent again as
it is then until it arrives, and a snapshot goes out up to half a second later. A reliable message that cannot
become JSON (a cycle, a BigInt) is not refused at the call yet and stalls every later reliable message to that
player (to be fixed, see [the roadmap](docs/ROADMAP.md)). `share` takes values of up to 8 000 characters as JSON,
under keys of up to 40 letters, digits, `_` or `-`, and only from a player with a seat.

**Links.** `room.lag(name?)` is the one-way delay in ms (to that player, or the slowest we play with);
`room.stats(name?)` is `{ rtt, peerRtt, direct, relayed, turn, weak }` for that player's link, or the worst of
them; `room.diag()` is a report of the connection to copy into a bug report; `room.direct`: every player we play
with is on a direct link; `room.nearby`: a nearby room (no internet).

**Policies and hints** (what a real-time game may set or call; a turn-based one needs none):
- `room.streaming = () => bool`: while it says true, a direct link quiet for 0.35 s (instead of 1.3 s) is doubted:
  if the other player still reaches us through the brokers, messages go that way too (internet rooms). Say true
  while you stream state every frame.
- `room.pulse = now => object | null`: a few fields that ride on the room's pulse, 5 times a second; the other
  side gets them as `pulse`. Pulses are not passed on: in a room of three or more, guests hear only the room's host.
- `room.frame(now)`: optional, every animation frame while playing: a direct link silent for 0.35 s is asked about
  through the brokers at once, not at the room's next tick (internet rooms).
- `room.kick()`: the network may have changed: check the broker connections now (a guest also retries the direct
  link soon). The room does it by itself when the page becomes visible again.

The room's code is `library/net/` (`room.js` describes the room and its rules) and `library/app/together.js`
(what a game sees; the rules of who plays and who runs a round are in `library/app/rules.js`).

### A multiplayer game on it, the way Two Dragons does it

- **One copy runs the round** (`room.role === 'host'`): it steps the game at a fixed rate and sends the whole
  state to the others with `{ fast: true, latest: 's' }`. Make each state self-contained (or repeat the last few
  changes in it), so a lost one costs nothing. The others send only their input (`fast`, numbered, repeated in
  `room.pulse`), and commands that must arrive (start, quit) as plain reliable messages.
- **Write who plays what into the round** when it starts (names per seat) and read your seat from there: the
  room's order may change on a shaky network, a round's seats must not.
- **Snapshot the round** about once a second (`room.snapshot`) from the runner; on `resume`, go on from it; on
  `role` → 'guest', drop your copy and ask for the full state.
- **Pause on `weak`**, and send the full state on `relinked` and to a guest who asks.
- **Show the others a little ahead**: predict both players to the moment your own input will reach the round
  (`room.lag()` is the one-way delay), and when a new state corrects the prediction, let the difference fade
  over ~0.1 s instead of jumping. The runner delays its own input and picture by `room.lag()`, so the round
  feels the same for everyone.
- **Keep settings in `room.share`** (the chosen mode, a series score): everyone sees the same, through reloads.
- **Quitting mid-round ends it for everyone** (send a reliable message, the runner tells the rest).
- **Keep the game's tests with the game** (`games/<id>/test/`): they are sealed with its sources, so a private game
  keeps them private. Two Dragons does.

### Under it: one room for the whole library

A room is a star: everyone is linked to the room's host, which passes on what guests send. Reliable
messages stay in the sender's outbox until acknowledged and go again by whatever path works (direct, or the
brokers), so a network switch or a minute offline loses nothing; a player who goes quiet pauses the game for
everyone after 1.5 s, and a silence the other path does not explain (a busy phone) never drops the direct link.
A player who drops out keeps their place for 3 minutes (or until someone presses «Не чекати»). Over the internet,
if the room's host is gone for 10 s, the first player still here takes over and the others follow; when the old
host comes back, it joins as a guest. Nearby (no internet), the host pairs with each guest in turn; the guests hear
each other through it, and no one else can take the host's part: the room waits for the host's phone.

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
the dev server): `room.diag()`, and `site` in `__ihroteka.state()`. Rollback: `git revert` (back to a tag: `git revert
--no-commit phase-N..HEAD && git commit`) and push; devices take it when idle, as under **Deploy** above.
