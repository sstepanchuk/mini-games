// A game made by `cli new` in a scratch copy of the repository (IHROTEKA_ROOT: no keyring, no password), served by a
// dev server of its own on a free port: for the scenarios that try the template (newgame, newgame3, template). The
// scratch copy and the server go when the scenario's process exits.
//   const G = await newGame('demo2', ['--title', 'Демо два'], { devnet: true })
//   G.made: cli new worked (G.out: what it said); G.up: its server answers at G.url (port G.port)
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const net = require('node:net');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { until } = require('./scenario.cjs');

const CLI = path.join(__dirname, '..', '..', '..', 'tools', 'cli.js');
const freePort = () => new Promise(res => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); }); });

// devnet: the server puts the fake network into every library page (--devnet)
async function newGame(id, args = [], { devnet = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-' + id + '-'));
  let server = null;
  process.on('exit', () => { if (server) server.kill(); fs.rmSync(root, { recursive: true, force: true }); });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ homepage: 'https://example.github.io/lib/' }));
  const env = { ...process.env, IHROTEKA_ROOT: root };
  delete env.VAULT_PASSWORD;
  const r = spawnSync(process.execPath, [CLI, 'new', id, ...args], { env, encoding: 'utf8' });
  const G = { made: r.status === 0 && r.stdout.includes('games/' + id), out: r.stdout + r.stderr, up: false, url: null, port: null };
  if (!G.made) return G;
  G.port = await freePort();
  G.url = 'http://127.0.0.1:' + G.port + '/';
  server = spawn(process.execPath, [CLI, 'dev', String(G.port), ...(devnet ? ['--devnet'] : [])], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  G.up = !!await until(() => fetch(G.url, { signal: AbortSignal.timeout(1000) }).then(x => x.ok, () => false), 15000);
  return G;
}

module.exports = { newGame };
