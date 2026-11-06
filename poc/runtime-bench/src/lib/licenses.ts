/**
 * Weak, deliberately conservative SPDX classification of a licence file body.
 *
 * These helpers are pure so they can be tested against fixtures without touching
 * the network or the filesystem. The result is always a guess: every consumer
 * must report it as `license.spdx_guess` and keep the licence file path beside it.
 */

export type SpdxGuess =
  | 'MIT'
  | 'Apache-2.0'
  | 'AGPL-3.0'
  | 'GPL-3.0'
  | 'ISC'
  | 'BSD-2-Clause'
  | 'BSD-3-Clause';

const RULES: ReadonlyArray<readonly [SpdxGuess, RegExp]> = [
  ['Apache-2.0', /\bApache License\b/i],
  ['AGPL-3.0', /\bGNU AFFERO\b/i],
  ['GPL-3.0', /\bGNU GENERAL PUBLIC LICENSE\b[\s\S]{0,80}?Version 3/i],
  ['MIT', /\bMIT License\b/i],
  ['ISC', /\bISC License\b/i],
  ['BSD-3-Clause', /\bBSD 3-Clause\b|\bNeither the name of\b/i],
  ['BSD-2-Clause', /\bBSD 2-Clause\b|\bRedistribution and use in source and binary forms\b/i],
];

export const classifyLicense = (text: string): SpdxGuess | null => {
  for (const [spdx, pattern] of RULES) {
    if (pattern.test(text)) return spdx;
  }
  return null;
};

/** First non-empty line of a licence body, trimmed, for human verification. */
export const firstMeaningfulLine = (text: string): string | null => {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
};
