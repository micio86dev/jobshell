// The free filter before the paid judgment, and the strategy it reads. Offline, pure.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { negativesOf, prefilter, preScore } from '../src/leads/prefilter.ts';
import { applyChange, defaultStrategy, loadStrategy, techTermsOf } from '../src/leads/strategy.ts';
import type { Signal } from '../src/leads/types.ts';
import { parseProfile } from '../src/profile.ts';

const real = parseProfile(JSON.parse(readFileSync(new URL('./fixtures/profile.real.redacted.json', import.meta.url), 'utf8')));
assert.ok(real.ok, 'the redacted real profile must stay a valid profile');
const profile = real.ok ? real.profile : (undefined as never);
const strategy = defaultStrategy(profile);
const now = new Date('2026-11-24T12:00:00Z');

const signal = (over: Partial<Signal> = {}): Signal => ({
  id: 'a', type: 'job_posting', source: 'lever', sources: ['lever'], url: 'https://x.test/1',
  title: 'Senior Laravel Developer', text: 'We build a SaaS platform with Laravel and Vue. Remote.', company_name: 'Acme',
  location: null, remote_hint: true, salary: null, published_at: '2026-11-20T00:00:00Z', observed_at: now.toISOString(), ...over,
});

test('the strategy restates the real profile: the technologies it names, and no others', () => {
  const terms = techTermsOf(profile);
  for (const expected of ['php', 'laravel', 'vue', 'nuxt', 'typescript', 'node', 'mysql', 'postgresql', 'mongodb', 'ionic', 'openai', 'claude']) {
    assert.ok(terms.includes(expected), `${expected} is in the CV`);
  }
  for (const absent of ['rust', 'python', 'kubernetes', 'flutter']) assert.ok(!terms.includes(absent), `${absent} is not in this redacted CV`);
});

test('the default strategy follows the priority markets and never needs a file', () => {
  assert.deepEqual(strategy.target_markets.slice(0, 4), ['DE', 'NL', 'CH', 'GB']);
  assert.deepEqual(loadStrategy(profile, '/nonexistent/leads.json'), { ok: true, strategy });
});

test('a strategy file overrides one field and an invalid field is named, never ignored', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobshell-strategy-'));
  const good = join(dir, 'good.json');
  writeFileSync(good, JSON.stringify({ threshold: 72, stale_days: { funding: 10 } }));
  const loaded = loadStrategy(profile, good);
  assert.ok(loaded.ok);
  if (loaded.ok) {
    assert.equal(loaded.strategy.threshold, 72);
    assert.equal(loaded.strategy.stale_days['funding'], 10);
    assert.equal(loaded.strategy.stale_days['job_posting'], 30, 'the other kinds keep their defaults');
  }
  const bad = join(dir, 'bad.json');
  writeFileSync(bad, JSON.stringify({ threshold: 400 }));
  const rejected = loadStrategy(profile, bad);
  assert.ok(!rejected.ok);
  if (!rejected.ok) assert.match(rejected.error, /threshold/);
  const broken = join(dir, 'broken.json');
  writeFileSync(broken, '{nope');
  assert.deepEqual(loadStrategy(profile, broken), { ok: false, error: 'leads strategy: the file is not valid JSON' });
});

test('unpaid work, internships, junior roles and closed items are dropped with their reason', () => {
  assert.deepEqual(negativesOf(signal({ text: 'Unpaid volunteer role, great exposure' }), strategy, now), ['unpaid']);
  assert.deepEqual(negativesOf(signal({ title: 'Software Engineering Intern' }), strategy, now), ['internship']);
  assert.deepEqual(negativesOf(signal({ title: 'Junior PHP Developer' }), strategy, now), ['junior']);
  assert.deepEqual(negativesOf(signal({ text: 'This position has been filled.' }), strategy, now), ['closed']);
});

test('on-site-only drops a job unless the source says remote', () => {
  assert.deepEqual(negativesOf(signal({ text: '100% on-site in Milan', remote_hint: null }), strategy, now), ['onsite_only']);
  assert.deepEqual(negativesOf(signal({ text: '100% on-site in Milan', remote_hint: true }), strategy, now), []);
});

test('a stale signal is dropped by its own kind, and a pasted post is never stale', () => {
  assert.deepEqual(negativesOf(signal({ published_at: '2026-09-01T00:00:00Z' }), strategy, now), ['stale']);
  assert.deepEqual(negativesOf(signal({ type: 'funding', published_at: '2026-09-01T00:00:00Z' }), strategy, now), []);
  assert.deepEqual(negativesOf(signal({ type: 'manual_import', published_at: '2025-01-01T00:00:00Z' }), strategy, now), []);
});

test('no budget, no freelance wording, an hourly contract and another stack are not reasons to drop', () => {
  assert.deepEqual(negativesOf(signal({ title: 'Senior Go Engineer', text: 'Hourly contract, rate to be discussed. Remote.', salary: null }), strategy, now), []);
});

test('an excluded company or term is dropped', () => {
  const custom = { ...strategy, exclude_companies: ['ACME Inc.'], exclude_terms: ['crypto'] };
  assert.deepEqual(negativesOf(signal(), custom, now), ['excluded_company']);
  assert.deepEqual(negativesOf(signal({ company_name: 'Other', text: 'a crypto exchange' }), custom, now), ['excluded_term']);
});

test('a freelance request outranks a plain vacancy, and the technology the profile names raises the score', () => {
  const request = preScore(signal({ type: 'freelance_request', title: 'Seeking freelance Laravel developer' }), strategy, now);
  const vacancy = preScore(signal({ title: 'Account Manager', text: 'Sales role in a retail chain.' }), strategy, now);
  assert.ok(request.pre_score > vacancy.pre_score);
  assert.deepEqual(request.tech_hits.sort(), ['laravel', 'vue']);
  const stack = preScore(signal({ text: 'PHP, Laravel, Vue, Nuxt, TypeScript' }), strategy, now);
  const none = preScore(signal({ text: 'Our office has a nice view.' }), strategy, now);
  assert.ok(stack.pre_score > none.pre_score);
});

test('prefilter keeps the promising signals best first and explains every drop', () => {
  const good = signal({ id: 'good', type: 'freelance_request' });
  const meh = signal({ id: 'meh', title: 'Office Manager', text: 'Run the office.' });
  const intern = signal({ id: 'intern', title: 'Developer Intern' });
  const result = prefilter([meh, intern, good], strategy, now);
  assert.deepEqual(result.kept.map((ranked) => ranked.signal.id), ['good', 'meh']);
  assert.deepEqual(result.dropped.map((drop) => [drop.signal.id, drop.negatives]), [['intern', ['internship']]]);
});

test('a change from the app keeps only the fields the user set, so the rest keeps following the profile', () => {
  const first = applyChange(profile, {}, { threshold: 70, target_markets: ['DE', 'NL'] });
  assert.ok(first.ok);
  if (!first.ok) return;
  assert.deepEqual(first.overrides, { threshold: 70, target_markets: ['DE', 'NL'] });
  const second = applyChange(profile, first.overrides, { usd_cap: 2 });
  assert.ok(second.ok);
  if (second.ok) assert.deepEqual(second.overrides, { threshold: 70, target_markets: ['DE', 'NL'], usd_cap: 2 });
});

test('a change the app may not make, or a value that is invalid, is refused by name and writes nothing', () => {
  assert.deepEqual(applyChange(profile, {}, { stale_days: { funding: 1 } }), { ok: false, error: 'leads strategy: stale_days cannot be changed from the app' });
  const bad = applyChange(profile, {}, { threshold: 150 });
  assert.ok(!bad.ok);
  if (!bad.ok) assert.match(bad.error, /threshold is invalid/);
  const badMarket = applyChange(profile, {}, { target_markets: ['GERMANY'] });
  assert.ok(!badMarket.ok);
  assert.ok(!applyChange(profile, { threshold: 70 }, { usd_cap: -1 }).ok);
});
