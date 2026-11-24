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
  if (choice.judgment_service !== 'laya' && choice.judgment_model.trim() === '') return 'judgment-model-missing';
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

/** The models to offer: the provider's list, sorted, with the current choice kept even if absent. */
export const modelOptions = (offered: readonly string[], current: string): string[] => {
  const names = new Set(offered);
  if (current.trim() !== '') names.add(current);
  return [...names].sort();
};
