// The offline copy brought up to date before the page reloads into a newer version (library/app/update.js
// updateCopy, for shell.js reload): what it says, with a fake service worker registration and fake timers. The page
// reloads only on 'activated' (or 'none': no offline copy); anything else and it stays as it is (app-core-05).
import { afterEach, beforeEach, describe, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { updateCopy } from '../library/app/update.js';

const SCOPE = 'https://example.org/games/';
// a service worker: its state, and 'statechange' as it moves on
class Worker extends EventTarget {
  constructor(state) { super(); this.state = state; }
  go(state) { this.state = state; this.dispatchEvent(new Event('statechange')); }
}
// a registration whose update() does `found` (its own steps: a new worker installing, a rejection, nothing…)
const registration = (found = () => {}, active = new Worker('activated')) => {
  const reg = { scope: SCOPE, active, installing: null, waiting: null, updates: 0 };
  reg.update = async () => { reg.updates++; await found(reg); };
  return reg;
};
// the offline copy's note of why its last install failed (sw.js: Cache 'ihroteka-meta', BASE + '__failed')
// (at: when it was written; by default as it is read, during the check)
const note = (why, at) => {
  globalThis.caches = { open: async name => ({ match: async url => name === 'ihroteka-meta' && url === SCOPE + '__failed' && why
    ? new Response(JSON.stringify({ version: 'abc', why, at: at ?? Date.now() })) : undefined }) };
};
// what the promise says so far (undefined: nothing yet), after the microtasks queued now have run
const peek = async p => { let out; p.then(v => { out = v; }); for (let i = 0; i < 20; i++) await null; return out; };

describe('the offline copy brought up to date (update.js updateCopy)', () => {
  beforeEach(() => { note(null); mock.timers.enable({ apis: ['setTimeout'] }); });
  afterEach(() => { mock.timers.reset(); delete globalThis.caches; });

  test('no offline copy (no registration: the dev server, a browser without service workers): none', async () => {
    assert.equal(await updateCopy(undefined), 'none');
    assert.equal(await updateCopy(null), 'none');
  });

  test('the site has nothing newer: same', async () => {
    const reg = registration();
    assert.equal(await updateCopy(reg), 'same');
    assert.equal(reg.updates, 1);
  });

  test('a newer version installs and takes over: activated', async () => {
    const w = new Worker('installing');
    const p = updateCopy(registration(reg => { reg.installing = w; }));
    assert.equal(await peek(p), undefined, 'not before it is in place');
    w.go('installed'); w.go('activating');
    assert.equal(await peek(p), undefined);
    w.go('activated');
    assert.equal(await p, 'activated');
  });

  test('activated also when it settled before the check: the worker already active, or the new one the active one', async () => {
    assert.equal(await updateCopy(registration(reg => { reg.waiting = new Worker('activated'); })), 'activated');
    assert.equal(await updateCopy(registration(reg => { reg.active = new Worker('activated'); })), 'activated');
  });

  test('the copy was brought up to date in the background before (the page runs an older one than the active): activated', async () => {
    const old = new Worker('redundant'), reg = registration();
    assert.equal(await updateCopy(reg, { served: old }), 'activated');
    assert.equal(await updateCopy(reg, { served: reg.active }), 'same', 'the page runs the active copy: same');
  });

  // The first visit: the network served the page, the first worker installed the copy of its version and claimed it;
  // a newer one did so in the background later (install.js's own check), before the friend's newer version showed.
  test('a page the network served: the first worker to claim it is its own version, a later one is newer: activated', async () => {
    const sw = new EventTarget(), was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    sw.controller = null;
    Object.defineProperty(globalThis, 'navigator', { value: { serviceWorker: sw }, configurable: true });
    try {
      const { updateCopy: fresh } = await import('../library/app/update.js?network');
      const reg = registration(() => {}, null);
      const claim = w => { reg.active = sw.controller = w; sw.dispatchEvent(new Event('controllerchange')); };
      claim(new Worker('activated'));                         // its own version's copy, stored as the page came
      assert.equal(await fresh(reg), 'same', 'the copy of the page\'s own version: nothing newer');
      claim(new Worker('activated'));                         // a newer one, in the background
      assert.equal(await fresh(reg), 'activated', 'the page runs an older version than the copy: reload into it');
    } finally { Object.defineProperty(globalThis, 'navigator', was); }
  });

  test('a new version that could not be installed: failed; storage when the offline copy noted it had no room', async () => {
    const w = new Worker('installing');
    const p = updateCopy(registration(reg => { reg.installing = w; }));
    w.go('redundant');
    assert.equal(await p, 'failed');
    assert.equal(await updateCopy(registration(reg => { reg.installing = new Worker('redundant'); })), 'failed', 'redundant at once');
    note('storage');
    const v = new Worker('installing'), q = updateCopy(registration(reg => { reg.installing = v; }));
    v.go('redundant');
    assert.equal(await q, 'storage');
  });

  test('a new version that failed before the check looked (nothing installing): storage when noted during the check', async () => {
    note('storage');
    assert.equal(await updateCopy(registration()), 'storage');
    note('storage', Date.now() - 60000);                     // (an older note: that version failed before this check)
    assert.equal(await updateCopy(registration()), 'same');
  });

  test('update() rejects (sw.js unreachable or broken): failed; storage when noted', async () => {
    assert.equal(await updateCopy(registration(() => { throw new TypeError('Failed to update a ServiceWorker'); })), 'failed');
    note('storage');
    assert.equal(await updateCopy(registration(() => { throw new TypeError('Failed to update a ServiceWorker'); })), 'storage');
  });

  // (the note stays until a version activates: one from an earlier try says nothing of why this one failed)
  test('a note of no room from an earlier try: what fails now is failed, not storage', async () => {
    note('storage', Date.now() - 60000);
    assert.equal(await updateCopy(registration(() => { throw new TypeError('Failed to update a ServiceWorker'); })), 'failed', 'no network now');
    const w = new Worker('installing'), p = updateCopy(registration(reg => { reg.installing = w; }));
    w.go('redundant');
    assert.equal(await p, 'failed', 'the new version failed now, for another reason');
  });

  test('update() that never answers: timeout at 30 s (ms), not before', async () => {
    const p = updateCopy(registration(() => new Promise(() => {})));
    mock.timers.tick(29999);
    assert.equal(await peek(p), undefined);
    mock.timers.tick(1);
    assert.equal(await p, 'timeout');
    const q = updateCopy(registration(() => new Promise(() => {})), { ms: 5000 });
    mock.timers.tick(5000);
    assert.equal(await q, 'timeout');
  });

  test('a new version still installing at the deadline: timeout; once it settles, later hears how it ended', async () => {
    const w = new Worker('installing'), heard = [];
    const p = updateCopy(registration(reg => { reg.installing = w; }), { later: out => heard.push(out) });
    mock.timers.tick(30000);
    assert.equal(await p, 'timeout');
    assert.deepEqual(heard, []);
    w.go('activated');
    await peek(Promise.resolve());
    assert.deepEqual(heard, ['activated'], 'a worker that finishes later still counts');
    const v = new Worker('installing'), also = [];
    const q = updateCopy(registration(reg => { reg.installing = v; }), { later: out => also.push(out) });
    mock.timers.tick(30000);
    assert.equal(await q, 'timeout');
    v.go('redundant');
    await peek(Promise.resolve());
    assert.deepEqual(also, ['failed']);
  });

  test('settled in time: later is not called', async () => {
    const heard = [], w = new Worker('installing');
    const p = updateCopy(registration(reg => { reg.installing = w; }), { later: out => heard.push(out) });
    w.go('activated');
    assert.equal(await p, 'activated');
    mock.timers.tick(30000);
    await peek(Promise.resolve());
    assert.deepEqual(heard, []);
  });
});
