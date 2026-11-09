/**
 * One run of the daily funnel, as a function with everything injected.
 *
 * The order is deliberate: policy first (a source we may not touch is never
 * fetched), then the network, then the free filters, then the paid judgment on the
 * survivors only. The evidence it returns is the product's answer to "what did you
 * do and what did it cost" — every number here is measured, not estimated.
 */
import type { AgentConfig } from './config.ts';
import { applyHardFilters, postingKey, rankAndCap, type DropReason, type Scored } from './funnel.ts';
import { judgePosting, type FetchLike, type HttpResponse, type JeDeps, type StackStance } from './jev.ts';
import { assertAutomationAllowed, Pacer, resolvePolicy } from './policy.ts';
import type { Spec } from './profile.ts';
import { adapterFor } from './sources/registry.ts';
import type { Challenge, Posting } from './sources/types.ts';

/** How many survivors get a paid judgment in one run. The cost ceiling. */
export const DEFAULT_SCORING_BUDGET = 120;

export type SourceReport = {
  source: string;
  policy: string;
  url: string | null;
  pages: number;
  status: number | null;
  postings: number;
  challenge: Challenge | null;
  ms: number;
  skipped: string | null;
};

export type RunEvidence = {
  run_at: string;
  queries: { list: string[]; source: 'model' | 'fallback'; reason: string | null };
  sources: SourceReport[];
  funnel: {
    fetched: number;
    kept: number;
    dropped: Record<string, number>;
    unknown_date: number;
    unknown_language: number;
    unknown_remote: number;
  };
  scoring: {
    judged: number;
    budget: number;
    above_threshold: number;
    below_threshold: number;
    input_tokens: number;
    ms: number;
  };
  selected: Array<{
    key: string;
    title: string;
    company: string | null;
    url: string;
    source: string;
    probability: number;
    verdict: string;
    stack_stance: StackStance;
    gaps: string[];
  }>;
  overflow: Array<{ key: string; probability: number }>;
};

export type RunDeps = {
  config: AgentConfig;
  spec: Spec;
  queries: { list: string[]; source: 'model' | 'fallback'; reason: string | null };
  sources: string[];
  fetchImpl: FetchLike;
  jev: JeDeps;
  now: Date;
  seen: Set<string>;
  scoringBudget?: number;
  sleep?: (ms: number) => Promise<void>;
};

const countDrops = (reasons: DropReason[]): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const reason of reasons) counts[reason] = (counts[reason] ?? 0) + 1;
  return counts;
};

/** Run one policy-gated collection and return the evidence. */
export const runOnce = async (deps: RunDeps): Promise<RunEvidence> => {
  const reports: SourceReport[] = [];
  const fetched: Posting[] = [];
  const budget = deps.scoringBudget ?? DEFAULT_SCORING_BUDGET;

  for (const sourceId of deps.sources) {
    const started = Date.now();
    const adapter = adapterFor(sourceId);
    const policy = resolvePolicy(sourceId, deps.config);
    const report: SourceReport = {
      source: sourceId,
      policy: policy.automation,
      url: null,
      pages: 0,
      status: null,
      postings: 0,
      challenge: null,
      ms: 0,
      skipped: null,
    };

    if (adapter === null) {
      reports.push({ ...report, skipped: 'no adapter for this source', ms: Date.now() - started });
      continue;
    }

    if (policy.automation === 'prohibited') {
      reports.push({ ...report, skipped: 'policy: prohibited', ms: Date.now() - started });
      continue;
    }

    if (policy.automation === 'measurement_only') {
      // A flag cannot prove a human is present, so the runner does not pretend to.
      // These sources are reachable only through the browser extension, where the
      // human is the one who clicked.
      reports.push({
        ...report,
        skipped: 'policy: session-driven source, use the browser extension',
        ms: Date.now() - started,
      });
      continue;
    }

    // The assertion is kept even though the branches above cover it, so a future
    // policy value cannot slip through this loop unnoticed.
    assertAutomationAllowed(sourceId, policy);

    const pacer = new Pacer(policy.paceMs, () => Date.now(), deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))));
    const pages = Math.min(policy.maxPages, Math.max(1, deps.queries.list.length));
    report.pages = pages;

    for (const query of deps.queries.list.slice(0, pages)) {
      await pacer.next();
      let url: string;
      try {
        url = adapter.buildSearchUrl(query, {});
      } catch (error) {
        // A board feed needs a tenant; a missing one is a skip, never a crash.
        report.skipped = `cannot build a URL: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
      report.url = url;
      const pageStarted = Date.now();
      let response: HttpResponse;
      try {
        // No body: a GET with one is rejected by Node's fetch, which would make every
        // source fail while a permissive test fake kept the suite green.
        response = await deps.fetchImpl(url, { method: 'GET', headers: { 'user-agent': 'openjob-job-agent/0.1' } });
      } catch (error) {
        report.skipped = `fetch failed: ${error instanceof Error ? error.message : String(error)}`;
        break;
      }
      report.status = response.status;
      report.ms += Date.now() - pageStarted;

      if (response.status !== 200) {
        report.skipped = `status ${response.status}`;
        break;
      }

      const challenge = adapter.detectChallenge(response.text);
      report.challenge = challenge;
      if (challenge !== 'none') {
        // Never solved, never retried: the run stops here and says why.
        report.skipped = `challenge: ${challenge}`;
        break;
      }

      const postings = adapter.extractPostings(response.text);
      report.postings += postings.length;
      fetched.push(...postings);
    }

    report.ms = Date.now() - started;
    reports.push(report);
  }

  const filtered = applyHardFilters(fetched, deps.spec, deps.seen, deps.now);
  const survivors = filtered.kept.slice(0, budget);

  const scoringStarted = Date.now();
  let inputTokens = 0;
  const scored: Scored[] = [];
  const verdicts = new Map<string, { verdict: string; stance: StackStance; gap: string }>();

  for (const posting of survivors) {
    const judged = await judgePosting(posting, deps.spec.prompt_context, deps.jev);
    inputTokens += judged.usage.input_tokens;
    verdicts.set(postingKey(posting), {
      verdict: judged.fit.verdict,
      stance: judged.stack_stance.stance,
      gap: judged.gap,
    });
    scored.push({ posting, probability: judged.fit.probability });
  }
  const scoringMs = Date.now() - scoringStarted;

  const ranked = rankAndCap(scored, deps.spec.threshold, deps.spec.daily_cap);

  return {
    run_at: deps.now.toISOString(),
    queries: deps.queries,
    sources: reports,
    funnel: {
      fetched: fetched.length,
      kept: filtered.kept.length,
      dropped: countDrops(filtered.dropped.map((drop) => drop.reason)),
      unknown_date: filtered.unknown_date,
      unknown_language: filtered.unknown_language,
      unknown_remote: filtered.unknown_remote,
    },
    scoring: {
      judged: scored.length,
      budget,
      above_threshold: ranked.selected.length + ranked.overflow.length,
      below_threshold: ranked.below_threshold,
      input_tokens: inputTokens,
      ms: scoringMs,
    },
    selected: ranked.selected.map((item) => {
      const detail = verdicts.get(postingKey(item.posting));
      return {
        key: postingKey(item.posting),
        title: item.posting.title,
        company: item.posting.company,
        url: item.posting.url,
        source: item.posting.source,
        probability: item.probability,
        verdict: detail?.verdict ?? 'unknown',
        stack_stance: detail?.stance ?? 'not_specified',
        // The disclosure the product promises: an accepted gap is named, not hidden.
        gaps: detail === undefined || detail.gap === 'none' ? [] : [detail.gap],
      };
    }),
    overflow: ranked.overflow.map((item) => ({ key: postingKey(item.posting), probability: item.probability })),
  };
};
