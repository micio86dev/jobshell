/**
 * Wiring a lead run: which sources, which judge, which model, from the user's choices and keys.
 *
 * Pure apart from the key reader it is handed, so the rules are tested without a keychain: a
 * dry run buys nothing, a missing key turns a stage off and names why, and the web research is
 * offered only to a provider that has the tools for it.
 */
import type { AgentConfig } from '../config.ts';
import { defaultFetch, type FetchLike, type JeDeps } from '../jev.ts';
import type { AskDeps } from '../llm-call.ts';
import { CLI_LABEL, CLI_DEFAULT_MODEL, isCliProvider } from '../llm-cli.ts';
import { LLM_LABEL } from '../llm-providers.ts';
import { baseAutomation } from '../policy.ts';
import { judgmentDepsFor, providerChoiceFromEnv, type ProviderChoice } from '../provider-choice.ts';
import { listSources } from '../sources/registry.ts';
import type { ResearchDeps } from './research.ts';
import { SIGNAL_SOURCES } from './sources.ts';

/** The generic Hacker News search is left out: the thread reader supersedes it and does not mix in people offering their own work. */
const SUPERSEDED = ['hn'];

/** Every source the policy lets an unattended run read, posting boards and signal sources alike. */
export const defaultLeadSources = (config: AgentConfig): string[] =>
  [...listSources(), ...SIGNAL_SOURCES.map((source) => source.id)].filter(
    (id, index, all) =>
      all.indexOf(id) === index &&
      !SUPERSEDED.includes(id) &&
      baseAutomation(id) === 'allowed' &&
      config.sources[id]?.enabled !== false,
  );

export type LeadWiring = {
  choice: ProviderChoice;
  jev: JeDeps | null;
  llm: AskDeps | null;
  research: ResearchDeps | null;
  researchUnavailable: string | null;
};

export const wireLead = (input: {
  env: Record<string, string | undefined>;
  readKey: (account: string) => string | null;
  dryRun: boolean;
  fetchImpl?: FetchLike;
}): LeadWiring => {
  const fetchImpl = input.fetchImpl ?? defaultFetch;
  const choice = providerChoiceFromEnv(input.env);
  if (input.dryRun) {
    return { choice, jev: null, llm: null, research: null, researchUnavailable: 'dry run: nothing is bought' };
  }
  const judgment = judgmentDepsFor(choice.judgment, (service) => input.readKey(service));
  const jev: JeDeps | null = judgment === null ? null : { apiKey: judgment.apiKey, model: judgment.model, baseUrl: judgment.baseUrl, fetchImpl };

  const chosen = choice.llm.provider;
  // A program the user signed in to needs no key from us: it is started as it is, with its own login.
  const key = isCliProvider(chosen) ? '' : (input.readKey(chosen)?.trim() ?? '');
  const llm: AskDeps | null = isCliProvider(chosen)
    ? { apiKey: '', provider: chosen, model: choice.llm.model || CLI_DEFAULT_MODEL, maxTokens: 1500, fetchImpl }
    : key === '' ? null : { apiKey: key, provider: chosen, model: choice.llm.model, maxTokens: 1500, fetchImpl };
  let research: ResearchDeps | null = null;
  let researchUnavailable: string | null = null;
  if (isCliProvider(chosen)) researchUnavailable = `web research needs an Anthropic API key: ${CLI_LABEL[chosen]} prints only its final text, and the checks need the pages it read`;
  else if (llm === null) researchUnavailable = `no ${LLM_LABEL[chosen]} key is stored`;
  else if (chosen !== 'anthropic') researchUnavailable = `web research needs the Anthropic provider, and ${LLM_LABEL[chosen]} is chosen`;
  else research = { apiKey: key, model: choice.llm.model, fetchImpl, maxSearches: 5, maxFetches: 4, maxTokens: 8000 };
  return { choice, jev, llm, research, researchUnavailable };
};
