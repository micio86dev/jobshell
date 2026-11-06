import assert from 'node:assert/strict';
import { test } from 'node:test';

import { probeBatch, probeJson, sleep } from '../src/lib/http.ts';

const jsonDataUrl = (payload: unknown): string =>
  `data:application/json,${encodeURIComponent(JSON.stringify(payload))}`;

test('probeJson parses a JSON body and reports a successful status', async () => {
  const result = await probeJson(jsonDataUrl({ ok: 1 }));
  assert.equal(result.ok, true);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: 1 });
  assert.equal(result.error, null);
  assert.ok(result.elapsed_ms >= 0);
});

test('probeJson keeps a text snippet when the body is not JSON', async () => {
  const result = await probeJson('data:text/plain,not%20json');
  assert.equal(result.ok, true);
  assert.equal(result.body, 'not json');
});

test('probeJson reports an unreachable endpoint as an error instead of throwing', async () => {
  // Port 1 on loopback refuses connections immediately; no external network is used.
  const result = await probeJson('http://127.0.0.1:1/health', { timeoutMs: 2000 });
  assert.equal(result.ok, false);
  assert.equal(result.status, null);
  assert.notEqual(result.error, null);
});

test('probeBatch preserves input order and paces consecutive requests', async () => {
  const urls = [jsonDataUrl({ n: 1 }), jsonDataUrl({ n: 2 }), jsonDataUrl({ n: 3 })];
  const started = performance.now();
  const results = await probeBatch(urls, { delayMs: 60 });
  const elapsed = performance.now() - started;

  assert.deepEqual(
    results.map((r) => (r.body as { n: number }).n),
    [1, 2, 3],
  );
  // Two gaps of 60 ms must be observable; the first request is not delayed.
  assert.ok(elapsed >= 110, `expected at least 110 ms of pacing, observed ${Math.round(elapsed)} ms`);
});

test('probeBatch applies no delay when delayMs is zero', async () => {
  const results = await probeBatch([jsonDataUrl({ a: 1 }), jsonDataUrl({ a: 2 })], { delayMs: 0 });
  assert.equal(results.length, 2);
  assert.equal(results[1]?.ok, true);
});

test('sleep resolves after approximately the requested delay', async () => {
  const started = performance.now();
  await sleep(40);
  assert.ok(performance.now() - started >= 30);
});
