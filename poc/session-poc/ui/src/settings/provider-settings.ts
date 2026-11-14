/** The provider choice as the Settings view edits it. Names and an address only, never a key. */
export interface ProviderChoiceView {
  llm_provider: string;
  llm_model: string;
  judgment_service: string;
  judgment_model: string;
  judgment_address: string;
}

/** Why a choice cannot be saved. The window turns the code into its copy. */
export type ChoiceProblem = 'llm-model-missing' | 'judgment-model-missing' | 'laya-address-missing';

/** The first problem with a choice, or null when it can be saved. */
export const validateChoice = (choice: ProviderChoiceView): ChoiceProblem | null => {
  if (choice.llm_model.trim() === '') return 'llm-model-missing';
  if (choice.judgment_service === 'laya' && choice.judgment_address.trim() === '') return 'laya-address-missing';
  if (choice.judgment_service !== 'laya' && choice.judgment_model.trim() === '') return 'judgment-model-missing';
  return null;
};

/** The models to offer: the provider's list, sorted, with the current choice kept even if absent. */
export const modelOptions = (offered: readonly string[], current: string): string[] => {
  const names = new Set(offered);
  if (current.trim() !== '') names.add(current);
  return [...names].sort();
};
