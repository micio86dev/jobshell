/**
 * The language-model providers the agent can ask for a CV reading or a search plan.
 * Each one has its own request and answer shape; this module is the only place that knows them.
 * Every request goes through the endpoint check, so the key only ever reaches an approved host.
 *
 * Shapes, from each provider's reference:
 *  - anthropic: POST /v1/messages, `x-api-key`; answer `content[].text`, `usage.input_tokens`.
 *  - openai: POST /v1/chat/completions, bearer key; `max_completion_tokens`; answer
 *    `choices[0].message.content`, `usage.prompt_tokens` and `completion_tokens`.
 *  - gemini: POST /v1beta/models/{model}:generateContent, `x-goog-api-key` header (never the URL);
 *    `generationConfig.maxOutputTokens`; answer `candidates[0].content.parts[].text`,
 *    `usageMetadata.promptTokenCount` and `candidatesTokenCount`.
 *  - qwen: OpenAI-compatible chat completions on DashScope; bearer key.
 */
import { checkEndpoint } from './endpoints.ts';

export const LLM_PROVIDERS = ['anthropic', 'openai', 'gemini', 'qwen'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];

export const LLM_LABEL: Record<LlmProvider, string> = {
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  gemini: 'Gemini',
  qwen: 'Qwen',
};

const URLS: Record<LlmProvider, string> = {
  anthropic: 'https://api.anthropic.com/v1/messages',
  openai: 'https://api.openai.com/v1/chat/completions',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/models',
  qwen: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
};

export const ANTHROPIC_VERSION = '2023-06-01';

export type LlmRequestDeps = {
  apiKey: string;
  model: string;
  prompt: string;
  maxTokens: number;
  baseUrl?: string | undefined;
};

export type LlmRequest = { url: string; init: { method: string; headers: Record<string, string>; body: string } };

/** `truncated` is true when the provider stopped because the output budget ran out. */
export type LlmAnswer = { text: string; usage: { input_tokens: number; output_tokens: number }; truncated: boolean };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const numberOr0 = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Build the request for one provider. Throws when the address is not approved. */
export const llmRequest = (provider: LlmProvider, deps: LlmRequestDeps): LlmRequest => {
  const base = deps.baseUrl ?? URLS[provider];
  const check = checkEndpoint(base);
  if (!check.ok) throw new Error(`${LLM_LABEL[provider]} endpoint refused: ${check.reason}`);
  const json = { 'content-type': 'application/json' };
  const message = [{ role: 'user', content: deps.prompt }];

  switch (provider) {
    case 'anthropic':
      return {
        url: base,
        init: {
          method: 'POST',
          headers: { 'x-api-key': deps.apiKey, 'anthropic-version': ANTHROPIC_VERSION, ...json },
          body: JSON.stringify({ model: deps.model, max_tokens: deps.maxTokens, messages: message }),
        },
      };
    case 'openai':
      return {
        url: base,
        init: {
          method: 'POST',
          headers: { authorization: `Bearer ${deps.apiKey}`, ...json },
          body: JSON.stringify({ model: deps.model, max_completion_tokens: deps.maxTokens, messages: message }),
        },
      };
    case 'gemini':
      return {
        url: `${base}/${encodeURIComponent(deps.model)}:generateContent`,
        init: {
          method: 'POST',
          headers: { 'x-goog-api-key': deps.apiKey, ...json },
          body: JSON.stringify({
            contents: [{ parts: [{ text: deps.prompt }] }],
            generationConfig: { maxOutputTokens: deps.maxTokens },
          }),
        },
      };
    case 'qwen':
      return {
        url: base,
        init: {
          method: 'POST',
          headers: { authorization: `Bearer ${deps.apiKey}`, ...json },
          body: JSON.stringify({ model: deps.model, messages: message }),
        },
      };
  }
};

const EMPTY: LlmAnswer = { text: '', usage: { input_tokens: 0, output_tokens: 0 }, truncated: false };

/** Read the text and the token counts out of one provider's answer. Anything unexpected is empty. */
export const llmAnswer = (provider: LlmProvider, parsed: unknown): LlmAnswer => {
  if (!isRecord(parsed)) return EMPTY;
  switch (provider) {
    case 'anthropic': {
      const content = Array.isArray(parsed['content']) ? (parsed['content'] as unknown[]) : [];
      const text = content
        .map((block) => (isRecord(block) && typeof block['text'] === 'string' ? block['text'] : ''))
        .join('');
      const usage = isRecord(parsed['usage']) ? parsed['usage'] : {};
      return {
        text,
        usage: { input_tokens: numberOr0(usage['input_tokens']), output_tokens: numberOr0(usage['output_tokens']) },
        truncated: parsed['stop_reason'] === 'max_tokens',
      };
    }
    case 'openai':
    case 'qwen': {
      const choices = Array.isArray(parsed['choices']) ? (parsed['choices'] as unknown[]) : [];
      const first = choices[0];
      const message = isRecord(first) && isRecord(first['message']) ? first['message'] : null;
      const text = message !== null && typeof message['content'] === 'string' ? message['content'] : '';
      const usage = isRecord(parsed['usage']) ? parsed['usage'] : {};
      return {
        text,
        usage: { input_tokens: numberOr0(usage['prompt_tokens']), output_tokens: numberOr0(usage['completion_tokens']) },
        truncated: first !== undefined && isRecord(first) && first['finish_reason'] === 'length',
      };
    }
    case 'gemini': {
      const candidates = Array.isArray(parsed['candidates']) ? (parsed['candidates'] as unknown[]) : [];
      const first = candidates[0];
      const content = isRecord(first) && isRecord(first['content']) ? first['content'] : null;
      const parts = content !== null && Array.isArray(content['parts']) ? (content['parts'] as unknown[]) : [];
      const text = parts.map((part) => (isRecord(part) && typeof part['text'] === 'string' ? part['text'] : '')).join('');
      const usage = isRecord(parsed['usageMetadata']) ? parsed['usageMetadata'] : {};
      return {
        text,
        usage: { input_tokens: numberOr0(usage['promptTokenCount']), output_tokens: numberOr0(usage['candidatesTokenCount']) },
        truncated: isRecord(first) && first['finishReason'] === 'MAX_TOKENS',
      };
    }
  }
};
