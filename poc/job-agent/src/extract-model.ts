/**
 * The model used to extract a CV or a portfolio. It is set by the environment, never by a value
 * written into the code: OPENJOB_EXTRACT_MODEL names any model the account can use. Without it,
 * the provider's default applies.
 */
import { DEFAULT_MODEL } from './config.ts';

export const modelForExtraction = (env: Record<string, string | undefined>): string => {
  const chosen = env['OPENJOB_EXTRACT_MODEL']?.trim() ?? '';
  return chosen.length > 0 ? chosen : DEFAULT_MODEL.anthropic;
};
