# Browser scenarios

Real Chromium pages against a running library, for what unit tests cannot show: players linking up, dropping
out, taking each other's places, the "Грати разом" dialog. They test the library only; Two Dragons' own scenarios
are sealed with the game (`games/dragons/test`). Not run in CI.

## Running

```sh
npm run dev                       # first, in another terminal: the library at http://127.0.0.1:8000/
npm run e2e                       # every scenario, two at a time, then a summary
npm run e2e -- names ui           # some of them
npm run e2e -- -j 1               # one at a time (slow machine)
node tests/e2e/names.e2e.cjs      # one, directly
E2E_URL=http://127.0.0.1:8001/ npm run e2e     # another server (npm run dev -- 8001, or npm run dev -- site)
```

Each scenario prints its checks (`✓`, `✗`, and `· todo` for a known bug that does not fail it yet), then `PASS` or
`FAIL`, and exits non-zero on a failed check, an uncaught error on any page, or a timeout. `run.cjs` exits non-zero if
any scenario failed.

Needs Playwright with Chromium, from the project or global (`npm i -g playwright`, then `npx playwright install
chromium`). `nearby3` opens the first game on the shelf, so it needs the dev server with a plaintext game (`npm run
unlock`): on the assembled site (`npm run dev -- site`) the games are locked and it fails; the others pass there too.

| scenario   | what                                                                                                  |
|------------|-------------------------------------------------------------------------------------------------------|
| `reliable` | net level, 3 players: reliable messages across an outage, a network switch and the host offline: all arrive, in order, once |
| `multi`    | net level, 4 players: one roster, forwarding, a message to one player, the host leaving (takeover), a reload |
| `names`    | net level: places by name, a new tab taking a place, the host away (takeover, back as a guest), «Не чекати», the host's new tab |
| `nosig`    | the chip and status when no broker answers (the network itself up), and back                           |
| `ui`       | the dialog: without internet only nearby, with internet two ways; a link and nearby both link up       |
| `tabs`     | the same player in a new tab (host, then guest): «Ти граєш деінде», «Повернути сюди»                   |
| `nearby3`  | three phones without internet: pairing, adding a player, a game followed by all, its seats, the host's phone gone |

## How they work

- `support/fakenet.cjs`: the network of a page, installed before the library runs. Fake MQTT brokers over a
  BroadcastChannel (shared by the pages of one browser: one browser is one network, separate browsers are separate
  devices), real WebRTC links, and switches on the page: `__net(on)`, `__brokers(on)`, `__switch(ms)`, `__killDc()`,
  `__hide(on)`, impairment `__imp = { lat, jit, loss, hiccup }` (none by default: sends go out at once, inside the
  call) and the traffic count `__tx`. See the file's header.
- `support/scenario.cjs`: `scenario(title, fn)`, `check(cond, what, detail)`, `todo(…)`, `until(fn, ms)`, `launch()`
  (browsers closed at the end), `E2E_URL`.
- `support/pages.cjs`: the library page: `openPage`, `enterName`, `createLink`, `frameOf`, `libState` (the library's
  `__ihroteka.state()`), `short`, and nearby `phone()` / `pair()`.
- `support/net.cjs`: net-level pages: `library/net` bundled with esbuild as `window.NET` on the library's origin,
  `join(page, code, name)` (`window.R`, `got`, `ev`); `node tests/e2e/support/net.cjs` writes the bundle to a temp
  dir (`E2E_NET=<file>` reuses it).

A scenario is `tests/e2e/<name>.e2e.cjs` (never `*.test.js`: `npm test` would run it). Wait with `until` on a
condition rather than a fixed pause, and check what a player would see.
