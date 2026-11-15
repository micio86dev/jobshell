/**
 * One run of the daily funnel, as a function with everything injected.
 *
 * The order is deliberate: policy first (a source we may not touch is never
 * fetched), then the network, then the free filters, then the paid judgment on the
 * survivors only. The evidence it returns is the product's answer to "what did you
 * do and what did it cost" — every number here is measured, not estimated.
 */
import type { AgentConfig } from './config.ts';
import { applyHardFilters, postingKey, rankAndCap, softBonus, type DropReason, type Scored } from './funnel.ts';
import { MAX_DESCRIPTION_CHARS } from './report.ts';

const boundedDescription = (text: string | null | undefined): string | null =>
  typeof text === 'string' ? text.slice(0, MAX_DESCRIPTION_CHARS) : null;
import { judgePosting, type FetchLike, type HttpResponse, type JeDeps, type StackStance } from './jev.ts';
import { assertAutomationAllowed, Pacer, resolvePolicy } from './policy.ts';
import type { Spec } from './profile.ts';
import { adapterFor } from './sources/registry.ts';
import { tenantsFor, type Tenant } from './sources/tenants.ts';
import { postingsFile, readPostings } from './sources/ziprecruiter.ts';
import type { Challenge, Posting, SearchOptions } from './sources/types.ts';

/** Fallback when neither the caller nor the profile sets a budget. */
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
    unknown_country: number;
    unknown_city: number;
    unknown_contract: number;
    /** Kept postings with at least one unknown fact a constraint needed. */
    needs_verification: number;
  };
  scoring: {
    /** The threshold this run used, so the evidence explains itself. */
    threshold: number;
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
    description: string | null;
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
  /** Board tenants per source. Absent means the verified registry; a map without a source means none. */
  boards?: Readonly<Record<string, readonly Tenant[]>>;
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
  const budget = deps.scoringBudget ?? deps.spec.scoring_budget ?? DEFAULT_SCORING_BUDGET;

  // ZipRecruiter is fetched by the desktop app, with the user's OAuth, through its MCP
  // server; the agent only reads what the app left behind. One judging path stays in place.
  if (deps.sources.includes('ziprecruiter')) {
    const started = Date.now();
    const policy = resolvePolicy('ziprecruiter', deps.config);
    const report: SourceReport = {
      source: 'ziprecruiter',
      policy: policy.automation,
      url: null,
      pages: 1,
      status: null,
      postings: 0,
      challenge: null,
      ms: 0,
      skipped: null,
    };
    // The same gate as the HTTP sources: a config override can tighten this source, and
    // skipping it must never be silent.
    if (policy.automation !== 'allowed') {
      report.skipped = `policy: ${policy.automation}`;
    } else {
      assertAutomationAllowed('ziprecruiter', policy);
      try {
        const postings = readPostings(postingsFile(deps.config.evidence_dir));
        fetched.push(...postings);
        report.postings = postings.length;
        if (postings.length === 0) report.skipped = 'the app has not fetched ZipRecruiter yet';
      } catch (error) {
        report.skipped = error instanceof Error ? error.message : String(error);
      }
    }
    report.ms = Date.now() - started;
    reports.push(report);
  }

  for (const sourceId of deps.sources) {
    if (sourceId === 'ziprecruiter') continue;
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

    // The user's switch comes before the network and before the policy, so a switched-off source costs nothing.
    if (deps.config.sources[sourceId]?.enabled === false) {
      reports.push({ ...report, skipped: 'disabled by the user', ms: Date.now() - started });
      continue;
    }

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

    // A feed ignores the query, so several queries resolve to the same URL. Fetching it
    // once per query would multiply the load on the publisher for identical bytes.
    const urls: string[] = [];
    // The options each URL was built from, so the extraction knows the employer behind a feed.
    const requestOptions = new Map<string, SearchOptions>();
    // Verified employers first, in registry order, then the ones the user added. A tenant listed twice is fetched once.
    const verified = deps.boards === undefined ? tenantsFor(sourceId) : (deps.boards[sourceId] ?? []);
    const boards = [...new Set([...verified.map((entry) => entry.tenant), ...(deps.config.sources[sourceId]?.tenants ?? [])])];
    if (boards.length > 0) {
      // A board source is one request per employer. The page ceiling caps the boards as it caps every other request.
      for (const tenant of boards.slice(0, policy.maxPages)) {
        try {
          const options: SearchOptions = { tenant };
          const url = adapter.buildSearchUrl('', options);
          if (!urls.includes(url)) {
            urls.push(url);
            requestOptions.set(url, options);
          }
        } catch (error) {
          report.skipped = `cannot build a URL: ${error instanceof Error ? error.message : String(error)}`;
          break;
        }
      }
    } else {
      for (const query of deps.queries.list.slice(0, Math.min(policy.maxPages, Math.max(1, deps.queries.list.length)))) {
        try {
          const url = adapter.buildSearchUrl(query, {});
          if (!urls.includes(url)) urls.push(url);
        } catch (error) {
          // A board feed needs a tenant; a missing one is a skip, never a crash.
          report.skipped = `cannot build a URL: ${error instanceof Error ? error.message : String(error)}`;
          break;
        }
      }
    }
    report.pages = urls.length;

    for (const url of urls) {
      await pacer.next();
      report.url = url;
      const pageStarted = Date.now();
      let response: HttpResponse;
      try {
        // No body: a GET with one is rejected by Node's fetch, which would make every
        // source fail while a permissive test fake kept the suite green.
        response = await deps.fetchImpl(url, { method: 'GET', headers: { 'user-agent': 'jobshell-job-agent/0.1' } });
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

      const postings = adapter.extractPostings(response.text, requestOptions.get(url) ?? {});
      report.postings += postings.length;
      fetched.push(...postings);
    }

    report.ms = Date.now() - started;
    reports.push(report);
  }

  // Two sources can carry the same posting, and without this the funnel would judge it
  // twice and the daily cap could show it twice.
  const unique = [...new Map(fetched.map((posting) => [postingKey(posting), posting])).values()];
  const filtered = applyHardFilters(unique, deps.spec, deps.seen, deps.now);
  // The budget judges the most promising survivors, not the first ones fetched. Array sort
  // is stable, so equal soft fits keep the fetch order.
  const bySoftFit = [...filtered.kept].sort(
    (a, b) => softBonus(b, deps.spec.soft) - softBonus(a, deps.spec.soft),
  );
  const survivors = bySoftFit.slice(0, budget);

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
    // Soft preferences lift the ranking; they never drop, and the bonus is capped.
    const lifted = Math.min(1, judged.fit.probability + softBonus(posting, deps.spec.soft));
    scored.push({ posting, probability: lifted });
  }
  const scoringMs = Date.now() - scoringStarted;

  const ranked = rankAndCap(scored, deps.spec.threshold, deps.spec.daily_cap);

  return {
    run_at: deps.now.toISOString(),
    queries: deps.queries,
    sources: reports,
    funnel: {
      fetched: unique.length,
      kept: filtered.kept.length,
      dropped: countDrops(filtered.dropped.map((drop) => drop.reason)),
      unknown_date: filtered.unknown_date,
      unknown_language: filtered.unknown_language,
      unknown_remote: filtered.unknown_remote,
      unknown_country: filtered.unknown_country,
      unknown_city: filtered.unknown_city,
      unknown_contract: filtered.unknown_contract,
      needs_verification: filtered.needs_verification.length,
    },
    scoring: {
      threshold: deps.spec.threshold,
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
        // Kept for the per-posting report, bounded by the same limit the report uses.
        description: boundedDescription(item.posting.description),
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
