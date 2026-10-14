// tags: @ci @webkit
// trust: the page's Content-Security-Policy and the game frame's camera and microphone (phase 3, J3; README: Trust).
// Used as it is (the shelf, «Грати разом», the game opened and closed), nothing on the page or in the game's frame
// breaks the policy, and the fonts' inline onload still runs. Then what it refuses: a script from elsewhere, the MQTT
// client of another version, eval, a plugin, a <base> elsewhere; what it lets through: inline scripts, a blob: script
// the page made, the pinned MQTT client at both of config.js's URLs (routed: a stand-in without integrity, so only the
// policy is tested), a blob: worker (the MQTT client's timers); a srcdoc frame (how the site runs a game) is under the
// same policy, and so is the open game's own frame (on the dev server its page, loaded by address, has the policy as a
// header: eval refused). Two Dragons' frame has no camera and no microphone (`camera 'none'; microphone 'none'`: a
// frame of our origin would have them otherwise); a game whose shelf entry says camera: true (game.json "camera") has
// the camera only, one that says microphone: true the microphone only (the shelf page rewritten on the way). Last, a
// browser that knows no worker-src (Safari before 15.5; here the page's policy loses it on the way): the blob: worker
// still runs, as script-src lets blob: in, which a policy without it (the one before) would not. Needs the dev server
// with the plaintext games (npm run unlock): it opens Two Dragons (or E2E_GAME). In another engine than Chromium
// (E2E_BROWSER), with no fake camera or microphone, that part checks what the frame says and that they are refused
// where they must be.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { U, w, launch, watch, errs, forgive: letGo, scenario, check, step, until, CHROMIUM = true, GAME: ID = 'dragons' } = require('./support/scenario.cjs');
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
  // a blob: script, made here as the page could make one (its own code as a Blob): it says it ran under its own address
  const blob = URL.createObjectURL(new Blob(['(window.__ran = window.__ran || {})[document.currentScript.src] = true;'], { type: 'text/javascript' }));
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
  const before = (top.__csp || []).length, seen = d => (top.__csp || []).slice(before).some(l => l.startsWith(d + ' '));
  const object = document.body.appendChild(Object.assign(document.createElement('object'), { type: 'image/svg+xml', data: 'icons/icon.svg' }));
  const base = document.head.appendChild(Object.assign(document.createElement('base'), { href: 'https://elsewhere.example/' }));
  const baseURI = document.baseURI, own = location.href;
  base.remove();
  // a game's page as the site runs it: a srcdoc frame, which inherits the policy
  const frame = new Promise(done => {
    const f = document.createElement('iframe');
    f.srcdoc = '<script>parent.__srcdoc = { inline: "ran" }; try { eval("1"); parent.__srcdoc.eval = "ran"; } catch (e) { parent.__srcdoc.eval = e.name; }' +
      'var b = document.createElement("script"); b.src = URL.createObjectURL(new Blob([\'parent.__srcdoc.blob = "ran";\'], { type: "text/javascript" }));' +
      'b.onerror = function () { parent.__srcdoc.blob = "refused"; }; document.head.appendChild(b);<\/script>' +
      '<script src="https://elsewhere.example/game-cdn.js" onload="parent.__srcdoc.cdn = window.__ran ? \'ran\' : \'loaded\'" onerror="parent.__srcdoc.cdn = \'refused\'"><\/script>';
    // (the frame may say it loaded before its refused script says so: WebKit)
    const said = () => window.__srcdoc?.cdn && window.__srcdoc?.blob;
    f.onload = () => { const t0 = Date.now(), wait = () => said() || Date.now() - t0 > 2000 ? (done(out.srcdoc = window.__srcdoc), f.remove()) : setTimeout(wait, 50); wait(); };
    document.body.append(f);
  });
  const later = new Promise(done => setTimeout(done, 1000));   // (a plugin is refused when it would load: after layout)
  return Promise.all([inline, script('blob', blob), script('elsewhere', 'https://elsewhere.example/x.js'), script('other version', other), ...pinned.map((u, i) => script('pinned ' + i, u)), frame, later])
    .then(() => { object.remove(); return { ...out, object: seen('object-src') ? 'refused' : 'loaded', base: seen('base-uri') && baseURI === own ? 'refused' : 'taken: ' + baseURI }; });
}

// A worker made the way the MQTT client makes the one for its timers (worker-timers: a typed Blob) → 'ran', or why not,
// and whether the policy refused it (a violation of worker-src or script-src for a blob:). In the page, or in a frame
// (it listens for the refusal itself: no init script needed there).
function worker() {
  const seen = [], note = e => seen.push(e.effectiveDirective + ' ' + e.blockedURI);
  document.addEventListener('securitypolicyviolation', note);
  return new Promise(done => {
    let v;
    const blob = new Blob(['postMessage("ran")'], { type: 'application/javascript; charset=utf-8' });
    try { v = new Worker(URL.createObjectURL(blob)); } catch (e) { return done(e.name); }
    v.onmessage = e => done(e.data);
    v.onerror = e => done('failed' + (e && e.message ? ': ' + e.message : ''));
    setTimeout(() => done('nothing'), 3000);
  }).then(said => new Promise(r => setTimeout(() => {
    document.removeEventListener('securitypolicyviolation', note);
    r({ said, refused: seen.filter(l => /^(worker|script)-src(-elem)? blob/.test(l)) });
  }, 300)));
}
// it ran (in Playwright's WebKit a worker of a page fails as it starts, on something the harness put in it: "Can't find
// variable: window"; so there a worker that loaded and then failed so, with no refusal by the policy, counts)
const ran = wk => wk.said === 'ran' || (!CHROMIUM && /^failed: ReferenceError/.test(wk.said) && !wk.refused.length);

// WebKit reports as the page's own errors what the test caused there on purpose (the worker the harness broke, the
// camera refused to the probe): from errs[from] on, those are let go
const forgive = (from, re) => { if (!CHROMIUM) letGo(from, re); };

// the open game's frame: its allow attribute, and whether it may use the camera and the microphone (the browser's own
// answer: Chromium says it through document.featurePolicy, and getUserMedia answers, with Chromium's fake devices: 'on')
// → { allow, camera: { policy, use }, microphone: { policy, use } }
async function devices(p) {
  const from = errs.length;
  const f = await (await p.waitForSelector('iframe.frame', { timeout: 15000 })).contentFrame();
  await f.waitForFunction(() => !!window.ihroteka, null, { timeout: 15000 });
  const allow = await p.$eval('iframe.frame', e => e.allow);
  const out = await f.evaluate(() => Promise.all([['camera', { video: true }], ['microphone', { audio: true }]].map(async ([what, asked]) => [what, {
    policy: document.featurePolicy ? document.featurePolicy.allowsFeature(what) : 'unknown',
    use: await Promise.race([new Promise(r => setTimeout(r, 3000, 'no answer')),
      navigator.mediaDevices.getUserMedia(asked).then(s => { s.getTracks().forEach(t => t.stop()); return 'on'; }, e => e.name)])
  }])).then(Object.fromEntries));
  await w(300);
  forgive(from, /getUserMedia|'(Camera|Microphone)' check failed/);
  return { allow, ...out };
}
// what the frame says of one of them: has it ('camera'), or refused ("camera 'none'")
const allows = (allow, what) => new RegExp('(^|; )' + what + '($|;)').test(allow);
const denies = (allow, what) => new RegExp('(^|; )' + what + " 'none'($|;)").test(allow);
// the browser's answer for one of them: it may (in Chromium the fake device is on), or it may not
const may = d => d.policy !== false && (!CHROMIUM || d.use === 'on');
const mayNot = d => d.policy !== true && (CHROMIUM ? d.use === 'NotAllowedError' : d.use !== 'on');

scenario('trust: the page\'s policy, and the camera and the microphone only for a game that asks', async () => {
  check(PINNED.length === 2 && PINNED.every(u => u.startsWith('https://')), 'config.js MQTT_LIB: two pinned URLs', PINNED);
  const b = await launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await b.newContext(CHROMIUM ? { permissions: ['camera', 'microphone'] } : {});
  // everything from elsewhere answers (so a refusal is the policy's, not the network's): a script that says it ran,
  // and the fonts' stylesheet (its link's inline onload switches it on)
  await ctx.route(u => u.hostname !== new URL(U).hostname, r => {
    const url = r.request().url();
    if (/fonts\.googleapis\.com/.test(url)) return r.fulfill({ status: 200, contentType: 'text/css', body: '' });
    if (/fonts\.gstatic\.com/.test(url)) return r.fulfill({ status: 404, body: '' });
    return r.fulfill({ status: 200, contentType: 'text/javascript', headers: { 'access-control-allow-origin': '*' },
      body: '(window.__ran = window.__ran || {})[' + JSON.stringify(url) + '] = true;' });
  });
  // the shelf page on the way: the game's entry asks for what asks says ({ camera: true }…); without worker-src in the
  // page's policy when old (what Safari before 15.5 reads: it does not know that directive)
  let asks = {}, old = false;
  await ctx.route(U, async r => {
    const res = await r.fetch();
    let html = await res.text();
    html = html.replace(/boot\((\{.*\})\);/, (_, a) => {
      a = JSON.parse(a);
      const g = a.dev?.games?.find(x => x.id === ID);
      if (g) Object.assign(g, asks);
      return 'boot(' + JSON.stringify(a) + ');';
    });
    if (old) html = html.replace(/(<meta http-equiv="Content-Security-Policy" content=")([^"]*)"/, (_, m, c) => m + c.split(';').filter(d => !/^\s*worker-src\b/.test(d)).join(';') + '"');
    await r.fulfill({ response: res, body: html });
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
  const shut = await devices(p);
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
  check(r.blob === 'ran', 'a blob: script the page made runs', r);
  check(r['pinned 0'] === 'ran' && r['pinned 1'] === 'ran', 'the pinned MQTT client runs, from either URL', r);
  const mark0 = errs.length, wk = await p.evaluate(worker);
  forgive(mark0, /ReferenceError: Can't find variable: window$/);
  check(ran(wk), 'a blob: worker runs (the MQTT client\'s timers)', wk);
  check(r.elsewhere === 'refused', 'a script from elsewhere is refused', r);
  check(r['other version'] === 'refused', 'the MQTT client of another version is refused', r);
  check(r.eval === 'EvalError', 'eval is refused', r);
  check(r.object === 'refused', 'a plugin (<object>) is refused', r);
  check(r.base === 'refused', 'a <base> elsewhere is refused', r);
  // (Playwright's WebKit neither runs nor refuses a blob: script made in a srcdoc frame: no load, no error. What blob:
  // in script-src is for, the MQTT client's worker, lives in the page and is checked above; there it must not be refused)
  const frameBlob = r.srcdoc && (CHROMIUM ? r.srcdoc.blob === 'ran' : r.srcdoc.blob !== 'refused');
  check(r.srcdoc && r.srcdoc.inline === 'ran' && frameBlob && r.srcdoc.eval === 'EvalError' && r.srcdoc.cdn === 'refused',
    'a game in a srcdoc frame (as on the site): its inline code and a blob: script it made run, eval and a script from elsewhere are refused', r.srcdoc);

  step('the camera and the microphone');
  check(denies(shut.allow, 'camera') && mayNot(shut.camera), 'a game that does not ask (' + ID + '): no camera in its frame', shut);
  check(denies(shut.allow, 'microphone') && mayNot(shut.microphone), 'and no microphone', shut);
  check(['fullscreen', 'screen-wake-lock', 'autoplay', 'gamepad'].every(f => allows(shut.allow, f)),
    'the rest as before: fullscreen, the wake lock, autoplay, gamepads', shut.allow);
  for (const what of ['camera', 'microphone']) {
    const other = what === 'camera' ? 'microphone' : 'camera';
    asks = { [what]: true };
    await p.goto(U);                                      // (the shelf's address: the game's would open it at once)
    await p.waitForSelector('#shelf:not([hidden])');
    await p.click(GAME);
    const open = await devices(p);
    check(allows(open.allow, what) && may(open[what]), 'a game whose entry says ' + what + ': true has it', open);
    check(denies(open.allow, other) && mayNot(open[other]), '… and still no ' + other, open);
  }
  asks = {};

  step('a browser that knows no worker-src (Safari before 15.5)');
  old = true;
  await p.goto(U);
  await p.waitForSelector('#shelf:not([hidden])');
  const said = await p.$eval('meta[http-equiv="Content-Security-Policy"]', m => m.content);
  check(!/worker-src/.test(said) && /script-src [^;]*blob:/.test(said), 'the page\'s policy, as such a browser reads it: script-src only, with blob:', said);
  const mark1 = errs.length, wk1 = await p.evaluate(worker);
  forgive(mark1, /ReferenceError: Can't find variable: window$/);
  check(ran(wk1), 'the blob: worker runs, judged by script-src (blob: there)', wk1);
  // the policy before blob: was in script-src, as such a browser reads it: a frame that adds it to the page's refuses
  await p.evaluate(() => new Promise(done => {
    const f = Object.assign(document.createElement('iframe'), { className: 'before', onload: done });
    f.srcdoc = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'">';
    document.body.append(f);
  }));
  const mark2 = errs.length, wk2 = await (await (await p.$('iframe.before')).contentFrame()).evaluate(worker);
  forgive(mark2, /ReferenceError: Can't find variable: window$/);
  check(wk2.said !== 'ran' && (wk2.refused.length > 0 || wk2.said === 'SecurityError'), 'without blob: in script-src it would be refused', wk2);
});
