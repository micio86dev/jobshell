/**
 * The funnel of a lead run, and the sentences that explain an empty result.
 *
 * An empty dashboard is only acceptable when it can say why. Every stage records what went in and
 * what came out, every loss has a named reason, and `explain` turns those numbers into the plain
 * answer to "why no leads today": which source was unreachable, which filter removed what, which
 * judgment was unavailable, how far the best candidate was from the line.
 */
import type { SourceReport } from '../run.ts';
import type { CostSummary } from './cost.ts';

export type RunError = { stage: string; message: string };

export type RunMetrics = {
  sources: SourceReport[];
  signals: { collected: number; unique: number; unidentified: number; identified_by_model: number };
  companies: { found: number; with_every_signal_dropped: number; classified: number; from_cache: number };
  prefilter_dropped: Record<string, number>;
  judge: { available: boolean; calls: number; suspicious: number; failed: number };
  research: { available: boolean; reason: string | null; companies: number; failed: number; facts_kept: number; facts_downgraded: number; contacts_kept: number; contacts_dropped: number; skipped_for_budget: number };
  outreach: { drafted: number; refused: number };
  qualified: number;
  rejected: Record<string, number>;
  /** The highest score among companies that did not qualify, so "nothing qualified" says how near it came. */
  best_rejected: { company: string; score: number; reason: string } | null;
  threshold: number;
  errors: RunError[];
  ms: Record<string, number>;
  cost: CostSummary;
};

export const emptyMetrics = (threshold: number, cost: CostSummary): RunMetrics => ({
  sources: [],
  signals: { collected: 0, unique: 0, unidentified: 0, identified_by_model: 0 },
  companies: { found: 0, with_every_signal_dropped: 0, classified: 0, from_cache: 0 },
  prefilter_dropped: {},
  judge: { available: true, calls: 0, suspicious: 0, failed: 0 },
  research: { available: true, reason: null, companies: 0, failed: 0, facts_kept: 0, facts_downgraded: 0, contacts_kept: 0, contacts_dropped: 0, skipped_for_budget: 0 },
  outreach: { drafted: 0, refused: 0 },
  qualified: 0,
  rejected: {},
  best_rejected: null,
  threshold,
  errors: [],
  ms: {},
  cost,
});

const top = (record: Record<string, number>, count: number): string =>
  Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([reason, total]) => `${reason} (${total})`)
    .join(', ');

/** Why this run produced what it did. With qualified leads it still reports what was weak. */
export const explain = (metrics: RunMetrics): string[] => {
  const lines: string[] = [];
  const reached = metrics.sources.filter((source) => source.skipped === null);
  const failed = metrics.sources.filter((source) => source.skipped !== null && source.skipped !== 'disabled by the user');

  if (metrics.sources.length === 0) {
    lines.push('No source was queried: every source is switched off or none is configured.');
  } else if (reached.length === 0) {
    lines.push(`No source was reachable: ${failed.map((source) => `${source.source}: ${source.skipped ?? ''}`).slice(0, 5).join('; ')}.`);
  } else if (failed.length > 0) {
    lines.push(`${failed.length} of ${metrics.sources.length} sources gave nothing: ${failed.map((source) => `${source.source}: ${source.skipped ?? ''}`).slice(0, 4).join('; ')}.`);
  }

  if (reached.length > 0 && metrics.signals.collected === 0) lines.push('The sources answered but returned no signals.');
  if (metrics.signals.unidentified > 0) {
    lines.push(`${metrics.signals.unidentified} of ${metrics.signals.unique} signals name no company and could not be identified, so they stayed out.`);
  }
  const dropped = Object.values(metrics.prefilter_dropped).reduce((sum, count) => sum + count, 0);
  if (dropped > 0 && metrics.companies.classified === 0 && metrics.companies.found > 0) {
    lines.push(`The free filters removed every company before judgment: ${top(metrics.prefilter_dropped, 4)}. They may be too strict for the strategy.`);
  }
  if (!metrics.judge.available) {
    lines.push('The judgment service was not available, so no company could be qualified. Check the TypeSafe or Laya key in Settings.');
  } else if (metrics.judge.failed > 0) {
    lines.push(`${metrics.judge.failed} judgments failed and those companies were not qualified.`);
  }
  if (metrics.judge.suspicious > 0) lines.push(`${metrics.judge.suspicious} signals looked like schemes or vague bait and were dropped.`);
  if (!metrics.research.available) {
    lines.push(`Company research was not available (${metrics.research.reason ?? 'unknown reason'}): scores rest on the signals alone, so confidence is lower and no contact could be found.`);
  } else if (metrics.research.failed > 0) {
    lines.push(`Research failed for ${metrics.research.failed} companies; they were scored on the signals alone.`);
  }
  if (metrics.research.skipped_for_budget > 0) lines.push(`${metrics.research.skipped_for_budget} promising companies were not researched: the budget for this run was reached.`);

  if (metrics.qualified === 0 && metrics.companies.classified > 0) {
    const best = metrics.best_rejected;
    lines.push(
      `No company reached the threshold of ${metrics.threshold}. Reasons: ${top(metrics.rejected, 4)}.${best === null ? '' : ` Closest: ${best.company} at ${best.score} (${best.reason}).`}`,
    );
  }
  if (metrics.qualified > 0) lines.push(`${metrics.qualified} qualified leads from ${metrics.companies.classified} companies judged.`);
  return lines;
};
