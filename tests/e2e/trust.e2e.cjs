// tags: @ci @webkit
// trust: the page's Content-Security-Policy and the game frame's camera (phase 3, J3; README: Trust). Used as it is
// (the shelf, «Грати разом», the game opened and closed), nothing on the page or in the game's frame breaks the policy,
// and the fonts' inline onload still runs. Then what it refuses: a script from elsewhere, the MQTT client of another
// version, eval, a plugin, a <base> elsewhere; what it lets through: inline scripts, the pinned MQTT client at both of
// config.js's URLs (routed: a stand-in without integrity, so only the policy is tested), a blob: worker (the MQTT
// client's timers); a srcdoc frame (how the site runs a game) is under the same policy, and so is the open game's
// own frame (on the dev server its page, loaded by address, has the policy as a header: eval refused). Two Dragons'
// frame has no camera (`camera 'none'`: a frame of our origin would have it otherwise), and a game whose shelf entry
// says camera: true (game.json "camera") has it (the shelf page rewritten on the way). Needs the dev server with the plaintext games
// (npm run unlock): it opens Two Dragons (or E2E_GAME). In another engine than Chromium (E2E_BROWSER), with no fake
// camera, the camera part checks what the frame says and that the camera is refused where it must be.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { U, w, launch, watch, scenario, check, step, until, CHROMIUM = true, GAME: ID = 'dragons' } = require('./support/scenario.cjs');
const { fakeNet } = require('./support/fakenet.cjs');

const CONFIG = fs.readFileSync(path.join(__dirname, '../../library/net/config.js'), 'utf8');
const PINNED = [...(/urls:\s*\[([^\]]*)\]/.exec(CONFIG) || [, ''])[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const OTHER = (PINNED[0] || '').replace(/@\d+\.\d+\.\d+\//, '@5.0.0/');   // the same client, another version
const GAME = 'a.game[href*="/' + ID + '/"]';

// every violation of the policy, in the page and in each of its frames (the game's), as 'directive blocked-uri'
const RECORD = () => document.addEventListener('securitypolicyviolation', e => {
  try { (top.__csp = top.__csp || []).push((window === top ? '' : 'frame: ') + e.effectiveDirective + ' ' + e.blockedURI); } catch (x) {}
});

// What the policy does with each attempt, in the page (and in a srcdoc frame of it) → { what: 'ran' | 'refused' | … }
function attempts({ pinned, other }) {
  const out = {}, script = (what, src) => new Promise(done => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => done(out[what] = window.__ran?.[src] ? 'ran' : 'loaded, did not run');
    s.onerror = () => done(out[what] = 'refused');
    document.head.append(s);
  });
  // (on a timer: while the test's own call runs, the browser lets it eval, whatever the policy)
  const inline = new Promise(done => setTimeout(() => {
    const s = document.createElement('script');
    s.textContent = 'window.__inline = "ran"; try { eval("1"); window.__eval = "ran"; } catch (e) { window.__eval = e.name; }';
    document.head.append(s);
    done(Object.assign(out, { inline: window.__inline || 'refused', eval: window.__eval }));
  }));
  const worker = new Promise(done => {
    let v;
    try { v = new Worker(URL.createObjectURL(new Blob(['postMessage("ran")']))); } catch (e) { return done(out.worker = e.name); }
    v.onmessage = e => done(out.worker = e.data);
    v.onerror = () => done(out.worker = 'refused');
    setTimeout(() => done(out.worker = out.worker || 'nothing'), 3000);
  });
  const before = (top.__csp || []).length, seen = d => (top.__csp || []).slice(before).some(l => l.startsWith(d + ' '));
  const object = document.body.appendChild(Object.assign(document.createElement('object'), { type: 'image/svg+xml', data: 'icons/icon.svg' }));
  const base = document.head.appendChild(Object.assign(document.createElement('base'), { href: 'https://elsewhere.example/' }));
  const baseURI = document.baseURI, own = location.href;
  base.remove();
  // a game's page as the site runs it: a srcdoc frame, which inherits the policy
  const frame = new Promise(done => {
    const f = document.createElement('iframe');
    f.srcdoc = '<script>parent.__srcdoc = { inline: "ran" }; try { eval("1"); parent.__srcdoc.eval = "ran"; } catch (e) { parent.__srcdoc.eval = e.name; }<\/script>' +
      '<script src="https://elsewhere.example/game-cdn.js" onload="parent.__srcdoc.cdn = window.__ran ? \'ran\' : \'loaded\'" onerror="parent.__srcdoc.cdn = \'refused\'"><\/script>';
    f.onload = () => { done(out.srcdoc = window.__srcdoc); f.remove(); };
    document.body.append(f);
  });
  const later = new Promise(done => setTimeout(done, 1000));   // (a plugin is refused when it would load: after layout)
  return Promise.all([inline, script('elsewhere', 'https://elsewhere.example/x.js'), script('other version', other), ...pinned.map((u, i) => script('pinned ' + i, u)), worker, frame, later])
    .then(() => { object.remove(); return { ...out, object: seen('object-src') ? 'refused' : 'loaded', base: seen('base-uri') && baseURI === own ? 'refused' : 'taken: ' + baseURI }; });
}

// the open game's frame: its allow attribute, and whether it may use the camera (the browser's own answer: Chromium
// says it through document.featurePolicy, and getUserMedia answers, with Chromium's fake camera: 'on')
async function camera(p) {
  const f = await (await p.waitForSelector('iframe.frame', { timeout: 15000 })).contentFrame();
  await f.waitForFunction(() => !!window.ihroteka, null, { timeout: 15000 });
  const allow = await p.$eval('iframe.frame', e => e.allow);
  const policy = await f.evaluate(() => document.featurePolicy ? document.featurePolicy.allowsFeature('camera') : 'unknown');
  const use = await f.evaluate(() => Promise.race([new Promise(r => setTimeout(r, 3000, 'no answer')),
    navigator.mediaDevices.getUserMedia({ video: true }).then(s => { s.getTracks().forEach(t => t.stop()); return 'on'; }, e => e.name)]));
  return { allow, policy, use };
}

scenario('trust: the page\'s policy, and the camera only for a game that asks', async () => {
  check(PINNED.length === 2 && PINNED.every(u => u.startsWith('https://')), 'config.js MQTT_LIB: two pinned URLs', PINNED);
  const b = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext(CHROMIUM ? { permissions: ['camera'] } : {});
  // everything from elsewhere answers (so a refusal is the policy's, not the network's): a script that says it ran,
  // and the fonts' stylesheet (its link's inline onload switches it on)
  await ctx.route(u => u.hostname !== new URL(U).hostname, r => {
    const url = r.request().url();
    if (/fonts\.googleapis\.com/.test(url)) return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/fonts\.gstatic\.com/.test(url)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
      body: '(window.__ran = window.__ran || {})[' + JSON.stringify(url) + '] = true;' });
  });
  let asks = false;                                       // the shelf says the game asks for the camera
  await ctx.route(U, async r => {
    const res = await r.fetch(), html = await res.text();
    await r.fulfill({ response: res, body: !asks ? html : html.replace(/boot\((\{.*\})\);/, (_, a) => {
      a = JSON.parse(a);
      const g = a.dev?.games?.find(x => x.id === ID);
      if (g) g.camera = true;
      return 'boot(' + JSON.stringify(a) + ');';
    }) });
  });
  const p = watch(await ctx.newPage(), 'page');
  await p.addInitScript(fakeNet('aaaaaaaaaaaa'));
  await p.addInitScript(RECORD);

  step('used as it is');
  await p.goto(U);
  await p.waitForSelector('#shelf:not([hidden])');
  const csp = await p.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content).catch(() => '');
  check(/script-src 'self' 'unsafe-inline'/.test(csp) && PINNED.every(u => csp.includes(u)), 'the page says its policy, naming the pinned MQTT client', csp);
  check(await until(() => p.$eval('link[rel=stylesheet][href*="fonts.googleapis.com"]', l => l.media === 'all'), 5000), 'the fonts\' inline onload runs (inline handlers are allowed)');
  await p.click('#together');                             // «Грати разом»: the dialog, the way to nearby
  await p.waitForSelector('.dialog');
  await w(500);
  await p.keyboard.press('Escape');
  await until(async () => !(await p.$('.dialog')), 3000);
  await p.click(GAME);
  const shut = await camera(p);
  // the open game's frame is under the policy too: eval there is refused (that refusal, ours, then forgotten)
  const mark = await p.evaluate(() => (top.__csp || []).length);
  const evalInGame = await (await (await p.$('iframe.frame')).contentFrame()).evaluate(() => new Promise(r => setTimeout(() => { try { eval('1'); r('ran'); } catch (e) { r(e.name); } })));
  await until(() => p.evaluate(n => (top.__csp || []).length > n, mark), 2000);
  await p.evaluate(n => { if (top.__csp) top.__csp.length = n; }, mark);
  check(evalInGame === 'EvalError', 'the game\'s own frame is under the policy (eval refused)', evalInGame);
  await w(1000);
  await (await (await p.$('iframe.frame')).contentFrame()).evaluate(() => window.ihroteka.home());
  await p.waitForSelector('#shelf:not([hidden])');
  check(!(await p.evaluate(() => top.__csp || [])).length, 'nothing on the page or in the game broke the policy', await p.evaluate(() => top.__csp));

  step('what it refuses and lets through');
  const r = await p.evaluate(attempts, { pinned: PINNED, other: OTHER });
  check(r.inline === 'ran', 'an inline script runs', r);
  check(r['pinned 0'] === 'ran' && r['pinned 1'] === 'ran', 'the pinned MQTT client runs, from either URL', r);
  check(r.worker === 'ran', 'a blob: worker runs (the MQTT client\'s timers)', r);
  check(r.elsewhere === 'refused', 'a script from elsewhere is refused', r);
  check(r['other version'] === 'refused', 'the MQTT client of another version is refused', r);
  check(r.eval === 'EvalError', 'eval is refused', r);
  check(r.object === 'refused', 'a plugin (<object>) is refused', r);
  check(r.base === 'refused', 'a <base> elsewhere is refused', r);
  check(r.srcdoc && r.srcdoc.inline === 'ran' && r.srcdoc.eval === 'EvalError' && r.srcdoc.cdn === 'refused',
    'a game in a srcdoc frame (as on the site): its inline code runs, eval and a script from elsewhere are refused', r.srcdoc);

  step('the camera');
  check(/camera 'none'/.test(shut.allow) && shut.policy !== true && (CHROMIUM ? shut.use === 'NotAllowedError' : shut.use !== 'on'),
    'a game that does not ask (' + ID + '): no camera in its frame', shut);
  check(/fullscreen/.test(shut.allow) && /screen-wake-lock/.test(shut.allow) && /autoplay/.test(shut.allow) && /gamepad/.test(shut.allow),
    'the rest as before: fullscreen, the wake lock, autoplay, gamepads', shut.allow);
  asks = true;
  await p.reload();
  await p.waitForSelector('#shelf:not([hidden])');
  await p.click(GAME);
  const open = await camera(p);
  check(/(^|; )camera($|;)/.test(open.allow) && !/'none'/.test(open.allow) && open.policy !== false && (!CHROMIUM || open.use === 'on'),
    'a game whose entry says camera: true has it', open);
});
