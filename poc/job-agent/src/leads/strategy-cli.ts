#!/usr/bin/env node
/**
 * Read or change the client-search strategy from the app.
 *
 *   node src/leads/strategy-cli.ts get --profile <path>
 *   node src/leads/strategy-cli.ts set --profile <path>      (the change as JSON on stdin)
 *
 * `get` prints the strategy a run would use. `set` validates the change against the schema and
 * writes only the fields the user set, so the rest keeps following the profile.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { loadRuntime } from '../bootstrap.ts';
import { applyChange, defaultStrategyPath, loadStrategy } from './strategy.ts';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const die = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

const main = (): void => {
  const command = process.argv[2];
  const profilePath = arg('profile') ?? die('--profile <path> is required');
  const { profile } = loadRuntime({ profilePath });
  const path = arg('strategy') ?? defaultStrategyPath();

  if (command === 'get') {
    const loaded = loadStrategy(profile, path);
    if (!loaded.ok) die(loaded.error);
    process.stdout.write(`${JSON.stringify(loaded.ok ? loaded.strategy : null)}\n`);
    return;
  }
  if (command === 'set') {
    let change: unknown;
    try {
      change = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      return die('the change is not valid JSON');
    }
    let existing: unknown = {};
    try {
      existing = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      // No file yet: the change is the first override.
    }
    const applied = applyChange(profile, existing, change);
    if (!applied.ok) return die(applied.error);
    mkdirSync(dirname(path), { recursive: true });
    const temporary = `${path}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(applied.overrides, null, 2)}\n`, 'utf8');
    renameSync(temporary, path);
    const loaded = loadStrategy(profile, path);
    process.stdout.write(`${JSON.stringify(loaded.ok ? loaded.strategy : null)}\n`);
    return;
  }
  die('use "get" or "set"');
};

main();
