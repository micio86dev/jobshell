/**
 * The "already shown" memory, shared by the CLI and the MCP server.
 *
 * One rule, learned the hard way: a path that was asked for and cannot be read is an
 * error. Treating it as a first run is how a corrupt file silently resets the user's
 * dedupe state and then gets overwritten with only the current run's keys.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** Read the keys already shown. `null` means no file was asked for: a first run. */
export const loadSeen = (path: string | null): Set<string> => {
  if (path === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`seen file ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`seen file ${path} is not a JSON array of keys`);
  return new Set(parsed.filter((value): value is string => typeof value === 'string'));
};

/** Merge the keys shown in this run into the file, keeping everything already there. */
export const saveSeen = (path: string, shown: Iterable<string>): void => {
  const merged = loadSeen(path);
  for (const key of shown) merged.add(key);
  writeFileSync(path, `${JSON.stringify([...merged].sort(), null, 2)}\n`, 'utf8');
};
