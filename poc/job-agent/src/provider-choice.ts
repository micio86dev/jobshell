/**
 * The provider the user chose in Settings. The desktop app sets these environment variables;
 * this module only reads names and numbers. Keys are read elsewhere, from the keychain.
 */
import { judgmentService, JUDGMENT_SERVICES, type JudgmentService, type JudgmentTarget } from './judgment-services.ts';
import { LLM_LABEL, LLM_PROVIDERS, type LlmProvider } from './llm-providers.ts';

export type LlmChoice = { provider: LlmProvider; model: string };
export type JudgmentChoice = JudgmentTarget & { model: string };
export type ProviderChoice = { llm: LlmChoice; judgment: JudgmentChoice };

/** The default LLM: Anthropic with its model, as before the choice existed. */
const DEFAULT_LLM: LlmChoice = { provider: 'anthropic', model: 'claude-sonnet-5-5' };

const env = (values: Record<string, string | undefined>, name: string): string => (values[name] ?? '').trim();

const llmFrom = (values: Record<string, string | undefined>): LlmChoice => {
  const name = env(values, 'JOBSHELL_LLM_PROVIDER');
  if (name === '') return DEFAULT_LLM;
  if (!(LLM_PROVIDERS as readonly string[]).includes(name)) {
    throw new Error(`unknown LLM provider: ${name}`);
  }
  const provider = name as LlmProvider;
  const model = env(values, 'JOBSHELL_LLM_MODEL');
  if (model === '') throw new Error(`choose a model for ${LLM_LABEL[provider]}`);
  return { provider, model };
};

const judgmentFrom = (values: Record<string, string | undefined>): JudgmentChoice => {
  const name = env(values, 'JOBSHELL_JUDGMENT_SERVICE') || 'typesafe';
  if (!(JUDGMENT_SERVICES as readonly string[]).includes(name)) {
    throw new Error(`unknown judgment service: ${name}`);
  }
  const target = judgmentService(name as JudgmentService, env(values, 'JOBSHELL_JUDGMENT_ADDRESS') || undefined);
  const chosen = env(values, 'JOBSHELL_JUDGMENT_MODEL');
  const model = chosen !== '' ? chosen : target.defaultModel;
  if (model === null) throw new Error(`choose a model for ${target.service}`);
  return { ...target, model };
};

/** The whole choice, from the environment. Unknown names are errors, never silent substitutions. */
export const providerChoiceFromEnv = (values: Record<string, string | undefined>): ProviderChoice => ({
  llm: llmFrom(values),
  judgment: judgmentFrom(values),
});

/** The provider and model a query plan is asked from: what the user chose in Settings. */
export const plannerTarget = (choice: ProviderChoice): LlmChoice => ({
  provider: choice.llm.provider,
  model: choice.llm.model,
});

/** What the judgment client needs for the chosen service. `null` means its key is missing. */
export const judgmentDepsFor = (
  judgment: JudgmentChoice,
  readKey: (service: JudgmentService) => string | null,
): { apiKey: string; baseUrl: string; model: string } | null => {
  if (!judgment.needsKey) return { apiKey: '', baseUrl: judgment.url, model: judgment.model };
  const key = readKey(judgment.service);
  if (key === null || key.trim() === '') return null;
  return { apiKey: key.trim(), baseUrl: judgment.url, model: judgment.model };
};
