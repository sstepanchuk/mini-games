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
  on in another player's copy from its last snapshot. The dialog first checks by itself whether there is internet
  (whether a broker answers: `navigator.onLine` also says yes on a hotspot without data). With internet there are
  two ways: a link (public MQTT brokers find the friend; WebRTC goes direct when it can), or nearby. Without it,
  only nearby: two devices on the same Wi-Fi or hotspot, one shows a QR code and the other scans it, then the
  other way round (the first one adds more players the same way). If a nearby link is impossible, the dialog says
  why (e.g. a phone sharing its hotspot cannot see that network in its browser) and offers a report for debugging.
- **Offline.** A service worker keeps one complete copy of the site per version; the shelf, the games and nearby
  play work without a network. On a phone it installs as an app.

## Layout

```
library/   everything that runs in the browser
  app/       the library page: shell, password, together, offline copy, page template, icons
  net/       two-player rooms: internet (MQTT + WebRTC) and nearby (QR-paired WebRTC)
  crypto.js  keyring and sealed files (browser and Node)
  game-api.js  window.ihroteka, injected into every game
tools/     cli.js (commands) · repo.js (keys, sealed files) · build.js (bundling, site, checks) · dev.js (local server)
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
npm run dev -- site         # serve the assembled site/
npm run check               # validate vault/ (no password)
npm run lint && npm test

npm run user -- list | add <name> | remove <name> | passwd
```

Set `VAULT_PASSWORD` to skip the prompt. A change to `library/` needs no password at all: commit it, and CI
assembles the site again.

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
(`undefined` when a game page is opened on its own, so treat it as optional):

```js
ihroteka.version     // 4
ihroteka.game        // { id, title, players: { min, max } }   (game.json "players": "2", "2-4", …)
ihroteka.home()      // back to the shelf
ihroteka.invite()    // the library's "play together" dialog
ihroteka.room        // the other players (below)
```

A room holds up to 8 players, each known by name. A game gets as many seats as its `players` says (2 when not
given): the first players to have it open play, in the room's order; anyone else who opens it waits for a seat
(`room.waiting`) and gets one as soon as a player leaves. `ihroteka.room` is linked while we have a seat and
someone else does too:

```js
const room = ihroteka.room;
room.on('linked', () => …)            // we play with someone now (also fires for a listener added later)
    .on('message', (m, from) => …)    // what another player sent, and who (a name)
    .on('join', name => …)            // one more player (games for more than two; in a game for two,
    .on('leave', name => …)           //   another partner is 'peer-gone' and then 'linked' again)
    .on('players', names => …)        // who plays now, in seat order
    .on('weak', v => …)               // a player dropped out, went quiet or is opening the game in a new tab / is back: pause
    .on('peer-gone', () => …)         // the round is over: our partner left for good, or the runner did
    .on('relinked', name => …)        // a player's copy of the game is new (a new tab or device) or its link started over:
                                      //   send them the full state
    .on('role', r => …)               // the round now runs in another copy: 'host' (ours) or 'guest'
    .on('resume', snap => …)          // we run the round now: go on from its last snapshot
    .on('shared', (key, value) => …); // a shared value changed (below)
room.me, room.players, room.waiting   // names: us, who plays (in seat order), who waits for a seat
room.role, room.host                  // 'host' (our copy runs the round), 'guest', or null (waiting); whose copy runs it
room.away(name)                       // a player who dropped out (their place is kept): for how long, ms
room.snapshot(state)                  // (the runner, about once a second) the round as it is, JSON-able; null: no round
room.shared('mode'), room.share('mode', 'race')   // what the game's players share: the same for everyone, whoever
                                      //   passes it on and whoever reloads (a chosen mode, a series score…)
room.send({ t: 'move', … });                  // to everyone who plays; reliable: exactly once, in order, even across an outage
room.send({ t: 'pos', … }, { fast: true });   // may be lost or reordered: number it yourself
room.send({ t: 'card', … }, { to: name });    // to one player
```

Seats follow the room's order, not who runs the round: a game draws "player 1" for `room.players[0]` whoever
its host is. Whose copy runs a round is shared by the whole room; it changes only when that copy has been gone
for 10 s (the first player still here takes over and gets `resume` with the latest snapshot; everyone else gets
`role`), or when that player comes back and the round already went on elsewhere.

Messages are plain objects with a string `t` (not starting with `_`). Also: `pulse` (with who) `stats` and `tick`
events; `room.lag(name?)`, `room.stats(name?)` (one player, or the slowest), `room.diag()`, `room.nearby`,
`room.direct`, `room.seats`, `room.seated`; and policies a game may set: `room.streaming`, `room.pulse` (see
`library/net/room.js`).

Under it, a room is a star: everyone is linked to the room's host, which passes on what guests send. Reliable
messages stay in the sender's outbox until acknowledged and go again by whatever path works (direct, or the
brokers), so a network switch or a minute offline loses nothing; a player who goes quiet pauses the game for
everyone after 1.5 s, and a silence the other path does not explain (a busy phone) never drops the direct link.
A player who drops out keeps their place for 3 minutes (or until someone presses «Не чекати»). If the room's
host is gone for 10 s, the first player still here takes over and the others follow; when the old host comes
back, it joins as a guest. Nearby (no internet), the host pairs with each guest in turn; the guests hear each
other through it.

## Security notes

- The keyring and sealed games are public; strength rests on the passwords (12+ characters, generated by default,
  PBKDF2-SHA-256 × 600 000 with a salt per person, so every guess costs that much per person).
  Who has access (the names in the keyring) and the list of games are public too.
- A leaked password: `npm run user -- passwd` replaces that person's keys and rotates the library key (the old
  keyring stays in git history); `remove` rotates it too. Everyone else's devices keep working without a password.
- Signed-in devices keep a non-extractable key in IndexedDB. Anything served from the same origin
  (`*.github.io` of this account) could use it, so host no untrusted pages there and don't load third-party scripts in games.
- Play together is not encrypted beyond WebRTC's own DTLS; through the brokers, messages are plain. Room topics are hashed.
  The MQTT client comes from a CDN, pinned to one version and checked with Subresource Integrity.
- CI runs only actions pinned to a commit, and keeps no git credentials after checkout.

**Deploy:** on every push to `main`, GitHub Actions lints, tests and checks, assembles `site/` and publishes it
(Settings → Pages → Source: *GitHub Actions*).
