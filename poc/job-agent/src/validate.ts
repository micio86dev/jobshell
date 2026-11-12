/**
 * Validates a stored profile payload against the agent's schema.
 *
 * The desktop side keeps payloads as opaque JSON text. It asks this module, the single
 * validator, whether a payload is a profile before it stores or compiles one.
 */
import { parseProfile } from './profile.ts';

export type ValidationResult = { ok: true } | { ok: false; error: string };

export const validateProfileText = (text: string): ValidationResult => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'profile payload is not valid JSON' };
  }
  const parsed = parseProfile(raw);
  return parsed.ok ? { ok: true } : { ok: false, error: parsed.error };
};
