// npm run test:games:e2e: every game's own browser scenarios (games/<id>/test/e2e/run.cjs, sealed with the game: after
// npm run unlock), one game after another, against the dev server (E2E_URL, as tests/e2e/README.md). The arguments go
// to each game's runner (its sets: fast, all…; -j 1); a first argument that names a game runs only that game's:
//   npm run test:games:e2e                          every game's default set
//   npm run test:games:e2e -- dragons near:kill     one game's, some of its scenarios
// Exits non-zero if a game's runner did (2: no such game, or no game with browser scenarios here, before any ran).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const GAMES = path.join(__dirname, '..', '..', 'games');
const runner = id => path.join(GAMES, id, 'test', 'e2e', 'run.cjs');
const ids = fs.existsSync(GAMES) ? fs.readdirSync(GAMES).filter(id => /^[a-z0-9-]+$/.test(id) && fs.existsSync(runner(id))).sort() : [];
const args = process.argv.slice(2);
const one = args.length && /^[a-z0-9-]+$/.test(args[0]) && fs.existsSync(path.join(GAMES, args[0])) ? args.shift() : null;
const pick = one ? [one] : ids;
if (!pick.length || (one && !ids.includes(one))) {
  console.error((one ? 'games/' + one + ' has no browser scenarios (test/e2e/run.cjs)' : 'No game here has browser scenarios (games/*/test/e2e/run.cjs): npm run unlock') +
    (ids.length ? '. Games with them: ' + ids.join(', ') : ''));
  process.exit(2);
}
const results = pick.map(id => {
  console.log('\n##### ' + id + (args.length ? ' ' + args.join(' ') : ''));
  const t0 = Date.now(), r = spawnSync(process.execPath, [runner(id), ...args], { stdio: 'inherit' });
  return { id, code: r.status === null ? 1 : r.status, s: Math.round((Date.now() - t0) / 1000) };
});
console.log('\nGames');
for (const r of results) console.log('  ' + (r.code === 0 ? 'PASS ' : 'FAIL ') + r.id.padEnd(22) + String(r.s).padStart(5) + ' s');
process.exit(results.every(r => r.code === 0) ? 0 : 1);
