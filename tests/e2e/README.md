# Browser scenarios

Real browser pages (Chromium; WebKit too) against a running library, for what unit tests cannot show: players
linking up, dropping out, taking each other's places, the "Грати разом" dialog; and the assembled site as players get
it (`prod/`). They test the library only; each game's own scenarios are sealed with it (`games/<id>/test/e2e`: `npm run
test:games:e2e` runs every game's, `games.cjs`).
CI runs them on every push (`.github/workflows/e2e.yml`, a workflow of its own: it does not hold up the deploy):
those tagged `@ci` in Chromium, those tagged `@webkit` in WebKit, against `npm run dev -- --probe` (CI has no
password, so no sealed game: an open probe game instead) and the assembled site.

## Running

```sh
npm run dev                       # first, in another terminal: the library at http://127.0.0.1:8000/
npm run e2e                       # every scenario, two at a time, then a summary
npm run e2e -- names ui           # some of them
npm run e2e -- @ci                # those tagged @ci (a scenario's first line: // tags: @ci @webkit)
npm run e2e -- -j 1               # one at a time (slow machine)
node tests/e2e/names.e2e.cjs      # one, directly
E2E_URL=http://127.0.0.1:8001/ npm run e2e     # another server (npm run dev -- 8001, or npm run dev -- site)

npm run dev -- --probe            # as CI does: the probe game on the shelf (tests/e2e/fixtures/probe) …
E2E_GAME=probe npm run e2e -- @ci # … and the scenarios that open a game open it
E2E_BROWSER=webkit npm run e2e -- @webkit      # in WebKit (npx playwright install webkit; not on every machine)

npm run site && npm run dev -- site            # the assembled site at http://localhost:8001/ (E2E_SITE_URL) …
npm run e2e -- --prod             # … and the production path (tests/e2e/prod); VAULT_PASSWORD (from the
                                  #   environment only) also opens a sealed game offline
```

Each scenario prints its checks (`✓`, `✗`, and `· todo` for a known bug that does not fail it yet), then `PASS` or
`FAIL`, and exits non-zero on a failed check, a timeout, or an error on any page it watches (every page `openPage`
opens): an uncaught one, or the page's code calling `console.error`, as the library does with a failure it catches
(the browser's own messages, a 404 or a refused script, do not count, nor does `console.warn`; `crash` checks the rule
itself first). One that cannot run here (no site, no fake camera in WebKit) says `SKIP` and exits with 77. `run.cjs`
exits non-zero if any scenario failed; Ctrl+C (or any SIGINT, SIGTERM, SIGHUP) stops the scenarios it runs, and a
scenario so stopped still removes what it made (a scratch copy, its dev server).

Needs Playwright (a devDependency: `npm install`, then `npx playwright install chromium`; or a global one).
`nearby3` opens the first game on the shelf, and `version`, `card`, `crash` and `trust` open Two Dragons (or the game
`E2E_GAME` names), so they need the dev server with the plaintext games (`npm run unlock`) or the probe: on the
assembled site (`npm run dev -- site`) the games are locked and they fail; the others pass there too. `newgame`,
`newgame3`, `template` and `screens` run a dev server of their own. The nearby scenarios need Chromium's fake camera.
Whom a game waits for is read wherever it shows (`support/pages.cjs` `waitShown`, `waitBox`, `clickWait`): the
library's card over the game, or the game's own `<ihroteka-wait>` (README "Waiting screens"); never both.

| scenario   | what                                                                                                  |
|------------|-------------------------------------------------------------------------------------------------------|
| `reliable` | net level, 3 players: reliable messages across an outage, a network switch and the host offline: all arrive, in order, once |
| `multi`    | net level, 4 players: one roster, forwarding, a message to one player, the host leaving (takeover), a reload |
| `names`    | net level: places by name, a new tab taking a place, the host away (takeover, back as a guest), «Не чекати», the host's new tab |
| `nosig`    | the chip and status when no broker answers (the network itself up), and back                           |
| `insecure` | a page without Web Crypto (plain http, `--lan`): «Грати разом» offers nearby only and says why; a room link opened there makes no internet room («Лише через https», a note, the dialog says why), sends nothing to the brokers, and the friend keeps waiting |
| `ui`       | the dialog: without internet only nearby, with internet two ways; a link and nearby both link up       |
| `tabs`     | the same player in a new tab (host, then guest): «Ти граєш деінде», «Повернути сюди»                   |
| `nearby3`  | three phones without internet: pairing, adding a player, a game followed by all, its seats, the host's phone gone: the waiting message wherever it is (the card, or the game's `<ihroteka-wait>`), and «Не чекати» for it ends the room on that phone, saying so |
| `nearbybye` | nearby: a guest's page reloads: its goodbye keeps its place (the other phone's room goes on, the player away); paired again («З’єднатися знову»), back in its place |
| `nearname` | nearby: a phone under the host's name, first with the host alone, then with a guest: the pairing ends at once on both phones, «Це ім’я вже в кімнаті»; the two stay together; «Спробувати ще» asks the newcomer for another name, and takes the host back to showing a code |
| `card`     | the waiting message wherever it is (the card, or the game's `<ihroteka-wait>`; with the probe, which places none: the card): «Чекаємо на Богдан… m:ss» built once (only the time changes, the screen reader hears only who and why, the focus stays on «Не чекати»); a new tab opening the game: «— повертається в гру», nothing to press; «Не чекати» lets his place go |
| `screens`  | the waiting screens in a game (`<ihroteka-wait>`, on `cli new demo5`, three players at 360 px), never two messages (sampled every 100 ms): a third player's screen «Ти чекаєш на місце» / «Грають зараз: …»; «Чекаємо на Богдан… m:ss» in the game, built once, a 44 px button; the copy hidden: the card at once, shown again or uncovered: the screen, covered: the card; a second copy: the first keeps the rows, then the second takes them; «Не чекати» pressed in the game (`showing` heard); a round's player whose game is slow to open: «— зараз не в грі» after the grace, then the same round; the game opened while a player is away, its page slow to parse: nothing until it has, the card never shown, then the screen, and `showing` heard once with the rows in place |
| `version`  | a friend's copy of a game is newer (its wire): the older page reloads itself into the room, once; not seated together; the note (the waiting message wherever it is), «Оновити» on the older page only |
| `proto`    | a friend's library is newer (PROTO + 1, its bundle rewritten on the way): not linked; both pages say so; the older reloads itself into the room, once |
| `crash`    | a game that throws as it starts (its page rewritten on the way): «Гра зламалася» over it, the focus on «Скопіювати звіт», which copies the report (site version, connection, trace: the error's type and place, never its message); a later error, or the library page's own, only goes into the trace; so does a ResizeObserver loop as the game starts (a browser's notice, no note), and the browser's refusal left uncaught (`NotAllowedError`, as `audio.play()` before any tap); the game's own error left rejected in a promise is a broken start |
| `newgame`  | `cli new demo2` in a scratch copy, its own dev server with `--devnet`, nothing allowed off this computer: two tabs link up, open the new game and play its round (`ihroteka.round`) to the end, turn by turn; the tab that does not run the round reloads, then the runner's (the round goes on from its snapshot, `run`, and from the newest state a player saw); meanwhile the other sees «Чекаємо на …» in the game's `<ihroteka-wait>`, never the card (sampled every 100 ms) |
| `newgame3` | `cli new demo3 --players 2-3`, as `newgame`, three devnet tabs: a state from a copy that does not run the round changes nothing; a player of the round leaves the room on their turn: the template's rule (`endWhenSeatGone`) ends it for the two left (the lobby says why; the record: `gone`); they play a new round, and the one who left comes back meanwhile: the round's seats are frozen, so they wait (the game's `<ihroteka-wait>`: «Ти чекаєш на місце» / «Грають зараз: …», its lobby nothing; never the card), get a seat when it is over, and start a round of three |
| `template` | the template's page (`cli new demo1`, its own dev server) with a stand-in `ihroteka.round` and `ihroteka.room`: its one rule (`endWhenSeatGone`); `run` fresh (state sent and saved), moves counted for the sender's seat once, `rejoin`, a `newer` state, the winner (`round.over`, then `end` shows it); a round on one device, then a partner (the lobby, nothing of it sent; Start asks `round.start`); `watch` (only the runner's state of that round), the round moving here with an older snapshot (the newest state it saw wins), `end` `gone` (the lobby says why); its `<ihroteka-wait>` under the title: undefined outside the library and taking no room; waiting for a seat, the lobby says nothing |
| `trust`    | the page's Content-Security-Policy (README: Trust): used as it is (the shelf, the dialog, Two Dragons), nothing breaks it; it refuses a script from elsewhere, the MQTT client of another version, eval, a plugin and a `<base>` elsewhere, and lets through inline scripts, a `blob:` script the page made, the pinned MQTT client from both its URLs and a `blob:` worker (the MQTT client's timers); a `srcdoc` frame (a game on the site) is under it too, and so is the open game's own frame (on the dev server: the policy as a header). Two Dragons' frame has no camera and no microphone (`camera 'none'; microphone 'none'`); a game whose shelf entry says `camera: true` has the camera only, `microphone: true` the microphone only. A browser that knows no `worker-src` (Safari before 15.5; the page's policy without it): the `blob:` worker still runs, by `script-src` |

In `prod/` (`npm run e2e -- --prod`, against `E2E_SITE_URL`):

| scenario   | what                                                                                                  |
|------------|-------------------------------------------------------------------------------------------------------|
| `smoke`    | the assembled site: the shelf lists library.json, the pages say the site's version, the offline copy takes charge with every file; fully offline, two reloads open the shelf, a sealed game asks for its password over its cover (with `VAULT_PASSWORD`: opens), an unknown address leads to the library; nothing refused by the Content-Security-Policy |
| `nearby`   | two phones on a Wi-Fi with no way out, the library from its offline copy: «Грати разом» offers nearby only; a code shown, scanned (typed), answered: together, nearby (Chromium) |

## How they work

- `support/fakenet.cjs`: the network of a page, installed before the library runs. Fake MQTT brokers over a
  BroadcastChannel (shared by the pages of one browser: one browser is one network, separate browsers are separate
  devices), real WebRTC links, and switches on the page: `__net(on)`, `__brokers(on)`, `__switch(ms)`, `__killDc()`,
  `__hide(on)`, impairment `__imp = { lat, jit, loss, hiccup }` (none by default: sends go out at once, inside the
  call) and the traffic counts `__tx` (per path and message type; a sealed broker packet by what it carries) and `__wire`
  (per path); `__open(s)`: what a packet this page sent to the brokers carries. See the file's header.
- `support/scenario.cjs`: `scenario(title, fn)`, `check(cond, what, detail)`, `todo(…)`, `skip(why)`, `until(fn, ms)`,
  `launch()` (browsers closed at the end; the engine `E2E_BROWSER`), `watch(page, label)` (its errors fail the
  scenario: `errs`; `forgive(from, re)` lets expected ones go), `exitOnSignals(before)` (a signal exits through the
  process's `exit` handlers), `E2E_URL`, `E2E_SITE_URL`, `E2E_GAME`; `E2E_PERF=<file>` makes any scenario write what
  its pages counted (long tasks, what went out per path while playing together) for `npm run perf` (tools/perf.js).
- `support/runner.cjs`: the queue (`-j`), the server check and the summary of `run.cjs`, and a whole runner for a
  game's own `test/e2e/run.cjs` (`runScenarios({ dir, sets, title, defaultSet })`; the games' runners still keep their
  own until they are rebuilt); an item asked twice runs twice, each with its own result.
- `support/pages.cjs`: the library page: `openPage` (`net: false`: no fake network, the page's own: devnet),
  `enterName`, `createLink`, `frameOf`, `libState` (the library's `__ihroteka.state()`), `short`, and nearby
  `phone()` / `pair()`.
- `support/newgame.cjs`: `newGame(id, args, { devnet })`: `cli new` in a scratch copy of the repository and a dev
  server of its own on a free port (`newgame`, `newgame3`, `template`, `screens`; `G.log`: what that server said),
  both gone when the scenario ends, by a signal too; `templateFrame(p, sel)` and `templateView(f)`: the template's
  frame, and what a player sees in it.
- `fixtures/probe`: the open probe game (`npm run dev -- --probe` serves it as `probe`): it shows the room as a game sees
  it and keeps what it heard in `window.__probe`.
- `support/net.cjs`: net-level pages: `library/net` bundled with esbuild as `window.NET` on the library's origin,
  `join(page, code, name)` (`window.R`, `got`, `ev`); `node tests/e2e/support/net.cjs` writes the bundle to a temp
  dir (`E2E_NET=<file>` reuses it).

A scenario is `tests/e2e/<name>.e2e.cjs` (never `*.test.js`: `npm test` would run it), its first line its tags (`//
tags: @ci @webkit`: CI's sets; none, and CI does not run it). Wait with `until` on a condition rather than a fixed
pause, and check what a player would see. A scenario for CI opens `GAME` (never a game by name) and keeps to what is
deterministic on a shared machine: rules and states, not timings.
