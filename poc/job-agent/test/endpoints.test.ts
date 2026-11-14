// The API key is only ever sent to an approved HTTPS host, or to the loopback address
// of a model the user runs on this machine. Offline: nothing here opens a connection.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkEndpoint } from '../src/endpoints.ts';

test('the known providers are reachable over HTTPS', () => {
  for (const url of [
    'https://api.anthropic.com/v1/messages',
    'https://api.openai.com/v1/chat/completions',
    'https://generativelanguage.googleapis.com/v1beta/models',
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    'https://api.typesafe.ai/v1/systemone',
  ]) {
    assert.deepEqual(checkEndpoint(url), { ok: true }, url);
  }
});

test('a local model on the loopback address may use plain HTTP', () => {
  assert.deepEqual(checkEndpoint('http://localhost:11434/v1/systemone'), { ok: true });
  assert.deepEqual(checkEndpoint('http://127.0.0.1:8080/v1/systemone'), { ok: true });
});

test('an unknown host is refused, so the key is never sent to it', () => {
  const result = checkEndpoint('https://evil.example.com/v1/systemone');
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /not in the approved list/);
});

test('plain HTTP to a remote host is refused', () => {
  const result = checkEndpoint('http://api.openai.com/v1/chat/completions');
  assert.equal(result.ok, false);
});

test('a lookalike host that only contains an approved name is refused', () => {
  assert.equal(checkEndpoint('https://api.openai.com.evil.example/v1').ok, false);
  assert.equal(checkEndpoint('https://user@evil.example/?api.openai.com').ok, false);
});

test('a malformed URL is refused without throwing', () => {
  assert.equal(checkEndpoint('not a url').ok, false);
});
