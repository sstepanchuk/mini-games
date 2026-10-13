// Runs the browser scenarios (tests/e2e/*.e2e.cjs) against the library at E2E_URL (default: the dev server,
// http://127.0.0.1:8000/), two at a time, and prints each one's report and a summary. Exits non-zero if any failed
// (one that skips itself, code 77, does not count).
//   npm run e2e                     all of them
//   npm run e2e -- names ui         some (by name)
//   npm run e2e -- @ci              those tagged @ci (a scenario's first line: // tags: @ci @webkit)
//   npm run e2e -- -j 1             one at a time
//   npm run e2e -- --prod           the production path instead (tests/e2e/prod, against the site at E2E_SITE_URL)
// E2E_BROWSER=webkit runs them in WebKit; E2E_GAME the game they open (support/scenario.cjs).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { U, SITE, BROWSER, GAME, SKIP } = require('./support/scenario.cjs');
const { writeBundle } = require('./support/net.cjs');

const args = process.argv.slice(2);
let jobs = 2;
const j = args.indexOf('-j');
if (j >= 0) { jobs = Math.max(1, /^\d+$/.test(args[j + 1]) ? +args.splice(j + 1, 1)[0] : 1); args.splice(j, 1); }   // (-j alone: 1)
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

function run(file, env) {
  return new Promise(resolve => {
    const t0 = Date.now(), out = [];
    const child = spawn(process.execPath, [path.join(DIR, file)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => out.push(d));
    child.on('close', code => {
      process.stdout.write('\n=== ' + file + '\n' + Buffer.concat(out).toString());
      resolve({ file, code, s: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

(async () => {
  const up = await fetch(AT, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) {
    console.error('Nothing answers at ' + AT + (prod ? '. Assemble and serve the site first (npm run site, then npm run dev -- site), or set E2E_SITE_URL.'
      : '. Start the dev server first (npm run dev), or set E2E_URL.'));
    process.exit(2);
  }
  const made = !process.env.E2E_NET && writeBundle();   // one net bundle for all of them
  const env = { ...process.env, E2E_NET: process.env.E2E_NET || made };
  console.log(pick.length + ' scenario(s) against ' + AT + ' in ' + BROWSER + ' (the game: ' + GAME + '), ' + jobs + ' at a time');
  const queue = pick.slice(), results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift(), env));
  }));
  console.log('\nSummary');
  for (const f of pick) { const r = results.find(x => x.file === f); console.log('  ' + (r.code === 0 ? 'PASS ' : r.code === SKIP ? 'SKIP ' : 'FAIL ') + f.padEnd(24) + String(r.s).padStart(4) + ' s'); }
  if (made) fs.rmSync(path.dirname(made), { recursive: true, force: true });
  const bad = results.filter(r => r.code !== 0 && r.code !== SKIP).length, skipped = results.filter(r => r.code === SKIP).length;
  console.log(bad ? bad + ' of ' + results.length + ' failed' : 'all ' + (results.length - skipped) + ' passed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  process.exit(bad ? 1 : 0);
})();
