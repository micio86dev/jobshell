/**
 * Non-secret configuration for the browser job agent.
 *
 * The file holds paths, limits and thresholds — never a credential. A key that
 * looks like a credential is rejected here on purpose: keys belong in the OS
 * keyring (`src/secrets.ts`), so a config file can be copied, diffed or committed
 * without leaking anything.
 */
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

/** Reject a credential at any depth before anything else looks at the object. */
const findCredentialKey = (value: unknown, path: string[]): string | null => {
  if (!isRecord(value)) return null;
  for (const [key, nested] of Object.entries(value)) {
    if (CREDENTIAL_KEY.test(key)) return [...path, key].join('.');
    const deeper = findCredentialKey(nested, [...path, key]);
    if (deeper !== null) return deeper;
  }
  return null;
};

type SourcesResult =
  | { ok: true; sources: Record<string, SourceOverride> }
  | { ok: false; error: string };

const parseSources = (raw: unknown): SourcesResult => {
  if (raw === undefined) return { ok: true, sources: {} };
  if (!isRecord(raw)) return { ok: false, error: 'config: sources must be an object' };
  const sources: Record<string, SourceOverride> = {};
  for (const [id, override] of Object.entries(raw)) {
    if (!isRecord(override)) return { ok: false, error: `config: sources.${id} must be an object` };
    const parsed: SourceOverride = {};
    if (override['automation'] !== undefined) {
      const automation = override['automation'];
      if (typeof automation !== 'string' || !AUTOMATIONS.includes(automation as Automation)) {
        return {
          ok: false,
          error: `config: sources.${id}.automation must be one of ${AUTOMATIONS.join(', ')}`,
        };
      }
      parsed.automation = automation as Automation;
    }
    if (override['pace_ms'] !== undefined) {
      const pace = override['pace_ms'];
      if (typeof pace !== 'number' || !Number.isFinite(pace) || pace <= 0) {
        return { ok: false, error: `config: sources.${id}.pace_ms must be a positive number` };
      }
      parsed.pace_ms = pace;
    }
    if (override['max_pages'] !== undefined) {
      const pages = override['max_pages'];
      if (typeof pages !== 'number' || !Number.isInteger(pages) || pages <= 0) {
        return { ok: false, error: `config: sources.${id}.max_pages must be a positive integer` };
      }
      parsed.max_pages = pages;
    }
    sources[id] = parsed;
  }
  return { ok: true, sources };
};

const positiveInt = (value: unknown, field: string): number | string => {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    return `config: ${field} must be a positive integer`;
  }
  return value;
};

const nonEmptyString = (value: unknown, field: string): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

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

  const provider = raw['provider'];
  if (typeof provider !== 'string' || !PROVIDERS.includes(provider as Provider)) {
    return fail(`provider must be one of ${PROVIDERS.join(', ')} (got ${JSON.stringify(provider)})`);
  }

  const model = nonEmptyString(raw['model'], 'model');
  if (model === null) return fail('model must be a non-empty string');

  const profileDir = nonEmptyString(raw['profile_dir'], 'profile_dir');
  if (profileDir === null) return fail('profile_dir must be a non-empty string');

  const evidenceDir = nonEmptyString(raw['evidence_dir'], 'evidence_dir');
  if (evidenceDir === null) return fail('evidence_dir must be a non-empty string');

  const threshold = raw['threshold'];
  if (typeof threshold !== 'number' || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    return fail(`threshold must be a number between 0 and 1 (got ${JSON.stringify(threshold)})`);
  }

  const paceFloor = positiveInt(raw['pace_ms_floor'], 'pace_ms_floor');
  if (typeof paceFloor === 'string') return { ok: false, error: paceFloor };

  const maxPages = positiveInt(raw['max_pages_per_run'], 'max_pages_per_run');
  if (typeof maxPages === 'string') return { ok: false, error: maxPages };

  const sources = parseSources(raw['sources']);
  if (!sources.ok) return { ok: false, error: sources.error };

  const baseUrl = raw['base_url'];
  if (baseUrl !== undefined && (typeof baseUrl !== 'string' || baseUrl.trim().length === 0)) {
    return fail('base_url must be a non-empty string when present');
  }

  const config: AgentConfig = {
    provider: provider as Provider,
    model,
    threshold,
    profile_dir: profileDir,
    evidence_dir: evidenceDir,
    pace_ms_floor: paceFloor,
    max_pages_per_run: maxPages,
    sources: sources.sources,
  };
  if (typeof baseUrl === 'string') config.base_url = baseUrl;
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
