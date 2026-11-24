// What the user's own decisions change: the order companies are judged in when the budget is short, and nothing else.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadPreferences } from '../src/leads/preferences.ts';
import { chooseForJudgment } from '../src/leads/pipeline.ts';
import { CostMeter } from '../src/leads/cost.ts';
import { emptyMetrics, explain } from '../src/leads/diagnostics.ts';

const item = (name: string, source: string, preScore: number, fromImport = false, type = 'job_posting') => ({ name, fromImport, primary: { pre_score: preScore, signal: { type, source } } });
const cases = [item('a', 'hn-hiring', 0.9), item('b', 'hn-hiring', 0.8), item('c', 'yc-hiring', 0.7), item('d', 'yc-hiring', 0.6), item('e', 'sifted', 0.5)];

test('without weights the order is what it was', () => {
  assert.deepEqual(chooseForJudgment(cases, 3).map((entry) => entry.name), ['a', 'b', 'c']);
  assert.deepEqual(chooseForJudgment(cases, 3, {}).map((entry) => entry.name), ['a', 'b', 'c']);
});

test('a source the user usually wants is judged first, and one they usually do not is judged later', () => {
  const names = chooseForJudgment(cases, 3, { 'yc-hiring': 1.5, 'hn-hiring': 0.5 }).map((entry) => entry.name);
  assert.deepEqual(names, ['c', 'd', 'e'], 'yc first (0.7*1.5, 0.6*1.5), then sifted (0.5) before hn (0.45, 0.4)');
});

test('a weight reorders and never drops: with room for all, every company is still judged', () => {
  const all = chooseForJudgment(cases, 10, { 'hn-hiring': 0.5 }).map((entry) => entry.name).sort();
  assert.deepEqual(all, ['a', 'b', 'c', 'd', 'e']);
});

test('what the user pasted stays first and the news share keeps its place, whatever the weights', () => {
  const mixed = [...cases, item('pasted', 'manual_import', 0.1, true), item('funded', 'techcrunch-startups', 0.2, false, 'funding')];
  const names = chooseForJudgment(mixed, 4, { 'techcrunch-startups': 0.5, 'hn-hiring': 1.5 }).map((entry) => entry.name);
  assert.equal(names[0], 'pasted');
  assert.equal(names[1], 'funded', 'the reserved news slot is not given away');
});

test('the input list is not reordered in place', () => {
  const copy = cases.map((entry) => entry.name);
  chooseForJudgment(cases, 3, { 'yc-hiring': 1.5 });
  assert.deepEqual(cases.map((entry) => entry.name), copy);
});

test('the file the app writes is read, a missing one means no weights, and anything else is a reason', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prefs-'));
  try {
    const path = join(dir, 'p.json');
    assert.deepEqual(loadPreferences(undefined), { ok: true, weights: {} });
    assert.deepEqual(loadPreferences(path), { ok: true, weights: {} });
    writeFileSync(path, JSON.stringify({ source_weights: { 'yc-hiring': 1.25 } }));
    assert.deepEqual(loadPreferences(path), { ok: true, weights: { 'yc-hiring': 1.25 } });
    writeFileSync(path, JSON.stringify({ source_weights: { 'yc-hiring': 9 } }));
    assert.deepEqual(loadPreferences(path), { ok: false, reason: 'the preferences file is not what the app writes' });
    writeFileSync(path, 'not json');
    assert.deepEqual(loadPreferences(path), { ok: false, reason: 'the preferences file could not be read' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the file the Rust side writes (one shared fixture) is read as it was meant', () => {
  const path = new URL('./fixtures/leads/preferences.json', import.meta.url).pathname;
  assert.deepEqual(loadPreferences(path), { ok: true, weights: { 'hn-hiring': 1.38, 'yc-hiring': 0.75 } });
});

test('the run explains when the user decisions changed the order, and says nothing when they did not', () => {
  const metrics = emptyMetrics(60, new CostMeter('none').summary());
  assert.ok(!explain(metrics).some((line) => /past decisions/.test(line)));
  metrics.preferences_sources = 2;
  assert.ok(explain(metrics).some((line) => /2 sources were judged earlier or later because of your past decisions/.test(line)));
});
