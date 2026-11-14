// The match threshold the user chose in Settings, as a percentage. When the desktop app sets
// it, it replaces the threshold saved in the profile for that run; when it is absent, the profile's applies.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { thresholdOverride } from '../src/match-threshold.ts';

test('with no value set, the profile threshold applies unchanged', () => {
  assert.equal(thresholdOverride({}, 0.9), 0.9);
});

test('a percentage from the environment becomes a fraction', () => {
  assert.equal(thresholdOverride({ JOBSHELL_MATCH_THRESHOLD: '70' }, 0.9), 0.7);
  assert.equal(thresholdOverride({ JOBSHELL_MATCH_THRESHOLD: ' 85 ' }, 0.9), 0.85);
});

test('the bounds are 1% and 100%', () => {
  assert.equal(thresholdOverride({ JOBSHELL_MATCH_THRESHOLD: '1' }, 0.9), 0.01);
  assert.equal(thresholdOverride({ JOBSHELL_MATCH_THRESHOLD: '100' }, 0.9), 1);
});

test('a value outside the bounds, or not a whole number, is refused', () => {
  for (const bad of ['0', '101', '70.5', 'high', '-3']) {
    assert.throws(() => thresholdOverride({ JOBSHELL_MATCH_THRESHOLD: bad }, 0.9), /match threshold/, bad);
  }
});
