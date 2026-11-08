// Tests for the localhost bridge the extension calls. The handlers are pure, so the
// behaviour is exercised without a socket, plus one test that does open one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleHealth, handleScore, parseScoreRequest, startBridge } from '../src/bridge.ts';
import { capture, posting } from './support.ts';

const bridgeDeps = () => {
  const { urls, fetchImpl } = capture();
  return {
    urls,
    deps: {
      jev: { apiKey: 'k', fetchImpl },
      promptContext: 'candidate',
      threshold: 0.9,
      token: 'token-1',
    },
  };
};

test('bridge: a malformed posting is dropped instead of trusted', () => {
  const parsed = parseScoreRequest({
    postings: [
      posting,
      { source: 'linkedin', id: '', title: 'no id', url: 'https://x.test' },
      { source: 'linkedin', id: '2', title: 'bad url', url: 'javascript:alert(1)' },
      { id: '3', title: 'no source', url: 'https://x.test' },
      'not an object',
    ],
  });
  assert.equal(parsed.length, 1);
  assert.equal(parsed[0]?.id, '4012345678');
});

test('bridge: a non-object body yields no postings', () => {
  assert.deepEqual(parseScoreRequest(null), []);
  assert.deepEqual(parseScoreRequest({ postings: 'nope' }), []);
});

test('bridge: scoring returns the probability, the verdict and the cost', async () => {
  const { deps } = bridgeDeps();
  const response = await handleScore({ postings: [posting] }, deps);
  assert.equal(response.results.length, 1);
  assert.equal(response.results[0]?.key, 'linkedin:4012345678');
  assert.ok(Math.abs((response.results[0]?.probability ?? 0) - 0.95) < 1e-9);
  assert.equal(response.results[0]?.verdict, 'yes');
  assert.equal(response.results[0]?.stack_stance, 'not_specified');
  assert.equal(response.input_tokens, 140);
  assert.equal(response.threshold, 0.9);
});

test('bridge: health reports the threshold and nothing secret', () => {
  const { deps } = bridgeDeps();
  const health = handleHealth(deps);
  assert.deepEqual(health, { ok: true, threshold: 0.9 });
  assert.doesNotMatch(JSON.stringify(health), /token-1/);
});

test('bridge: the server refuses a request without the token and accepts one with it', async () => {
  const { deps } = bridgeDeps();
  const server = await startBridge(deps);
  try {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    assert.equal(health.status, 401, 'a localhost port is reachable by anything, so it needs a token');

    const authorised = await fetch(`http://127.0.0.1:${server.port}/health`, {
      headers: { 'x-openjob-token': server.token },
    });
    assert.equal(authorised.status, 200);
    assert.deepEqual(await authorised.json(), { ok: true, threshold: 0.9 });

    const scored = await fetch(`http://127.0.0.1:${server.port}/score`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-openjob-token': server.token },
      body: JSON.stringify({ postings: [posting] }),
    });
    assert.equal(scored.status, 200);
    const body = (await scored.json()) as { results: unknown[] };
    assert.equal(body.results.length, 1);
  } finally {
    await server.close();
  }
});

