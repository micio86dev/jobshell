// The tailored CV: the CV rewritten for one posting. Offline: the network is a fake fetch.
// Every number in the output must already be in the CV or the posting, or the output is refused.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { tailorCv, tailorInstruction } from '../src/tailor.ts';
import type { ReportInput } from '../src/report.ts';

const CV = 'Rust developer. Twelve years building desktop apps. Led a team of four.';
const input: ReportInput = {
  posting: {
    title: 'Senior Rust Engineer',
    company: 'Acme',
    url: 'https://example.test/1',
    description: 'We build desktop apps with Rust for teams of up to 10.',
  },
  cv: CV,
  verdict: 'yes',
  gaps: [],
};

const answer = (text: string) =>
  JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 200 } });

const fakeFetch = (status: number, body: string) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init: init as RequestInit });
    return { status, text: body };
  };
  return { calls, fetchImpl };
};

const deps = (fetchImpl: FetchLike) => ({ apiKey: 'sk-secret-test-key', model: 'claude-test', fetchImpl });

test('a valid answer becomes the tailored CV, sent with the CV and the posting', async () => {
  const markdown = '# Profilo\nRust developer with twelve years building desktop apps.';
  const { calls, fetchImpl } = fakeFetch(200, answer(markdown));
  const result = await tailorCv(input, deps(fetchImpl));
  assert.deepEqual(result, { source: 'model', markdown });
  const body = String(calls[0]?.init.body);
  assert.match(body, /Led a team of four/, 'the CV is in the request');
  assert.match(body, /teams of up to 10/, 'the posting is in the request');
});

test('the instruction keeps the rewrite to facts the CV already has', () => {
  const text = tailorInstruction(input);
  assert.match(text, /only facts from the CV/i);
  assert.match(text, /never invent/i);
  assert.match(text, /reorder|select/i, 'it may reorder and select, not add');
});

test('an output number the CV and the posting do not contain is refused', async () => {
  const { fetchImpl } = fakeFetch(200, answer('# Profilo\nFifteen years of Rust, 15 projects.'));
  const result = await tailorCv(input, deps(fetchImpl));
  assert.equal(result.source, 'fallback');
  assert.match(result.source === 'fallback' ? result.reason : '', /added the number 15/);
});

test('a number the posting contains is allowed', async () => {
  const markdown = '# Profilo\nRust developer. Team of up to 10 users.';
  const { fetchImpl } = fakeFetch(200, answer(markdown));
  const result = await tailorCv(input, deps(fetchImpl));
  assert.deepEqual(result, { source: 'model', markdown });
});

test('an empty CV is refused before any request is sent', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer('# Profilo'));
  const result = await tailorCv({ ...input, cv: '  ' }, deps(fetchImpl));
  assert.deepEqual(result, { source: 'fallback', reason: 'the CV is empty' });
  assert.equal(calls.length, 0);
});
