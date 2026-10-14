// Runs browser scenarios: tests/e2e/run.cjs (the library's) and each game's own test/e2e/run.cjs. An item is a
// scenario's name with its arguments after «:» (near:kill → near.e2e.cjs kill; a file name works too); the items run
// a few at a time, each one's report printed as it ends, then a summary in the order they were asked (an item asked
// twice runs twice and shows twice, each with its own result). The process exits non-zero if any failed (one that
// skips itself, code 77, does not count). A signal (Ctrl+C, a CI cancel) stops the scenarios still running too.
//   runScenarios({ dir: __dirname, sets: { fast: […], all: […] }, title: 'Two Dragons', defaultSet: 'fast' })
// reads the command line (or args): -j <n> (one at a time: -j 1; -j alone: 1), then items and set names (none: the
// default set), and checks that something answers at E2E_URL first (url). Its parts, for a runner of its own (run.cjs):
// takeJobs(args), serverUp(url, hint), runQueue(items, { dir, jobs, env }) and summary(items, results).
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { U, SKIP, exitOnSignals } = require('./scenario.cjs');

// -j <n> taken out of args → how many at a time (2 by default)
function takeJobs(args) {
  let jobs = 2;
  const j = args.indexOf('-j');
  if (j >= 0) { jobs = Math.max(1, /^\d+$/.test(args[j + 1]) ? +args.splice(j + 1, 1)[0] : 1); args.splice(j, 1); }   // (-j alone: 1)
  return jobs;
}

// nothing answers at url: say so (and what to do: hint), exit 2
async function serverUp(url, hint) {
  const up = await fetch(url, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) { console.error('Nothing answers at ' + url + '. ' + hint); process.exit(2); }
}

const running = new Set();                             // the scenarios' processes, while they run
let signals = false;
function runOne(item, dir, env) {
  const [name, ...rest] = item.split(':');
  const file = path.join(dir, name.endsWith('.e2e.cjs') ? name : name + '.e2e.cjs');
  return new Promise(resolve => {
    const t0 = Date.now(), out = [];
    const child = spawn(process.execPath, [file, ...rest], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    running.add(child);
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => out.push(d));
    child.on('close', code => {
      running.delete(child);
      process.stdout.write('\n=== ' + item + '\n' + Buffer.concat(out).toString());
      resolve({ item, code, s: Math.round((Date.now() - t0) / 1000) });
    });
  });
}
// runs the items, jobs at a time → their results ({ item, code, s }), result i for items[i]
async function runQueue(items, { dir, jobs = 2, env = process.env } = {}) {
  if (!signals) { signals = true; exitOnSignals(s => { for (const c of running) c.kill(s); }); }
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await runOne(items[i], dir, env); }
  }));
  return results;
}

// prints the summary → how many failed
function summary(items, results) {
  console.log('\nSummary');
  items.forEach((item, i) => {
    const r = results[i];
    console.log('  ' + (r.code === 0 ? 'PASS ' : r.code === SKIP ? 'SKIP ' : 'FAIL ') + item.padEnd(24) + String(r.s).padStart(5) + ' s');
  });
  const bad = results.filter(r => r.code !== 0 && r.code !== SKIP).length, skipped = results.filter(r => r.code === SKIP).length;
  console.log(bad ? bad + ' of ' + results.length + ' failed' : 'all ' + (results.length - skipped) + ' passed' + (skipped ? ', ' + skipped + ' skipped' : ''));
  return bad;
}

// a game's runner: sets by name, the default set when none is asked, title for the first line ('Two Dragons')
async function runScenarios({ dir, sets = {}, title, defaultSet, args = process.argv.slice(2), url = U }) {
  args = args.slice();
  const jobs = takeJobs(args);
  const there = fs.readdirSync(dir).filter(f => f.endsWith('.e2e.cjs')).map(f => f.replace('.e2e.cjs', '')).sort();
  const pick = (args.length ? args : [defaultSet]).flatMap(a => Object.hasOwn(sets, a) ? sets[a] : [a]);
  const bad = pick.filter(a => !there.includes(a.split(':')[0]));
  if (bad.length) {
    console.error('No such scenario: ' + bad.join(', ') + '. There are: ' + there.join(', ') + '; sets: ' + Object.keys(sets).join(', '));
    process.exit(2);
  }
  await serverUp(url, 'Start the dev server first (npm run unlock, then npm run dev), or set E2E_URL.');
  console.log(pick.length + ' scenario(s) of ' + title + ' against ' + url + ', ' + jobs + ' at a time');
  const results = await runQueue(pick, { dir, jobs });
  process.exit(summary(pick, results) ? 1 : 0);
}

module.exports = { runScenarios, takeJobs, serverUp, runQueue, summary };
