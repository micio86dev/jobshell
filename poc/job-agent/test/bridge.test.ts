// Tests for the localhost bridge. The handlers are pure, so most behaviour is exercised
// without a socket; the socket tests use node:http so the Origin header is exactly what
// a browser would send.
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { test } from 'node:test';

import {
  handleHealth,
  handleScore,
  isAllowedOrigin,
  isExtensionOrigin,
  mapWithConcurrency,
  parseScoreRequest,
  startBridge,
} from '../src/bridge.ts';
import type { FetchLike } from '../src/jev.ts';
import { JUDGEMENT, capture, posting } from './support.ts';

import { EXTENSION_ORIGIN } from '../src/bridge.ts';

const EXTENSION = EXTENSION_ORIGIN;

/** The real keyring holds the user's own keys; these tests never read it. */
const noKeyring = (): null => null;

const bridgeDeps = () => {
  const { urls, fetchImpl } = capture();
  return {
    urls,
    deps: {
      jev: { apiKey: 'k', fetchImpl },
      promptContext: 'candidate',
      threshold: 0.9,
      resolveKey: () => 'k',
      keyring: noKeyring,
    },
  };
};

type Answer = { status: number; body: string; headers: Record<string, string | string[] | undefined> };

const call = (
  port: number,
  method: string,
  path: string,
  options: { origin?: string; body?: string } = {},
): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.origin !== undefined) headers['origin'] = options.origin;
    if (options.body !== undefined) headers['content-type'] = 'application/json';
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8'), headers: res.headers }),
      );
    });
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });

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
  assert.deepEqual(handleHealth(deps), { ok: true, threshold: 0.9 });
});

test('bridge: only an extension origin may score, and a web page is refused', async () => {
  const { deps } = bridgeDeps();
  const server = await startBridge(deps);
  try {
    const web = await call(server.port, 'POST', '/score', {
      origin: 'https://evil.test',
      body: JSON.stringify({ postings: [posting] }),
    });
    assert.equal(web.status, 403, 'a web page cannot pretend to be an extension');

    const extension = await call(server.port, 'POST', '/score', {
      origin: EXTENSION,
      body: JSON.stringify({ postings: [posting] }),
    });
    assert.equal(extension.status, 200);
    assert.equal((JSON.parse(extension.body) as { results: unknown[] }).results.length, 1);
    assert.equal(extension.headers['access-control-allow-origin'], EXTENSION, 'CORS echoes only the extension');
  } finally {
    await server.close();
  }
});

test('bridge: health is open so the popup can say whether the agent is running', async () => {
  const { deps } = bridgeDeps();
  const server = await startBridge(deps);
  try {
    const health = await call(server.port, 'GET', '/health');
    assert.equal(health.status, 200);
    assert.deepEqual(JSON.parse(health.body), { ok: true, threshold: 0.9 });
  } finally {
    await server.close();
  }
});

test('bridge: one failing judgment does not discard the rest of the batch', async () => {
  // The judged state carries the title, not the id, so that is what discriminates.
  const fetchImpl: FetchLike = async (_url, init) => {
    const body = JSON.parse(init.body ?? '{}') as { state: { posting: { title: string } } };
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
    { jev: { apiKey: 'k', fetchImpl }, promptContext: 'c', threshold: 0.9, resolveKey: () => 'k' },
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
  const { deps } = bridgeDeps();
  const first = await startBridge(deps);
  try {
    await assert.rejects(() => startBridge(deps, first.port), /cannot listen on 127\.0\.0\.1/);
  } finally {
    await first.close();
  }
});

test('bridge: every score request leaves one record behind', async () => {
  const records: Array<Record<string, unknown>> = [];
  const { deps } = bridgeDeps();
  const response = await handleScore(
    { postings: [posting] },
    {
      ...deps,
      log: (record) => {
        records.push(record as unknown as Record<string, unknown>);
      },
    },
  );

  assert.equal(records.length, 1);
  assert.equal(records[0]?.['postings'], 1);
  assert.equal(records[0]?.['scored'], response.results.length);
  assert.equal(records[0]?.['failed'], 0);
  assert.equal(records[0]?.['input_tokens'], 140);
  assert.equal(typeof records[0]?.['ms'], 'number');
  assert.match(String(records[0]?.['at']), /^\d{4}-/);
});

test('bridge: the origin rules are explicit', () => {
  assert.equal(isExtensionOrigin(EXTENSION), true);
  assert.equal(isExtensionOrigin('https://evil.test'), false);
  assert.equal(isExtensionOrigin(undefined), false);
  assert.equal(
    isExtensionOrigin('chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    false,
    'another extension must not be able to spend the user tokens',
  );
  assert.equal(isAllowedOrigin('http://127.0.0.1:8787', 8787), true);
  assert.equal(isAllowedOrigin('http://127.0.0.1:9999', 8787), false);
  assert.equal(isAllowedOrigin('https://evil.test', 8787), false);
});

test('bridge: a judgment error that is not one of the judge\'s fixed messages is not sent to the client', async () => {
  const secret = 'sk-ant-LEAK-in-a-network-error';
  const fetchImpl: FetchLike = async () => {
    throw new Error(`connect failed using ${secret}`);
  };
  const response = await handleScore(
    { postings: [posting] },
    { jev: { apiKey: 'k', fetchImpl }, promptContext: 'c', threshold: 0.9, resolveKey: () => 'k' },
  );
  assert.equal(response.errors.length, 1);
  assert.doesNotMatch(JSON.stringify(response), /sk-ant-LEAK/, 'the raw error text stays on the agent side');
});

test('bridge: a malformed body is a 400, and a server-side failure is a 500 that says nothing about the cause', async () => {
  const { deps } = bridgeDeps();
  const server = await startBridge(deps);
  try {
    const malformed = await call(server.port, 'POST', '/score', { origin: EXTENSION, body: '{not json' });
    assert.equal(malformed.status, 400, 'the request is at fault');

    const failing = await startBridge({
      ...deps,
      resolveKey: () => {
        throw new Error('keyring unavailable: sk-ant-LEAK-in-a-server-error');
      },
    });
    try {
      const broken = await call(failing.port, 'POST', '/score', {
        origin: EXTENSION,
        body: JSON.stringify({ postings: [posting] }),
      });
      assert.equal(broken.status, 500, 'the server is at fault, not the request');
      assert.doesNotMatch(broken.body, /sk-ant-LEAK|keyring/, 'the cause is not sent to the client');
    } finally {
      await failing.close();
    }
  } finally {
    await server.close();
  }
});
