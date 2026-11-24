// The 100-point score, its confidence, and the gate. Offline, pure.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Classification } from '../src/leads/classify.ts';
import { asksForOutsideHelp, DIMENSIONS, needSummary, nextAction, scoreCase, type CaseInput } from '../src/leads/score.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import type { Contact, Fact, Signal } from '../src/leads/types.ts';
import { profile as fixtureProfile } from './support.ts';

const strategy = defaultStrategy(fixtureProfile);
const signal = (over: Partial<Signal> = {}): Signal => ({
  id: 's1', type: 'freelance_request', source: 'hn-hiring', sources: ['hn-hiring'], url: 'https://news.ycombinator.com/item?id=1',
  title: 'Acme | Contract Laravel engineer | REMOTE', text: null, company_name: 'Acme', location: null, remote_hint: true, salary: null,
  published_at: null, observed_at: '2026-11-24T00:00:00Z', ...over,
});
const answer = <T extends string>(verdict: T, rest: Record<string, number> = {}) => ({ verdict, probabilities: { [verdict]: 0.9, ...rest } });
const strong: Classification = {
  need: answer('explicit_external', { probable_gap: 0.1 }), b2b: 0.9, longterm: 0.7, fit: answer('strong'), level: answer('matches'),
  remote: answer('remote_ok'), quality: { verdict: 'genuine', suspicion: 0.05 }, usage: { input_tokens: 800, output_tokens: 30 },
};
const fact = (field: string, provenance: Fact['provenance'] = 'reported'): Fact => ({ field, value: 'v', provenance, source_url: provenance === 'inferred' ? null : 'https://x.test', quote: provenance === 'inferred' ? null : 'q' });
const base = (over: Partial<CaseInput> = {}): CaseInput => ({
  primary: signal(), signals: [signal()], classification: strong, facts: [], contacts: [], legitimacy: null, country: null, tech_hits: ['laravel', 'vue'],
  researched: false, strategy, ...over,
});

test('the six dimensions sum to a hundred and the total is the sum of the lines', () => {
  assert.equal(DIMENSIONS.reduce((sum, dimension) => sum + dimension.max, 0), 100);
  const scored = scoreCase(base());
  assert.deepEqual(scored.dimensions.map((dimension) => dimension.name), DIMENSIONS.map((dimension) => dimension.name));
  assert.equal(scored.total, Math.round(scored.dimensions.reduce((sum, dimension) => sum + dimension.points, 0) * 10) / 10);
  assert.ok(scored.dimensions.every((dimension) => dimension.explanation.length > 10 && dimension.evidence.length > 0 && dimension.points <= dimension.max));
});

test('a company that asks for a contractor, in the user stack, qualifies even with no financial data at all', () => {
  const scored = scoreCase(base());
  assert.equal(scored.qualified, true);
  assert.equal(scored.rejection_reason, null);
  assert.ok(scored.total >= strategy.threshold);
  const capacity = scored.dimensions.find((dimension) => dimension.name === 'company_capacity');
  assert.equal(capacity?.points, 8, 'unknown is neutral: 40% of the points');
  assert.match(capacity?.explanation ?? '', /neutral, not as a weakness/);
});

test('proven funding raises capacity, the model own reading does not', () => {
  const none = scoreCase(base()).dimensions.find((d) => d.name === 'company_capacity')?.points ?? 0;
  const funded = scoreCase(base({ facts: [fact('funding')], researched: true })).dimensions.find((d) => d.name === 'company_capacity')?.points ?? 0;
  const guessed = scoreCase(base({ facts: [fact('funding', 'inferred'), fact('revenue', 'inferred')] })).dimensions.find((d) => d.name === 'company_capacity')?.points ?? 0;
  assert.ok(funded > none);
  assert.equal(guessed, none);
});

test('capacity does not make a company that does not need engineers a lead', () => {
  const rich: Classification = { ...strong, need: answer('unrelated', { employee_only: 0.1 }), b2b: 0.1, longterm: 0.3, fit: answer('none'), level: answer('matches') };
  const scored = scoreCase(base({ classification: rich, facts: [fact('funding'), fact('revenue'), fact('company_size')], legitimacy: 'real', researched: true }));
  assert.equal(scored.qualified, false);
  assert.match(scored.rejection_reason ?? '', /not about a company that needs software engineering/);
});

test('a recruiter or talent marketplace building its own pool is rejected, and a software agency short of capacity is not', () => {
  const recruiter: Classification = { ...strong, need: answer('recruitment_marketing', { employee_only: 0.1 }), b2b: 0.4 };
  const result = scoreCase(base({ classification: recruiter }));
  assert.equal(result.qualified, false);
  assert.match(result.rejection_reason ?? '', /recruitment marketing, not a client/);
  const agency: Classification = { ...strong, need: answer('probable_gap', { explicit_external: 0.2 }) };
  assert.equal(scoreCase(base({ classification: agency })).qualified, true);
});

test('a company-level signal alone is held until a second independent source confirms it', () => {
  const news = signal({ id: 'n1', type: 'funding', url: 'https://sifted.test/a', title: 'Acme raises 8m' });
  const probable: Classification = { ...strong, need: answer('probable_gap', { explicit_external: 0.1 }) };
  const alone = scoreCase(base({ primary: news, signals: [news], classification: probable }));
  assert.equal(alone.qualified, false);
  assert.match(alone.rejection_reason ?? '', /one source is not enough: research could not confirm it/);
  const confirmed = scoreCase(base({ primary: news, signals: [news], classification: probable, researched: true, facts: [{ field: 'funding', value: '8m', provenance: 'reported', source_url: 'https://other.test/x', quote: 'raised 8m' }] }));
  assert.equal(confirmed.qualified, true, 'a second place shows the same thing');
  assert.match(scoreCase(base({ primary: news, signals: [news], classification: probable, researched: true })).rejection_reason ?? '', /no second independent source confirmed it/);
  const asked: Classification = { ...strong, need: answer('explicit_external', { probable_gap: 0.1 }) };
  const askingNews = signal({ id: 'n2', type: 'funding', url: 'https://sifted.test/b', title: 'Acme raises 8m and looks for a freelance backend engineer' });
  assert.equal(scoreCase(base({ primary: askingNews, signals: [askingNews], classification: asked })).qualified, true, 'a company that asks needs no second source');
  // The judge says "asks", the words say nothing of the sort: the judge is not enough.
  const silent = scoreCase(base({ primary: news, signals: [news], classification: asked }));
  assert.equal(silent.qualified, false);
  assert.match(silent.rejection_reason ?? '', /one source is not enough/);
  assert.equal(scoreCase(base({ classification: probable })).qualified, true, 'a posting is the offer itself');
});

test('an employee vacancy is not rejected: it scores lower on B2B and can still qualify when everything else is strong', () => {
  const vacancy: Classification = { ...strong, need: answer('employee_only', { probable_gap: 0.1 }), b2b: 0.7 };
  const scored = scoreCase(base({ classification: vacancy, facts: [fact('funding'), fact('hiring')], legitimacy: 'real', researched: true, country: 'DE', signals: [signal(), signal({ id: 's2', sources: ['sifted'] })] }));
  const b2b = scored.dimensions.find((d) => d.name === 'b2b_potential');
  assert.match(b2b?.explanation ?? '', /not ruled out/);
  assert.ok((b2b?.points ?? 0) < 20);
  assert.equal(scored.qualified, true);
});

test('a doubtful business, a scheme, a junior role and an unrelated company are all rejected with their reason', () => {
  assert.match(scoreCase(base({ legitimacy: 'doubtful' })).rejection_reason ?? '', /doubtful/);
  const scam: Classification = { ...strong, quality: { verdict: 'scam', suspicion: 0.9 } };
  assert.match(scoreCase(base({ classification: scam })).rejection_reason ?? '', /scheme or vague bait/);
  const junior: Classification = { ...strong, level: answer('junior_role') };
  const result = scoreCase(base({ classification: junior }));
  assert.ok(result.total < scoreCase(base()).total);
  assert.match(scoreCase(base({ negatives: ['internship'] })).rejection_reason ?? '', /set aside: internship/);
});

test('a high score on thin evidence is shown as such: confidence and completeness are separate from the score', () => {
  const thin = scoreCase(base());
  const solid = scoreCase(base({
    facts: [fact('funding'), fact('company_size'), fact('hiring'), fact('website'), fact('description')], legitimacy: 'real', researched: true, country: 'NL',
    contacts: [{ role: 'CTO', name: 'Jo', channel: 'email', value: 'cto@a.test', source_url: 'https://a.test', quote: 'Jo, CTO', verified: true } satisfies Contact],
    signals: [signal(), signal({ id: 's2', sources: ['sifted'] })],
  }));
  assert.ok(solid.confidence > thin.confidence);
  assert.ok(solid.completeness > thin.completeness);
  assert.ok(thin.completeness < 0.3);
});

test('a missing confidence floor rejects: the evidence is too thin to show', () => {
  const picky = { ...strategy, min_confidence: 0.95 };
  const result = scoreCase(base({ strategy: picky }));
  assert.equal(result.qualified, false);
  assert.match(result.rejection_reason ?? '', /confidence/);
});

test('a target market lifts the remote and international line, an unknown country does not penalise it much', () => {
  const dimension = (country: string | null): number => scoreCase(base({ country })).dimensions.find((d) => d.name === 'remote_international')?.points ?? 0;
  assert.ok(dimension('DE') > dimension('BR'));
  assert.ok(dimension(null) > dimension('BR'));
});

test('the next step names the person when there is one, the post when it is a request, and says plainly when there is no contact', () => {
  const contact: Contact = { role: 'CTO', name: 'Jo Doe', channel: 'page', value: 'https://a.test/team', source_url: 'https://a.test/team', quote: 'Jo Doe, CTO', verified: true };
  assert.match(nextAction(base({ contacts: [contact] }), null), /Write to Jo Doe \(CTO\)/);
  assert.match(nextAction(base(), null), /Reply where it was posted/);
  assert.match(nextAction(base({ primary: signal({ type: 'job_posting' }) }), 'https://a.test'), /No public contact was found/);
  assert.match(needSummary(base(), 'Series A, hiring.'), /Asks for outside engineers\. Series A, hiring\. Evidence: Acme/);
});

test('the text must say it asks for an outside engineer, in any of the user languages', () => {
  const s = (title: string) => [signal({ title, text: null })];
  assert.equal(asksForOutsideHelp(s('Seeking freelance Laravel developer')), true);
  assert.equal(asksForOutsideHelp(s('Sviluppatore in partita IVA')), true);
  assert.equal(asksForOutsideHelp(s('Desarrollador autónomo para proyecto')), true);
  assert.equal(asksForOutsideHelp(s('Hourly contract, six months')), true);
  assert.equal(asksForOutsideHelp(s('Nango: A single API for all your integrations')), false);
  assert.equal(asksForOutsideHelp(s('Senior Full-Stack Engineer')), false);
});

test('a second listing or a headcount does not corroborate a need for outside engineers, a funding page does', () => {
  const directory = signal({ id: 'd1', type: 'hiring_growth', url: 'https://directory.test/acme', title: 'Acme: a platform', text: 'Team size 25.' });
  const careers = signal({ id: 'd2', type: 'job_posting', url: 'https://acme.test/careers', title: 'Senior Engineer', text: null });
  const probable: Classification = { ...strong, need: answer('probable_gap', { explicit_external: 0.1 }) };
  const hiringOnly = base({ primary: directory, signals: [directory, careers], classification: probable, facts: [{ field: 'hiring', value: 'x', provenance: 'reported', source_url: 'https://acme.test/careers', quote: 'q' }, { field: 'company_size', value: '25', provenance: 'reported', source_url: 'https://directory.test/acme', quote: 'q' }] });
  assert.equal(scoreCase(hiringOnly).qualified, false, 'hiring in two places is still only hiring');
  const withFunding = { ...hiringOnly, facts: [...hiringOnly.facts, { field: 'funding' as const, value: '8m', provenance: 'reported' as const, source_url: 'https://press.test/acme', quote: 'raised 8m' }] };
  assert.equal(scoreCase(withFunding).qualified, true);
  const asking = signal({ id: 'd3', type: 'freelance_request', url: 'https://forum.test/acme', title: 'Acme looks for a freelance engineer', text: null });
  assert.equal(scoreCase({ ...hiringOnly, signals: [directory, asking] }).qualified, true, 'a second signal that asks does');
});
