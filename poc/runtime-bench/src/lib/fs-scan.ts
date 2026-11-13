import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  exit_code: number | null;
};

/**
 * Run a command and keep the difference between "printed nothing" and "failed".
 * Callers must inspect `ok`; an empty stdout is a legitimate result.
 */
export const run = (cwd: string, command: string, args: string[]): CommandResult => {
  try {
    const stdout = execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return { ok: true, stdout, stderr: '', exit_code: 0 };
  } catch (error) {
    const err = error as { status?: number; stderr?: Buffer | string; message?: string };
    const stderr =
      typeof err.stderr === 'string' ? err.stderr : err.stderr ? err.stderr.toString('utf8') : (err.message ?? '');
    return { ok: false, stdout: '', stderr: stderr.trim(), exit_code: err.status ?? null };
  }
};

const SKIP_DIRS = new Set(['node_modules', '.git', '.venv', '__pycache__', 'target', 'dist']);

/**
 * Depth-limited search for files with an exact name. Returns repository-relative
 * paths, always with '/' separators, sorted for stable evidence output on every system. Missing directories are an error, not
 * an empty result, so a typo cannot masquerade as "no manifest found".
 */
export const findFilesNamed = (baseDir: string, relativeFrom: string, name: string, maxDepth = 3): string[] => {
  const hits: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > maxDepth) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (entry.name === name) hits.push(path.relative(relativeFrom, full).split(path.sep).join('/'));
    }
  };
  walk(baseDir, 0);
  return hits.sort();
};

/** Parse JSON as `unknown`; callers narrow it. Returns null on invalid JSON. */
export const parseJsonUnknown = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};
