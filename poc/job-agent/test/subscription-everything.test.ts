// Every step of the client search and the profile can run on a subscription program: offline, the program is fake.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runExtractCv } from '../src/extract-cv.ts';
import { askSystemOne, type FetchLike } from '../src/jev.ts';
import { askViaModel } from '../src/judge-model.ts';
import { wireLead } from '../src/leads/bootstrap.ts';
import { enrichCompany } from '../src/leads/enrich.ts';
import { addressesIn, candidates } from '../src/leads/research-cli.ts';
import { invocationFor, type ExecLike, type ExecResult } from '../src/llm-cli.ts';
import { planQueries } from '../src/planner.ts';
import { judgmentService } from '../src/judgment-services.ts';
import { judgeViaModel, providerChoiceFromEnv } from '../src/provider-choice.ts';
import type { UserProfile } from '../src/profile.ts';

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '', failure: null });
const present = { exists: () => true, home: '/home/u', pathEnv: '/usr/bin' };
const never: FetchLike = async () => { throw new Error('no HTTP request is expected'); };

/** A fake program: each request gets the next answer, and every command line and prompt is kept. */
const program = (...answers: string[]): { exec: ExecLike; calls: Array<{ args: string[]; input: string | null }> } => {
  const calls: Array<{ args: string[]; input: string | null }> = [];
  let next = 0;
  return {
    calls,
    exec: async (_file, args, options) => {
      calls.push({ args, input: options.input });
      return ok(answers[Math.min(next++, answers.length - 1)] ?? '');
    },
  };
};

test('the web search is allowed to Claude Code and Codex only when asked, and nothing else comes with it', () => {
  const claude = invocationFor('cli-claude', 'default', 'p', null, true).args;
  assert.deepEqual(claude.slice(claude.indexOf('--allowedTools'), claude.indexOf('--allowedTools') + 2), ['--allowedTools', 'WebSearch']);
  const refused = claude.slice(claude.indexOf('--disallowedTools') + 1);
  assert.ok(!refused.includes('WebSearch') && refused.includes('WebFetch') && refused.includes('Bash') && refused.includes('Write'));
  assert.ok(invocationFor('cli-claude', 'default', 'p', null, false).args.includes('WebSearch'), 'refused when not asked');
  assert.deepEqual(invocationFor('cli-codex', 'default', 'p', null, true).args.slice(0, 2), ['--search', 'exec']);
  assert.ok(!invocationFor('cli-codex', 'default', 'p', null, false).args.includes('--search'));
});

test('the addresses a program names are read from its JSON, or written out, and only public ones are kept', () => {
  assert.deepEqual(addressesIn('Here: {"urls": ["https://acme.test/about", 7]}'), ['https://acme.test/about']);
  assert.deepEqual(addressesIn('see https://acme.test/team and https://acme.test/contact.'), ['https://acme.test/team', 'https://acme.test/contact.']);
  const list = candidates('Company: Acme\nWebsite hint: acme.test', ['https://www.linkedin.com/company/acme', 'http://acme.test/plain', 'https://127.0.0.1/x', 'https://acme.test/about', 'https://acme.test/about#team'], 5);
  assert.deepEqual(list, ['https://acme.test', 'https://acme.test/about']);
});

const signals = [{ id: 's1', type: 'job_posting', source: 'hn-hiring', url: 'https://news.ycombinator.com/item?id=1', title: 'Acme is hiring a senior engineer', text: 'Acme builds invoicing software.', company: 'Acme', observed_at: '2026-11-24T00:00:00Z' }] as never;

const page = '<html><body>' + 'Acme builds invoicing software for small shops. '.repeat(3) + '<p>Jane Rossi, CEO and founder of Acme, answers every request herself.</p></body></html>';
const siteFetch: FetchLike = async (url) => {
  if (url.endsWith('/robots.txt')) return { status: 404, text: '' };
  return url.startsWith('https://acme.test') ? { status: 200, text: page } : { status: 404, text: '' };
};

const answer = JSON.stringify({
  company: 'Acme', website: 'https://acme.test', country: 'IT', summary: 'Invoicing software.', legitimacy: 'real', legitimacy_reason: 'a real site',
  engineering_need: 'maybe', facts: [{ field: 'description', value: 'invoicing software', provenance: 'verified', source_url: 'https://acme.test', quote: 'Acme builds invoicing software for small shops.' }],
  contacts: [{ role: 'CEO', name: 'Jane Rossi', channel: 'page', value: 'https://acme.test', source_url: 'https://acme.test', quote: 'Jane Rossi, CEO and founder of Acme' }],
});

test('research through Claude Code: it names pages, our code reads them, and the checks compare quotes with those pages', async () => {
  const fake = program('{"urls": ["https://acme.test/about"]}', answer);
  const result = await enrichCompany('Acme', signals, 'acme.test', {
    apiKey: '', model: 'default', fetchImpl: siteFetch, maxSearches: 1, maxFetches: 3, maxTokens: 8000,
    cli: { provider: 'cli-claude', deps: { ...present, exec: fake.exec } },
  });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.equal(fake.calls.length, 2, 'one request to find pages, one to read them');
  assert.ok(fake.calls[0]?.args.includes('--allowedTools'), 'the first may search');
  assert.ok(!fake.calls[1]?.args.includes('--allowedTools'), 'the second has no tool at all');
  assert.match(fake.calls[1]?.input ?? '', /<page url="https:\/\/acme\.test">/);
  assert.equal(result.searches, 0, 'a search on a subscription has no price, so none is counted');
  assert.deepEqual(result.facts.filter((fact) => fact.field === 'description').map((fact) => fact.provenance), ['verified']);
  assert.deepEqual(result.contacts.map((contact) => contact.name), ['Jane Rossi']);
});

test('a quote that is not on any page we read is not kept as a fact', async () => {
  const invented = answer.replace('Acme builds invoicing software for small shops.', 'Acme raised forty million euros');
  const fake = program('{"urls": []}', invented);
  const result = await enrichCompany('Acme', signals, 'acme.test', { apiKey: '', model: 'default', fetchImpl: siteFetch, maxSearches: 1, maxFetches: 3, maxTokens: 8000, cli: { provider: 'cli-claude', deps: { ...present, exec: fake.exec } } });
  assert.equal(result.status, 'ok');
  if (result.status !== 'ok') return;
  assert.ok(!result.facts.some((fact) => fact.provenance === 'verified' && fact.field === 'description'));
});

test('a program with no web search skips the search and still reads the known site', async () => {
  const fake = program(answer);
  const result = await enrichCompany('Acme', signals, 'acme.test', { apiKey: '', model: 'default', fetchImpl: siteFetch, maxSearches: 1, maxFetches: 3, maxTokens: 8000, cli: { provider: 'cli-gemini', deps: { ...present, exec: fake.exec } } });
  assert.equal(result.status, 'ok');
  assert.equal(fake.calls.length, 1);
  if (result.status === 'ok') assert.equal(result.searches, 0);
});

test('no readable public page is a reason, not a guess', async () => {
  const fake = program('{"urls": ["https://nowhere.test"]}', answer);
  const result = await enrichCompany('Acme', signals, null, { apiKey: '', model: 'default', fetchImpl: async () => ({ status: 404, text: '' }), maxSearches: 1, maxFetches: 3, maxTokens: 8000, cli: { provider: 'cli-claude', deps: { ...present, exec: fake.exec } } });
  assert.deepEqual(result, { status: 'unavailable', reason: 'no public page of the company could be read (Claude Code searched the web)' });
  assert.equal(fake.calls.length, 1, 'the second request is never made');
});

test('a program that is not signed in ends the research with its own sentence', async () => {
  const signedOut = async (): Promise<ExecResult> => ({ code: 1, stdout: 'Not logged in · Please run /login', stderr: '', failure: null });
  const result = await enrichCompany('Acme', signals, 'acme.test', { apiKey: '', model: 'default', fetchImpl: siteFetch, maxSearches: 1, maxFetches: 3, maxTokens: 8000, cli: { provider: 'cli-claude', deps: { ...present, exec: signedOut } } });
  assert.deepEqual(result, { status: 'unavailable', reason: 'Claude Code is not signed in: open a terminal, run it once and sign in' });
});

test('the CV reader works with a program and no key, and says nothing about a key', async () => {
  const fake = program(JSON.stringify({ headline: 'Senior developer', capabilities: ['Laravel'], domains: [], seniority: 'senior', languages: [{ code: 'it', level: 'native' }] }));
  const out = await runExtractCv('Ten years of Laravel.', { readKey: () => null, provider: 'cli-claude', model: 'default', fetchImpl: never, cli: { ...present, exec: fake.exec } });
  assert.equal(out.exitCode, 0, out.stderr);
  assert.equal(JSON.parse(out.stdout).fields.headline, 'Senior developer');
  assert.equal(out.stderr, '');
});

test('the job planner asks a program for its queries, and falls back with the program own sentence', async () => {
  const profile = { headline: 'Laravel developer', capabilities: ['Laravel'], domains: [], seniority: 'senior', remote_modes: ['remote'], languages: ['en'] } as unknown as UserProfile;
  const fake = program('["laravel contract remote", "vue nuxt freelance"]');
  const planned = await planQueries(profile, { provider: 'cli-claude', apiKey: '', model: 'default', fetchImpl: never, cli: { ...present, exec: fake.exec } });
  assert.deepEqual([planned.source, planned.queries], ['model', ['laravel contract remote', 'vue nuxt freelance']]);
  const limited = await planQueries(profile, { provider: 'cli-codex', apiKey: '', model: 'default', fetchImpl: never, cli: { ...present, exec: async () => ({ code: 1, stdout: '', stderr: 'ERROR: You have hit your usage limit.', failure: null }) } });
  assert.equal(limited.source, 'fallback');
  assert.match(limited.reason ?? '', /Codex gave no answer: ERROR: You have hit your usage limit/);
});

const questions = { need: { type: 'noul', instructions: 'Does it need outside engineers?' }, level: { type: 'choice', instructions: 'Level?', criteria: { senior: 's', junior: 'j' } } } as const;
const verdict = JSON.stringify({ answers: { need: { type: 'noul', noul: 0.8 }, level: { type: 'choice', choice: 'senior', confidence: 0.9, probabilities: { senior: 0.9, junior: 0.1 } } } });

test('the judge can be the chosen model: same answers as the hosted one, no HTTP and no judgment key', async () => {
  const fake = program(verdict);
  const via = { apiKey: '', provider: 'cli-claude' as const, model: 'default', maxTokens: 1500, fetchImpl: never, cli: { ...present, exec: fake.exec } };
  const response = await askSystemOne({ state: { posting: 'x' }, questions }, { apiKey: '', via, fetchImpl: never });
  assert.deepEqual(response.answers['need'], { type: 'noul', noul: 0.8 });
  assert.deepEqual(response.answers['level'], { type: 'choice', choice: 'senior', confidence: 0.9, probabilities: { senior: 0.9, junior: 0.1 } });
  assert.equal(response.model, 'cli-claude:default');
  assert.match(fake.calls[0]?.input ?? '', /STATE:[\s\S]*QUESTIONS:/);
});

test('a judge answer with nothing usable, or a program that fails, throws a fixed sentence', async () => {
  const base = { apiKey: '', provider: 'cli-claude' as const, model: 'default', maxTokens: 1, fetchImpl: never };
  const prose = program('not json at all');
  await assert.rejects(askViaModel({ state: {}, questions }, { ...base, cli: { ...present, exec: prose.exec } }, () => ({})), /judgment: the model answer had no usable answers/);
  assert.equal(prose.calls.length, 2, 'asked once more, and no more than once');
  await assert.rejects(askViaModel({ state: {}, questions }, { ...base, cli: { ...present, exec: async () => ({ code: 1, stdout: 'Not logged in', stderr: '', failure: null }) } }, () => ({})), /judgment: Claude Code is not signed in/);
});

test('"the same as the AI service" is a judgment service with no address and no key, and is wired to the chosen model', () => {
  assert.deepEqual(judgmentService('provider'), { service: 'provider', url: '', needsKey: false, defaultModel: 'provider' });
  const env = { JOBSHELL_LLM_PROVIDER: 'cli-claude', JOBSHELL_JUDGMENT_SERVICE: 'provider' };
  const choice = providerChoiceFromEnv(env);
  assert.equal(choice.judgment.service, 'provider');
  assert.equal(judgeViaModel(choice, () => null, never)?.provider, 'cli-claude');
  assert.equal(judgeViaModel(providerChoiceFromEnv({ ...env, JOBSHELL_JUDGMENT_SERVICE: 'typesafe' }), () => null, never), null);
  const apiChoice = providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'openai', JOBSHELL_LLM_MODEL: 'gpt-x', JOBSHELL_JUDGMENT_SERVICE: 'provider' });
  assert.equal(judgeViaModel(apiChoice, () => null, never), null, 'an API provider without its key cannot judge');
  assert.equal(judgeViaModel(apiChoice, () => 'sk-test', never)?.apiKey, 'sk-test');
  const wired = wireLead({ env, readKey: () => null, dryRun: false });
  assert.equal(wired.jev?.via?.provider, 'cli-claude');
  assert.equal(wired.jev?.apiKey, '');
});

test('a judge answer in prose is asked again once, and the second answer is used', async () => {
  const fake = program('I think it is quite likely.', verdict);
  const via = { apiKey: '', provider: 'cli-claude' as const, model: 'default', maxTokens: 1500, fetchImpl: never, cli: { ...present, exec: fake.exec } };
  const response = await askSystemOne({ state: {}, questions }, { apiKey: '', via, fetchImpl: never });
  assert.equal(fake.calls.length, 2);
  assert.deepEqual(response.answers['need'], { type: 'noul', noul: 0.8 });
});
