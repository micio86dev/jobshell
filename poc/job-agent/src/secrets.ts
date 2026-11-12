/**
 * Read-only access to the macOS keyring.
 *
 * There is deliberately no write path. The user adds a key once with
 *
 *   security add-generic-password -a anthropic -s dev.openjob.desktop -w
 *
 * which prompts for the value, so the secret never lands in argv, in shell
 * history or in a file this process can read. Reading is all the agent needs, and
 * the value is never logged, never echoed in an error and never returned twice.
 */
import { spawnSync } from 'node:child_process';

export type RunnerResult = { status: number; stdout: string; stderr: string };
export type Runner = (command: string, args: string[]) => RunnerResult;

/** Keychain service shared by every account the agent uses. */
export const SERVICE = 'dev.openjob.desktop';

/** Accounts the agent reads: `anthropic`, `qwen`, `typesafe`. */
export const ACCOUNTS = ['anthropic', 'qwen', 'typesafe'] as const;

/** A hung `security` call must not block the agent, so it is abandoned. */
const TIMEOUT_MS = 10_000;

/** The shape `spawnSync` returns that this module cares about. */
export type SpawnResult = { status: number | null; stdout?: string | null; stderr?: string | null; error?: unknown };

/** Build a runner around a spawn function, so the timeout mapping can be tested. */
export const makeRunner =
  (spawn: (command: string, args: string[], options: { encoding: 'utf8'; timeout: number }) => SpawnResult): Runner =>
  (command, args) => {
    const result = spawn(command, args, { encoding: 'utf8', timeout: TIMEOUT_MS });
    return {
      // 124 is the conventional exit code for "timed out"; a killed process reports no
      // status at all, which must not look like success.
      status: result.error === undefined ? (result.status ?? 1) : 124,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
    };
  };

/** Runs the `security` CLI. Injected, so tests never touch the real keychain. */
export const defaultRunner: Runner = makeRunner(spawnSync);

/** `security` exits 44 when the item is not in the keychain. */
const ITEM_NOT_FOUND = 44;

/**
 * Read one secret, or null when the account has no stored key.
 *
 * Throws only on an unexpected CLI failure, and the message names the account so
 * the user can fix it without the value ever being printed.
 */
export const readSecret = (account: string, runner: Runner = defaultRunner): string | null => {
  const result = runner('security', ['find-generic-password', '-s', SERVICE, '-a', account, '-w']);
  if (result.status === 0) return result.stdout.trim();
  if (result.status === ITEM_NOT_FOUND) return null;
  throw new Error(`secrets: reading account "${account}" failed (security exited ${result.status})`);
};
