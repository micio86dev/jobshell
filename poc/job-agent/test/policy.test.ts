// Tests for the per-source guardrail. This module is what stands between a
// measurement and a ban, so every clamp is asserted from both sides.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultConfig, type AgentConfig } from '../src/config.ts';
import {
  MEASUREMENT_PACE_MS,
  Pacer,
  assertAutomationAllowed,
  resolvePolicy,
} from '../src/policy.ts';

const config = (patch: Partial<AgentConfig> = {}): AgentConfig => ({ ...defaultConfig(), ...patch });

test('LinkedIn and Indeed default to measurement_only', () => {
  for (const source of ['linkedin', 'indeed']) {
    const policy = resolvePolicy(source, config());
    assert.equal(policy.automation, 'measurement_only', source);
    assert.equal(policy.paceMs, MEASUREMENT_PACE_MS, source);
    assert.equal(policy.maxPages, 5, source);
  }
});

test('ATS feeds default to allowed at the configured floor', () => {
  for (const source of ['greenhouse', 'lever', 'ashby', 'recruitee']) {
    const policy = resolvePolicy(source, config());
    assert.equal(policy.automation, 'allowed', source);
    assert.equal(policy.paceMs, 8000, source);
  }
});

test('an unknown source is prohibited rather than guessed', () => {
  assert.equal(resolvePolicy('monster', config()).automation, 'prohibited');
  assert.equal(resolvePolicy('', config()).automation, 'prohibited');
});

test('an override can tighten a source but never loosen it', () => {
  const loosened = resolvePolicy('linkedin', config({ sources: { linkedin: { automation: 'allowed' } } }));
  assert.equal(loosened.automation, 'measurement_only');

  const tightened = resolvePolicy('greenhouse', config({ sources: { greenhouse: { automation: 'prohibited' } } }));
  assert.equal(tightened.automation, 'prohibited');

  const toMeasurement = resolvePolicy('greenhouse', config({ sources: { greenhouse: { automation: 'measurement_only' } } }));
  assert.equal(toMeasurement.automation, 'measurement_only');
});

test('a source override can never lower the pace floor', () => {
  const policy = resolvePolicy('linkedin', config({ sources: { linkedin: { pace_ms: 10 } } }));
  assert.equal(policy.paceMs, MEASUREMENT_PACE_MS);
});

test('a source override can raise the pace above the floor', () => {
  const policy = resolvePolicy('indeed', config({ sources: { indeed: { pace_ms: 60000 } } }));
  assert.equal(policy.paceMs, 60000);
});

test('a source override can never raise the page ceiling', () => {
  const policy = resolvePolicy('greenhouse', config({ sources: { greenhouse: { max_pages: 50 } } }));
  assert.equal(policy.maxPages, 5);
});

test('a source override can lower the page ceiling', () => {
  const policy = resolvePolicy('greenhouse', config({ sources: { greenhouse: { max_pages: 1 } } }));
  assert.equal(policy.maxPages, 1);
});

test('prohibited is refused with the source named', () => {
  const policy = resolvePolicy('monster', config());
  assert.throws(() => assertAutomationAllowed('monster', policy), /monster.*prohibited/i);
});

test('measurement_only is refused with an attended-session explanation', () => {
  const policy = resolvePolicy('linkedin', config());
  assert.throws(() => assertAutomationAllowed('linkedin', policy), /measurement_only.*attended/i);
});

test('allowed passes', () => {
  assert.doesNotThrow(() => assertAutomationAllowed('greenhouse', resolvePolicy('greenhouse', config())));
});

test('the pacer waits the remaining interval and nothing after a long gap', async () => {
  let now = 0;
  const waits: number[] = [];
  const pacer = new Pacer(1000, () => now, async (ms) => {
    waits.push(ms);
    now += ms;
  });

  await pacer.next();
  assert.deepEqual(waits, [], 'the first call never waits');

  now = 200;
  await pacer.next();
  assert.deepEqual(waits, [800]);

  now = 10_000;
  await pacer.next();
  assert.deepEqual(waits, [800], 'a gap longer than the pace waits for nothing');
});
