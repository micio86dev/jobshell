/**
 * Non-secret configuration for the browser job agent.
 *
 * The file holds paths, limits and thresholds — never a credential. A key that
 * looks like a credential is rejected here on purpose: keys belong in the OS
 * keyring (`src/secrets.ts`), so a config file can be copied, diffed or committed
 * without leaking anything.
 */

import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export type Automation = 'allowed' | 'measurement_only' | 'prohibited';
export type Provider = 'anthropic' | 'qwen';

export type SourceOverride = {
  automation?: Automation;
  pace_ms?: number;
  max_pages?: number;
};

export type AgentConfig = {
  provider: Provider;
  model: string;
  base_url?: string;
  threshold: number;
  profile_dir: string;
  evidence_dir: string;
  pace_ms_floor: number;
  max_pages_per_run: number;
  sources: Record<string, SourceOverride>;
};

export type ParseResult = { ok: true; config: AgentConfig } | { ok: false; error: string };

const AUTOMATIONS: readonly Automation[] = ['allowed', 'measurement_only', 'prohibited'];
const PROVIDERS: readonly Provider[] = ['anthropic', 'qwen'];

/** A key that looks like a credential, at any depth. */
const CREDENTIAL_KEY = /(api[_-]?key|token|secret|password)/i;

export const DEFAULT_MODEL: Record<Provider, string> = {
  anthropic: 'claude-sonnet-5-5',
  qwen: 'qwen3-coder-plus',
};

export const defaultConfigPath = (): string => join(homedir(), '.config', 'openjob', 'agent.json');

export const defaultConfig = (): AgentConfig => ({
  provider: 'anthropic',
  model: DEFAULT_MODEL.anthropic,
  threshold: 0.9,
  profile_dir: join(homedir(), 'Library', 'Application Support', 'openjob-phase0', 'agent-profile'),
  evidence_dir: join(homedir(), '.local', 'share', 'openjob', 'evidence'),
  pace_ms_floor: 8000,
  max_pages_per_run: 5,
  sources: {},
});

const fail = (message: string): ParseResult => ({ ok: false, error: `config: ${message}` });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reject a credential at any depth, inside objects and inside arrays, before anything else looks
 * at the file. The path names the field, never its value.
 */
const findCredentialKey = (value: unknown, path: string[]): string | null => {
  if (Array.isArray(value)) {
    for (const [index, nested] of value.entries()) {
      const deeper = findCredentialKey(nested, [...path, String(index)]);
      if (deeper !== null) return deeper;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) return [...path, key].join('.');
    const deeper = findCredentialKey(nested, [...path, key]);
    if (deeper !== null) return deeper;
  }
  return null;
};

const notBlank = (value: string): boolean => value.trim().length > 0;
const positiveNumber = (value: number): boolean => Number.isFinite(value) && value > 0;
const positiveInteger = (field: string) =>
  z
    .number({ error: `${field} must be a positive integer` })
    .refine((value) => Number.isInteger(value) && value > 0, { error: `${field} must be a positive integer` });

/** A source override: every field optional, and each one checked against its own message. */
const sourceOverride = (id: string) =>
  z.object(
    {
      automation: z.enum(AUTOMATIONS, {
        error: `sources.${id}.automation must be one of ${AUTOMATIONS.join(', ')}`,
      }),
      pace_ms: z
        .number({ error: `sources.${id}.pace_ms must be a positive number` })
        .refine(positiveNumber, { error: `sources.${id}.pace_ms must be a positive number` }),
      max_pages: z
        .number({ error: `sources.${id}.max_pages must be a positive integer` })
        .refine((value) => Number.isInteger(value) && value > 0, {
          error: `sources.${id}.max_pages must be a positive integer`,
        }),
    },
    { error: `sources.${id} must be an object` },
  ).partial();

type SourcesResult =
  | { ok: true; sources: Record<string, SourceOverride> }
  | { ok: false; error: string };

const parseSources = (raw: unknown): SourcesResult => {
  if (raw === undefined) return { ok: true, sources: {} };
  if (!isRecord(raw)) return { ok: false, error: 'config: sources must be an object' };
  const sources: Record<string, SourceOverride> = {};
  for (const [id, override] of Object.entries(raw)) {
    const checked = sourceOverride(id).safeParse(override);
    if (!checked.success) {
      return { ok: false, error: `config: ${checked.error.issues[0]?.message ?? `sources.${id} must be an object`}` };
    }
    // Only the fields the file actually sets are kept, so an absent field stays absent.
    const parsed: SourceOverride = {};
    if (checked.data.automation !== undefined) parsed.automation = checked.data.automation;
    if (checked.data.pace_ms !== undefined) parsed.pace_ms = checked.data.pace_ms;
    if (checked.data.max_pages !== undefined) parsed.max_pages = checked.data.max_pages;
    sources[id] = parsed;
  }
  return { ok: true, sources };
};

/** The non-secret settings. Each message names its field; the values echoed are the ones the user wrote. */
const configShape = z.object(
  {
    provider: z.enum(PROVIDERS, {
      error: (issue) => `provider must be one of ${PROVIDERS.join(', ')} (got ${JSON.stringify(issue.input)})`,
    }),
    model: z.string({ error: 'model must be a non-empty string' }).refine(notBlank, {
      error: 'model must be a non-empty string',
    }),
    profile_dir: z.string({ error: 'profile_dir must be a non-empty string' }).refine(notBlank, {
      error: 'profile_dir must be a non-empty string',
    }),
    evidence_dir: z.string({ error: 'evidence_dir must be a non-empty string' }).refine(notBlank, {
      error: 'evidence_dir must be a non-empty string',
    }),
    threshold: z
      .number({ error: (issue) => `threshold must be a number between 0 and 1 (got ${JSON.stringify(issue.input)})` })
      .refine((value) => Number.isFinite(value) && value >= 0 && value <= 1, {
        error: 'threshold must be a number between 0 and 1',
      }),
    pace_ms_floor: positiveInteger('pace_ms_floor'),
    max_pages_per_run: positiveInteger('max_pages_per_run'),
    sources: z.unknown(),
    base_url: z
      .string({ error: 'base_url must be a non-empty string when present' })
      .refine(notBlank, { error: 'base_url must be a non-empty string when present' })
      .optional(),
  },
  { error: 'the configuration must be a JSON object' },
);

/** Validate a raw object into a config, naming the offending field on failure. */
export const parseConfig = (raw: unknown): ParseResult => {
  if (!isRecord(raw)) return fail('the configuration must be a JSON object');

  const credential = findCredentialKey(raw, []);
  if (credential !== null) {
    return fail(
      `field "${credential}" looks like a credential; keep keys out of this file and store them in the keyring ` +
        `(security add-generic-password -a <account> -s openjob-agent -w)`,
    );
  }

  const shaped = configShape.safeParse(raw);
  if (!shaped.success) return fail(shaped.error.issues[0]?.message ?? 'the configuration is not valid');

  const sources = parseSources(raw['sources']);
  if (!sources.ok) return { ok: false, error: sources.error };

  const config: AgentConfig = {
    provider: shaped.data.provider,
    model: shaped.data.model,
    threshold: shaped.data.threshold,
    profile_dir: shaped.data.profile_dir,
    evidence_dir: shaped.data.evidence_dir,
    pace_ms_floor: shaped.data.pace_ms_floor,
    max_pages_per_run: shaped.data.max_pages_per_run,
    sources: sources.sources,
  };
  if (shaped.data.base_url !== undefined) config.base_url = shaped.data.base_url;
  return { ok: true, config };
};

export type LoadOptions = {
  path?: string;
  readFile?: (path: string) => string;
};

/**
 * Read and validate the configuration file.
 *
 * A missing file is not an error: it means "run with the defaults", which is what
 * a first run looks like. Malformed JSON is an error, because silently falling
 * back to defaults would hide a typo that changes what the agent does.
 */
export const loadConfig = (options: LoadOptions = {}): AgentConfig => {
  const path = options.path ?? defaultConfigPath();
  const readFile = options.readFile ?? ((target: string) => readFileSync(target, 'utf8'));

  let text: string;
  try {
    text = readFile(path);
  } catch (error) {
    const code = isRecord(error) ? error['code'] : undefined;
    if (code === 'ENOENT') return defaultConfig();
    throw new Error(`config: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new Error(`config: ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const result = parseConfig(isRecord(raw) ? { ...defaultConfig(), ...raw } : raw);
  if (!result.ok) throw new Error(result.error);
  return result.config;
};
