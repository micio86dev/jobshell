#!/usr/bin/env node
/**
 * Run the lead pipeline once.
 *
 *   node src/leads/cli.ts --profile <path> [--config <path>] [--strategy <path>] [--sources a,b] [--dry-run]
 *
 * It loads the profile and the strategy, wires the judge and the model from the user's choices,
 * reads the imports the user pasted, runs, and writes one JSON document the desktop app stores.
 * The last line of stdout is a small JSON summary with the path of that document. A dry run reads
 * the sources and applies the free filters, and buys nothing.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRuntime } from '../bootstrap.ts';
import { defaultFetch } from '../jev.ts';
import { readSecret } from '../secrets.ts';
import { openCache } from './cache.ts';
import { defaultLeadSources, wireLead } from './bootstrap.ts';
import { takeImports } from './import.ts';
import { runLeads } from './pipeline.ts';
import { defaultStrategyPath, loadStrategy } from './strategy.ts';

const PROGRESS_PREFIX = 'jobshell-progress: ';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const die = (message: string): never => {
  process.stderr.write(`jobshell: ${message}\n`);
  process.exit(2);
};

/** A search that has not finished by now is stuck: it stops with a plain message so the app is never held. */
const MAX_RUN_MS = 45 * 60 * 1000;

const main = async (): Promise<void> => {
  setTimeout(() => die('the search took too long and was stopped'), MAX_RUN_MS).unref();
  const profilePath = arg('profile') ?? die('--profile <path> is required');
  const configPath = arg('config');
  const runtime = loadRuntime({ profilePath, ...(configPath === undefined ? {} : { configPath }) });
  const loaded = loadStrategy(runtime.profile, arg('strategy') ?? defaultStrategyPath());
  if (!loaded.ok) die(loaded.error);
  const strategy = loaded.ok ? loaded.strategy : die('unreachable');
  const dryRun = process.argv.includes('--dry-run');

  const wiring = (() => {
    try {
      return wireLead({ env: process.env, readKey: readSecret, dryRun });
    } catch (error) {
      return die(error instanceof Error ? error.message : 'the provider choice is invalid');
    }
  })();

  const outDir = runtime.config.evidence_dir;
  mkdirSync(outDir, { recursive: true });
  const sources = (arg('sources') ?? defaultLeadSources(runtime.config).join(','))
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
  const cache = openCache(join(outDir, 'leads-cache.json'));

  const document = await runLeads({
    config: runtime.config,
    profile: runtime.profile,
    strategy,
    sources,
    fetchImpl: defaultFetch,
    jev: wiring.jev,
    llm: wiring.llm,
    research: wiring.research,
    researchUnavailable: wiring.researchUnavailable,
    dryRun,
    cache,
    imports: dryRun ? [] : takeImports(outDir),
    now: new Date(),
    onProgress: (message) => process.stderr.write(`${PROGRESS_PREFIX}${message}\n`),
  });
  if (!dryRun) cache.save();

  const path = join(outDir, `${document.run.id}.json`);
  writeFileSync(path, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  process.stdout.write(
    `${JSON.stringify({
      path,
      run_id: document.run.id,
      dry_run: dryRun,
      leads: document.leads.length,
      qualified: document.run.metrics.qualified,
      explanation: document.run.metrics.explanation,
      cost: document.run.cost,
    })}\n`,
  );
};

await main();
