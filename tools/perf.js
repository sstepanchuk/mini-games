#!/usr/bin/env node
// A local performance report: npm run perf -- <game> [--profile wifi] [--secs 30] [--out <file>] [--save]. A person
// reads it; it is never a gate (numbers drift between machines and runs: docs/ROADMAP.md, K5). It runs against the dev
// server with the game's plaintext sources (npm run dev; E2E_URL), in Chromium, and measures:
//   round    the game's own fair scenario (games/<id>/test/e2e/fair.e2e.cjs <profile> <secs>), when it has one: for the
//            player whose copy runs the round (host) and the other (guest), input reaching the round (control) and
//            reaching their own screen (screen), ms; jumps on their screen (own dragon, the other's)
//   traffic  in that same run (tests/e2e/support/scenario.cjs E2E_PERF): what each page sent, per path (dc-ctl,
//            dc-fast: the direct link; mqtt-room, mqtt-mail: the brokers), in characters a second while they played
//            together; long tasks on each page and in its game's frame (how many, ms in all, the longest)
//   open     a click on the shelf → the game's page loaded and its code run, ms (median of 5, and the slowest)
//   idle     CPU with nothing to do: the shelf alone, and the game open alone (its menu: Two Dragons runs a demo
//            there), % of one core
// It writes them as JSON (--out, or a file in the temp folder) and prints them next to docs/perf-reference.json (the
// same game and profile). --save makes this run the reference: commit it with the change it measured.
/* global window, document */                          // (what runs in the page)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const REFERENCE = path.join(ROOT, 'docs', 'perf-reference.json');
const require = createRequire(import.meta.url);
const S = require('../tests/e2e/support/scenario.cjs'), P = require('../tests/e2e/support/pages.cjs');

const fail = msg => { console.error('✗ ' + msg); process.exit(2); };
let game, profile, secs, opt;                           // (from the command line: main)

/* ---------- the round: the game's fair scenario, with E2E_PERF ---------- */
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? Math.round(s[Math.min(s.length - 1, Math.floor(s.length * p))]) : null; };
// 'med 86 p90 120 max 300 (n 50)' → { med, p90, max, n }; '-' → null
const stats = t => { const m = /med (\d+) p90 (\d+) max (\d+) \(n (\d+)\)/.exec(t); return m && { med: +m[1], p90: +m[2], max: +m[3], n: +m[4] }; };
// fair's report: per player, '    <name>  HOST|guest seat …' and its control / screen / smooth lines
export function parseFair(out) {
  const round = {};
  for (const m of out.matchAll(/^ {4}(\S+)\s+(HOST|guest)\s+seat .*\n\s+control (.*)\n\s+screen\s+(.*)\n\s+smooth\s+(.*)$/gm)) {
    const j = Object.fromEntries(Array.from(m[5].matchAll(/(own|other) ([\d.]+)% off, (\d+) jumps/g), x => [x[1], +x[3]]));
    round[m[2] === 'HOST' ? 'host' : 'guest'] = { name: m[1], control: stats(m[3]), screen: stats(m[4]), jumps: { own: j.own ?? null, other: j.other ?? null } };
  }
  return round;
}
function runFair() {
  const file = path.join(ROOT, 'games', game, 'test', 'e2e', 'fair.e2e.cjs');
  if (!fs.existsSync(file)) { console.log('· ' + path.relative(ROOT, file) + ' not found: no round figures'); return Promise.resolve({ round: null, pages: [] }); }
  const report = path.join(os.tmpdir(), 'ihroteka-perf-' + process.pid + '.json');
  console.log('… ' + game + '\'s fair scenario, ' + profile + ', ' + secs + ' s');
  return new Promise(resolve => {
    const out = [], child = spawn(process.execPath, [file, profile, String(secs)], { env: { ...process.env, E2E_PERF: report }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', d => out.push(d));
    child.stderr.on('data', d => out.push(d));
    child.on('close', code => {
      const text = Buffer.concat(out).toString();
      if (code !== 0) console.log(text.split('\n').filter(l => /✗|No such profile|Error/.test(l)).slice(0, 8).join('\n') || text.slice(-1500));
      let pages = [];
      try { pages = JSON.parse(fs.readFileSync(report, 'utf8')); fs.rmSync(report); } catch (e) {}
      resolve({ round: parseFair(text), pages, passed: code === 0 });
    });
  });
}
// the pages' figures by player: what they sent a second per path, and long tasks (page and game frame)
export function traffic(pages, round) {
  const role = name => round && Object.keys(round).find(r => round[r].name === name) || name;
  const out = {};
  for (const x of pages) {
    const who = out[role(x.page)] || (out[role(x.page)] = {});
    if (x.frame === 'page' && x.linkedS > 0) who.sent = Object.fromEntries(Object.entries(x.bytes).filter(([, b]) => b > 0).map(([k, b]) => [k, Math.round(b / x.linkedS)]));
    who['long-' + x.frame] = { n: x.long.length, ms: x.long.reduce((a, b) => a + b, 0), max: x.long.length ? Math.max(...x.long) : 0 };
  }
  return out;
}

/* ---------- opening the game, and idle CPU (a page of our own) ---------- */
async function library() {
  const b = await S.launch(), ctx = await b.newContext({ viewport: { width: 900, height: 650 } });
  const p = await P.openPage(ctx, 'perfaaaaaaaa', S.U, { label: 'perf' });
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Performance.enable');
  const busy = async ms => {                            // % of one core the page kept busy over ms
    const t = async () => (await cdp.send('Performance.getMetrics')).metrics.find(m => m.name === 'TaskDuration').value;
    const a = await t();
    await S.w(ms);
    return Math.round(1000 * (await t() - a) / (ms / 1000)) / 10;
  };
  const card = 'a.game[href*="/' + game + '/"]';
  if (!(await p.$(card))) fail(game + ' is not on the shelf at ' + S.U + ' (npm run unlock, then npm run dev)');
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await p.click(card);
    const f = await (await p.waitForSelector('iframe.frame', { timeout: 30000 })).contentFrame();
    await f.waitForFunction(() => !!window.ihroteka && document.readyState === 'complete', null, { timeout: 30000 });
    times.push(Date.now() - t0);
    if (i < 4) { await f.evaluate(() => window.ihroteka.home()); await p.waitForSelector('#shelf:not([hidden])'); await S.w(500); }
  }
  await S.w(3000);
  const inGame = await busy(8000);
  await (await (await p.$('iframe.frame')).contentFrame()).evaluate(() => window.ihroteka.home());
  await p.waitForSelector('#shelf:not([hidden])');
  await S.w(3000);
  const shelf = await busy(8000);
  const version = b.version();
  await b.close();
  return { open: { med: q(times, 0.5), max: Math.max(...times) }, idle: { shelf, game: inGame }, browser: version };
}

/* ---------- the report ---------- */
const flat = (o, pre = '') => Object.entries(o || {}).flatMap(([k, v]) => v && typeof v === 'object' ? flat(v, pre + k + '.') : typeof v === 'number' ? [[pre + k, v]] : []);
// → [[figure, reference, now, change]]: every number of either (null where one has none), the change in % ('' when
// there is nothing to compare)
export function diff(now, ref) {
  const was = new Map(flat(ref)), rows = flat(now).map(([k, v]) => [k, was.has(k) ? was.get(k) : null, v]);
  for (const k of was.keys()) if (!rows.some(r => r[0] === k)) rows.push([k, was.get(k), null]);
  return rows.map(([k, a, b]) => {
    if (a == null || b == null || (a === 0 && b === 0)) return [k, a, b, ''];
    if (a === 0) return [k, a, b, 'new'];
    const d = Math.round((b - a) / Math.abs(a) * 100);
    return [k, a, b, (d > 0 ? '+' : '') + d + '%'];
  });
}
function compare(now, ref) {
  const rows = diff(now, ref), w = Math.max(...rows.map(r => r[0].length), 8);
  console.log('\n' + 'figure'.padEnd(w) + '   reference        now   change');
  for (const [k, a, b, d] of rows) console.log(k.padEnd(w) + '   ' + String(a ?? '-').padStart(9) + '  ' + String(b ?? '-').padStart(9) + '   ' + d);
}

async function main() {
  const args = process.argv.slice(2);
  opt = { '--profile': 'wifi', '--secs': '30' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--save') opt['--save'] = true;
    else if (args[i] in opt || args[i] === '--out') { if (i + 1 >= args.length) fail(args[i] + ' needs a value'); opt[args[i]] = args[++i]; }
    else if (!game && /^[a-z0-9][a-z0-9-]*$/.test(args[i])) game = args[i];
    else fail('Unknown argument: ' + args[i] + '. Usage: npm run perf -- <game> [--profile wifi] [--secs 30] [--out <file>] [--save]');
  }
  if (!game) fail('Which game? npm run perf -- dragons [--profile wifi]');
  if (!S.CHROMIUM) fail('Chromium only (its DevTools protocol measures the CPU): unset E2E_BROWSER');
  profile = opt['--profile']; secs = +opt['--secs'];
  if (!(secs >= 5)) fail('--secs: at least 5');
  const KEY = game + ':' + profile;
  const up = await fetch(S.U, { signal: AbortSignal.timeout(5000) }).then(r => r.ok, () => false);
  if (!up) fail('Nothing answers at ' + S.U + '. Start the dev server first (npm run dev), or set E2E_URL.');
  const fair = await runFair();
  console.log('… opening ' + game + ', and idle CPU');
  const lib = await library();
  const metrics = { round: fair.round, traffic: traffic(fair.pages, fair.round), open: lib.open, idle: lib.idle };
  const result = { game, profile, secs, when: new Date().toISOString(), machine: os.cpus()[0]?.model + ' ×' + os.cpus().length, browser: lib.browser,
    fairPassed: fair.passed ?? null, metrics };
  const out = opt['--out'] || path.join(os.tmpdir(), 'ihroteka-perf-' + KEY.replace(':', '-') + '-' + result.when.slice(0, 19).replace(/:/g, '-') + '.json');
  fs.writeFileSync(out, JSON.stringify(result, null, 2) + '\n');
  const refs = fs.existsSync(REFERENCE) ? JSON.parse(fs.readFileSync(REFERENCE, 'utf8')) : {};
  const ref = refs[KEY];
  console.log('\n' + KEY + ', ' + secs + ' s, on ' + result.machine + ' (Chromium ' + result.browser + ')' +
    (ref ? '; the reference: ' + ref.when.slice(0, 10) + ', on ' + ref.machine : '; no reference for ' + KEY + ' yet (--save makes one)'));
  compare(metrics, ref && ref.metrics);
  console.log('\n(a report to read, not a gate: machines and runs differ; ms, characters a second, % of one core)\n✓ ' + out);
  if (opt['--save']) {
    refs[KEY] = result;
    fs.writeFileSync(REFERENCE, JSON.stringify(Object.fromEntries(Object.entries(refs).sort()), null, 2) + '\n');
    console.log('✓ the reference for ' + KEY + ': ' + path.relative(ROOT, REFERENCE));
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => fail(e.stack || e.message));
