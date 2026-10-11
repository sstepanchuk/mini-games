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
- **Together.** "Грати разом" connects two players for the whole library: whatever one opens, the other's
  library opens too. Over the internet: a link (public MQTT brokers find the friend; WebRTC goes direct when
  it can). Nearby, no internet: two phones on the same Wi-Fi or hotspot show each other a QR code.
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
                     shareDescription, imageAlt, emoji, theme) — validated on build
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
ihroteka.version     // 2
ihroteka.game        // { id, title }
ihroteka.home()      // back to the shelf
ihroteka.invite()    // the library's "play together" dialog
ihroteka.room        // the other player (below)
```

`ihroteka.room` is linked while both players have this game open:

```js
const room = ihroteka.room;
room.on('linked', () => …)            // both are here (also fires for a listener added later)
    .on('message', m => …)            // what the other player sent
    .on('weak', quiet => …)           // they went quiet / came back: pause and wait
    .on('peer-gone', () => …)         // they left this game
    .on('relinked', () => …);         // they reopened it in a new tab: send them the full state
room.role                             // 'host' (usually runs the game) or 'guest'
room.send({ t: 'move', … });                  // reliable: arrives exactly once
room.send({ t: 'pos', … }, { fast: true });   // may be lost or reordered: number it yourself
```

Messages are plain objects with a string `t`. Also: `pulse`, `stats` and `tick` events; `room.lag()`,
`room.stats()`, `room.diag()`, `room.nearby`, `room.direct`; and policies a game may set: `room.keepSeat`,
`room.patient`, `room.streaming`, `room.pulse` (see `library/net/room.js`).

## Security notes

- The keyring and sealed games are public; strength rests on the passwords (12+ characters, generated by default).
  Who has access (the names in the keyring) and the list of games are public too.
- A leaked password: `npm run user -- passwd` replaces that person's keys; `remove` also rotates the library key.
- Signed-in devices keep a non-extractable key in IndexedDB. Anything served from the same origin
  (`*.github.io` of this account) could use it, so host no untrusted pages there and don't load third-party scripts in games.
- Play together is not encrypted beyond WebRTC's own DTLS; through the brokers, messages are plain. Room topics are hashed.
  The MQTT client comes from a CDN, pinned to one version and checked with Subresource Integrity.

**Deploy:** on every push to `main`, GitHub Actions lints, tests and checks, assembles `site/` and publishes it
(Settings → Pages → Source: *GitHub Actions*).
