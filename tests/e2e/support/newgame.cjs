// A game made by `cli new` in a scratch copy of the repository (IHROTEKA_ROOT: no keyring, no password), served by a
// dev server of its own on a free port: for the scenarios that try the template (newgame, newgame3, template, screens,
// nearby3cut).
// The scratch copy and the server go when the scenario's process exits, a signal too (SIGINT, SIGTERM, SIGHUP:
// scenario.cjs exitOnSignals).
//   const G = await newGame('demo2', ['--title', 'Демо два'], { devnet: true })
//   G.made: cli new worked (G.out: what it said); G.up: its server answers at G.url (port G.port); G.log: what the
//   server said (its stdout and stderr: the detail of a failed check(G.up, …))
// A library of its own, made and assembled as the published one is (cli init, new, build --no-tests and site, in a
// scratch IHROTEKA_ROOT) and served by `cli dev site` on a free port (its offline copy, sw.js, too): for the scenarios
// of the password (lock). Its passwords are the ones cli init made: read from what it printed, never printed again nor
// put in a check's detail; they reach a child process only through its env (VAULT_PASSWORD), a page only by typing.
//   const L = await scratchLibrary('demo', ['alice'])
//   L.made: all of it was made (L.out: what the tools said, the passwords cut out); L.up: its server answers at L.url
//   (http://localhost:<port>/, as the server says: one origin, one sign-in); L.passwords.alice; L.log: the server
//   L.cli(args, password, input): one more of its tools (the password: VAULT_PASSWORD; input: what is typed) → whether
//   it worked; after `user passwd`, L.passwords has the new one (what the tools said keeps every password cut out)
// The scratch copy and the server go when the scenario's process exits, a signal too.
// The template's page in a library page p: templateFrame(p, sel) waits for its frame and sel visible in it (#lobby,
// or main: #lobby is hidden mid-round); templateView(f) is what a player sees there (null: the frame is gone).
// The template puts the library's waiting screen at the end of its page, under its buttons (<ihroteka-wait>, README
// "Waiting screens"), where it is seen at these sizes: whom it waits for shows there, never in the library's card over
// it (only on a short landscape phone, where that end is out of view, does the card say it). SCREENS, an init script
// for the context (ctx.addInitScript(SCREENS)), counts in every library page, every 100 ms, which showed rows: the
// card, the game's screen, both at once, two copies of it; sampled(p) reads the counts.
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { until, exitOnSignals } = require('./scenario.cjs');

const CLI = path.join(__dirname, '..', '..', '..', 'tools', 'cli.js');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

// devnet: the server puts the fake network into every library page (--devnet)
async function newGame(id, args = [], { devnet = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-' + id + '-'));
  let server = null;
  process.on('exit', () => { if (server) server.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  exitOnSignals();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
  const env = { ...process.env, IHROTEKA_ROOT: root };
  delete env.VAULT_PASSWORD;
  const r = spawnSync(process.execPath, [CLI, 'new', id, ...args], { env, encoding: 'utf8' });
  const log = [];
  const G = { made: r.status === 0 && r.stdout.includes('games/' + id), out: r.stdout + r.stderr, up: false, url: null, port: null, get log() { return Buffer.concat(log).toString(); } };
  if (!G.made) return G;
  G.port = await freePort();
  G.url = 'http://127.0.0.1:' + G.port + '/';
  server = spawn(process.execPath, [CLI, 'dev', String(G.port), ...(devnet ? ['--devnet'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false;
  server.stdout.on('data', d => log.push(d));
  server.stderr.on('data', d => log.push(d));
  server.on('exit', (code, signal) => { ended = true; log.push(Buffer.from('(the dev server exited: ' + (signal || code) + ')\n')); });
  G.up = await until(() => ended ? 'ended' : fetch(G.url, { signal: AbortSignal.timeout(1000) }).then(x => x.ok, () => false), 15000) === true;
  return G;
}

async function scratchLibrary(id = 'demo', names = ['alice']) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-lib-'));
  let server = null;
  process.on('exit', () => { if (server) server.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  exitOnSignals();
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
  const env = { ...process.env, IHROTEKA_ROOT: root };
  delete env.VAULT_PASSWORD;
  delete env.VAULT_PASSWORDS;
  const passwords = {}, said = [], ever = new Set();     // ever: every password seen (an old one is cut out too)
  const hide = t => [...ever].reduce((x, pw) => x.split(pw).join('…'), t).replace(/(New password: )\S+/g, '$1…');
  const cli = (args, password, input = '') => {
    const r = spawnSync(process.execPath, [CLI, ...args], { env: password === undefined ? env : { ...env, VAULT_PASSWORD: password }, input, encoding: 'utf8' });
    if (args[0] === 'init') for (const m of r.stdout.matchAll(/^\s+(\S+)\s+(\S+)$/gm)) if (names.includes(m[1])) passwords[m[1]] = m[2];
    const fresh = /New password: (\S+)/.exec(r.stdout);   // (user passwd: the new one, after the prompt, on its line)
    if (args[0] === 'user' && args[1] === 'passwd' && fresh) passwords[Object.keys(passwords).find(n => passwords[n] === password)] = fresh[1];
    for (const pw of Object.values(passwords)) ever.add(pw);
    said.push('$ cli ' + args.join(' ') + '\n' + hide(r.stdout + r.stderr));
    return r.status === 0;
  };
  const log = [];
  const L = { made: false, up: false, url: null, port: null, passwords, cli, get out() { return said.join('\n'); }, get log() { return Buffer.concat(log).toString(); } };
  L.made = cli(['init', ...names]) && names.every(n => passwords[n]) && cli(['new', id]) && cli(['build', '--no-tests'], passwords[names[0]]) && cli(['site']);
  if (!L.made) return L;
  L.port = await freePort();
  L.url = 'http://localhost:' + L.port + '/';
  server = spawn(process.execPath, [CLI, 'dev', 'site', String(L.port)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false;
  server.stdout.on('data', d => log.push(d));
  server.stderr.on('data', d => log.push(d));
  server.on('exit', (code, signal) => { ended = true; log.push(Buffer.from('(the dev server exited: ' + (signal || code) + ')\n')); });
  const at = 'http://127.0.0.1:' + L.port + '/';
  L.up = await until(() => ended ? 'ended' : fetch(at, { signal: AbortSignal.timeout(1000) }).then(x => x.ok, () => false), 15000) === true;
  return L;
}

// (every library page, from its start: see above)
function SCREENS() {
  if (window.top !== window) return;
  const S = window.__screens = { n: 0, card: 0, screen: 0, both: 0, many: 0 };
  setInterval(() => {
    const c = document.getElementById('waiting'), card = !!c && !c.hidden && !!c.firstElementChild;
    let doc = null;
    try { doc = document.querySelector('iframe.frame')?.contentDocument || null; } catch (e) {}
    const held = doc ? [...doc.querySelectorAll('ihroteka-wait')].filter(x => x.firstElementChild && x.getClientRects().length > 0).length : 0;
    S.n++;
    if (card) S.card++;
    if (held) S.screen++;
    if (card && held) S.both++;
    if (held > 1) S.many++;
  }, 100);
}
// → { n (samples), card, screen, both, many (how many samples showed each) }, or null (a page closed, or none taken)
const sampled = p => p.isClosed() ? Promise.resolve(null) : p.evaluate(() => window.__screens || null).catch(() => null);

// the template's frame in the library page p, once sel shows in it
async function templateFrame(p, sel = '#lobby') {
  const e = await p.waitForSelector('iframe.frame', { timeout: 15000 });
  const f = await e.contentFrame();
  await f.waitForSelector(sel, { timeout: 15000 });
  return f;
}
// what a player sees in the template's frame f: its lobby (and what it says), a round (the total, the seats, whose
// turn: say, the line a sighted player reads; which buttons work: not aria-disabled), «Ще раз», the text of «Вийти з
// раунду» (null: hidden); null when the frame is gone
const templateView = f => f.evaluate(() => {
  const $ = id => document.getElementById(id);
  return { lobby: !$('lobby').hidden, text: $('lobby-text').textContent, play: !$('play').hidden, total: +$('total').textContent, say: $('say-text').textContent,
    seats: [...$('seats').children].map(li => li.textContent), steps: [...$('steps').children].map(b => b.getAttribute('aria-disabled') !== 'true'), again: !$('again').hidden,
    quit: $('quit').hidden ? null : $('quit').textContent };
}).catch(() => null);

module.exports = { newGame, scratchLibrary, SCREENS, sampled, templateFrame, templateView };
