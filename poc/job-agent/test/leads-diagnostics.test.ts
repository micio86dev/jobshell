// The cache, the generated queries and the explanation of an empty run. Offline, pure.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { contentKey, openCache } from '../src/leads/cache.ts';
import { CostMeter } from '../src/leads/cost.ts';
import { emptyMetrics, explain } from '../src/leads/diagnostics.ts';
import { baseQueries, planLeadQueries } from '../src/leads/queries.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import { profile } from './support.ts';

const strategy = { ...defaultStrategy(profile), tech_terms: ['laravel', 'vue', 'php'] };
const now = new Date('2026-11-24T00:00:00Z');
const metrics = () => emptyMetrics(60, new CostMeter('claude-sonnet-5-5').summary());
const report = (source: string, skipped: string | null, postings = 0) => ({ source, policy: 'allowed', url: null, pages: 1, status: null, postings, challenge: null, ms: 1, skipped });

test('a cached verdict is returned while fresh, forgotten when old, and a damaged file is an empty cache', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobshell-cache-'));
  const path = join(dir, 'cache.json');
  const cache = openCache(path);
  const key = contentKey('signal', 'text', 'candidate');
  cache.setVerdict(key, { fit: 'strong' }, now);
  cache.setResearch('n:acme', { ok: true }, now);
  cache.save();
  const again = openCache(path);
  assert.deepEqual(again.verdict(key, new Date('2026-11-30T00:00:00Z'), 14), { fit: 'strong' });
  assert.equal(again.verdict(key, new Date('2027-02-01T00:00:00Z'), 14), undefined);
  assert.equal(again.verdict(contentKey('other'), now, 14), undefined);
  assert.deepEqual(again.research('n:acme', now, 14), { ok: true });
  writeFileSync(path, '{broken');
  assert.equal(openCache(path).verdict(key, now, 14), undefined);
});

test('the content key changes when the candidate changes, so a new profile is judged again', () => {
  assert.notEqual(contentKey('s', 't', 'candidate A'), contentKey('s', 't', 'candidate B'));
  assert.equal(contentKey('s', null), contentKey('s', null));
});

test('the base queries come from the profile technologies, in the languages the user works in, with no duplicates', () => {
  const queries = baseQueries({ ...profile, languages: ['it', 'es', 'en'] }, strategy);
  assert.ok(queries.includes('laravel freelance'));
  assert.ok(queries.includes('laravel consulente'));
  assert.ok(queries.includes('laravel autónomo'));
  assert.ok(queries.includes('fractional CTO'));
  assert.equal(new Set(queries).size, queries.length);
  assert.ok(queries.length <= 20);
});

test('the model may add queries, bounded and cleaned, and its failure leaves the base set', async () => {
  const model = (text: string, status = 200): Parameters<typeof planLeadQueries>[2] => ({
    apiKey: 'k', provider: 'anthropic', model: 'm', maxTokens: 100,
    fetchImpl: (async () => ({ status, text: JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: 'end_turn' }) })) as FetchLike,
  });
  const extended = await planLeadQueries(profile, strategy, model('["series A startup needs backend team", "x", "' + 'long '.repeat(30) + '"]'));
  assert.equal(extended.source, 'model');
  assert.ok(extended.queries.includes('series A startup needs backend team'));
  assert.ok(!extended.queries.includes('x'));
  assert.ok(extended.queries.every((query) => query.length <= 80));
  const failed = await planLeadQueries(profile, strategy, model('', 401));
  assert.equal(failed.source, 'fallback');
  assert.deepEqual(failed.queries, baseQueries(profile, strategy));
  assert.equal((await planLeadQueries(profile, strategy, null)).reason, 'no model available');
});

test('an empty run says which sources were unreachable', () => {
  const m = metrics();
  m.sources = [report('hn-hiring', 'status 503'), report('sifted', 'fetch failed: offline')];
  const lines = explain(m);
  assert.match(lines[0] ?? '', /No source was reachable: hn-hiring: status 503; sifted: fetch failed: offline/);
});

test('an empty run says when the filters removed everything, and with what', () => {
  const m = metrics();
  m.sources = [report('hn-hiring', null, 90)];
  m.signals = { collected: 90, unique: 90, unidentified: 0, identified_by_model: 0, naming_skipped: 0 };
  m.companies = { found: 80, with_every_signal_dropped: 80, after_filter: 0, classified: 0, from_cache: 0 };
  m.prefilter_dropped = { stale: 60, onsite_only: 20 };
  assert.match(explain(m).join(' '), /removed every company before judgment: stale \(60\), onsite_only \(20\)/);
});

test('an empty run says when the judge or the research was not available, and what that changes', () => {
  const m = metrics();
  m.sources = [report('sifted', null, 5)];
  m.signals = { collected: 5, unique: 5, unidentified: 3, identified_by_model: 0, naming_skipped: 0 };
  m.judge = { available: false, calls: 0, suspicious: 0, failed: 0 };
  m.research = { ...m.research, available: false, reason: 'the Anthropic account has no credit left' };
  const text = explain(m).join(' ');
  assert.match(text, /3 of 5 signals name no company/);
  assert.match(text, /judgment service was not available/);
  assert.match(text, /research was not available \(the Anthropic account has no credit left\)/);
  assert.match(text, /no contact could be found/);
});

test('an empty run says how near the best company came to the threshold', () => {
  const m = metrics();
  m.sources = [report('hn-hiring', null, 90)];
  m.companies = { found: 40, with_every_signal_dropped: 0, after_filter: 0, classified: 40, from_cache: 0 };
  m.rejected = { 'score below threshold': 38, 'confidence below minimum': 2 };
  m.best_rejected = { company: 'Acme', score: 55.5, reason: 'score 55.5 is below 60' };
  assert.match(explain(m).join(' '), /No company reached the threshold of 60\. Reasons: score below threshold \(38\), confidence below minimum \(2\)\. Closest: Acme at 55\.5/);
});

test('a run with leads still reports what was weak', () => {
  const m = metrics();
  m.sources = [report('hn-hiring', null, 90), report('yc-hiring', 'status 503')];
  m.qualified = 4;
  m.companies = { found: 40, with_every_signal_dropped: 0, after_filter: 0, classified: 30, from_cache: 5 };
  m.research = { ...m.research, skipped_for_budget: 3 };
  const text = explain(m).join(' ');
  assert.match(text, /1 of 2 sources gave nothing: yc-hiring: status 503/);
  assert.match(text, /3 promising companies were not researched/);
  assert.match(text, /4 qualified leads from 30 companies judged/);
});

test('a dry run says what it did and that it bought nothing, not that something was unavailable', () => {
  const m = emptyMetrics(60, new CostMeter('none').summary(), true);
  m.sources = [report('hn-hiring', null, 90)];
  m.signals = { collected: 90, unique: 88, unidentified: 0, identified_by_model: 0, naming_skipped: 0 };
  m.companies = { found: 80, with_every_signal_dropped: 3, after_filter: 77, classified: 0, from_cache: 0 };
  m.judge.available = false;
  assert.deepEqual(explain(m), ['Dry run: 88 signals from 1 sources, 77 of 80 companies passed the free filters. Nothing was judged or researched.']);
});
