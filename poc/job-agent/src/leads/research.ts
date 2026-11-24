/**
 * Company research with the provider's own web tools.
 *
 * The model searches and reads pages on Anthropic's side; this module sends the request, continues
 * a paused turn, and returns what the response proves: the text, every URL the tools touched, the
 * text of the pages it read, and the passages it cited. Those are the only things a later guard
 * accepts as evidence, so a model cannot cite a page it never saw. A raw provider error never
 * reaches the caller: the reasons are fixed sentences.
 *
 * Tool shapes follow the public documentation of the Messages API (web_search_20250305 and
 * web_fetch_20250910). They were exercised live on 2026-11-24 against a funded account: eight
 * companies researched, evidence in evidence/leads-live/2026-11-24-with-research.json.
 */
import { checkEndpoint } from '../endpoints.ts';
import type { FetchLike } from '../jev.ts';
import { ANTHROPIC_VERSION } from '../llm-providers.ts';

export const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const MAX_CONTINUATIONS = 3;
const LOGIN_WALLED = ['linkedin.com', 'facebook.com', 'instagram.com', 'x.com', 'twitter.com'] as const;

export type ResearchDeps = {
  apiKey: string;
  model: string;
  fetchImpl: FetchLike;
  maxSearches: number;
  maxFetches: number;
  maxTokens: number;
  baseUrl?: string;
};

export type Evidence = {
  /** Every address the tools returned, read or cited. */
  urls: Set<string>;
  /** The text of the pages the model read in full. */
  documents: Array<{ url: string; text: string }>;
  /** The passages the model quoted, as the provider reports them. */
  citations: Array<{ url: string; cited_text: string }>;
};

export type ResearchResult =
  | {
      ok: true;
      text: string;
      evidence: Evidence;
      searches: number;
      usage: { input_tokens: number; output_tokens: number };
    }
  | { ok: false; reason: string };

type Block = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** An address in the form two sources can be compared in: no fragment, no trailing slash, no tracking. */
export const canonicalUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    for (const key of [...parsed.searchParams.keys()]) if (/^(utm_|fbclid|gclid)/i.test(key)) parsed.searchParams.delete(key);
    return parsed.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
};

const collect = (content: Block[], evidence: Evidence): { text: string; searches: number } => {
  let text = '';
  let searches = 0;
  for (const block of content) {
    const type = str(block['type']);
    if (type === 'text') {
      text += str(block['text']) ?? '';
      for (const citation of Array.isArray(block['citations']) ? block['citations'] : []) {
        if (!isRecord(citation)) continue;
        const url = str(citation['url']);
        const cited = str(citation['cited_text']);
        if (url === null) continue;
        evidence.urls.add(canonicalUrl(url));
        if (cited !== null) evidence.citations.push({ url: canonicalUrl(url), cited_text: cited });
      }
    } else if (type === 'server_tool_use' && str(block['name']) === 'web_search') {
      searches += 1;
    } else if (type === 'web_search_tool_result') {
      for (const result of Array.isArray(block['content']) ? block['content'] : []) {
        if (isRecord(result) && str(result['url']) !== null) evidence.urls.add(canonicalUrl(str(result['url']) ?? ''));
      }
    } else if (type === 'web_fetch_tool_result') {
      const result = block['content'];
      if (!isRecord(result)) continue;
      const url = str(result['url']);
      if (url === null) continue;
      evidence.urls.add(canonicalUrl(url));
      const document = isRecord(result['content']) ? result['content'] : null;
      const source = document !== null && isRecord(document['source']) ? document['source'] : null;
      const data = source === null ? null : str(source['data']);
      if (data !== null) evidence.documents.push({ url: canonicalUrl(url), text: data });
    }
  }
  return { text, searches };
};

const refusal = (status: number, body: string): string => {
  if (status === 401 || status === 403) return 'the Anthropic key was refused: it is wrong or expired, replace it in Settings';
  if (status === 429) return 'Anthropic is rate limiting this key: the research will be retried on the next run';
  if (status === 400 && /credit balance/i.test(body)) return 'the Anthropic account has no credit left: add credit in the Anthropic console';
  if (status === 400) return 'Anthropic refused the research request';
  return `Anthropic answered ${status}`;
};

/** Run one research request: the model uses the web tools as it needs, within the budget. */
export const research = async (system: string, prompt: string, deps: ResearchDeps): Promise<ResearchResult> => {
  const url = deps.baseUrl ?? ANTHROPIC_MESSAGES_URL;
  const check = checkEndpoint(url);
  if (!check.ok) return { ok: false, reason: `provider endpoint refused: ${check.reason}` };

  // Login-walled networks are never read, by the model or by the provider's fetcher.
  const tools: Block[] = [{ type: 'web_search_20250305', name: 'web_search', max_uses: deps.maxSearches, blocked_domains: [...LOGIN_WALLED] }];
  if (deps.maxFetches > 0) tools.push({ type: 'web_fetch_20250910', name: 'web_fetch', max_uses: deps.maxFetches, blocked_domains: [...LOGIN_WALLED] });

  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = [{ role: 'user', content: prompt }];
  const evidence: Evidence = { urls: new Set(), documents: [], citations: [] };
  const usage = { input_tokens: 0, output_tokens: 0 };
  let text = '';
  let searches = 0;

  for (let turn = 0; turn <= MAX_CONTINUATIONS; turn += 1) {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await deps.fetchImpl(url, {
        method: 'POST',
        headers: { 'x-api-key': deps.apiKey, 'anthropic-version': ANTHROPIC_VERSION, 'content-type': 'application/json' },
        body: JSON.stringify({ model: deps.model, max_tokens: deps.maxTokens, system, tools, messages }),
      });
    } catch {
      // The raw error may carry the key: only a fixed sentence leaves this function.
      return { ok: false, reason: 'the research request failed' };
    }
    if (response.status !== 200) return { ok: false, reason: refusal(response.status, response.text) };

    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      return { ok: false, reason: 'the research answer was not JSON' };
    }
    if (!isRecord(parsed)) return { ok: false, reason: 'the research answer was not JSON' };
    const content = (Array.isArray(parsed['content']) ? parsed['content'] : []).filter(isRecord);
    const found = collect(content, evidence);
    text += found.text;
    searches += found.searches;
    const used = isRecord(parsed['usage']) ? parsed['usage'] : {};
    usage.input_tokens += count(used['input_tokens']);
    usage.output_tokens += count(used['output_tokens']);

    if (parsed['stop_reason'] === 'refusal') return { ok: false, reason: 'the model declined the research request' };
    if (parsed['stop_reason'] === 'max_tokens') return { ok: false, reason: 'the research answer was cut short' };
    if (parsed['stop_reason'] !== 'pause_turn') return { ok: true, text, evidence, searches, usage };
    // The server paused a long turn: send it back unchanged and let it continue.
    messages.push({ role: 'assistant', content });
  }
  return { ok: false, reason: 'the research did not finish in time' };
};
