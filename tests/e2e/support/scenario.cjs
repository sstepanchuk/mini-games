// What every browser scenario needs: the library's address, Playwright's browser, waits, checks and the exit code.
//   scenario('title', async () => { … check(cond, 'what must hold', detail) … })
// prints each check, then PASS or FAIL; the process exits non-zero when a check failed, the scenario threw, a watched
// page (watch: openPage does it) threw an uncaught error or its code called console.error (the library logs the
// failures it catches that way; the browser's own messages, a 404 or a refusal, carry no arguments and do not count;
// console.warn never does), or it ran longer than its timeout. forgive(from, re) lets expected ones go. todo(cond, …)
// is a known bug: reported, never failing. skip(why) leaves before it starts: SKIP and the exit code 77 (run.cjs counts
// it apart). exitOnSignals(before) makes SIGINT, SIGTERM and SIGHUP exit through process 'exit' (cleanups run).
// E2E_PERF=<file>: a report for tools/perf.js (npm run perf). Every page counts its long tasks (its frames too) and,
// while its game is played together, what went out per path (the fake network's __wire); when the scenario ends, all
// of it goes into that file: [{ page, frame: 'page' | 'game', long: [ms, …], linkedS, bytes: { path: characters } }].
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execSync } = require('node:child_process');

// E2E_URL: where the library runs (the dev server by default: npm run dev). E2E_SITE_URL: the assembled site, for
// the scenarios of the production path (tests/e2e/prod; npm run site, then npm run dev -- site: localhost, a secure
// origin, as its offline copy needs)
const U = new URL(process.env.E2E_URL || 'http://127.0.0.1:8000/').href.replace(/\/?$/, '/');
const SITE = new URL(process.env.E2E_SITE_URL || 'http://localhost:8001/').href.replace(/\/?$/, '/');
// E2E_BROWSER: Playwright's engine, chromium (by default) or webkit (Safari's: what iPhones run; no fake camera, so
// nothing nearby). E2E_GAME: the game a scenario opens (Two Dragons by default; CI has only the probe: npm run dev --
// --probe, E2E_GAME=probe).
const BROWSER = process.env.E2E_BROWSER || 'chromium', CHROMIUM = BROWSER === 'chromium';
const GAME = process.env.E2E_GAME || 'dragons';
const w = ms => new Promise(r => setTimeout(r, ms));
const SKIP = 77;
function skip(why) { console.log('SKIP: ' + why); process.exit(SKIP); }
const PERF = process.env.E2E_PERF || '';
// (in every page and frame, before its code: see E2E_PERF)
function PERF_INIT() {
  const P = window.__perf = { long: [], linkedS: 0, bytes: {} };
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) P.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: true }); } catch (e) {}
  if (window.top !== window) return;
  let last = null;
  setInterval(() => {
    const now = { ...(window.__wire || {}) }, linked = !!window.__ihroteka?.state().game?.linked;
    if (last && linked) { P.linkedS++; for (const k of Object.keys(now)) P.bytes[k] = (P.bytes[k] || 0) + now[k] - (last[k] || 0); }
    last = now;
  }, 1000);
}

// Playwright from this project, or the one installed globally (npm i -g playwright)
let pw = null;
function playwright() {
  if (pw) return pw;
  try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
  return pw;
}
const browsers = new Set();
// a browser (one device); closed when the scenario ends. (Chromium's own switches, such as a fake camera, are dropped
// for another engine.)
async function launch(opt = {}) {
  const engine = playwright()[BROWSER];
  if (!engine) throw new Error('E2E_BROWSER: no such engine in Playwright: ' + BROWSER);
  if (!CHROMIUM && opt.args) opt = { ...opt, args: opt.args.filter(a => !/^--use-fake-|^--use-file-for-fake-/.test(a)) };
  const b = await engine.launch(opt);
  if (PERF) { const make = b.newContext.bind(b); b.newContext = async (...a) => { const c = await make(...a); await c.addInitScript(PERF_INIT); return c; }; }
  browsers.add(b);
  b.on('disconnected', () => browsers.delete(b));
  return b;
}

const errs = [];                                       // uncaught errors and console.error on the pages (see watch)
const labels = new WeakMap();                          // page → its label (see watch)
// an uncaught error as it is reported: its kind (unless a plain Error), its message and where it was thrown
const describe = e => {
  const at = (e.stack || '').split('\n').map(l => l.trim()).find(l => /:\d+:\d+\)?$/.test(l));
  return (e.name && e.name !== 'Error' ? e.name + ': ' : '') + e.message + (at ? ' @ ' + at : '');
};
// a page's uncaught errors fail the scenario, and so does its code's console.error (any frame of it): the library
// catches most of its own failures and logs them that way (dom.js safe, room handlers, the brokers). Page code always
// passes arguments; the browser's own messages (a 404, a refused script, a permissions notice) have none.
const watch = (page, label) => {
  labels.set(page, label);
  page.on('pageerror', e => errs.push(label + ': ' + describe(e)));
  page.on('console', m => {
    if (m.type() === 'error' && m.args().length) errs.push(label + ': console.error ' + m.text().split('\n')[0] + ' @ ' + (m.location().url || 'evaluate') + ':' + m.location().lineNumber);
  });
  return page;
};
// expected errors (errs[from] on that match re) are let go
const forgive = (from, re) => { for (let i = errs.length - 1; i >= from; i--) if (re.test(errs[i])) errs.splice(i, 1); };
// E2E_PERF: what every page and frame counted, into that file
async function perfReport() {
  const out = [];
  for (const b of browsers) for (const c of b.contexts()) for (const p of c.pages()) for (const f of p.frames()) {
    const r = await f.evaluate(() => window.__perf && { long: window.__perf.long, linkedS: window.__perf.linkedS, bytes: window.__perf.bytes }).catch(() => null);
    if (r) out.push({ page: labels.get(p) || p.url(), frame: f === p.mainFrame() ? 'page' : 'game', ...r });
  }
  fs.writeFileSync(PERF, JSON.stringify(out));
}

let passed = 0, failed = 0, todos = 0;
const show = v => typeof v === 'string' ? v : JSON.stringify(v);
function check(ok, what, detail) {
  if (ok) passed++; else failed++;
  console.log('  ' + (ok ? '✓ ' : '✗ ') + what + (!ok && detail !== undefined ? '\n      got: ' + show(detail) : ''));
  return !!ok;
}
// a known bug (see the plan's {todo} list): reported, does not fail the scenario
function todo(ok, what, detail) {
  todos++;
  console.log('  · todo ' + what + (ok ? ' — passes now: make it a check' : detail !== undefined ? '\n      got: ' + show(detail) : ''));
}
const step = label => console.log('— ' + label);
// polls fn until it returns something truthy or ms pass → its last value
async function until(fn, ms = 10000, every = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v || Date.now() >= end) return v;
    await w(every);
  }
}

// at: the address it runs against, for the title line (the dev server's by default)
function scenario(title, fn, { timeout = 300000, at = U } = {}) {
  const t0 = Date.now();
  const timer = setTimeout(() => { console.log('  ✗ timed out after ' + timeout / 1000 + ' s'); finish(1); }, timeout);
  const finish = async code => {
    clearTimeout(timer);
    if (PERF) await perfReport().catch(e => console.log('  (E2E_PERF: ' + e.message + ')'));
    for (const b of [...browsers]) await b.close().catch(() => {});
    process.exit(code);
  };
  console.log(title + '  (' + at + (CHROMIUM ? '' : ', ' + BROWSER) + ')');
  (async () => {
    try { await fn(); } catch (e) { failed++; console.log('  ✗ ' + (e && e.stack || e)); }
    check(!errs.length, 'no errors on the pages (uncaught, or console.error)', errs);
    console.log((failed ? 'FAIL' : 'PASS') + ': ' + passed + ' passed, ' + failed + ' failed' + (todos ? ', ' + todos + ' todo' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
    await finish(failed ? 1 : 0);
  })();
}

// SIGINT, SIGTERM or SIGHUP ends the process as if it exited (its process 'exit' handlers run: scratch copies,
// servers), with the code a shell gives it (128 + the signal's number); each call's before(signal) runs first. Its
// handlers are registered on the first call, and stay (process.on).
const befores = [];
let onSignals = false;
function exitOnSignals(before = () => {}) {
  befores.push(before);
  if (onSignals) return;
  onSignals = true;
  for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => {
    for (const f of befores) try { f(s); } catch (e) { console.error(e); }
    process.exit(128 + os.constants.signals[s]);
  });
}

module.exports = { U, SITE, BROWSER, CHROMIUM, GAME, w, playwright, launch, watch, errs, forgive, check, todo, step, until, scenario, SKIP, skip, exitOnSignals };
