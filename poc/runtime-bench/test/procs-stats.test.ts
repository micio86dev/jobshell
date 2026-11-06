import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findRootPids, parseCpuTime, sumSubtree, type ProcRow } from '../src/lib/procs.ts';
import { aggregate, median, measured } from '../src/lib/stats.ts';

test('parseCpuTime reads the MM:SS.ss shape ps prints for short-lived processes', () => {
  assert.equal(parseCpuTime('00:01.50'), 1.5);
  assert.equal(parseCpuTime('12:34.00'), 754);
});

test('parseCpuTime reads the HH:MM:SS shape', () => {
  assert.equal(parseCpuTime('01:00:00'), 3600);
  assert.equal(parseCpuTime('02:03:04'), 7384);
});

test('parseCpuTime reads the DD-HH:MM:SS shape without dropping the day prefix', () => {
  assert.equal(parseCpuTime('1-02:03:04.05'), 93784.05);
  assert.equal(parseCpuTime('2-00:00:00'), 172800);
});

test('parseCpuTime returns 0 for empty or malformed input instead of NaN', () => {
  assert.equal(parseCpuTime(''), 0);
  assert.equal(parseCpuTime('   '), 0);
  assert.equal(Number.isNaN(parseCpuTime('abc')), false);
});

test('median returns null for an empty list rather than a fabricated zero', () => {
  assert.equal(median([]), null);
});

test('median returns the middle value for an odd count and the mean of the pair for an even count', () => {
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
});

test('median keeps fractional precision instead of rounding memory and CPU values', () => {
  assert.equal(median([100, 101.3]), 100.65);
  assert.equal(median([100.1, 100.2, 100.25]), 100.2);
});

test('median does not mutate the caller array', () => {
  const values = [3, 1, 2];
  median(values);
  assert.deepEqual(values, [3, 1, 2]);
});

test('measured drops nulls and non-finite values so they cannot enter an aggregate', () => {
  assert.deepEqual(measured([1, null, 2, Number.NaN]), [1, 2]);
  assert.deepEqual(measured([]), []);
});

test('aggregate reports the count of measured runs beside the median', () => {
  assert.deepEqual(aggregate([10, null, 20]), { median: 15, n: 2, values: [10, 20] });
  assert.deepEqual(aggregate([10.5, 20.5]), { median: 15.5, n: 2, values: [10.5, 20.5] });
  assert.deepEqual(aggregate([null, null]), { median: null, n: 0, values: [] });
});

const row = (pid: number, ppid: number, rss: number, cpu: number, command = 'chrome'): ProcRow => ({
  pid,
  ppid,
  rss_kb: rss,
  cpu_seconds: cpu,
  command,
});

test('findRootPids matches on the unique profile marker', () => {
  const rows = [
    row(10, 1, 100, 0, 'chrome --user-data-dir=/tmp/run-a/profile'),
    row(11, 10, 200, 0, 'chrome --user-data-dir=/tmp/run-b/profile'),
  ];
  assert.deepEqual(findRootPids(rows, '/tmp/run-a/profile'), [10]);
  assert.deepEqual(findRootPids(rows, '/tmp/none'), []);
});

test('sumSubtree adds a browser and all of its descendants', () => {
  const rows = [
    row(10, 1, 100, 1),
    row(11, 10, 50, 2),
    row(12, 10, 25, 0.5),
    row(13, 11, 25, 0.25),
    row(99, 1, 999, 99),
  ];
  assert.deepEqual(sumSubtree(rows, [10]), { processes: 4, rss_kb: 200, cpu_seconds: 3.75 });
});

test('sumSubtree ignores an unrelated process and survives a ppid cycle', () => {
  const rows = [row(10, 1, 100, 1), row(11, 10, 50, 1), row(10, 11, 100, 1)];
  const totals = sumSubtree(rows, [10]);
  assert.equal(totals.processes, 2);
  assert.equal(totals.rss_kb, 150);
});

test('sumSubtree returns zeros for an unknown root', () => {
  assert.deepEqual(sumSubtree([row(10, 1, 100, 1)], [42]), { processes: 0, rss_kb: 0, cpu_seconds: 0 });
});
