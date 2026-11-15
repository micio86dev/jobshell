// Tests for the per-posting report (blocks A to G). Offline: the network is a fake fetch.
// The report may only use facts from the CV and the posting, never a key, never a raw error.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ANTHROPIC_URL } from '../src/planner.ts';
import type { FetchLike } from '../src/jev.ts';
import { generateReport, MAX_DESCRIPTION_CHARS, reportInstruction, type ReportInput } from '../src/report.ts';

const CV = 'Twelve years building desktop apps with Rust and Python. Led a team of four.';
const REPORT = '## A. Sintesi del ruolo\nSviluppatore Rust senior.\n## B. Match con il CV\nRust: presente nel CV.';

const input: ReportInput = {
  posting: {
    title: 'Senior Rust Engineer',
    company: 'Acme',
    url: 'https://example.test/1',
    description: 'We build desktop apps with Rust.',
  },
  cv: CV,
  verdict: 'yes',
  gaps: [],
};

const answer = (text: string) =>
  JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 120 } });

const fakeFetch = (status: number, body: string) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init: init as RequestInit });
    return { status, text: body };
  };
  return { calls, fetchImpl };
};

const deps = (fetchImpl: FetchLike) => ({ apiKey: 'sk-secret-test-key', model: 'claude-test', fetchImpl });

test('a valid answer becomes the report, sent with the CV and the posting', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(REPORT));
  const result = await generateReport(input, deps(fetchImpl));
  assert.deepEqual(result, { source: 'model', markdown: REPORT });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.url, ANTHROPIC_URL);
  const body = String(calls[0]?.init.body);
  assert.match(body, /Twelve years building desktop apps/, 'the CV is in the request');
  assert.match(body, /We build desktop apps with Rust/, 'the posting is in the request');
});

test('the instruction asks for blocks A to G and forbids invented experience', () => {
  const text = reportInstruction(input);
  for (const block of ['A.', 'B.', 'C.', 'D.', 'E.', 'F.', 'G.']) assert.ok(text.includes(block), `block ${block}`);
  assert.match(text, /only facts from the CV/i);
  assert.match(text, /never invent/i);
  assert.match(text, /not stated/i, 'missing facts are said to be missing, not guessed');
});

test('an empty CV is refused before any request is sent', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(REPORT));
  const result = await generateReport({ ...input, cv: '   ' }, deps(fetchImpl));
  assert.deepEqual(result, { source: 'fallback', reason: 'the CV is empty' });
  assert.equal(calls.length, 0);
});

test('a missing key is refused before any request is sent', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(REPORT));
  const result = await generateReport(input, { ...deps(fetchImpl), apiKey: '' });
  assert.equal(result.source, 'fallback');
  assert.equal(calls.length, 0);
});

test('a refused key is a fixed reason that never echoes the key or the provider body', async () => {
  const { fetchImpl } = fakeFetch(401, '{"error":"invalid key sk-secret-test-key"}');
  const result = await generateReport(input, deps(fetchImpl));
  assert.equal(result.source, 'fallback');
  assert.match(result.source === 'fallback' ? result.reason : '', /key was refused \(HTTP 401\)/);
  assert.ok(!JSON.stringify(result).includes('sk-secret-test-key'), 'the key never reaches the output');
});

test('a non-200 answer, a network error and a non-JSON answer each become a fixed fallback', async () => {
  const server = await generateReport(input, deps(fakeFetch(500, '{}').fetchImpl));
  assert.deepEqual(server, { source: 'fallback', reason: 'provider answered 500' });

  const broken = await generateReport(input, deps(fakeFetch(200, 'not json').fetchImpl));
  assert.deepEqual(broken, { source: 'fallback', reason: 'provider answer was not JSON' });

  const failing: FetchLike = async () => {
    throw new Error('getaddrinfo ENOTFOUND api.anthropic.com');
  };
  const network = await generateReport(input, deps(failing));
  assert.deepEqual(network, { source: 'fallback', reason: 'provider request failed' });
});

test('an oversized description is cut to the bound before it is sent', async () => {
  const long = 'x'.repeat(MAX_DESCRIPTION_CHARS + 5_000);
  const { calls, fetchImpl } = fakeFetch(200, answer(REPORT));
  await generateReport({ ...input, posting: { ...input.posting, description: long } }, deps(fetchImpl));
  const body = String(calls[0]?.init.body);
  assert.ok(!body.includes('x'.repeat(MAX_DESCRIPTION_CHARS + 1)), 'nothing past the bound is sent');
});
