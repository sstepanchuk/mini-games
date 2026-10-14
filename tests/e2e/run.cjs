// Runs the browser scenarios (tests/e2e/*.e2e.cjs) against the library at E2E_URL (default: the dev server,
// http://127.0.0.1:8000/), two at a time, and prints each one's report and a summary. Exits non-zero if any failed
// (one that skips itself, code 77, does not count).
//   npm run e2e                     all of them
//   npm run e2e -- names ui         some (by name)
//   npm run e2e -- @ci              those tagged @ci (a scenario's first line: // tags: @ci @webkit)
//   npm run e2e -- -j 1             one at a time
//   npm run e2e -- --prod           the production path instead (tests/e2e/prod, against the site at E2E_SITE_URL)
// E2E_BROWSER=webkit runs them in WebKit; E2E_GAME the game they open (support/scenario.cjs). The queue and the
// summary are support/runner.cjs's; a signal stops the scenarios still running.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { U, SITE, BROWSER, GAME } = require('./support/scenario.cjs');
const { writeBundle } = require('./support/net.cjs');
const { takeJobs, serverUp, runQueue, summary } = require('./support/runner.cjs');

const args = process.argv.slice(2);
const jobs = takeJobs(args);
const prod = args.includes('--prod');
if (prod) args.splice(args.indexOf('--prod'), 1);
const DIR = prod ? path.join(__dirname, 'prod') : __dirname, AT = prod ? SITE : U;
const all = fs.readdirSync(DIR).filter(f => f.endsWith('.e2e.cjs')).sort();
// a scenario's tags: its first line, // tags: @ci @webkit
const tagsOf = f => (/^\/\/ tags:(.*)$/m.exec(fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')[0]) || [, ''])[1].trim().split(/\s+/);
const tags = args.filter(a => a.startsWith('@')), names = args.filter(a => !a.startsWith('@'));
const named = names.map(a => all.find(f => f === a || f === a + '.e2e.cjs' || f === path.basename(a)));
if (named.some(f => !f)) {
  console.error('No such scenario: ' + names.filter((a, i) => !named[i]).join(', ') + '. There are: ' + all.map(f => f.replace('.e2e.cjs', '')).join(', '));
  process.exit(2);
}
const pick = [...new Set([...named, ...(tags.length ? all.filter(f => tags.every(t => tagsOf(f).includes(t))) : names.length ? [] : all)])];
if (!pick.length) { console.error('No scenario is tagged ' + tags.join(' ') + '.'); process.exit(2); }

let made = null;                                       // the net bundle written here (removed on the way out)
process.on('exit', () => { if (made) fs.rmSync(path.dirname(made), { recursive: true, force: true }); });

(async () => {
  await serverUp(AT, prod ? 'Assemble and serve the site first (npm run site, then npm run dev -- site), or set E2E_SITE_URL.'
    : 'Start the dev server first (npm run dev), or set E2E_URL.');
  made = !process.env.E2E_NET && writeBundle();       // one net bundle for all of them
  const env = { ...process.env, E2E_NET: process.env.E2E_NET || made };
  console.log(pick.length + ' scenario(s) against ' + AT + ' in ' + BROWSER + ' (the game: ' + GAME + '), ' + jobs + ' at a time');
  const results = await runQueue(pick, { dir: DIR, jobs, env });
  process.exit(summary(pick, results) ? 1 : 0);
})();
