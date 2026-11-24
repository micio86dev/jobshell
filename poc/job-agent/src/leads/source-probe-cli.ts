/**
 * Live probe of the lead signal sources: robots.txt first, then one read-only GET per URL.
 *
 * It is the gate a signal source passes before the policy allows it, like the one for job
 * boards: a self-identifying user agent, one request every 1.2 seconds, a URL that robots.txt
 * refuses is never requested, a data redirect is never followed. A source that answers with
 * signals on its first request and on its follow-up (when it has one) is "ok".
 *
 *   node src/leads/source-probe-cli.ts [output-file]
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pacer } from '../policy.ts';
import { robotsAllows, verdictOf, type ProbeVerdict } from '../source-probe.ts';
import { SIGNAL_SOURCES, type SignalSource } from './sources.ts';

const USER_AGENT = 'jobshell-job-agent/0.1 (read-only source probe)';
const PACE_MS = 1200;
const TIMEOUT_MS = 20_000;

type Robots = { status: number | string; text: string | null };
type Row = {
  source: string;
  step: 'request' | 'follow';
  url: string;
  robots_status: number | string;
  robots_allowed: boolean | null;
  status: number | null;
  bytes: number;
  challenge: string | null;
  signals: number;
  verdict: ProbeVerdict | 'not_probed';
  sample_titles: string[];
  error: string | null;
};

const fetchText = async (url: string, redirect: 'follow' | 'manual'): Promise<{ status: number; text: string } | { error: string }> => {
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect,
      headers: { 'user-agent': USER_AGENT, accept: 'application/json, application/rss+xml, application/xml, */*' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { status: response.status, text: await response.text() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

const robotsFor = async (origin: string, pacer: Pacer, cache: Map<string, Robots>): Promise<Robots> => {
  const cached = cache.get(origin);
  if (cached !== undefined) return cached;
  await pacer.next();
  const response = await fetchText(`${origin}/robots.txt`, 'follow');
  let robots: Robots;
  if ('error' in response) robots = { status: response.error, text: null };
  else if (response.status === 200) robots = { status: 200, text: response.text };
  else if (response.status === 404 || response.status === 410) robots = { status: response.status, text: '' };
  else robots = { status: response.status, text: null };
  cache.set(origin, robots);
  return robots;
};

const probeUrl = async (
  source: SignalSource,
  step: Row['step'],
  url: string,
  now: Date,
  pacer: Pacer,
  cache: Map<string, Robots>,
): Promise<{ row: Row; body: string | null }> => {
  const parsed = new URL(url);
  const robots = await robotsFor(parsed.origin, pacer, cache);
  const base = { source: source.id, step, url, robots_status: robots.status, status: null as number | null, bytes: 0, challenge: null as string | null, signals: 0, sample_titles: [] as string[], error: null as string | null };
  if (robots.text === null) return { row: { ...base, robots_allowed: null, verdict: 'not_probed', error: 'robots.txt could not be read' }, body: null };
  if (!robotsAllows(robots.text, `${parsed.pathname}${parsed.search}`)) {
    return { row: { ...base, robots_allowed: false, verdict: 'blocked_by_robots' }, body: null };
  }
  await pacer.next();
  const response = await fetchText(url, 'manual');
  if ('error' in response) return { row: { ...base, robots_allowed: true, verdict: 'http_error', error: response.error }, body: null };
  const challenge = response.status === 200 ? source.detectChallenge(response.text) : 'none';
  const signals = response.status === 200 && challenge === 'none' ? source.parse(response.text, { now, url }) : [];
  // A thread list yields no signal by design: its job is to open the comment pages, so it counts as ok when it does.
  const opens = step === 'request' && response.status === 200 && (source.follow?.(response.text, { now, url }).length ?? 0) > 0;
  const verdict = verdictOf({ status: response.status, challenge, postings: signals.length + (opens ? 1 : 0), robotsAllowed: true });
  return {
    row: { ...base, robots_allowed: true, status: response.status, bytes: response.text.length, challenge, signals: signals.length, sample_titles: signals.slice(0, 3).map((signal) => signal.title), verdict },
    body: response.status === 200 ? response.text : null,
  };
};

const main = async (): Promise<void> => {
  const here = dirname(fileURLToPath(import.meta.url));
  const today = new Date().toISOString().slice(0, 10);
  const outputFile = resolve(process.argv[2] ?? resolve(here, '../../../../evidence/source-probe', `${today}-leads.json`));
  const now = new Date();
  const pacer = new Pacer(PACE_MS);
  const cache = new Map<string, Robots>();
  const rows: Row[] = [];

  for (const source of SIGNAL_SOURCES) {
    for (const url of source.requests(now)) {
      const first = await probeUrl(source, 'request', url, now, pacer, cache);
      rows.push(first.row);
      if (first.body === null || source.follow === undefined) continue;
      const next = source.follow(first.body, { now, url })[0];
      if (next === undefined) continue;
      rows.push((await probeUrl(source, 'follow', next, now, pacer, cache)).row);
    }
  }

  const perSource = SIGNAL_SOURCES.map((source) => {
    const own = rows.filter((row) => row.source === source.id);
    const verdicts = [...new Set(own.map((row) => row.verdict))];
    return { source: source.id, label: source.label, signals: own.reduce((sum, row) => sum + row.signals, 0), verdicts, outcome: own.length > 0 && own.every((row) => row.verdict === 'ok') ? 'ok' : 'not_ok' };
  });
  const document = {
    generated_at: now.toISOString(),
    method: 'read-only GET, self-identifying user agent, one request every 1200 ms, robots.txt read first per origin; a URL refused by robots.txt is not requested; no credential, no cookie, no browser',
    user_agent: USER_AGENT,
    per_source: perSource,
    records: rows,
  };
  mkdirSync(dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, `${JSON.stringify(document, null, 2)}\n`);
  for (const row of perSource) console.log(`${row.outcome.padEnd(7)} ${row.source.padEnd(20)} signals=${row.signals} ${row.verdicts.join(',')}`);
  console.log(`evidence: ${outputFile}`);
};

await main();
