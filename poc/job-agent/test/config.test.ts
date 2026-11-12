// Tests for the non-secret agent configuration. Every case is offline: the file
// reader is injected, so nothing here touches the real filesystem or keyring.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  defaultConfig,
  loadConfig,
  parseConfig,
} from '../src/config.ts';

test('a missing file yields the documented defaults', () => {
  const config = loadConfig({
    path: '/nonexistent/agent.json',
    readFile: () => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    },
  });
  assert.deepEqual(config, defaultConfig());
  assert.equal(config.provider, 'anthropic');
  assert.equal(config.threshold, 0.9);
  assert.equal(config.pace_ms_floor, 8000);
  assert.equal(config.max_pages_per_run, 5);
});

test('a valid file overrides only the fields it sets', () => {
  const config = loadConfig({
    path: '/tmp/agent.json',
    readFile: () =>
      JSON.stringify({
        provider: 'qwen',
        model: 'qwen3-coder',
        threshold: 0.75,
        sources: { linkedin: { pace_ms: 20000, max_pages: 2 } },
      }),
  });
  assert.equal(config.provider, 'qwen');
  assert.equal(config.model, 'qwen3-coder');
  assert.equal(config.threshold, 0.75);
  assert.equal(config.pace_ms_floor, 8000);
  assert.deepEqual(config.sources['linkedin'], { pace_ms: 20000, max_pages: 2 });
});

test('malformed JSON is an error, never a silent fallback', () => {
  assert.throws(
    () => loadConfig({ path: '/tmp/agent.json', readFile: () => '{ not json' }),
    /config: .*JSON/,
  );
});

test('each invalid field is named in the error', () => {
  const cases: Array<[Record<string, unknown>, RegExp]> = [
    [{ provider: 'openai' }, /provider/],
    [{ model: '' }, /model/],
    [{ threshold: 1.5 }, /threshold/],
    [{ threshold: -0.1 }, /threshold/],
    [{ profile_dir: '' }, /profile_dir/],
    [{ evidence_dir: 42 }, /evidence_dir/],
    [{ pace_ms_floor: 0 }, /pace_ms_floor/],
    [{ max_pages_per_run: 0 }, /max_pages_per_run/],
    [{ sources: { linkedin: { automation: 'sometimes' } } }, /automation/],
    [{ sources: { linkedin: { pace_ms: -5 } } }, /pace_ms/],
  ];
  for (const [patch, expected] of cases) {
    const result = parseConfig({ ...defaultConfig(), ...patch });
    assert.equal(result.ok, false, `expected ${JSON.stringify(patch)} to be rejected`);
    if (result.ok) continue;
    assert.match(result.error, expected);
    assert.match(result.error, /^config: /);
  }
});

test('a credential-shaped key is rejected and points at the keyring', () => {
  for (const key of ['api_key', 'API_KEY', 'token', 'secret', 'password', 'qwen_secret']) {
    const result = parseConfig({ ...defaultConfig(), [key]: 'sk-live-should-never-be-here' });
    assert.equal(result.ok, false, `${key} must be rejected`);
    if (result.ok) continue;
    // The error names the credential-shaped fragment, which may be shorter than the key.
    assert.match(result.error, /api[_-]?key|token|secret|password/i);
    assert.match(result.error, /keyring/);
    assert.doesNotMatch(result.error, /sk-live-should-never-be-here/);
  }
});

test('a credential-shaped key nested in a source override is rejected too', () => {
  const result = parseConfig({
    ...defaultConfig(),
    sources: { linkedin: { token: 'nope' } },
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /token/);
});

test('a credential-shaped key inside a list is rejected, not only inside an object', () => {
  const result = parseConfig({
    ...defaultConfig(),
    sources: { linkedin: { extra: [{ api_key: 'sk-live-should-never-be-here' }] } },
  });
  assert.equal(result.ok, false, 'a secret nested in an array must be found');
  if (result.ok) return;
  assert.match(result.error, /api_key/);
  assert.doesNotMatch(result.error, /sk-live-should-never-be-here/);
});

test('a secret typed into a value field is never echoed back in the error', () => {
  const secret = 'sk-live-should-never-be-echoed';
  for (const patch of [{ provider: secret }, { threshold: secret }]) {
    const result = parseConfig({ ...defaultConfig(), ...patch });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.doesNotMatch(result.error, /sk-live-should-never-be-echoed/, `echoed by ${Object.keys(patch)[0]}`);
  }
});

test('malformed JSON never echoes the text it failed on, which may hold a pasted secret', () => {
  const secret = 'sk-ant-LEAK-should-not-appear';
  try {
    loadConfig({ path: '/tmp/agent.json', readFile: () => `{"model": "x", "note": ${secret}}` });
    assert.fail('malformed JSON must throw');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.doesNotMatch(message, /sk-ant-/, 'the parser fragment, even truncated, is not part of the error');
    assert.match(message, /not valid JSON/);
  }
});

test('a source id that is not a plain name is refused without echoing it', () => {
  const secret = 'sk-ant-LEAK-in-an-id';
  const result = parseConfig({ ...defaultConfig(), sources: { [secret]: { automation: 'allowed' } } });
  assert.equal(result.ok, false, 'an id with a secret shape must be refused');
  if (result.ok) return;
  assert.doesNotMatch(result.error, /sk-ant-LEAK/);
});

test('a credential-shaped key is named by the fragment that matched, not the whole key', () => {
  const result = parseConfig({ ...defaultConfig(), 'sk-ant-LEAK-api_key': 'x' });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.error, /api_key/);
  assert.doesNotMatch(result.error, /sk-ant-LEAK/);
});

test('a base url carrying a credential in its query is refused without echoing it', () => {
  const secret = 'sk-ant-LEAK-in-the-url';
  for (const url of [`https://api.example.test/v1?api_key=${secret}`, `https://${secret}@api.example.test`]) {
    const result = parseConfig({ ...defaultConfig(), base_url: url });
    assert.equal(result.ok, false, `${url} must be refused`);
    if (result.ok) continue;
    assert.doesNotMatch(result.error, /sk-ant-LEAK/);
  }
});

test('a key that only contains a credential word inside a longer word is not a credential', () => {
  const result = parseConfig({ ...defaultConfig(), max_tokens: 100 });
  assert.equal(result.ok, true, 'max_tokens is a limit, not a secret');
  for (const key of ['token', 'API_KEY', 'qwen_secret', 'anthropic_api_key', 'db-password']) {
    assert.equal(parseConfig({ ...defaultConfig(), [key]: 'x' }).ok, false, `${key} must still be refused`);
  }
});
