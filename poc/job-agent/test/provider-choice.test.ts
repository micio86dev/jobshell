// The provider the user chose in Settings, read from the environment the desktop app sets.
// No secret is ever read here: keys stay in the keychain, the choice is only a name.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { providerChoiceFromEnv } from '../src/provider-choice.ts';

test('with nothing set, the defaults are Anthropic for the LLM and TypeSafe Jev for judgments', () => {
  const choice = providerChoiceFromEnv({});
  assert.equal(choice.llm.provider, 'anthropic');
  assert.equal(choice.llm.model, 'claude-sonnet-5-5');
  assert.equal(choice.judgment.service, 'typesafe');
  assert.equal(choice.judgment.model, 'jev-1.14.0');
});

test('the environment picks the LLM provider and its model', () => {
  const choice = providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'openai', JOBSHELL_LLM_MODEL: 'gpt-x' });
  assert.equal(choice.llm.provider, 'openai');
  assert.equal(choice.llm.model, 'gpt-x');
});

test('a provider that does not exist is refused, not silently replaced', () => {
  assert.throws(() => providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'mistral' }), /unknown LLM provider/);
});

test('a provider without a chosen model is refused, since there is no safe default for it', () => {
  assert.throws(() => providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'gemini' }), /choose a model/);
});

test('Laya needs its address, and the address goes through the endpoint check', () => {
  assert.throws(() => providerChoiceFromEnv({ JOBSHELL_JUDGMENT_SERVICE: 'laya', JOBSHELL_JUDGMENT_MODEL: 'm' }), /needs an endpoint/);
  const choice = providerChoiceFromEnv({
    JOBSHELL_JUDGMENT_SERVICE: 'laya',
    JOBSHELL_JUDGMENT_MODEL: 'm',
    JOBSHELL_JUDGMENT_ADDRESS: 'http://127.0.0.1:9000/v1/systemone',
  });
  assert.equal(choice.judgment.url, 'http://127.0.0.1:9000/v1/systemone');
});

test('the choice never carries a key', () => {
  const choice = providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'openai', JOBSHELL_LLM_MODEL: 'gpt-x', JOBSHELL_LLM_API_KEY: 'sk-leak' });
  assert.ok(!JSON.stringify(choice).includes('sk-leak'));
});
