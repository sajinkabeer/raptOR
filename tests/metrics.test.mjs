import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadMetrics } from './load-metrics.mjs';

const M = loadMetrics();

test('calc sums in tenths', () => {
  const c = M.calc({ shots: [{ n: 1, s: 10.5 }, { n: 2, s: 9.8 }, { n: 3, s: 10.0 }] });
  assert.equal(c.n, 3);
  assert.equal(c.sum, 30.3);
  assert.equal(c.tensN, 2);
});

const REAL = [
  { n: 11, s: 9.8, d: '↘' }, { n: 12, s: 10.6, d: '↓' }, { n: 13, s: 10.3, d: '↖' }, { n: 14, s: 8.4, d: '→' },
  { n: 15, s: 9.6, d: '↙' }, { n: 16, s: 10.2, d: '↗' }, { n: 17, s: 8.5, d: '↗' }, { n: 18, s: 8.9, d: '↗' },
  { n: 19, s: 9.7, d: '↙' }, { n: 20, s: 9.7, d: '↗' },
];
const series1 = () => Array.from({ length: 10 }, (_, i) => ({ n: i + 1, s: 10, d: '' }));
const sess = (shots, extra) => Object.assign({ id: '2026-11-04_morning', date: '2026-11-04', label: 'Morning', fired: 60, shots, seriesTimes: {}, updatedAt: 100 }, extra);

test('labelFromTime', () => {
  assert.equal(M.labelFromTime('08:33'), 'Morning');
  assert.equal(M.labelFromTime('12:00'), 'Afternoon');
  assert.equal(M.labelFromTime('16:59'), 'Afternoon');
  assert.equal(M.labelFromTime('17:00'), 'Evening');
  assert.equal(M.labelFromTime(null), 'Other');
  assert.equal(M.labelFromTime('nonsense'), 'Other');
});

test('scanCheck real photo matches', () => {
  assert.deepEqual(M.scanCheck(REAL, 95.7), { sum: 95.7, subtotal: 95.7, ok: true });
  assert.equal(M.scanCheck(REAL, 95.8).ok, false);
  assert.equal(M.scanCheck(REAL, null).ok, null);
});

test('mergeShots partial series', () => {
  const base = sess(series1());
  const merged = M.mergeShots(base, REAL.slice(0, 4), '08:33');
  assert.equal(merged.shots.length, 14);
  assert.equal(merged.fired, 60);
  assert.equal(merged.seriesTimes[2], '08:33');
  assert.equal(base.shots.length, 10);
  assert.deepEqual(M.calc(merged).missing.slice(0, 2), [15, 16]);
});

test('mergeShots replaces by n', () => {
  const merged = M.mergeShots(sess(REAL.slice()), [{ n: 12, s: 10.1, d: '↓' }], null);
  assert.equal(merged.shots.length, 10);
  assert.equal(merged.shots.find((x) => x.n === 12).s, 10.1);
});

test('scanConflicts', () => {
  assert.deepEqual(M.scanConflicts(sess(REAL.slice()), [{ n: 12, s: 10.6, d: '↓' }, { n: 13, s: 10.3, d: '↗' }, { n: 21, s: 9, d: '' }]), [13]);
  assert.deepEqual(M.scanConflicts(null, REAL), []);
});

test('mergeRemote keeps pending local-only session', () => {
  const A = sess([], { id: 'A' });
  assert.deepEqual(M.mergeRemote([A], [], { A: 'upsert' }), [A]);
});

test('mergeRemote hides pending delete', () => {
  const B = sess([], { id: 'B' });
  assert.deepEqual(M.mergeRemote([], [B], { B: 'delete' }), []);
});

test('mergeRemote newer pending local wins', () => {
  const local = sess([], { id: 'A', updatedAt: 200, note: 'local' });
  const remote = sess([], { id: 'A', updatedAt: 100, note: 'remote' });
  assert.equal(M.mergeRemote([local], [remote], { A: 'upsert' })[0].note, 'local');
  assert.equal(M.mergeRemote([local], [remote], {})[0].note, 'remote');
});

test('shotRanges compresses runs', () => {
  assert.equal(M.shotRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 21, 22, 23, 40]), '1–10, 21–23, 40');
  assert.equal(M.shotRanges([]), '');
});
