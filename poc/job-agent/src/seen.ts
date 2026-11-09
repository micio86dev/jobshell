/**
 * The "already shown" memory, shared by the CLI and the MCP server.
 *
 * One rule, learned the hard way: a path that was asked for and cannot be read is an
 * error. Treating it as a first run is how a corrupt file silently resets the user's
 * dedupe state and then gets overwritten with only the current run's keys.
 */
import { readFileSync, writeFileSync } from 'node:fs';

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
  if (!Array.isArray(parsed)) throw new Error(`seen file ${path} is not a JSON array of keys`);
  return new Set(parsed.filter((value): value is string => typeof value === 'string'));
};

/** Merge the keys shown in this run into the file, keeping everything already there. */
export const saveSeen = (path: string, shown: Iterable<string>): void => {
  const merged = loadSeen(path, 'empty');
  for (const key of shown) merged.add(key);
  writeFileSync(path, `${JSON.stringify([...merged].sort(), null, 2)}\n`, 'utf8');
};
