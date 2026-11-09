// Tests for the localhost bridge the extension calls. The handlers are pure, so the
// behaviour is exercised without a socket, plus one test that does open one.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { handleHealth, handleScore, mapWithConcurrency, parseScoreRequest, startBridge } from '../src/bridge.ts';
import type { FetchLike } from '../src/jev.ts';
import { JUDGEMENT, capture, posting } from './support.ts';

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


test('bridge: one failing judgment does not discard the rest of the batch', async () => {
  // The judged state carries the title, not the id, so that is what discriminates.
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body) as { state: { posting: { title: string } } };
    if (body.state.posting.title === 'Broken posting') return { status: 500, text: 'boom' };
    return { status: 200, text: JUDGEMENT };
  };
  const response = await handleScore(
    {
      postings: [
        posting,
        { ...posting, id: 'bad', title: 'Broken posting', url: 'https://example.test/bad' },
      ],
    },
    { jev: { apiKey: 'k', fetchImpl }, promptContext: 'c', threshold: 0.9, token: 't' },
  );

  assert.equal(response.results.length, 1, 'the good posting is still scored');
  assert.equal(response.results[0]?.key, 'linkedin:4012345678');
  assert.equal(response.errors.length, 1);
  assert.match(response.errors[0]?.key ?? '', /bad/);
  assert.match(response.errors[0]?.message ?? '', /500/);
});

test('bridge: concurrency is bounded and the order is preserved', async () => {
  let inFlight = 0;
  let peak = 0;
  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const out = await mapWithConcurrency(items, 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 1));
    inFlight -= 1;
    return item * 2;
  });
  assert.deepEqual(out, items.map((item) => item * 2));
  assert.ok(peak <= 3, `at most 3 in flight, saw ${peak}`);
});

test('bridge: a busy port fails loudly instead of hanging', async () => {
  const first = await startBridge({ jev: { apiKey: 'k', fetchImpl: capture().fetchImpl }, promptContext: 'c', threshold: 0.9, token: 't1' });
  try {
    await assert.rejects(
      () => startBridge({ jev: { apiKey: 'k', fetchImpl: capture().fetchImpl }, promptContext: 'c', threshold: 0.9, token: 't2' }, first.port),
      /cannot listen on 127\.0\.0\.1/,
    );
  } finally {
    await first.close();
  }
});
