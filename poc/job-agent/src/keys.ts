/**
 * Reading the API keys. Writing happens in the desktop app, through the OS keyring.
 *
 * `AGENTS.md` is explicit: secrets are stored through the OS keyring, never in files. The
 * desktop app writes them with the `keyring` crate, which talks to the Security framework
 * directly — no shell, no argument list, no file. This module only reads, so the agent can
 * score while the key never leaves the keychain.
 *
 * A key cannot be written from here on purpose: the only way a process can hand a secret to
 * the `security` CLI is through its argument list, where every other process on the machine
 * can read it.
 */
import { readSecret } from './secrets.ts';

export type KeyAccount = 'typesafe' | 'anthropic' | 'qwen';
export const KEY_ACCOUNTS: readonly KeyAccount[] = ['typesafe', 'anthropic', 'qwen'];

export type KeyringReader = (account: KeyAccount) => string | null;

/** The key for one account, or null when the keyring has none. */
export const readKey = (account: KeyAccount, keyring: KeyringReader = readSecret): string | null => {
  const value = keyring(account)?.trim() ?? '';
  return value.length > 0 ? value : null;
};

/** Which accounts have a key, without revealing any of them. */
export const keyStatus = (keyring: KeyringReader = readSecret): Record<KeyAccount, boolean> => {
  const status = {} as Record<KeyAccount, boolean>;
  for (const account of KEY_ACCOUNTS) status[account] = readKey(account, keyring) !== null;
  return status;
};

/** Accept only the accounts the app knows; anything else is a mistake, not a new key. */
export const asKeyAccount = (value: unknown): KeyAccount | null => {
  if (typeof value !== 'string') return null;
  for (const account of KEY_ACCOUNTS) if (account === value) return account;
  return null;
};
