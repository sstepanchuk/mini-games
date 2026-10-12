// Runs the browser scenarios (tests/e2e/*.e2e.cjs) against the library at E2E_URL (default: the dev server,
// http://127.0.0.1:8000/), two at a time, and prints each one's report and a summary. Exits non-zero if any failed.
//   npm run e2e                     all of them
//   npm run e2e -- names ui         some (by name)
//   npm run e2e -- -j 1             one at a time
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { U } = require('./support/scenario.cjs');
const { writeBundle } = require('./support/net.cjs');

const args = process.argv.slice(2);
let jobs = 2;
const j = args.indexOf('-j');
if (j >= 0) { jobs = Math.max(1, /^\d+$/.test(args[j + 1]) ? +args.splice(j + 1, 1)[0] : 1); args.splice(j, 1); }   // (-j alone: 1)
const all = fs.readdirSync(__dirname).filter(f => f.endsWith('.e2e.cjs')).sort();
const pick = args.length ? args.map(a => all.find(f => f === a || f === a + '.e2e.cjs' || f === path.basename(a))) : all;
if (pick.some(f => !f)) {
  console.error('No such scenario: ' + args.filter((a, i) => !pick[i]).join(', ') + '. There are: ' + all.map(f => f.replace('.e2e.cjs', '')).join(', '));
  process.exit(2);
}

function run(file, env) {
  return new Promise(resolve => {
    const t0 = Date.now(), out = [];
    const child = spawn(process.execPath, [path.join(__dirname, file)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => out.push(d));
    child.on('close', code => {
      process.stdout.write('\n=== ' + file + '\n' + Buffer.concat(out).toString());
      resolve({ file, ok: code === 0, s: Math.round((Date.now() - t0) / 1000) });
    });
  });
}

(async () => {
  const up = await fetch(U, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) {
    console.error('Nothing answers at ' + U + '. Start the dev server first (npm run dev), or set E2E_URL.');
    process.exit(2);
  }
  const made = !process.env.E2E_NET && writeBundle();   // one net bundle for all of them
  const env = { ...process.env, E2E_NET: process.env.E2E_NET || made };
  console.log(pick.length + ' scenario(s) against ' + U + ', ' + jobs + ' at a time');
  const queue = pick.slice(), results = [];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) results.push(await run(queue.shift(), env));
  }));
  console.log('\nSummary');
  for (const f of pick) { const r = results.find(x => x.file === f); console.log('  ' + (r.ok ? 'PASS ' : 'FAIL ') + f.padEnd(24) + String(r.s).padStart(4) + ' s'); }
  if (made) fs.rmSync(path.dirname(made), { recursive: true, force: true });
  const bad = results.filter(r => !r.ok).length;
  console.log(bad ? bad + ' of ' + results.length + ' failed' : 'all ' + results.length + ' passed');
  process.exit(bad ? 1 : 0);
})();
