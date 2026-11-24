// Company identification and signal deduplication for the lead pipeline. Offline, pure.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { companyKeyOf, dedupeSignals, groupByCompany, normalizeCompanyName, postingToSignal } from '../src/leads/company.ts';
import type { Posting } from '../src/sources/types.ts';

const posting = (over: Partial<Posting> = {}): Posting => ({
  source: 'lever',
  id: '1',
  title: 'Senior Laravel Developer',
  company: 'Acme GmbH',
  location: 'Berlin',
  url: 'https://jobs.lever.co/acme/1',
  remote_hint: true,
  description: 'Build our SaaS with Laravel and Vue.',
  published_at: '2026-11-20',
  salary: null,
  ...over,
});

test('legal suffixes, case, accents and punctuation do not make two spellings two companies', () => {
  assert.equal(normalizeCompanyName('Acme GmbH'), 'acme');
  assert.equal(normalizeCompanyName('ACME, Inc.'), 'acme');
  assert.equal(normalizeCompanyName('Café Société S.r.l.'), 'cafe societe');
  assert.equal(normalizeCompanyName('  Acme   B.V. '), 'acme');
  assert.equal(normalizeCompanyName(''), '');
});

test('a name that is only a legal suffix is not a company', () => {
  assert.equal(normalizeCompanyName('Ltd'), '');
});

test('the company key comes from the name, then from the employer site, then from the board tenant', () => {
  assert.equal(companyKeyOf({ company: 'Acme GmbH', url: 'https://x.test/1' }), 'n:acme');
  assert.equal(companyKeyOf({ company: null, url: 'https://www.acme.io/careers/1' }), 'd:acme.io');
  assert.equal(companyKeyOf({ company: null, url: 'https://jobs.lever.co/globex/9' }), 't:lever:globex');
  assert.equal(companyKeyOf({ company: null, url: 'https://globex.teamtailor.com/jobs/9' }), 't:teamtailor:globex');
});

test('an aggregator host is never taken for the employer site', () => {
  assert.equal(companyKeyOf({ company: null, url: 'https://www.linkedin.com/jobs/view/1' }), null);
  assert.equal(companyKeyOf({ company: null, url: 'not a url' }), null);
});

test('a posting becomes a signal that keeps its evidence and a stable id', () => {
  const signal = postingToSignal(posting(), new Date('2026-11-24T10:00:00Z'));
  assert.equal(signal.type, 'job_posting');
  assert.equal(signal.company_name, 'Acme GmbH');
  assert.equal(signal.source, 'lever');
  assert.equal(signal.url, 'https://jobs.lever.co/acme/1');
  assert.equal(signal.observed_at, '2026-11-24T10:00:00.000Z');
  assert.equal(signal.id, postingToSignal(posting(), new Date('2027-01-01')).id);
  assert.notEqual(signal.id, postingToSignal(posting({ id: '2' }), new Date()).id);
});

test('the same job on two sources is one signal that remembers both sources', () => {
  const now = new Date('2026-11-24T10:00:00Z');
  const a = postingToSignal(posting({ source: 'lever', url: 'https://jobs.lever.co/acme/1' }), now);
  const b = postingToSignal(
    posting({ source: 'workable', id: 'w9', url: 'https://apply.workable.com/acme/j/9', company: 'ACME Inc.' }),
    now,
  );
  const merged = dedupeSignals([a, b]);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0]?.sources, ['lever', 'workable']);
});

test('two different roles of the same company stay two signals', () => {
  const now = new Date();
  const a = postingToSignal(posting({ id: '1', title: 'Senior Laravel Developer' }), now);
  const b = postingToSignal(posting({ id: '2', title: 'Head of Engineering' }), now);
  assert.equal(dedupeSignals([a, b]).length, 2);
});

test('grouping puts every signal of a company together, and a signal with no company stays visible', () => {
  const now = new Date();
  const a = postingToSignal(posting({ id: '1' }), now);
  const b = postingToSignal(posting({ id: '2', title: 'Head of Engineering' }), now);
  const c = postingToSignal(posting({ id: '3', company: 'Globex' }), now);
  const lost = postingToSignal(posting({ id: '4', company: null, url: 'https://www.linkedin.com/jobs/view/4' }), now);
  const groups = groupByCompany([a, b, c, lost]);
  assert.equal(groups.companies.length, 2);
  assert.equal(groups.companies.find((g) => g.key === 'n:acme')?.signals.length, 2);
  assert.equal(groups.unidentified.length, 1);
});
