// Net-level scenarios: library/net bundled for a plain page (esbuild, an IIFE that sets window.NET), on the library's
// origin, with the fake network. Run on its own it writes the bundle into a temp dir and prints the path:
//   node tests/e2e/support/net.cjs        (E2E_NET=<that path> makes the scenarios use it instead of building)
/* global NET */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fakeNet } = require('./fakenet.cjs');
const { U, watch } = require('./scenario.cjs');

const ENTRY = path.join(__dirname, '..', '..', '..', 'library', 'net', 'index.js');
let code = null;
// the bundle's source (built once per process)
function netBundle() {
  if (code) return code;
  if (process.env.E2E_NET) return (code = fs.readFileSync(process.env.E2E_NET, 'utf8'));
  const r = require('esbuild').buildSync({ entryPoints: [ENTRY], bundle: true, format: 'iife', globalName: 'NET', write: false, logLevel: 'warning' });
  return (code = r.outputFiles[0].text);
}
// → the path of a fresh bundle in a new temp dir
function writeBundle() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-e2e-')), file = path.join(dir, 'net.js');
  fs.writeFileSync(file, netBundle());
  return file;
}

// a page (a tab) with the fake network and window.NET; opt as in fakeNet
async function netPage(ctx, pid, label, opt) {
  const p = watch(await ctx.newPage(), label);
  await p.addInitScript(fakeNet(pid, opt));
  await p.goto(U + 'no-such-page');                     // the library's origin, nothing of it running
  await p.addScriptTag({ content: netBundle() });
  return p;
}
// Join a room on that page: window.R is the room, got its messages ('<from>:<t><n>'), ev its events in order
// ('<event> <arg> <arg>').
const EVENTS = ['linked', 'join', 'leave', 'relinked', 'away', 'replaced', 'peer-gone', 'role'];
const join = (p, code, name) => p.evaluate(({ code, name, EVENTS }) => {
  const R = window.R = NET.joinRoom({ game: 'test', code, name }), got = window.got = [], ev = window.ev = [];
  R.on('message', (m, from) => got.push(from + ':' + m.t + (m.n ?? '')));
  for (const e of EVENTS) R.on(e, (x, y) => ev.push(e + (x !== undefined ? ' ' + x : '') + (y !== undefined ? ' ' + y : '')));
}, { code, name, EVENTS });
// what a page's room looks like: { role, players, away, linked } (null for a closed page)
const roomOf = p => p.isClosed() ? Promise.resolve(null)
  : p.evaluate(() => ({ role: window.R.role, players: window.R.players, away: window.R.players.filter(n => window.R.away(n)), linked: window.R.linked }));
const rooms = ps => Promise.all(ps.map(roomOf));
const show = r => !r ? 'closed' : r.role + ' [' + r.players.map(n => n + (r.away.includes(n) ? '·away' : '')).join(', ') + ']' + (r.linked ? '' : ' not linked');

module.exports = { netBundle, writeBundle, netPage, join, roomOf, rooms, show };

if (require.main === module) console.log(writeBundle());
