/**
 * Live probe of every source the agent can reach without a credential or a browser.
 *
 * One read-only GET per verified tenant (or per public feed), with a self-identifying user agent,
 * one request every 1.2 seconds, and robots.txt read first for each origin. A URL that robots.txt
 * refuses is never requested. The result is written to the evidence directory, one JSON file per
 * day, and the same run prints one line per source.
 *
 *   node src/source-probe-cli.ts [output-file]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pacer, baseAutomation } from './policy.ts';
import { robotsAllows, verdictOf, type ProbeVerdict } from './source-probe.ts';
import { adapterFor, listSources } from './sources/registry.ts';
import { tenantsFor } from './sources/tenants.ts';
import type { SearchOptions, SourceAdapter } from './sources/types.ts';

const USER_AGENT = 'jobshell-job-agent/0.1 (read-only source probe)';
const PACE_MS = 1200;
const TIMEOUT_MS = 20_000;
const MAX_SAMPLE_TITLES = 3;

type Target = {
  source: string;
  tenant: string | null;
  url: string;
  options: SearchOptions;
  adapter: SourceAdapter;
};

/** The publisher's robots.txt: its HTTP status, and its text when it could be read (null when it could not). */
type Robots = { status: number | string; text: string | null };

type ProbeRecord = {
  source: string;
  tenant: string | null;
  url: string;
  robots_status: number | string;
  robots_allowed: boolean | null;
  status: number | null;
  bytes: number;
  challenge: string | null;
  postings: number;
  verdict: ProbeVerdict | 'not_probed';
  sample_titles: string[];
  error: string | null;
};

const targetsOf = (): { targets: Target[]; skipped: Array<{ source: string; reason: string }> } => {
  const targets: Target[] = [];
  const skipped: Array<{ source: string; reason: string }> = [];
  for (const source of listSources()) {
    const automation = baseAutomation(source);
    if (automation !== 'allowed') {
      skipped.push({ source, reason: `policy: ${automation}` });
      continue;
    }
    const adapter = adapterFor(source);
    if (adapter === null) continue;
    const tenants = tenantsFor(source);
    const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((entry) => entry.tenant) : [null];
    for (const tenant of tenantIds) {
      const options: SearchOptions = tenant === null ? {} : { tenant };
      try {
        targets.push({ source, tenant, url: adapter.buildSearchUrl('', options), options, adapter });
      } catch (error) {
        skipped.push({ source, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  }
  return { targets, skipped };
};

const fetchText = async (
  url: string,
  redirect: 'follow' | 'manual',
): Promise<{ status: number; text: string } | { error: string }> => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json, application/rss+xml, application/xml, text/xml, */*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

/**
 * robots.txt of one origin, read once per run. A 404 or 410 means the publisher states no policy,
 * so its text is empty. Any other answer, or no answer, leaves the text unknown.
 */
const robotsFor = async (origin: string, pacer: Pacer, cache: Map<string, Robots>): Promise<Robots> => {
  const cached = cache.get(origin);
  if (cached !== undefined) return cached;
  await pacer.next();
  // RFC 9309 asks crawlers to follow redirects for robots.txt itself, since a publisher may host it on its own domain.
  const response = await fetchText(`${origin}/robots.txt`, 'follow');
  let robots: Robots;
  if ('error' in response) robots = { status: response.error, text: null };
  else if (response.status === 200) robots = { status: 200, text: response.text };
  else if (response.status === 404 || response.status === 410) robots = { status: response.status, text: '' };
  else robots = { status: response.status, text: null };
  cache.set(origin, robots);
  return robots;
};

const main = async (): Promise<void> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const today = new Date().toISOString().slice(0, 10);
  const outputFile = resolve(process.argv[2] ?? resolve(here, '../../../evidence/source-probe', `${today}.json`));

  const { targets, skipped } = targetsOf();
  const pacer = new Pacer(PACE_MS);
  const robotsCache = new Map<string, Robots>();
  const records: ProbeRecord[] = [];

  for (const target of targets) {
    const url = new URL(target.url);
    const robots = await robotsFor(url.origin, pacer, robotsCache);
    const row = {
      source: target.source,
      tenant: target.tenant,
      url: target.url,
      robots_status: robots.status,
      status: null as number | null,
      bytes: 0,
      challenge: null as string | null,
      postings: 0,
      sample_titles: [] as string[],
      error: null as string | null,
    };

    // Robots first: a URL the publisher refuses, or whose policy could not be read, is never requested.
    if (robots.text === null) {
      records.push({ ...row, robots_allowed: null, verdict: 'not_probed', error: 'robots.txt could not be read' });
      continue;
    }
    if (!robotsAllows(robots.text, `${url.pathname}${url.search}`)) {
      records.push({ ...row, robots_allowed: false, verdict: 'blocked_by_robots' });
      continue;
    }

    await pacer.next();
    // A data request does not follow redirects: its target may be another origin whose robots.txt was never read.
    const response = await fetchText(target.url, 'manual');
    if ('error' in response) {
      records.push({ ...row, robots_allowed: true, verdict: 'http_error', error: response.error });
      continue;
    }

    const challenge = response.status === 200 ? target.adapter.detectChallenge(response.text) : 'none';
    const postings = response.status === 200 && challenge === 'none'
      ? target.adapter.extractPostings(response.text, target.options)
      : [];
    records.push({
      ...row,
      robots_allowed: true,
      status: response.status,
      bytes: response.text.length,
      challenge,
      postings: postings.length,
      sample_titles: postings.slice(0, MAX_SAMPLE_TITLES).map((job) => job.title),
      verdict: verdictOf({ status: response.status, challenge, postings: postings.length, robotsAllowed: true }),
    });
  }

  const perSource = listSources()
    .filter((source) => targets.some((target) => target.source === source))
    .map((source) => {
      const rows = records.filter((record) => record.source === source);
      const postings = rows.reduce((total, row) => total + row.postings, 0);
      const verdicts = [...new Set(rows.map((row) => row.verdict))];
      return {
        source,
        targets: rows.length,
        postings,
        verdicts,
        outcome: postings > 0 ? 'added' : 'not_added',
      };
    });

  const document = {
    generated_at: new Date().toISOString(),
    method:
      'read-only GET, self-identifying user agent, one request every 1200 ms, robots.txt read first per origin; a URL refused by robots.txt is not requested; no credential, no cookie, no browser',
    user_agent: USER_AGENT,
    per_source: perSource,
    skipped,
    records,
  };
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`);

  for (const row of perSource) {
    console.log(`${row.outcome.padEnd(9)} ${row.source.padEnd(15)} targets=${row.targets} postings=${row.postings} ${row.verdicts.join(',')}`);
  }
  for (const entry of skipped) console.log(`skipped   ${entry.source.padEnd(15)} ${entry.reason}`);
  console.log(`evidence: ${outputFile}`);
};

await main();
