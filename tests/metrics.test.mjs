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

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`);

test('shotXY puts score as distance and arrow as direction', () => {
  const c = M.shotXY({ n: 1, s: 10.9, d: '↑' });
  close(c.x, 0); close(c.y, 0);
  const r = M.shotXY({ n: 1, s: 9.9, d: '→' });
  close(r.x, 1); close(r.y, 0);
  const lo = M.shotXY({ n: 1, s: 8.9, d: '↓' });
  close(lo.x, 0); close(lo.y, 2); // y grows downward, like the screen
  assert.equal(M.shotXY({ n: 1, s: 9.5, d: '' }), null);
});

test('groupBias finds a low-left group', () => {
  const shots = [9.1, 9.4, 8.8, 9.6, 10.1].map((s, i) => ({ n: i + 1, s, d: i % 2 ? '↓' : '↙' }));
  const b = M.groupBias(shots);
  assert.equal(b.n, 5);
  assert.equal(b.centred, false);
  assert.ok(b.dir === '↙' || b.dir === '↓', b.dir);
  assert.equal(b.weak, 4);   // shots under 10 with an arrow
  assert.equal(b.weakIn, 4); // all within 45° of the bias direction
});

test('groupBias calls a balanced group centred', () => {
  const shots = ['↑', '↓', '←', '→', '↗', '↙', '↖', '↘'].map((d, i) => ({ n: i + 1, s: 9.5, d }));
  assert.equal(M.groupBias(shots).centred, true);
});

test('groupBias needs 5 shots with arrows', () => {
  assert.equal(M.groupBias(REAL.slice(0, 4)), null);
  assert.equal(M.groupBias(REAL.map(x => ({ ...x, d: '' }))), null);
});

test('usualSeries averages complete series, skipping the one just shot', () => {
  const full = (no, s) => Array.from({ length: 10 }, (_, i) => ({ n: (no - 1) * 10 + i + 1, s, d: '' }));
  const a = sess([...full(1, 9), ...full(2, 10)], { id: 'a' });
  const b = sess([...full(1, 9.5), { n: 11, s: 10, d: '' }], { id: 'b' }); // series 2 incomplete
  const u = M.usualSeries([a, b], 'b', 1);
  assert.equal(u.n, 2);
  close(u.avg, 95);
  assert.equal(M.usualSeries([a], 'a', 1), null); // only one series left: not enough
});

test('alreadySaved finds the session holding every scanned shot unchanged', () => {
  const a = sess(series1(), { id: 'a' });
  const b = sess([...series1(), ...REAL], { id: 'b', date: '2026-11-03' });
  assert.equal(M.alreadySaved([a, b], REAL).id, 'b');           // found even under another date
  assert.equal(M.alreadySaved([a, b], REAL.slice(2, 5)).id, 'b'); // part of a saved series
  const changed = REAL.map(x => x.n === 14 ? { ...x, s: 8.5 } : x);
  assert.equal(M.alreadySaved([a, b], changed), null);           // a different score is new info
  const newArrow = REAL.map(x => x.n === 14 ? { ...x, d: '←' } : x);
  assert.equal(M.alreadySaved([a, b], newArrow), null);
  const extra = [...REAL, { n: 21, s: 10, d: '↑' }];
  assert.equal(M.alreadySaved([a, b], extra), null);             // a shot not saved yet
  assert.equal(M.alreadySaved([a, b], []), null);
});

const day = (id, scores, d = '') => sess(scores.map((s, i) => ({ n: i + 1, s, d })), { id, date: '2026-11-0' + id.slice(-1) });
const ten = v => Array(10).fill(v);

test('formSplit compares the latest sessions with the ones before', () => {
  const L = [1, 2, 3, 4, 5, 6, 7].map(i => day('s' + i, ten(9)));
  let f = M.formSplit(L);
  assert.deepEqual(f.recent.map(s => s.id), ['s5', 's6', 's7']);
  assert.equal(f.earlier.length, 4);
  f = M.formSplit(L.slice(0, 3));
  assert.deepEqual(f.recent.map(s => s.id), ['s3']);
  assert.equal(f.earlier.length, 2);
  assert.equal(M.formSplit(L.slice(0, 1)), null);
});

test('records picks best average, tens, series and tightest session', () => {
  const a = day('s1', [...ten(9), ...ten(10.5)]);           // series 2 = 105.0, the best series
  const b = day('s2', ten(10.1));                            // best average 10.1, 100% tens, SD 0
  const c = day('s3', [9, 10, 9, 10, 9, 10, 9, 10, 9, 10]); // spread out
  const tiny = day('s4', [10.9, 10.9]);                      // under 10 shots: ignored
  const r = M.records([a, b, c, tiny]);
  assert.equal(r.bestAvg.s.id, 's2'); assert.equal(r.bestAvg.v, 10.1);
  assert.equal(r.bestTens.s.id, 's2');
  assert.equal(r.bestSeries.s.id, 's1'); assert.equal(r.bestSeries.no, 2); assert.equal(r.bestSeries.sum, 105);
  assert.equal(r.tightest.s.id, 's2');
  assert.equal(M.records([tiny]), null);
});
