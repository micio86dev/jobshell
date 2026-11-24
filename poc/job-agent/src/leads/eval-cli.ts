#!/usr/bin/env node
/**
 * The live evaluation: the ten mandatory scenarios, judged by the real judgment service on a real profile.
 *
 *   node src/leads/eval-cli.ts --profile <path> [--out <file>]
 *
 * The scenarios are controlled fixtures (companies that do not exist), so this measures whether the judge
 * agrees with the expected label, not whether the market has such companies. Web research is not part of
 * it: no model provider is called, so the only cost is the judge's input tokens. The result file holds the
 * verdicts and the metrics, never the profile.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRuntime } from '../bootstrap.ts';
import { defaultFetch } from '../jev.ts';
import { readSecret } from '../secrets.ts';
import { wireLead } from './bootstrap.ts';
import { openCache } from './cache.ts';
import { runLeads } from './pipeline.ts';
import { defaultStrategy } from './strategy.ts';
import type { Signal } from './types.ts';

type Scenario = { id: string; title: string; expected: { qualified: boolean }; signal: Signal };

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const main = async (): Promise<void> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const profilePath = arg('profile');
  if (profilePath === undefined) {
    process.stderr.write('--profile <path> is required\n');
    process.exit(2);
  }
  const scenarios = JSON.parse(readFileSync(resolve(here, '../../test/fixtures/leads/scenarios.json'), 'utf8')) as Scenario[];
  const runtime = loadRuntime({ profilePath });
  // The default strategy, untouched: the threshold is not tuned to the scenarios.
  const strategy = defaultStrategy(runtime.profile);
  const wiring = wireLead({ env: process.env, readKey: readSecret, dryRun: false });
  if (wiring.jev === null) {
    process.stderr.write('no judgment key is stored: add the TypeSafe key in Settings\n');
    process.exit(2);
  }

  const started = Date.now();
  const document = await runLeads({
    config: runtime.config,
    profile: runtime.profile,
    strategy,
    sources: [],
    fetchImpl: defaultFetch,
    jev: wiring.jev,
    llm: null,
    research: null,
    researchUnavailable: 'the evaluation judges the signals alone',
    cache: openCache('/nonexistent-dir/never-saved.json'),
    imports: scenarios.map((scenario) => scenario.signal),
    now: new Date(),
  });
  const ms = Date.now() - started;

  const rows = scenarios.map((scenario) => {
    const lead = document.leads.find((entry) => entry.company_name === scenario.signal.company_name);
    const got = lead?.qualified === true;
    return {
      id: scenario.id,
      expected_qualified: scenario.expected.qualified,
      qualified: got,
      analysed: lead !== undefined,
      score: lead?.score.total ?? null,
      confidence: lead?.score.confidence ?? null,
      reason: lead === undefined ? 'set aside before judgment' : (lead.rejection_reason ?? null),
      dimensions: lead?.score.dimensions.map((dimension) => [dimension.name, dimension.points]) ?? [],
      agrees: got === scenario.expected.qualified,
    };
  });
  const relevant = rows.filter((row) => row.expected_qualified);
  const irrelevant = rows.filter((row) => !row.expected_qualified);
  const truePositive = relevant.filter((row) => row.qualified).length;
  const falsePositive = irrelevant.filter((row) => row.qualified).length;
  const metrics = {
    scenarios: rows.length,
    agreement: rows.filter((row) => row.agrees).length,
    recall: relevant.length === 0 ? null : truePositive / relevant.length,
    precision: truePositive + falsePositive === 0 ? null : truePositive / (truePositive + falsePositive),
    relevant_wrongly_rejected: relevant.filter((row) => !row.qualified).map((row) => row.id),
    irrelevant_wrongly_accepted: irrelevant.filter((row) => row.qualified).map((row) => row.id),
    judge_input_tokens: document.run.cost.jev_input_tokens,
    judge_failed_calls: document.run.metrics.judge.failed,
    errors: document.run.metrics.errors,
    ms,
  };

  const outFile = resolve(arg('out') ?? resolve(here, '../../../../evidence/leads-eval', `${new Date().toISOString().slice(0, 10)}.json`));
  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(
    outFile,
    `${JSON.stringify({ generated_at: new Date().toISOString(), method: 'real judgment service on controlled fixtures; no web research; default strategy (threshold ' + strategy.threshold + ')', judge: wiring.choice.judgment.service + ' ' + wiring.choice.judgment.model, metrics, rows }, null, 2)}\n`,
  );
  for (const row of rows) {
    process.stdout.write(`${row.agrees ? 'ok ' : 'XX '} ${row.id.padEnd(28)} expected=${String(row.expected_qualified).padEnd(5)} got=${String(row.qualified).padEnd(5)} score=${row.score ?? '-'} ${row.reason ?? ''}\n`);
  }
  process.stdout.write(`\nagreement ${metrics.agreement}/${metrics.scenarios}, recall ${metrics.recall}, precision ${metrics.precision}, judge tokens ${metrics.judge_input_tokens}, failed calls ${metrics.judge_failed_calls}\nevidence: ${outFile}\n`);
};

await main();
