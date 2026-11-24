/** The provider choice as the Settings view edits it. Names and an address only, never a key. */
export interface ProviderChoiceView {
  llm_provider: string;
  llm_model: string;
  judgment_service: string;
  judgment_model: string;
  judgment_address: string;
  match_threshold: number;
}

/** Why a choice cannot be saved. The window turns the code into its copy. */
export type ChoiceProblem = 'llm-model-missing' | 'judgment-model-missing' | 'laya-address-missing' | 'threshold-out-of-range';

/** The first problem with a choice, or null when it can be saved. */
export const validateChoice = (choice: ProviderChoiceView): ChoiceProblem | null => {
  if (choice.llm_model.trim() === '') return 'llm-model-missing';
  if (choice.judgment_service === 'laya' && choice.judgment_address.trim() === '') return 'laya-address-missing';
  if (choice.judgment_service !== 'laya' && choice.judgment_service !== 'provider' && choice.judgment_model.trim() === '') return 'judgment-model-missing';
  if (!Number.isInteger(choice.match_threshold) || choice.match_threshold < 1 || choice.match_threshold > 100) {
    return 'threshold-out-of-range';
  }
  return null;
};

/** The programs of a subscription: the user is signed in to them, and the app needs no key for them. */
export const CLI_PROVIDERS = ['cli-claude', 'cli-codex', 'cli-gemini', 'cli-opencode'] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

export const isCliProvider = (name: string): name is CliProvider => (CLI_PROVIDERS as readonly string[]).includes(name);

/** The name a person knows each program by, and the file name the status check looks for. */
export const CLI_NAMES: Readonly<Record<CliProvider, { name: string; program: string }>> = {
  'cli-claude': { name: 'Claude Code', program: 'claude' },
  'cli-codex': { name: 'Codex', program: 'codex' },
  'cli-gemini': { name: 'Gemini CLI', program: 'gemini' },
  'cli-opencode': { name: 'OpenCode', program: 'opencode' },
};

/** The model after the provider changes: "default" for a program (it uses its own), empty when leaving one, so the user chooses. */
export const modelAfterSwitch = (to: string, current: string): string => {
  if (isCliProvider(to)) return 'default';
  return current === 'default' ? '' : current;
};

/** The provider the app starts with, and the one a person goes back to when leaving a subscription program. */
export const DEFAULT_API_CHOICE = { llm_provider: 'anthropic', llm_model: 'claude-sonnet-5-5' } as const;

/**
 * The whole choice after the person picks a provider, once. A subscription program answers the judge's
 * questions too (no other key), unless they run their own judge locally; going back to an API provider
 * puts the hosted judge back.
 */
export const chooseProvider = (choice: ProviderChoiceView, provider: string): ProviderChoiceView => {
  const next: ProviderChoiceView = { ...choice, llm_provider: provider, llm_model: modelAfterSwitch(provider, choice.llm_model) };
  if (isCliProvider(provider) && choice.judgment_service === 'typesafe') next.judgment_service = 'provider';
  if (!isCliProvider(provider) && choice.judgment_service === 'provider') next.judgment_service = 'typesafe';
  return next;
};

/** Back to an API provider from the wizard, where no list of models is loaded yet. */
export const chooseApi = (choice: ProviderChoiceView): ProviderChoiceView => {
  const next = chooseProvider(choice, DEFAULT_API_CHOICE.llm_provider);
  return isCliProvider(choice.llm_provider) ? { ...next, llm_model: DEFAULT_API_CHOICE.llm_model } : next;
};

/** The models to offer: the provider's list, sorted, with the current choice kept even if absent. */
export const modelOptions = (offered: readonly string[], current: string): string[] => {
  const names = new Set(offered);
  if (current.trim() !== '') names.add(current);
  return [...names].sort();
};
