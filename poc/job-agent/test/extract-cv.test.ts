// Tests for the CV extraction entry: the key comes from the agent's own keyring account,
// the CV goes to the model once, and nothing secret or CV text is ever printed.
// Offline: the key reader and the network are fakes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { runExtractCv } from '../src/extract-cv.ts';
import type { FetchLike } from '../src/jev.ts';

const KEY = 'sk-test-SECRET-value-123';
const CV = 'Twelve years building desktop apps with Rust and Python. Led a team of four.';

const answer = (text: string) => JSON.stringify({ content: [{ type: 'text', text }] });

const modelJson = JSON.stringify({
  headline: 'Desktop engineer',
  capabilities: ['Rust', 'Python'],
  domains: [],
  seniority: 'senior',
  years_experience: 12,
  languages: ['English'],
});

const fakeFetch = (status: number, body: string) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init: init as RequestInit });
    return { status, text: body };
  };
  return { calls, fetchImpl };
};

test('with no stored key it refuses, says where to add one, and reads no network', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(modelJson));
  const result = await runExtractCv(CV, { readKey: () => null, model: 'claude-test', fetchImpl });

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /openjob-agent/);
  assert.match(result.stderr, /anthropic/);
  assert.equal(calls.length, 0, 'no request is sent without a key');
});

test('an empty CV is refused before any key is read or request is sent', async () => {
  let keyReads = 0;
  const { calls, fetchImpl } = fakeFetch(200, answer(modelJson));
  const result = await runExtractCv('   ', {
    readKey: () => {
      keyReads += 1;
      return KEY;
    },
    model: 'claude-test',
    fetchImpl,
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /empty/);
  assert.equal(calls.length, 0);
  assert.equal(keyReads, 0);
});

test('a CV over the size bound is refused without a request', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(modelJson));
  const result = await runExtractCv('x'.repeat(60_001), {
    readKey: () => KEY,
    model: 'claude-test',
    fetchImpl,
  });

  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /too long/);
  assert.equal(calls.length, 0);
});

test('a model answer prints the proposal as JSON, exit 0, and never the key or the CV', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(modelJson));
  const result = await runExtractCv(CV, { readKey: () => KEY, model: 'claude-test', fetchImpl });

  assert.equal(result.exitCode, 0);
  const verdict = JSON.parse(result.stdout) as { source: string; reason: string | null; fields: { headline: string } };
  assert.equal(verdict.source, 'model');
  assert.equal(verdict.reason, null);
  assert.equal(verdict.fields.headline, 'Desktop engineer');

  assert.equal(calls.length, 1, 'the CV is sent once');
  assert.equal((calls[0]?.init.headers as Record<string, string>)['x-api-key'], KEY, 'the key goes only in the header');
  assert.ok(!result.stdout.includes(KEY) && !result.stderr.includes(KEY), 'the key is never printed');
  assert.ok(!result.stdout.includes('Twelve years'), 'the CV text is never echoed');
});

test('a failed provider call prints a fallback with a fixed reason, exit 1, and no secret', async () => {
  // The provider echoes the key back in its error body; the output must not carry it.
  const { fetchImpl } = fakeFetch(401, `invalid x-api-key ${KEY}`);
  const result = await runExtractCv(CV, { readKey: () => KEY, model: 'claude-test', fetchImpl });

  assert.equal(result.exitCode, 1);
  const verdict = JSON.parse(result.stdout) as { source: string; reason: string };
  assert.equal(verdict.source, 'fallback');
  assert.equal(verdict.reason, 'provider answered 401');
  assert.ok(!result.stdout.includes(KEY) && !result.stderr.includes(KEY), 'the echoed key is not printed');
});

test('a network failure is a fallback whose raw error text is never printed', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error(`connect failed with ${KEY}`);
  };
  const result = await runExtractCv(CV, { readKey: () => KEY, model: 'claude-test', fetchImpl });

  assert.equal(result.exitCode, 1);
  assert.equal((JSON.parse(result.stdout) as { reason: string }).reason, 'provider request failed');
  assert.ok(!result.stdout.includes(KEY) && !result.stderr.includes(KEY));
});

test('a portfolio is sent framed as a portfolio, and an unknown kind is refused before any key is read', async () => {
  const { calls, fetchImpl } = fakeFetch(200, answer(modelJson));
  const result = await runExtractCv('Case studies in English.', { readKey: () => KEY, model: 'claude-test', fetchImpl }, 'portfolio');
  assert.equal(result.exitCode, 0);
  const body = JSON.parse(String(calls[0]?.init.body)) as { messages: Array<{ content: string }> };
  assert.match(body.messages[0]?.content ?? '', /Portfolio:/);

  let keyReads = 0;
  const refused = await runExtractCv(CV, { readKey: () => { keyReads += 1; return KEY; }, model: 'claude-test', fetchImpl }, 'resume' as never);
  assert.equal(refused.exitCode, 2);
  assert.equal(keyReads, 0);
});
