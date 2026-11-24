// The judgment services that speak POST /v1/systemone: TypeSafe Jev, Laya and Ollama.
// Offline: the network is a fake fetch that records what it was asked to send.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { askSystemOne, type FetchLike } from '../src/jev.ts';
import { judgmentService, JUDGMENT_SERVICES } from '../src/judgment-services.ts';

test('TypeSafe Jev is the hosted service that needs a key', () => {
  const typesafe = judgmentService('typesafe');
  assert.equal(typesafe.url, 'https://api.typesafe.ai/v1/systemone');
  assert.equal(typesafe.needsKey, true);
  assert.equal(typesafe.defaultModel, 'jev-1.14.0');
});

test('Ollama runs on this machine: no key, the local address by default', () => {
  const ollama = judgmentService('ollama');
  assert.equal(ollama.url, 'http://localhost:11434/v1/systemone');
  assert.equal(ollama.needsKey, false);
});

test('Laya has no default address: the user must name where it runs', () => {
  assert.throws(() => judgmentService('laya'), /needs an endpoint/);
  const laya = judgmentService('laya', 'http://127.0.0.1:9000/v1/systemone');
  assert.equal(laya.url, 'http://127.0.0.1:9000/v1/systemone');
  assert.equal(laya.needsKey, false);
});

test('a remote address that is not approved is refused for every service', () => {
  assert.throws(() => judgmentService('laya', 'https://evil.example.com/v1/systemone'), /not in the approved list/);
});

test('the list of services names every one the user can pick', () => {
  assert.deepEqual([...JUDGMENT_SERVICES].sort(), ['laya', 'ollama', 'provider', 'typesafe']);
});

test('a request to an unapproved address is never sent, so the key stays put', async () => {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (url) => {
    calls.push(url);
    return { status: 200, text: '{}' };
  };
  await assert.rejects(
    askSystemOne({ state: 'x', questions: {} }, { apiKey: 'secret-key', baseUrl: 'https://evil.example.com/v1/systemone', fetchImpl }),
    /not in the approved list/,
  );
  assert.deepEqual(calls, []);
});

test('a local service without a key sends no Authorization header', async () => {
  let sent: Record<string, string> = {};
  const fetchImpl: FetchLike = async (_url, init) => {
    sent = init.headers;
    return { status: 500, text: 'stop here' };
  };
  await askSystemOne({ state: 'x', questions: {} }, { apiKey: '', baseUrl: 'http://localhost:11434/v1/systemone', fetchImpl }).catch(() => undefined);
  assert.equal('authorization' in sent, false);
});
