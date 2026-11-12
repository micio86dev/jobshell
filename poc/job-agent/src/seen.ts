/**
 * The "already shown" memory, shared by the CLI and the MCP server.
 *
 * One rule, learned the hard way: a path that was asked for and cannot be read is an
 * error. Treating it as a first run is how a corrupt file silently resets the user's
 * dedupe state and then gets overwritten with only the current run's keys.
 */
import { closeSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

/** The memory file is a JSON array of keys, and nothing else: any other entry is corruption. */
const seenKeys = z.array(z.string(), {
  error: (issue) => `not a JSON array of keys (${issue.code})`,
});

/**
 * What a missing file means, which depends on who is asking.
 *
 * `empty` for the CLI, where the file lives at a path the program chose and simply
 * does not exist yet. `error` for the MCP entry point, where the user named the file
 * and a missing one is a mistake worth stopping for.
 */
export type MissingMode = 'empty' | 'error';

/** Read the keys already shown. `null` means no file was asked for: a first run. */
export const loadSeen = (path: string | null, missing: MissingMode = 'error'): Set<string> => {
  if (path === null) return new Set();
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === 'ENOENT' && missing === 'empty') return new Set();
    throw new Error(`seen file ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    // A file that exists but cannot be parsed is always an error: guessing here is how
    // a corrupt memory resets the user's history.
    throw new Error(`seen file ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const keys = seenKeys.safeParse(parsed);
  if (!keys.success) throw new Error(`seen file ${path} is not a JSON array of keys`);
  return new Set(keys.data);
};

/** How long a save waits for another run to release the memory before it refuses. */
const LOCK_WAIT_MS = 1500;
const LOCK_RETRY_MS = 50;

const sleep = (ms: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
};

/**
 * Take the lock that serialises read-modify-write between the CLI and the MCP server. The lock
 * is a file created exclusively; a run that cannot get it within the wait refuses rather than
 * overwrite the memory another run is writing.
 */
const acquireLock = (lockPath: string, memoryPath: string): number => {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      return openSync(lockPath, 'wx');
    } catch (error) {
      const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
      if (code !== 'EEXIST') throw error;
      if (Date.now() >= deadline) {
        throw new Error(
          `seen file ${memoryPath} is locked by another run. If no run is active, a previous crash left the lock: remove ${lockPath}`,
        );
      }
      sleep(LOCK_RETRY_MS);
    }
  }
};

/**
 * Merge the keys shown in this run into the file, keeping everything already there.
 *
 * The write goes to a temporary file that is then renamed over the memory, so a crash leaves
 * either the old memory or the new one, never a half-written file. The lock is released only by
 * the run that took it.
 */
export const saveSeen = (path: string, shown: Iterable<string>): void => {
  const lockPath = `${path}.lock`;
  const lockFd = acquireLock(lockPath, path);
  closeSync(lockFd);
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const merged = loadSeen(path, 'empty');
    for (const key of shown) merged.add(key);
    writeFileSync(temporary, `${JSON.stringify([...merged].sort(), null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary was renamed into place; there is nothing left to remove.
    }
    unlinkSync(lockPath);
  }
};
