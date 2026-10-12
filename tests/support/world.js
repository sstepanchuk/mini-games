// The test's side of worker tabs (tab.js). A world is one network: its tabs share the fake brokers (fakenet.js),
// and a spy on it sees everything published and can publish anything (someone who watches a room's topic on a
// public broker). Each world belongs to one test and is torn down when that test ends; an error inside any of its
// tabs (an exception from a timer or a listener, console.error) then fails that test, as a page error fails a
// browser scenario.
//
//   const W = world(t, { scale, rtc })     scale: window.__timeScale of every tab (config.js TIMING); rtc: fake direct
//                                          links (fakertc.js) besides the brokers
//   const A = await W.tab('aaaa1111')      a tab; its session starts with this pid (sessions decide some elections)
//   await A.join('room01', 'Аня')          a net-level room (library/net joinRoom); A.lib(code, name, seats): the library's
//                                          room (together.js), and A.open(game), A.game(), A.gsend(m), A.snapshot(s) …
//   await A.state(), A.events(), A.got(), A.net({ up: false }), A.send(m, opts), A.release(n), A.leave(), A.kill() …
//   await until(async () => …, ms)         poll a condition (truthy → it; deadline → false)
//   const S = W.spy()                      S.seen: [{ topic, url, m }]; S.publish(topic, m, session): to every broker
//   await room(W, code, names, o)          tabs for these players, linked one after another and settled
import { Worker } from 'node:worker_threads';

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

export function world(t, { scale = 1, brokerMs = 25, rtc = false } = {}) {
  const bus = 'tabs-' + process.pid + '-' + (++worlds);
  const tabs = [], spies = [];
  let urls = null;
  const W = {
    bus,
    /** a new tab; net: fakenet switches to start with; library: another library/ folder to run (an older version) */
    async tab(pid, net = {}, { library } = {}) {
      const w = new Worker(TAB, { workerData: { pid, bus, scale, brokerMs, rtc, net, library } });
      const waits = new Map();
      let n = 0, dead = null;
      const ready = new Promise((res, rej) => {
        w.on('message', m => {
          if (m.ready) { urls = urls || m.urls; res(m); return; }
          const p = waits.get(m.id);
          if (!p) return;
          waits.delete(m.id);
          if (m.ok) p.res(m.value); else p.rej(new Error(m.error));
        });
        w.on('error', e => { dead = e; rej(e); for (const p of waits.values()) p.rej(e); });
        w.on('exit', () => { dead = dead || new Error('tab ' + pid + ' is gone'); for (const p of waits.values()) p.rej(dead); waits.clear(); });
      });
      const call = (cmd, args) => dead ? Promise.reject(dead) : new Promise((res, rej) => { const id = ++n; waits.set(id, { res, rej }); w.postMessage({ id, cmd, args }); });
      const { session } = await ready;
      const T = {
        pid, session, worker: w, call,
        join: (code, name, o = {}) => call('join', { code, name, ...o }),
        lib: (code, name, seats) => call('lib', { code, name, seats }),
        state: () => call('state'),
        log: (from, gfrom) => call('log', { from, gfrom }),
        events: async () => (await call('log')).events,
        // the messages this tab's room got, as 'from:t' or 'from:t:n' strings
        got: async () => (await call('log')).got.map(([f, m]) => f + ':' + m.t + (m.n !== undefined ? ':' + m.n : '')),
        send: (m, opts) => call('send', { m, opts }),
        sendAll: (list, opts) => call('send', { list, opts }),
        release: n => call('release', { n }),
        leave: final => call('leave', { final }),
        net: o => call('net', o),
        errors: () => call('errors'),
        open: id => call('open', { id }),
        game: () => call('game'),
        gsend: (m, opts) => call('gsend', { m, opts }),
        snapshot: s => call('gsnapshot', { s }),
        share: (k, v) => call('gshare', { k, v }),
        shared: k => call('gshared', { k }),
        info: (code, game) => call('info', { code, game }),
        killDc: () => call('killDc'),
        hide: on => call('hide', { on }),                  // the page hidden (a locked phone) or shown again
        freeze: ms => call('freeze', { ms }),              // the tab stops for ms (→ when it runs again)
        kick: () => call('kick'),
        // the tab is killed (a crash, a phone that dies): nothing more goes out
        kill: () => w.terminate(),
        // the tab closes (pagehide: it says bye, its place is kept), then it is gone
        close: async () => { await call('pagehide'); await w.terminate(); }
      };
      tabs.push(T);
      return T;
    },
    spy() {
      const ch = new BroadcastChannel(bus), seen = [];
      let q = Date.now();
      ch.onmessage = e => { const { t, s, url } = e.data || {}; try { seen.push({ topic: t, url, m: JSON.parse(s) }); } catch (err) {} };
      const S = {
        seen,
        // publish m on topic through every broker, as session f (the brokers' duplicate filter needs a fresh q)
        publish(topic, m, f) {
          const s = JSON.stringify({ ...m, f, q: ++q });
          for (const url of urls || []) ch.postMessage({ t: topic, s, url });
        },
        close: () => ch.close()
      };
      spies.push(S);
      return S;
    },
    // → what went wrong inside the tabs that are still there: ['pid: error', …]; a tab that does not answer in 10 s
    // (stuck in a loop, or frozen past the test's end) is one, so a hung tab fails its test instead of hanging the run
    async errors() {
      const ask = T => new Promise(res => {
        const k = setTimeout(() => res([T.pid + ': no answer in 10 s (a loop that never ends?)']), 10000);
        T.errors().then(e => e.map(x => T.pid + ': ' + x), () => []).then(e => { clearTimeout(k); res(e); });
      });
      return (await Promise.all(tabs.map(ask))).flat();
    },
    async close() {
      for (const S of spies) S.close();
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
