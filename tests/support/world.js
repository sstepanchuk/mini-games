// The test's side of worker tabs (tab.js). A world is one network: its tabs share the fake brokers (fakenet.js),
// and a spy on it sees everything published and can publish anything (someone who watches a room's topic on a
// public broker). The brokers' traffic is sealed (library/net/seal.js): a spy knows the code of every room the
// world's tabs joined (or asked about: info), as a friend would, and reads and writes its packets as a tab does
// (seal.js here); a stranger (spy({ stranger: true })) knows no code, sees the packets as they are and can send any
// of them again. Each world belongs to one test and is torn down when that test ends; an error inside any of its
// tabs (an exception from a timer or a listener, console.error) then fails that test, as a page error fails a
// browser scenario, also one inside a tab that went before (close, reload, kill: it is asked as it goes).
//
//   const W = world(t, { scale, timing, rtc })
//                                          scale: window.__timeScale of every tab (config.js TIMING); timing: any of
//                                          TIMING set outright, ms (window.__timing: only with a scale, so a test can
//                                          have one long and the rest short); rtc: fake direct links (fakertc.js)
//                                          besides the brokers
//   const A = await W.tab('aaaa1111')      a tab; its session starts with this pid (sessions decide some elections);
//                                          W.tab(pid, net, { strip, reloadAnswer, initial, local, … }): a browser without
//                                          what strip names ('Array.prototype.at' …), see tab.js; tabs given the same
//                                          local object are tabs of one browser (one localStorage); by default each tab
//                                          is a browser of its own
//   await A.join('room01', 'Аня')          a net-level room (library/net joinRoom; { ask: true }: a typed name, asked
//                                          about first while its place's device is on the line: A.take()); A.lib(code,
//                                          name, seats, wires, { ask }): the library's room (together.js startInternet),
//                                          and A.open(game), A.game(), A.gsend(m) → true | false, A.snapshot(s), A.share(k, v) …;
//                                          A.near(name, { ask }): a nearby one (rtc), paired with A.pair('offer' | 'answer' | 'finish', code);
//                                          A.libNear(name, seats, wires, { ask }): the library's nearby room (together.js
//                                          startNearby), paired so too
//   await A.state(), A.events(), A.got(), A.net({ up: false }), A.send(m, opts, then), A.release(n), A.lag(n), A.leave(final, send), A.kill(),
//   A.listeners(), A.timers() …; A.open(id, { wire }): a game whose copy here speaks this wire;
//   A.pagehide({ persisted, lost, quiet }), A.pageshow({ after, quiet }): into the back-forward cache and back (quiet: no
//                                          'offline' / 'online' with them, as browsers do; netState().said counts them); A.throttle({ every }):
//                                          its timers held back as a hidden tab's (tab.js, the top)
//   const A2 = await A.reload()            the page reloads in the same tab (its sessionStorage kept, and its browser's
//                                          localStorage: A.local()), in no room until
//                                          A2.lib(…), as a page that comes back from its room's link; at its game, if
//                                          it was in one (/<id>/?room=: the shell shows it before the room is back)
//   await until(async () => …, ms)         poll a condition (truthy → it; deadline → false)
//   const S = W.spy()                      S.seen: [{ topic, url, m, raw, sealed }] (m: opened if the spy knows the room);
//                                          S.publish(topic, m, session, { plain }): sealed (if known) to every broker;
//                                          S.send(topic, raw): a packet as it is (again)
//   await room(W, code, names, o)          tabs for these players, linked one after another and settled
import { Worker } from 'node:worker_threads';
import { keysOf, openWith, sealWith } from './seal.js';

const TAB = new URL('./tab.js', import.meta.url);
let worlds = 0;

export const sleep = ms => new Promise(r => setTimeout(r, ms));
// poll fn until it returns something truthy (→ that) or ms pass (→ false)
export async function until(fn, ms = 10000, every = 25) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) return false;
    await sleep(every);
  }
}
// a short line about a tab's room, for assertion messages
export const show = s => !s ? 'no room' : `${s.me}: ${s.role}${s.linked ? ', linked' : ''}${s.weak ? ', weak' : ''} [${s.players.join(', ')}]` +
  (s.away.length ? ' away: ' + s.away.join(', ') : '') + (s.host ? ' host ' + s.host : '');
export const states = tabs => Promise.all(tabs.map(T => T.state()));
export const shows = async tabs => (await states(tabs)).map(show).join(' | ');

// These tabs are one room: all linked, the same roster of n players (default: as many as the tabs), nobody away,
// exactly one of them holds the room. → their states, or false
export const settled = (tabs, n = tabs.length) => async () => {
  const s = await states(tabs);
  return s.every(x => x && x.linked && !x.away.length && x.players.length === n && x.players.join() === s[0].players.join()) &&
    s.filter(x => x.role === 'host').length === 1 && s;
};

// Tabs for these players in room `code`, one after another (the first holds the room; each one is linked before
// the next comes, so no two look for the room at once), settled → the tabs. Sessions sort in the order the players
// came (pids p1…, p2…). o: max (players), net (fakenet switches for every tab), lib: library tabs (together.js)
// instead of net-level ones, with these seats per game ({} for 2 everywhere).
export async function room(W, code, names, o = {}) {
  const tabs = [];
  for (const [i, name] of names.entries()) {
    const T = await W.tab('p' + (i + 1) + 'tab', o.net);
    if (o.lib) await T.lib(code, name, o.lib); else await T.join(code, name, { max: o.max });
    const inside = async () => { const s = await T.state(); return i ? s.linked : s.role === 'host'; };
    if (!await until(inside, 5000)) throw new Error('room: ' + name + ' is not in: ' + await shows([...tabs, T]));
    tabs.push(T);
  }
  if (!await until(settled(tabs), 10000)) throw new Error('room: not settled: ' + await shows(tabs));
  return tabs;
}

// a sealed topic's room: the topic itself, or its mailboxes' (seal.js: 'ihroteka/s/' + 32 hex, then '/d/from/to')
const roomOf = topic => topic.startsWith('ihroteka/s/') ? topic.slice(0, 43) : topic;

export function world(t, { scale = 1, timing = null, brokerMs = 25, rtc = false } = {}) {
  const bus = 'tabs-' + process.pid + '-' + (++worlds);
  const tabs = [], spies = [];
  // What went wrong inside a tab, its errors so far: ['pid: error', …] (as: how it is named); one that does not answer
  // in 10 s (stuck in a loop, or frozen past the test's end) is one, so a hung tab fails its test instead of hanging the
  // run. A tab that goes (close, reload, kill) leaves its errors in gone first.
  const gone = [];
  const ask = (T, as = T.pid) => new Promise(res => {
    const k = setTimeout(() => res([as + ': no answer in 10 s (a loop that never ends?)']), 10000);
    T.errors().then(e => e.map(x => as + ': ' + x), () => []).then(e => { clearTimeout(k); res(e); });
  });
  const going = async T => { const [e] = await Promise.all([ask(T, T.pid + ' (before it went)'), keepLocal(T)]); gone.push(...e); };
  // Each browser's localStorage (tab.js local): a tab's `local` object stands for its browser. A new tab of a browser
  // starts with what one of its tabs still there holds, or else what the last of them held as it went (seed: at first,
  // the object's own entries); its tabs then share each change on a channel of their own (browser).
  // (A tab that does not answer in 10 s, frozen or stuck, is not asked: its browser keeps what it had.)
  const browsers = new WeakMap();                        // local object → { name, seed: [[key, value], …], open: Set of its tabs }
  let nBrowsers = 0;
  const browserOf = local => {
    if (!browsers.has(local)) browsers.set(local, { name: bus + ':local:' + (++nBrowsers), seed: Object.entries(local).map(([k, v]) => [k, String(v)]), open: new Set() });
    return browsers.get(local);
  };
  const localOf = T => new Promise(res => {
    const k = setTimeout(() => res(null), 10000);
    T.call('localAll').then(v => { clearTimeout(k); res(v); }, () => { clearTimeout(k); res(null); });
  });
  const keepLocal = async T => {
    const B = browserOf(T.browser);
    B.open.delete(T);
    B.seed = await localOf(T) || B.seed;
  };
  const seedOf = async B => {
    for (const T of B.open) { const v = await localOf(T); if (v) return v; }
    return B.seed;
  };
  let urls = null;
  // the rooms the tabs joined: sealed topic → key; and each sender's highest number on the bus (a spy that speaks as
  // that sender takes one above it: the replay window, seal.js, takes no number twice nor one far below the highest)
  const keys = new Map(), hi = new Map();
  const know = (game, code) => { if (typeof code === 'string' && code) { const K = keysOf(game, code); keys.set(K.topic, K.key); } };
  const watch = new BroadcastChannel(bus);
  watch.onmessage = e => {
    const s = e.data && e.data.s;
    if (typeof s !== 'string') return;
    const qi = s.lastIndexOf('"q":'), fi = s.lastIndexOf('"f":"', qi);
    if (qi < 0 || fi < 0) return;
    const f = s.slice(fi + 5, s.indexOf('"', fi + 5)), q = parseInt(s.slice(qi + 4), 10);
    if (Number.isSafeInteger(q) && !(hi.get(f) >= q)) hi.set(f, q);
  };
  const W = {
    bus,
    /** a new tab; net: fakenet switches to start with; library: another library/ folder to run (an older version);
     *  dev: the page is the dev server's (together.js warns in its console); insecure: no Web Crypto (plain http);
     *  kept: its sessionStorage to start with, [[key, value], …] (reload); initial: the game its address names (reload);
     *  strip: what this browser does not have ('Array.prototype.at', 'structuredClone' …); reloadAnswer: what the
     *  shell's reload says ('reload': once the offline copy is in place, reloadDone; 'storage', 'failed', 'timeout',
     *  'same': at once); local: an object that stands for the tab's browser (tabs given the same one share its
     *  localStorage; its own entries, the first time: what that holds at first; none: a browser of its own). A tab whose
     *  library does not load (its timing refused) → rejects */
    async tab(pid, net = {}, { library, dev, insecure, kept, initial, strip, reloadAnswer, local = {}, search, boot } = {}) {
      const B = browserOf(local);
      const w = new Worker(TAB, { workerData: { pid, bus, scale, timing, brokerMs, rtc, net, library, dev, insecure, kept, initial, strip, reloadAnswer,
        local: await seedOf(B), browser: B.name, search, boot } });
      const waits = new Map();
      let n = 0, dead = null;
      const ready = new Promise((res, rej) => {
        w.on('message', m => {
          if (m.ready) { urls = urls || m.urls; res(m); return; }
          if (m.failed) { rej(new Error('tab ' + pid + ': the library did not load: ' + m.failed)); w.terminate(); return; }
          const p = waits.get(m.id);
          if (!p) return;
          waits.delete(m.id);
          if (m.ok) p.res(m.value); else p.rej(new Error(m.error));
        });
        w.on('error', e => { dead = e; rej(e); for (const p of waits.values()) p.rej(e); });
        w.on('exit', () => { dead = dead || new Error('tab ' + pid + ' is gone'); rej(dead); for (const p of waits.values()) p.rej(dead); waits.clear(); });
      });
      const call = (cmd, args) => dead ? Promise.reject(dead) : new Promise((res, rej) => { const id = ++n; waits.set(id, { res, rej }); w.postMessage({ id, cmd, args }); });
      const { session } = await ready;
      const T = {
        pid, session, worker: w, call, browser: local,   // browser: its local object (W.tab(pid, net, { local: A.browser }): a tab of A's browser)
        join: (code, name, o = {}) => { know(o.game || 'test', code); return call('join', { code, name, ...o }); },   // o: { max, game, ask }
        near: (name, o = {}) => call('near', { name, ...o }),     // a nearby room (world rtc), then pair('offer') …; o: { max, game, leaveOn, ask }
        pair: (step, code) => call('pair', { step, code }),
        take: () => call('take'),                          // after status 'taken': it is them (room.take)
        // (together.js LIB; o: startInternet's options, { ask })
        lib: (code, name, seats, wires, o) => { know('ihroteka', code); return call('lib', { code, name, seats, wires, o }); },
        libNear: (name, seats, wires, o) => call('libNear', { name, seats, wires, o }),   // the library's nearby room (world rtc), then pair(…)
        local: () => call('localAll'),                     // the browser's localStorage as this page sees it, [[key, value], …]
        state: () => call('state'),
        log: (from, gfrom) => call('log', { from, gfrom }),
        events: async () => (await call('log')).events,
        // the messages this tab's room got, as 'from:t' or 'from:t:n' strings
        got: async () => (await call('log')).got.map(([f, m]) => f + ':' + m.t + (m.n !== undefined ? ':' + m.n : '')),
        send: (m, opts, then) => call('send', { m, opts, then }),
        sendAs: (m, as, opts) => call('send', { m, opts, as }),    // m, whose toJSON says it is `as`
        sendAll: (list, opts) => call('send', { list, opts }),
        release: n => call('release', { n }),
        lag: n => call('lag', { n }),                      // room.lag(n): one-way delay, ms (n: a name, or the slowest)
        leave: (final, send) => call('leave', { final, send }),   // send: reliable messages said just before, in the same task
        net: o => call('net', o),
        errors: () => call('errors'),
        takeErrors: () => call('takeErrors'),              // its errors (console.error and .warn too) so far, then forgotten
        open: (id, o = {}) => call('open', { id, ...o }),    // o: { wire } (the wire this copy of the game speaks)
        game: () => call('game'),
        gsend: (m, opts) => call('gsend', { m, opts }),
        snapshot: s => call('gsnapshot', { s }),
        share: (k, v) => call('gshare', { k, v }),
        shared: k => call('gshared', { k }),
        diag: () => call('gdiag'),                         // the game's room.diag() (the connection, then the trace)
        info: (code, game) => { know(game || 'test', code); return call('info', { code, game }); },
        killDc: () => call('killDc'),
        hide: on => call('hide', { on }),                  // the page hidden (a locked phone) or shown again
        // the page goes into the back-forward cache ({ persisted: true }; lost: its goodbye lost, its sockets already
        // dead), and back from it after ms ({ after }): tab.js; throttle({ every }): its timers held back as a hidden tab's
        pagehide: o => call('pagehide', o),
        pageshow: o => call('pageshow', o),
        throttle: o => call('throttle', o),
        siteData: on => call('siteData', { on }),          // the browser blocks the page's site data (false) or allows it
        reloadDone: () => call('reloadDone'),              // the shell's reload, its offline copy in place: 'reload' | 'stay' | null
        stored: k => call('stored', { k }),                // sessionStorage[k] (JSON), as the next page would find it
        freeze: ms => call('freeze', { ms }),              // the tab stops for ms (→ when it runs again, on the clock of its events)
        listeners: () => call('listeners'),                // the page's listeners on window and document now: { 'window:pagehide': 1, … }
        timers: () => call('timers'),                      // the page's intervals that run now, by period: { '200': 1, … }
        kick: () => call('kick'),
        clock: by => call('clock', { by }),                // the device's clock set back (by < 0, ms) or on
        // the tab is killed (a crash, a phone that dies): nothing more goes out (what went wrong inside it is kept)
        kill: async () => { await going(T); await w.terminate(); },
        // the tab closes (pagehide: it says bye, its place is kept), then it is gone ({ hidden: true }: a tab in sight, hidden
        // first in the same go); onHide(list, at): what the page sends as it goes ([{ m, opts }], before the room's goodbye;
        // at 'hidden': as it is hidden)
        close: async o => { await call('pagehide', o); await going(T); await w.terminate(); },
        // the page reloads: it goes as close does (o), and the next page in this tab (→ its tab: the same pid, a new
        // session, the same browser) starts with what this one kept in sessionStorage (its pagehide's too), at the game
        // it was in (the address it reloads at), in no room until it joins one (lib); o.boot: it starts the library at
        // once at the address this page had (?room=: the library's own way back into its room, REJOIN; tab.js boot)
        reload: async (o = {}) => {
          const initial = await call('view'), at = o.boot ? await call('address') : null;
          await call('pagehide', o);
          const kept = await call('sessionAll');
          await going(T);
          await w.terminate();
          return W.tab(pid, net, { library, dev, insecure, kept, initial, strip, reloadAnswer, local,
            ...(at && { search: at.search, boot: { seats: at.seats, wires: at.wires } }) });
        },
        onHide: (list, at) => call('onHide', { list, at })
      };
      tabs.push(T);
      B.open.add(T);
      w.on('exit', () => B.open.delete(T));
      return T;
    },
    // a spy: knows the code of every room of this world (see the top), or none (stranger)
    spy({ stranger = false } = {}) {
      const ch = new BroadcastChannel(bus), seen = [], mine = new Map();
      ch.onmessage = e => {
        const { t, s, url } = e.data || {};
        if (typeof s !== 'string') return;
        let m;
        try { m = JSON.parse(s); } catch (err) { return; }
        const sealed = !!m && typeof m.s === 'string', key = sealed && !stranger && keys.get(roomOf(t));
        const open = key && openWith(key, t, s);
        seen.push({ topic: t, url, m: open || m, raw: s, sealed });
      };
      const send = (topic, s) => { for (const url of urls || []) ch.postMessage({ t: topic, s, url }); };
      const S = {
        seen,
        // publish m on topic through every broker, as session f: sealed with the room's key if the spy knows it (and not
        // plain), under a number that sender has not used (q: or this one)
        publish(topic, m, f, { plain = false, q } = {}) {
          q = q ?? Math.max(hi.get(f) ?? Date.now(), mine.get(f) ?? 0) + 50;
          mine.set(f, q);
          const key = !plain && !stranger && keys.get(roomOf(topic));
          send(topic, key ? sealWith(key, topic, f, q, m) : JSON.stringify({ ...m, f, q }));
        },
        // a packet as it is (raw: its JSON), again: what a stranger recorded
        send,
        close: () => ch.close()
      };
      spies.push(S);
      return S;
    },
    // → what went wrong inside the world's tabs, those that went (close, reload, kill: 'pid (before it went): error') and
    // those still there: ['pid: error', …] (see ask)
    async errors() {
      return [...gone, ...(await Promise.all(tabs.map(T => ask(T)))).flat()];
    },
    async close() {
      for (const S of spies) S.close();
      watch.close();
      await Promise.all(tabs.map(T => T.worker.terminate()));
    }
  };
  t.after(async () => {
    const errors = await W.errors();
    await W.close();
    if (errors.length) throw new Error('errors inside the tabs:\n' + errors.join('\n'));
  });
  return W;
}
