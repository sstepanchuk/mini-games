// The browser scenarios' own support (tests/e2e/support), where it runs in Node: a scenario that made a game with
// newGame (a scratch copy of the repository and a dev server of its own) and is ended by a signal (Ctrl+C, a CI
// cancel, a closed terminal) still removes the copy and stops the server, and exits as a shell expects (128 + the
// signal's number). The runner (runner.cjs: the library's run.cjs and each game's) shows each item asked with its own
// result, a repeated one too, and a signal to it stops the scenarios it runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const NEWGAME = path.join(import.meta.dirname, 'e2e', 'support', 'newgame.cjs');
const RUNNER = path.join(import.meta.dirname, 'e2e', 'support', 'runner.cjs');
const answers = url => fetch(url, { signal: AbortSignal.timeout(300) }).then(() => true, () => false);
const w = ms => new Promise(r => setTimeout(r, ms));

for (const [sig, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
  test('e2e support: a signal still removes newGame\'s scratch copy and stops its server (' + sig + ')', { skip: process.platform === 'win32' && 'no such signals' }, async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-signal-'));
    try {
      const child = spawn(process.execPath, ['-e', 'require(' + JSON.stringify(NEWGAME) + ').newGame(\'demo8\').then(G => { console.log(JSON.stringify(G)); setInterval(() => {}, 1000); })'],
        { env: { ...process.env, TMPDIR: tmp }, stdio: ['ignore', 'pipe', 'pipe'] });
      const exited = new Promise(res => child.on('exit', (c, s) => res({ code: c, signal: s })));
      let out = '', err = '';
      child.stderr.on('data', d => { err += d; });
      const G = await new Promise((res, rej) => {
        child.stdout.on('data', d => { out += d; if (out.includes('\n')) res(JSON.parse(out.split('\n')[0])); });
        exited.then(x => rej(new Error('it ended before newGame did: ' + JSON.stringify(x) + '\n' + err)));
      });
      assert.ok(G.made && G.up, 'cli new demo8, and its server answers at ' + G.url);
      assert.equal(fs.readdirSync(tmp).filter(f => f.startsWith('ihroteka-demo8-')).length, 1, 'its scratch copy');
      child.kill(sig);                                   // (the process alone: its server is not told)
      assert.deepEqual(await exited, { code, signal: null }, 'it exits as for ' + sig);
      assert.deepEqual(fs.readdirSync(tmp), [], 'nothing left behind');
      let up = true;
      for (let i = 0; i < 20 && up; i++) { up = await answers(G.url); if (up) await w(100); }
      assert.ok(!up, 'its server stopped');
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
      if (fs.existsSync('/proc')) for (const p of fs.readdirSync('/proc').filter(x => /^\d+$/.test(x))) {
        try { if (fs.readFileSync('/proc/' + p + '/environ', 'utf8').includes('IHROTEKA_ROOT=' + tmp)) process.kill(+p); } catch (e) {}
      }
    }
  });
}

// a runner over scenarios written into a scratch dir, and a server for its check → { dir, url, run(opts, args) }
async function runnerOver(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ihroteka-runner-'));
  for (const [f, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, f), src);
  const server = http.createServer((q, r) => r.end('ok'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  const run = opts => {
    const child = spawn(process.execPath, ['-e', 'require(' + JSON.stringify(RUNNER) + ').runScenarios(' + JSON.stringify({ dir, url, title: 'the test', ...opts }) + ')'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    return { child, out: () => out, exited: new Promise(res => child.on('exit', (code, signal) => res({ code, signal }))) };
  };
  return { dir, url, run, done: () => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); } };
}

test('e2e support: the runner shows each item with its own result, a repeated one too', async () => {
  // flaky: fails on its first run, passes on the next (a count beside it); skips with «skip» after «:»
  const R = await runnerOver({ 'flaky.e2e.cjs': `const fs = require('fs'), f = __dirname + '/count';
const n = fs.existsSync(f) ? +fs.readFileSync(f, 'utf8') : 0;
fs.writeFileSync(f, String(n + 1));
console.log('run ' + (n + 1));
process.exit(process.argv[2] === 'skip' ? 77 : n ? 0 : 1);` });
  try {
    const r = R.run({ sets: { twice: ['flaky', 'flaky'] }, defaultSet: 'twice', args: ['-j', '1', 'twice', 'flaky:skip'] });
    assert.deepEqual(await r.exited, { code: 1, signal: null }, r.out());
    const lines = r.out().split('\n'), at = lines.indexOf('Summary');
    assert.ok(at > 0, r.out());
    assert.deepEqual(lines.slice(at + 1, at + 4).map(l => l.trim().replace(/\s+\d+ s$/, '').split(/\s+/)), [['FAIL', 'flaky'], ['PASS', 'flaky'], ['SKIP', 'flaky:skip']], r.out());
    assert.equal(lines[at + 4], '1 of 3 failed', r.out());
    assert.match(r.out(), /^3 scenario\(s\) of the test against http:\/\/127\.0\.0\.1:\d+\/, 1 at a time$/m);
  } finally { R.done(); }
});

test('e2e support: a signal to the runner stops the scenarios it runs', { skip: process.platform === 'win32' && 'no such signals' }, async () => {
  const R = await runnerOver({ 'hang.e2e.cjs': `require('fs').writeFileSync(__dirname + '/pid.' + process.pid, ''); setInterval(() => {}, 1000);` });
  const pids = () => fs.readdirSync(R.dir).filter(f => f.startsWith('pid.')).map(f => +f.slice(4));
  const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return false; } };
  try {
    const r = R.run({ sets: {}, defaultSet: 'hang', args: ['hang', 'hang'] });
    for (let i = 0; i < 100 && pids().length < 2; i++) await w(50);
    assert.equal(pids().length, 2, 'both scenarios run: ' + r.out());
    r.child.kill('SIGTERM');
    assert.deepEqual(await r.exited, { code: 143, signal: null }, r.out());
    let left = pids();
    for (let i = 0; i < 40 && left.some(alive); i++) await w(50);
    left = pids().filter(alive);
    assert.deepEqual(left, [], 'no scenario left running');
  } finally {
    for (const pid of pids()) try { process.kill(pid, 'SIGKILL'); } catch (e) {}
    R.done();
  }
});
