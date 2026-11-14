// The language-model providers that answer a prompt: Anthropic, OpenAI, Gemini and Qwen.
// Each one has its own request shape and its own answer shape; both are checked here offline.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { llmAnswer, llmRequest, LLM_PROVIDERS } from '../src/llm-providers.ts';

const body = (init: RequestInit): Record<string, unknown> => JSON.parse(String(init.body)) as Record<string, unknown>;

test('the four providers are the ones the user can pick', () => {
  assert.deepEqual([...LLM_PROVIDERS].sort(), ['anthropic', 'gemini', 'openai', 'qwen']);
});

test('OpenAI: bearer key, chat completions, the prompt as a user message', () => {
  const { url, init } = llmRequest('openai', { apiKey: 'sk-o', model: 'gpt-x', prompt: 'hi', maxTokens: 300 });
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal((init.headers as Record<string, string>)['authorization'], 'Bearer sk-o');
  assert.deepEqual(body(init), { model: 'gpt-x', max_completion_tokens: 300, messages: [{ role: 'user', content: 'hi' }] });
});

test('Gemini: the key travels in a header, never in the URL', () => {
  const { url, init } = llmRequest('gemini', { apiKey: 'AIza-secret', model: 'gemini-2.5-flash', prompt: 'hi', maxTokens: 300 });
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
  assert.equal((init.headers as Record<string, string>)['x-goog-api-key'], 'AIza-secret');
  assert.ok(!url.includes('AIza-secret'), 'the key is not in the URL');
  assert.deepEqual(body(init), {
    contents: [{ parts: [{ text: 'hi' }] }],
    generationConfig: { maxOutputTokens: 300 },
  });
});

test('Anthropic keeps its own headers and body', () => {
  const { url, init } = llmRequest('anthropic', { apiKey: 'sk-a', model: 'claude-x', prompt: 'hi', maxTokens: 300 });
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal((init.headers as Record<string, string>)['x-api-key'], 'sk-a');
  assert.equal(body(init)['max_tokens'], 300);
});

test('a request to an unapproved address is refused before anything is sent', () => {
  assert.throws(
    () => llmRequest('openai', { apiKey: 'sk', model: 'm', prompt: 'p', maxTokens: 1, baseUrl: 'https://evil.example.com/v1' }),
    /not in the approved list/,
  );
});

test('OpenAI answer: the text of the first choice, and its token counts', () => {
  const answer = llmAnswer('openai', {
    choices: [{ message: { content: 'the text' } }],
    usage: { prompt_tokens: 90, completion_tokens: 40 },
  });
  assert.equal(answer.text, 'the text');
  assert.deepEqual(answer.usage, { input_tokens: 90, output_tokens: 40 });
});

test('Gemini answer: the text of the parts, and its token counts', () => {
  const answer = llmAnswer('gemini', {
    candidates: [{ content: { parts: [{ text: 'hello ' }, { text: 'world' }] } }],
    usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 5 },
  });
  assert.equal(answer.text, 'hello world');
  assert.deepEqual(answer.usage, { input_tokens: 12, output_tokens: 5 });
});

test('an answer with an unexpected shape gives empty text and zero tokens, not a crash', () => {
  assert.deepEqual(llmAnswer('gemini', { candidates: [] }), { text: '', usage: { input_tokens: 0, output_tokens: 0 }, truncated: false });
  assert.deepEqual(llmAnswer('openai', 'not an object'), { text: '', usage: { input_tokens: 0, output_tokens: 0 }, truncated: false });
});

test('a cut-off answer is reported as truncated, for each provider', () => {
  assert.equal(llmAnswer('anthropic', { content: [], stop_reason: 'max_tokens' }).truncated, true);
  assert.equal(llmAnswer('openai', { choices: [{ message: { content: 'x' }, finish_reason: 'length' }] }).truncated, true);
  assert.equal(llmAnswer('gemini', { candidates: [{ finishReason: 'MAX_TOKENS' }] }).truncated, true);
  assert.equal(llmAnswer('openai', { choices: [{ message: { content: 'x' }, finish_reason: 'stop' }] }).truncated, false);
});
