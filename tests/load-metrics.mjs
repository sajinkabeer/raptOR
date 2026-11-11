// Evaluates the global METRICS block of web/index.html so its pure functions can be tested in Node.
import { readFileSync } from 'node:fs';

const NAMES = ['calc', 'T', 'seriesNo', 'makeId', 'DIRS', 'DEFAULT_CFG', 'labelFromTime', 'scanCheck', 'nextShotNo', 'shiftShots', 'scanConflicts', 'mergeShots', 'mergeRemote', 'shotRanges', 'shotXY', 'groupBias', 'usualSeries', 'alreadySaved', 'formSplit', 'records'];

export function loadMetrics() {
  const html = readFileSync(new URL('../web/index.html', import.meta.url), 'utf8');
  const src = html.split('/*==METRICS-START==*/')[1].split('/*==METRICS-END==*/')[0];
  return new Function(src + '; return {' + NAMES.join(',') + '};')();
}
