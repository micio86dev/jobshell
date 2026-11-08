/**
 * Loading the runtime once, for every entry point.
 *
 * The CLI, the bridge and the MCP server all need the same four things: the config,
 * the profile, the compiled spec and the keys. Duplicating that in three places is
 * how the three drift apart, so it lives here.
 */
import { readFileSync } from 'node:fs';

import { loadConfig, type AgentConfig } from './config.ts';
import { compileProfile, parseProfile, type Spec, type UserProfile } from './profile.ts';

export type Runtime = {
  config: AgentConfig;
  profile: UserProfile;
  spec: Spec;
};

export type RuntimeOptions = { profilePath: string; configPath?: string };

export const loadRuntime = (options: RuntimeOptions): Runtime => {
  const config = options.configPath === undefined ? loadConfig() : loadConfig({ path: options.configPath });

  const raw: unknown = JSON.parse(readFileSync(options.profilePath, 'utf8'));
  const parsed = parseProfile(raw);
  if (!parsed.ok) throw new Error(parsed.error);

  // Keys are deliberately not kept here: each entry point reads the one it needs at
  // the moment it builds the client, so a long-lived process does not hold a secret
  // it is not using.
  return { config, profile: parsed.profile, spec: compileProfile(parsed.profile) };
};

/** The message every entry point prints when a key is missing, in one place. */
export const missingKeyMessage = (account: string): string =>
  `no ${account} key in the keyring. Add one with: security add-generic-password -a ${account} -s openjob-agent -w`;
