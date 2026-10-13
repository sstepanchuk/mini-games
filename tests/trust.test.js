// Trust (phase 3, J3; README: Trust). A game is trusted code in a frame of the library's origin; what the page itself
// closes is its Content-Security-Policy (library/app/page.html, a <meta> that a game's srcdoc frame inherits): scripts
// only from the site, inline, blob: and the pinned MQTT client: exactly the URLs of library/net/config.js MQTT_LIB, so
// an upgrade that forgets the policy fails here instead of leaving the site without internet rooms; never eval; workers
// from the site or blob: (the MQTT client keeps its timers in one), and script-src lets in every worker worker-src does
// (Safari before 15.5 knows no worker-src and judges workers by script-src); no plugins, no <base> elsewhere. It comes
// before anything it governs, and every page the build makes (the shelf, a game's page, the dev server's shelf) has it;
// the dev server's game page (its frame loads it by address, so it inherits nothing) gets the same policy as a header.
// The browser side (what the policy refuses and lets through, the frame's camera and microphone) is
// tests/e2e/trust.e2e.cjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

globalThis.window ??= {};                              // config.js reads window.__timeScale and window.__pid as it loads
const { MQTT_LIB } = await import('../library/net/config.js');
const { page, gamePage } = await import('../tools/build.js');
const { devServer } = await import('../tools/dev.js');

const TEMPLATE = fs.readFileSync(fileURLToPath(new URL('../library/app/page.html', import.meta.url)), 'utf8');
const META = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/g;
// the policies a page says: [{ directive: [source, …] }]
const policies = html => [...html.matchAll(META)].map(m => Object.fromEntries(m[1].split(';').map(d => d.trim().split(/\s+/)).filter(d => d[0]).map(([k, ...v]) => [k, v])));
const VALS = { title: 't', description: 'd', shareTitle: 's', shareDescription: 's', imageUrl: '', imageAlt: '', emoji: '🎲', theme: '#e4e2f0', base: './', bootArgs: '{}' };

test('the policy: scripts of the site, inline ones, blob: and the pinned MQTT client only; workers of the site or blob:', () => {
  const all = policies(TEMPLATE);
  assert.equal(all.length, 1, 'page.html says one policy');
  const csp = all[0];
  // a new directive is a decision: Two Dragons, the shelf, the password, the offline copy and nearby (camera, QR) are
  // checked under it in the browser first, on the dev server and on the assembled site
  assert.deepEqual(Object.keys(csp).sort(), ['base-uri', 'object-src', 'script-src', 'worker-src']);
  assert.deepEqual([...csp['script-src']].sort(), ["'self'", "'unsafe-inline'", 'blob:', ...MQTT_LIB.urls].sort(),
    'script-src names exactly the MQTT_LIB urls of library/net/config.js (upgrade both together), and blob:');
  for (const u of MQTT_LIB.urls) assert.match(u, /^https:\/\/[^/]+\/.+@\d+\.\d+\.\d+\/.+\.js$/, 'one exact file, one exact version: ' + u);
  assert.ok(!csp['script-src'].some(s => /^'(unsafe-eval|wasm-unsafe-eval|strict-dynamic|unsafe-hashes)'$/.test(s)), 'no eval of any kind');
  assert.ok(!csp['script-src'].some(s => /^'(nonce|sha\d+)-/.test(s)), "no nonce or hash (either would switch 'unsafe-inline' off: every game's code is inline)");
  assert.deepEqual(csp['worker-src'], ["'self'", 'blob:'], 'the service worker; the MQTT client\'s timers (a blob: worker)');
  // a browser that does not know worker-src (Safari before 15.5) judges a worker by script-src (and there is no
  // child-src, above, that another browser would ask first): the same workers have to pass there too
  for (const s of csp['worker-src']) assert.ok(csp['script-src'].includes(s), 'script-src lets in ' + s + ' too, as worker-src does');
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.deepEqual(csp['base-uri'], ["'self'"]);
});

test('it comes first in <head>: before any script, stylesheet or inline handler it governs', () => {
  const at = TEMPLATE.search(META), head = TEMPLATE.slice(0, at);
  assert.ok(at > 0, 'page.html has the policy');
  assert.ok(head.lastIndexOf('<head>') >= 0 && !/<(script|link|style)\b|\son\w+=/i.test(head.replace(/<!--[\s\S]*?-->/g, '')),
    'nothing but <meta charset> ahead of it');
});

test('every page of the site and of the dev server has it, once', () => {
  const pages = {
    'the shelf (site/index.html)': page({ ...VALS, version: '1a2b3c4 2026-10-13' }),
    'a game\'s page (site/<id>/index.html)': gamePage('demo', { title: 'Demo', description: 'd', image: 'preview.png' }, '1a2b3c4 2026-10-13'),
    'the dev server\'s shelf': page({ ...VALS, base: '/', bootArgs: JSON.stringify({ dev: { games: [] } }) })
  };
  for (const [what, html] of Object.entries(pages)) {
    assert.equal(policies(html).length, 1, what);
    assert.deepEqual(policies(html)[0], policies(TEMPLATE)[0], what + ': the template\'s, unchanged');
    assert.ok(html.search(META) < html.search(/<script\b/i), what + ': ahead of its scripts');
  }
});

test('the dev server\'s game page (/<id>/?frame, loaded by address): the same policy, as a header', async () => {
  const server = devServer('games', { probe: true });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try {
    const at = 'http://127.0.0.1:' + server.address().port;
    const game = await fetch(at + '/probe/?frame');
    assert.equal(game.status, 200);
    assert.equal(game.headers.get('content-security-policy'), TEMPLATE.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/)[1]);
    const shelf = await fetch(at + '/probe/');
    assert.equal(policies(await shelf.text()).length, 1, 'the shelf: its <meta>');
  } finally { server.close(); }
});
