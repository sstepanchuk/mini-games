// What every browser scenario needs: the library's address, Playwright's Chromium, waits, checks and the exit code.
//   scenario('title', async () => { … check(cond, 'what must hold', detail) … })
// prints each check, then PASS or FAIL; the process exits non-zero when a check failed, the scenario threw, a page
// threw an uncaught error, or it ran longer than its timeout. todo(cond, …) is a known bug: reported, never failing.
'use strict';
const path = require('node:path');
const { execSync } = require('node:child_process');

// E2E_URL: where the library runs (the dev server by default: npm run dev)
const U = new URL(process.env.E2E_URL || 'http://127.0.0.1:8000/').href.replace(/\/?$/, '/');
const w = ms => new Promise(r => setTimeout(r, ms));

// Playwright from this project, or the one installed globally (npm i -g playwright)
let pw = null;
function playwright() {
  if (pw) return pw;
  try { pw = require('playwright'); } catch (e) { pw = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
  return pw;
}
const browsers = new Set();
// a browser (one device); closed when the scenario ends
async function launch(opt = {}) {
  const b = await playwright().chromium.launch(opt);
  browsers.add(b);
  b.on('disconnected', () => browsers.delete(b));
  return b;
}

const errs = [];                                       // uncaught errors on the pages (see watch)
// a page's uncaught errors fail the scenario
const watch = (page, label) => { page.on('pageerror', e => errs.push(label + ': ' + e.message)); return page; };

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

function scenario(title, fn, { timeout = 300000 } = {}) {
  const t0 = Date.now();
  const timer = setTimeout(() => { console.log('  ✗ timed out after ' + timeout / 1000 + ' s'); finish(1); }, timeout);
  const finish = async code => {
    clearTimeout(timer);
    for (const b of [...browsers]) await b.close().catch(() => {});
    process.exit(code);
  };
  console.log(title + '  (' + U + ')');
  (async () => {
    try { await fn(); } catch (e) { failed++; console.log('  ✗ ' + (e && e.stack || e)); }
    check(!errs.length, 'no uncaught errors on the pages', errs);
    console.log((failed ? 'FAIL' : 'PASS') + ': ' + passed + ' passed, ' + failed + ' failed' + (todos ? ', ' + todos + ' todo' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s');
    await finish(failed ? 1 : 0);
  })();
}

module.exports = { U, w, playwright, launch, watch, errs, check, todo, step, until, scenario };
