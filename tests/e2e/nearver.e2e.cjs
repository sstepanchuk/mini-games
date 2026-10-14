// tags: @ci
// nearver: nearby, no internet, two phones whose libraries speak different wire versions (net/config.js PROTO): one
// page's library says PROTO + 1 (its bundle rewritten on the way, as in proto). They show each other their codes; the
// link does not count, and BOTH phones say «Інша версія», whichever of them showed its code first. (Before the audit,
// deploy-day-live-02, the phone that showed its code heard it first and its dialog left the room at once, before its
// own hello went: the other phone waited at «Чекаю на з’єднання…» for good. net/nearby.js onHello.)
'use strict';
const { scenario, check, step, until } = require('./support/scenario.cjs');
const { phone, pair, libState } = require('./support/pages.cjs');

const OTHER = /Інша версія/;

// this phone's library says PROTO + 1 from now on (its page loads again) → that number
async function newer(X) {
  let proto = 0;
  await X.p.context().route('**/lib/ihroteka.js*', async route => {
    const r = await route.fetch();
    const js = (await r.text()).replace(/\b(var|let|const) PROTO = (\d+);/, (_, k, n) => k + ' PROTO = ' + (proto = +n + 1) + ';');
    await route.fulfill({ response: r, body: js });
  });
  await X.p.reload();
  await X.p.waitForSelector('#shelf:not([hidden])');
  return proto;
}

scenario('nearver: nearby phones of different versions both say so', async () => {
  for (const newerShows of [false, true]) {
    const H = await phone(newerShows ? 'hhhhhhhh2222' : 'hhhhhhhh1111', 'Ганна'), G = await phone(newerShows ? 'gggggggg2222' : 'gggggggg1111', 'Гліб');
    const proto = await newer(newerShows ? H : G);
    step((newerShows ? 'Ганна' : 'Гліб') + '’s library says PROTO ' + proto + '; Ганна shows her code, Гліб answers');
    check(proto > 1, 'the bundle says PROTO + 1', proto);
    await pair(H, G);
    const both = await until(async () => OTHER.test(await H.text()) && OTHER.test(await G.text()), 15000, 300);
    check(both, '«Інша версія» on both phones', { Ганна: await H.text(), Гліб: await G.text() });
    const s = await Promise.all([H, G].map(X => libState(X.p)));
    check(s.every(x => !x.linked), 'not linked', s.map(x => [x.kind, x.linked, x.players]));
    await H.b.close(); await G.b.close();
  }
}, { timeout: 150000 });
