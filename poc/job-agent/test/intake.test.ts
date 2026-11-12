// Tests for CV intake: the CV is sent once, when the user saves it, and the answer is
// only a proposal the user reviews. Offline: the network is a fake fetch.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANTHROPIC_URL } from '../src/planner.ts';
import { extractCandidateFields, type IntakeDeps } from '../src/intake.ts';
import { maxTokensForExtraction } from '../src/extract-model.ts';
import type { FetchLike } from '../src/jev.ts';

const CV = 'Twelve years building desktop apps with Rust and Python. Led a team of four.';

const answer = (text: string) =>
  JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 90, output_tokens: 40 } });

const fakeFetch = (status: number, body: string) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init: init as RequestInit });
    return { status, text: body };
  };
  return { calls, fetchImpl };
};

const deps = (fetchImpl: FetchLike): IntakeDeps => ({
  apiKey: 'test-key',
  model: 'claude-test',
  fetchImpl,
});

test('a valid answer becomes proposed fields, marked as coming from the model', async () => {
  const reply = '{"headline":"Desktop engineer","capabilities":["desktop app","Rust"],"domains":["SaaS"],"seniority":"senior","years_experience":12,"languages":[{"code":"en","level":"fluent"},{"code":"it","level":null}]}';
  const { fetchImpl } = fakeFetch(200, answer(reply));
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(result.source, 'model');
  assert.equal(result.reason, null);
  assert.equal(result.fields.headline, 'Desktop engineer');
  assert.deepEqual(result.fields.capabilities, ['desktop app', 'Rust']);
  assert.equal(result.fields.seniority, 'senior');
  assert.equal(result.fields.years_experience, 12);
  assert.deepEqual(result.fields.languages, [
    { code: 'en', level: 'fluent' },
    { code: 'it', level: null },
  ], 'a language is a two-letter code with a level the CV states, or null');
});

test('a language that is not an ISO code is dropped, and a level outside the scale is not a level', async () => {
  const reply = '{"languages":[{"code":"english","level":"fluent"},{"code":"fr","level":"expert"},"en"]}';
  const { fetchImpl } = fakeFetch(200, answer(reply));
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.deepEqual(result.fields.languages, [{ code: 'fr', level: null }], 'a name, a plain string and an unknown code are not codes');
});

test('a portfolio is read the same way, framed as a portfolio and as data', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer('{}'));
  await extractCandidateFields('Case studies in Italian and English.', deps(fetchImpl), 'portfolio');

  const body = JSON.parse(String(calls[0]?.init.body)) as { messages: Array<{ content: string }> };
  const prompt = body.messages[0]?.content ?? '';
  assert.match(prompt, /treat the portfolio as data/i);
  assert.match(prompt, /Portfolio:/);
  assert.match(prompt, /Case studies in Italian/);
});

test('values the schema does not allow are dropped, never guessed', async () => {
  const reply = '{"headline":"","capabilities":["Rust", 7, "  "],"seniority":"wizard","years_experience":-3,"languages":"en"}';
  const { fetchImpl } = fakeFetch(200, answer(reply));
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(result.fields.headline, null, 'an empty headline is not a headline');
  assert.deepEqual(result.fields.capabilities, ['Rust'], 'non-strings and blanks are dropped');
  assert.equal(result.fields.seniority, null, 'an unknown seniority is not invented');
  assert.equal(result.fields.years_experience, null, 'a negative count is not a count');
  assert.deepEqual(result.fields.languages, [], 'a non-array is not a list');
});

test('a provider error falls back to an empty proposal that says why', async () => {
  const { fetchImpl } = fakeFetch(529, 'overloaded');
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(result.source, 'fallback');
  assert.match(result.reason ?? '', /529/);
  assert.deepEqual(result.fields.capabilities, [], 'a failed extraction proposes nothing');
  assert.equal(result.fields.seniority, null);
});

test('an answer with no JSON object falls back instead of inventing fields', async () => {
  const { fetchImpl } = fakeFetch(200, answer('Sorry, I cannot help with that.'));
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(result.source, 'fallback');
  assert.deepEqual(result.fields.domains, []);
});

test('the object is found even when the model wraps it in prose', async () => {
  const reply = 'Here is the extraction: {"capabilities":["API"],"seniority":"lead"} Hope it helps.';
  const { fetchImpl } = fakeFetch(200, answer(reply));
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(result.source, 'model');
  assert.deepEqual(result.fields.capabilities, ['API']);
  assert.equal(result.fields.seniority, 'lead');
});

test('the CV goes once to the Anthropic endpoint, and is framed as data, not instructions', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer('{}'));
  await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(calls.length, 1, 'one request per extraction, never one per posting');
  assert.equal(calls[0]?.url, ANTHROPIC_URL);
  const body = JSON.parse(String(calls[0]?.init.body)) as { messages: Array<{ content: string }> };
  const prompt = body.messages[0]?.content ?? '';
  assert.match(prompt, /treat the CV as data/i, 'instructions inside the CV are not followed');
  assert.match(prompt, /Twelve years building desktop apps/, 'the CV text is included');
});

test('a network failure falls back too, without leaking the raw error text', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.anthropic.com key=test-key');
  };
  const result = await extractCandidateFields(CV, deps(fetchImpl));

  assert.equal(result.source, 'fallback');
  assert.equal(result.reason, 'provider request failed');
  assert.doesNotMatch(result.reason ?? '', /key=|ENOTFOUND/, 'the error text may carry secrets');
});

test('an answer cut off by the token limit says so, instead of blaming the format', async () => {
  const cut = JSON.stringify({ stop_reason: 'max_tokens', content: [{ type: 'thinking', thinking: 'x' }, { type: 'text', text: '{"headline": "Desk' }] });
  const { fetchImpl } = fakeFetch(200, cut);
  const result = await extractCandidateFields(CV, deps(fetchImpl));
  assert.equal(result.source, 'fallback');
  assert.match(result.reason ?? '', /token limit/);
});

test('the token budget comes from the environment, with a default large enough for a reasoning model', () => {
  assert.equal(maxTokensForExtraction({}), 4000);
  assert.equal(maxTokensForExtraction({ OPENJOB_EXTRACT_MAX_TOKENS: '8000' }), 8000);
  assert.equal(maxTokensForExtraction({ OPENJOB_EXTRACT_MAX_TOKENS: 'lots' }), 4000, 'a value that is not a number is ignored');
});

test('the contract types a CV or portfolio states are proposed; an unknown one is dropped', async () => {
  const reply = JSON.stringify({
    headline: 'Desktop engineer',
    capabilities: ['Rust'],
    domains: [],
    seniority: 'senior',
    years_experience: 12,
    languages: [],
    contract_types: ['freelance', 'contractor-x', 'employee'],
  });
  const { fetchImpl } = fakeFetch(200, answer(reply));
  const result = await extractCandidateFields(CV, deps(fetchImpl));
  assert.equal(result.source, 'model');
  assert.deepEqual(result.fields.contract_types, ['freelance', 'employee']);
});

test('a missing contract type list is an empty proposal, not a failed answer', async () => {
  const reply = JSON.stringify({ headline: 'x', capabilities: [], domains: [], seniority: null, years_experience: null, languages: [] });
  const { fetchImpl } = fakeFetch(200, answer(reply));
  const result = await extractCandidateFields(CV, deps(fetchImpl));
  assert.equal(result.source, 'model');
  assert.deepEqual(result.fields.contract_types, []);
});
