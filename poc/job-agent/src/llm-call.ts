/**
 * One model call for a text answer. Shared by the report and the tailored CV, so both keep the
 * same failure rules: a fixed reason, never the key and never a raw provider or network error.
 */
import type { FetchLike } from './jev.ts';
import { llmAnswer, llmRequest, LLM_LABEL, type LlmProvider } from './llm-providers.ts';

export type AskDeps = {
  apiKey: string;
  provider: LlmProvider;
  model: string;
  maxTokens: number;
  baseUrl?: string | undefined;
  fetchImpl: FetchLike;
};

export type AskResult = { ok: true; text: string } | { ok: false; reason: string };

export const askModel = async (prompt: string, deps: AskDeps): Promise<AskResult> => {
  const label = LLM_LABEL[deps.provider];
  const fail = (reason: string): AskResult => ({ ok: false, reason });

  let request: ReturnType<typeof llmRequest>;
  try {
    request = llmRequest(deps.provider, {
      apiKey: deps.apiKey,
      model: deps.model,
      prompt,
      maxTokens: deps.maxTokens,
      baseUrl: deps.baseUrl,
    });
  } catch (error) {
    return fail(error instanceof Error ? error.message : 'provider endpoint refused');
  }

  // A network failure proposes nothing, and its raw text is never returned: it may carry the key.
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await deps.fetchImpl(request.url, request.init);
  } catch {
    return fail('provider request failed');
  }
  if (response.status === 401 || response.status === 403) {
    return fail(`the ${label} key was refused (HTTP ${response.status}): it is wrong or expired, replace it in Settings`);
  }
  if (response.status !== 200) return fail(`provider answered ${response.status}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(response.text);
  } catch {
    return fail('provider answer was not JSON');
  }

  const answer = llmAnswer(deps.provider, parsed);
  const text = answer.text.trim();
  if (text.length === 0) return fail('provider answer had no text');
  if (answer.truncated) return fail('the answer was cut short: raise the token budget and try again');
  return { ok: true, text };
};
