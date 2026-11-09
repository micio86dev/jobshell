#!/usr/bin/env node
/**
 * The command line entry point.
 *
 * It is deliberately thin: everything it does is load state, call `runOnce`, and
 * write evidence. The policy, the funnel and the judgment all live in modules that
 * are tested without a terminal.
 *
 * Usage:
 *   node src/cli.ts --profile <path> [--config <path>] [--sources a,b]
 *                   [--dry-run] [--out <dir>]
 *
 * Session-driven sources (LinkedIn, Indeed, StepStone, …) are never fetched here:
 * they are reachable only through the browser extension, where a human clicked.
 *
 * `--dry-run` fetches and filters but buys no judgment, which is how the speed of
 * a source is measured without spending a token.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadRuntime, missingKeyMessage } from './bootstrap.ts';
import { defaultFetch } from './jev.ts';
import { planQueries } from './planner.ts';
import { resolvePolicy } from './policy.ts';
import { runOnce, type RunEvidence } from './run.ts';
import { loadSeen, saveSeen } from './seen.ts';
import { readSecret } from './secrets.ts';
import { listSources } from './sources/registry.ts';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const die = (message: string): never => {
  process.stderr.write(`openjob: ${message}\n`);
  process.exit(2);
};

/**
 * Read the memory, or stop. A corrupt file must end the run: starting from empty and
 * then writing would replace the user's history with this run only.
 */
const loadSeenOrDie = (path: string): Set<string> => {
  try {
    return loadSeen(path, 'empty');
  } catch (error) {
    return die(error instanceof Error ? error.message : String(error));
  }
};

const main = async (): Promise<void> => {
  const profilePath = arg('profile') ?? die('--profile <path> is required');
  const configPath = arg('config');
  const runtime = loadRuntime({
    profilePath,
    ...(configPath === undefined ? {} : { configPath }),
  });
  const { config, profile, spec } = runtime;

  // Only sources the policy allows unattended. A board feed that needs a tenant is
  // kept out too: `runOnce` reports it as a skip instead of crashing.
  const allowed = listSources().filter(
    (id) => resolvePolicy(id, config).automation === 'allowed' && id !== 'greenhouse',
  );
  const sources = (arg('sources') ?? allowed.join(','))
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0);

  const dryRun = flag('dry-run');
  const outDir = arg('out') ?? config.evidence_dir;
  mkdirSync(outDir, { recursive: true });

  const typesafeKey = readSecret('typesafe');
  if (typesafeKey === null && !dryRun) die(missingKeyMessage('typesafe'));
  // A dry run buys no judgment, so this placeholder is never sent anywhere. Naming it
  // makes that explicit instead of passing an empty string that looks like a key.
  const jevKey = typesafeKey ?? 'dry-run-no-judgment';

  const providerKey = readSecret(config.provider);
  // A dry run buys nothing: no judgment and no planner call, so the profile never
  // leaves the machine. That is what the README promises and what this enforces.
  const plannerDeps = providerKey === null || dryRun
    ? null
    : {
        provider: config.provider,
        apiKey: providerKey,
        model: config.model,
        fetchImpl: defaultFetch,
        ...(config.base_url === undefined ? {} : { baseUrl: config.base_url }),
      };

  const queries = plannerDeps === null
    ? {
        queries: {
          list: spec.queries,
          source: 'fallback' as const,
          reason: dryRun ? 'dry run: the planner is not called' : 'no provider key in the keyring',
        },
      }
    : await planQueries(profile, plannerDeps).then((plan) => ({
        queries: { list: plan.queries, source: plan.source, reason: plan.reason },
      }));

  const seenPath = join(outDir, 'seen.json');
  const seen = loadSeenOrDie(seenPath);

  const evidence: RunEvidence = await runOnce({
    config,
    spec,
    queries: queries.queries,
    sources,
    fetchImpl: defaultFetch,
    jev: {
      apiKey: jevKey,
      fetchImpl: defaultFetch,
      ...(config.base_url === undefined ? {} : { baseUrl: config.base_url }),
    },
    now: new Date(),
    seen,
    ...(dryRun ? { scoringBudget: 0 } : {}),
  });

  const stamp = evidence.run_at.replace(/[:.]/g, '-');
  const evidencePath = join(outDir, `run-${stamp}.json`);
  writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');

  const selectedKeys = evidence.selected.map((item) => item.key);
  if (selectedKeys.length > 0) saveSeen(seenPath, selectedKeys);

  const lines: string[] = [];
  lines.push(`openjob run ${evidence.run_at}${dryRun ? ' (dry run: no judgment bought)' : ''}`);
  for (const report of evidence.sources) {
    lines.push(
      `  ${report.source.padEnd(15)} ${report.policy.padEnd(16)} ` +
        (report.skipped === null
          ? `${report.postings} postings in ${report.ms} ms`
          : `skipped: ${report.skipped}`),
    );
  }
  lines.push(
    `  funnel: ${evidence.funnel.fetched} fetched, ${evidence.funnel.kept} kept, ` +
      `dropped ${JSON.stringify(evidence.funnel.dropped)}`,
  );
  lines.push(
    `  scoring: ${evidence.scoring.judged} judged in ${evidence.scoring.ms} ms, ` +
      `${evidence.scoring.input_tokens} input tokens, ${evidence.scoring.above_threshold} above ${spec.threshold}`,
  );
  if (evidence.selected.length === 0) {
    lines.push('  nothing above the threshold today. That is the product working, not failing.');
  }
  for (const item of evidence.selected) {
    lines.push(`  ${Math.round(item.probability * 100)}%  ${item.title} — ${item.company ?? 'unknown company'}`);
    lines.push(`        ${item.url}`);
  }
  lines.push(`  evidence: ${evidencePath}`);
  process.stdout.write(`${lines.join('\n')}\n`);
};

await main();
