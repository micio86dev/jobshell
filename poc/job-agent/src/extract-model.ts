/**
 * The model used to extract a CV or a portfolio, and its token budget. Both are set by the
 * environment, never by a value written into the code: OPENJOB_EXTRACT_MODEL names any model the
 * account can use, and OPENJOB_EXTRACT_MAX_TOKENS the room the answer gets. Without them, the
 * provider default and the default budget apply.
 */
import { DEFAULT_MODEL } from './config.ts';
import { DEFAULT_EXTRACT_MAX_TOKENS } from './intake.ts';

export const modelForExtraction = (env: Record<string, string | undefined>): string => {
  const chosen = env['OPENJOB_EXTRACT_MODEL']?.trim() ?? '';
  return chosen.length > 0 ? chosen : DEFAULT_MODEL.anthropic;
};

export const maxTokensForExtraction = (env: Record<string, string | undefined>): number => {
  const value = Number(env['OPENJOB_EXTRACT_MAX_TOKENS']);
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_EXTRACT_MAX_TOKENS;
};
