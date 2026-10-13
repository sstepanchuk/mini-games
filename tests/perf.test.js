// The local performance report (tools/perf.js, npm run perf): it reads the game's fair scenario's own report, and the
// pages' counts (tests/e2e/support/scenario.cjs E2E_PERF), and prints every figure next to the reference
// (docs/perf-reference.json). A report to read, never a gate: these tests pin only how it reads and compares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseFair, traffic, diff } from '../tools/perf.js';

// as fair.e2e.cjs prints it (games/dragons/test/e2e)
const FAIR = `fair: wifi {"lat":35}, 30 s  (http://127.0.0.1:8000/)
  ✓ Аня and Богдан are together
    via direct; dragons Аня/Богдан
    Аня     HOST  seat 0, seats seen [0]
       control med 79 p90 89 max 91 (n 49)
       screen  med 38 p90 47 max 715 (n 48)
       smooth  own 1.1% off, 2 jumps | other 3.5% off, 1 jumps  (1700 frames)
  ✓ Аня steers the dragon the round gives them
    Богдан  guest seat 1, seats seen [1]
       control med 63 p90 79 max 94 (n 61)
       screen  -
       smooth  other 0.4% off, 0 jumps | own 0.9% off, 3 jumps  (1690 frames)
PASS: 9 passed, 0 failed in 41 s`;

test('the fair report: each player\'s control, screen and jumps, by role', () => {
  const r = parseFair(FAIR);
  assert.deepEqual(r.host, { name: 'Аня', control: { med: 79, p90: 89, max: 91, n: 49 }, screen: { med: 38, p90: 47, max: 715, n: 48 }, jumps: { own: 2, other: 1 } });
  assert.deepEqual(r.guest, { name: 'Богдан', control: { med: 63, p90: 79, max: 94, n: 61 }, screen: null, jumps: { own: 3, other: 0 } });
  assert.deepEqual(parseFair('no such profile'), {});
});

test('the pages\' counts: what each sent a second while playing together, and long tasks, by role', () => {
  const pages = [
    { page: 'Аня', frame: 'page', long: [60, 80], linkedS: 10, bytes: { 'dc-fast': 1000, 'mqtt-room': 50, 'dc-ctl': 0 } },
    { page: 'Аня', frame: 'game', long: [], linkedS: 0, bytes: {} },
    { page: 'Богдан', frame: 'page', long: [], linkedS: 0, bytes: { 'dc-fast': 10 } }
  ];
  assert.deepEqual(traffic(pages, parseFair(FAIR)), {
    host: { sent: { 'dc-fast': 100, 'mqtt-room': 5 }, 'long-page': { n: 2, ms: 140, max: 80 }, 'long-game': { n: 0, ms: 0, max: 0 } },
    guest: { 'long-page': { n: 0, ms: 0, max: 0 } }
  });
});

test('the comparison: every figure of either, the change in %', () => {
  const rows = diff({ open: { med: 330 }, idle: { shelf: 0, game: 12 }, x: { n: 3 } }, { open: { med: 300 }, idle: { shelf: 0, game: 0 }, y: 5 });
  assert.deepEqual(rows, [['open.med', 300, 330, '+10%'], ['idle.shelf', 0, 0, ''], ['idle.game', 0, 12, 'new'], ['x.n', null, 3, ''], ['y', 5, null, '']]);
});

test('the reference in the repository reads as a report', () => {
  const refs = JSON.parse(fs.readFileSync(new URL('../docs/perf-reference.json', import.meta.url), 'utf8'));
  for (const [key, r] of Object.entries(refs)) {
    assert.equal(key, r.game + ':' + r.profile);
    assert.ok(r.metrics && r.when && r.machine, key);
    assert.ok(diff(r.metrics, r.metrics).every(row => row[3] === '' || row[3] === '0%'), key + ': compared with itself, no change');
  }
});
