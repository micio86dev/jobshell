/**
 * Collection: every enabled source, under the same policy and pace as the job pipeline.
 *
 * Posting sources and signal sources both end as signals. A source the user switched off, one the
 * policy does not allow, or one that answers with an error or a challenge is reported with its
 * reason and never retried: an empty result must always be explainable.
 */
import type { AgentConfig } from '../config.ts';
import type { FetchLike, HttpResponse } from '../jev.ts';
import { assertAutomationAllowed, Pacer, resolvePolicy } from '../policy.ts';
import type { SourceReport } from '../run.ts';
import { adapterFor } from '../sources/registry.ts';
import { tenantsFor, type Tenant } from '../sources/tenants.ts';
import { postingsFile, readPostings } from '../sources/ziprecruiter.ts';
import type { SearchOptions } from '../sources/types.ts';
import { postingToSignal } from './company.ts';
import { signalSourceFor } from './sources.ts';
import type { Signal } from './types.ts';

export type CollectDeps = {
  config: AgentConfig;
  fetchImpl: FetchLike;
  now: Date;
  /** Source ids to read, posting adapters and signal sources alike. */
  sources: string[];
  /** Search strings for the posting adapters that take a query. */
  queries: string[];
  boards?: Readonly<Record<string, readonly Tenant[]>>;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (message: string) => void;
};

const USER_AGENT = 'jobshell-job-agent/0.1';

type Plan = {
  id: string;
  urls: string[];
  detectChallenge: (body: string) => ReturnType<NonNullable<ReturnType<typeof adapterFor>>['detectChallenge']>;
  parse: (body: string, url: string) => Signal[];
  follow: (body: string, url: string) => string[];
};

const emptyReport = (source: string, policy: string): SourceReport => ({
  source,
  policy,
  url: null,
  pages: 0,
  status: null,
  postings: 0,
  challenge: null,
  ms: 0,
  skipped: null,
});

/** The fetch plan of a source: a posting adapter or a signal source, or null when there is none. */
const planFor = (id: string, deps: CollectDeps, maxPages: number): Plan | { skipped: string } | null => {
  const signalSource = signalSourceFor(id);
  if (signalSource !== null) {
    return {
      id,
      urls: signalSource.requests(deps.now),
      detectChallenge: (body) => signalSource.detectChallenge(body),
      parse: (body, url) => signalSource.parse(body, { now: deps.now, url }),
      follow: (body, url) => signalSource.follow?.(body, { now: deps.now, url }) ?? [],
    };
  }
  const adapter = adapterFor(id);
  if (adapter === null) return null;
  const urls: string[] = [];
  const options = new Map<string, SearchOptions>();
  const verified = deps.boards === undefined ? tenantsFor(id) : (deps.boards[id] ?? []);
  const boards = [...new Set([...verified.map((entry) => entry.tenant), ...(deps.config.sources[id]?.tenants ?? [])])];
  try {
    if (boards.length > 0) {
      for (const tenant of boards.slice(0, maxPages)) {
        const request: SearchOptions = { tenant };
        const url = adapter.buildSearchUrl('', request);
        if (!urls.includes(url)) {
          urls.push(url);
          options.set(url, request);
        }
      }
    } else {
      for (const query of deps.queries.slice(0, Math.min(maxPages, Math.max(1, deps.queries.length)))) {
        const url = adapter.buildSearchUrl(query, {});
        if (!urls.includes(url)) urls.push(url);
      }
    }
  } catch (error) {
    return { skipped: `cannot build a URL: ${error instanceof Error ? error.message : String(error)}` };
  }
  return {
    id,
    urls,
    detectChallenge: (body) => adapter.detectChallenge(body),
    parse: (body, url) => adapter.extractPostings(body, options.get(url) ?? {}).map((posting) => postingToSignal(posting, deps.now)),
    follow: () => [],
  };
};

/** Read every source and return the signals with one report per source. */
export const collectSignals = async (deps: CollectDeps): Promise<{ signals: Signal[]; reports: SourceReport[] }> => {
  const signals: Signal[] = [];
  const reports: SourceReport[] = [];
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  for (const id of deps.sources) {
    const started = Date.now();
    const policy = resolvePolicy(id, deps.config);
    const report = emptyReport(id, policy.automation);
    const finish = (skipped: string | null): void => {
      report.skipped = skipped ?? report.skipped;
      report.ms = Date.now() - started;
      reports.push(report);
    };

    if (deps.config.sources[id]?.enabled === false) {
      finish('disabled by the user');
      continue;
    }
    if (policy.automation === 'prohibited') {
      finish('policy: prohibited');
      continue;
    }
    if (policy.automation === 'measurement_only') {
      finish('policy: session-driven source, use the browser extension');
      continue;
    }
    assertAutomationAllowed(id, policy);

    // ZipRecruiter is fetched by the desktop app with the user's own authorization; this only reads the file.
    if (id === 'ziprecruiter') {
      try {
        const postings = readPostings(postingsFile(deps.config.evidence_dir));
        signals.push(...postings.map((posting) => postingToSignal(posting, deps.now)));
        report.postings = postings.length;
        finish(postings.length === 0 ? 'the app has not fetched ZipRecruiter yet' : null);
      } catch (error) {
        finish(error instanceof Error ? error.message : String(error));
      }
      continue;
    }

    const plan = planFor(id, deps, policy.maxPages);
    if (plan === null) {
      finish('no adapter for this source');
      continue;
    }
    if ('skipped' in plan) {
      finish(plan.skipped);
      continue;
    }

    const pacer = new Pacer(policy.paceMs, () => Date.now(), sleep);
    const queue = [...plan.urls];
    let fetched = 0;
    while (queue.length > 0 && fetched < policy.maxPages) {
      const url = queue.shift();
      if (url === undefined) break;
      fetched += 1;
      deps.onProgress?.(`fetching ${id}, page ${fetched}`);
      await pacer.next();
      report.url = url;
      const pageStarted = Date.now();
      let response: HttpResponse;
      try {
        response = await deps.fetchImpl(url, { method: 'GET', headers: { 'user-agent': USER_AGENT } });
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
      const challenge = plan.detectChallenge(response.text);
      report.challenge = challenge;
      if (challenge !== 'none') {
        report.skipped = `challenge: ${challenge}`;
        break;
      }
      const found = plan.parse(response.text, url);
      report.postings += found.length;
      signals.push(...found);
      queue.push(...plan.follow(response.text, url).filter((next) => !queue.includes(next)));
    }
    report.pages = fetched;
    finish(null);
  }
  return { signals, reports };
};
