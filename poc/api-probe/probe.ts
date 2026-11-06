import fs from 'node:fs';
import path from 'node:path';

import { probeBatch, probeJson, type ProbeResult } from '../runtime-bench/src/lib/http.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

type SourceProbe = {
  id: string;
  label: string;
  /** Documented endpoint template; `{token}` is replaced per candidate. */
  template: string;
  /** Public board tokens used to check that the endpoint answers without credentials. */
  candidates: string[];
  /** Where the endpoint is documented. */
  docs: string;
  /** What the payload is expected to contain, so a 200 with an error body is visible. */
  expect: (body: unknown) => string;
  /** Finding that the status code alone would hide. */
  note?: string;
};

const shape = (body: unknown): string => {
  if (Array.isArray(body)) return `array(${body.length})`;
  if (typeof body === 'object' && body !== null) return `object(${Object.keys(body).slice(0, 6).join(',')})`;
  return typeof body;
};

const numberAt = (body: unknown, key: string): number | null => {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
};

const arrayAt = (body: unknown, key: string): number | null => {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[key];
  return Array.isArray(value) ? value.length : null;
};

const SOURCES: SourceProbe[] = [
  {
    id: 'greenhouse',
    label: 'Greenhouse Job Board API',
    template: 'https://boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true',
    candidates: ['stripe', 'figma', 'notion', 'datadog'],
    docs: 'https://developers.greenhouse.io/job-board.html',
    expect: (body) => `jobs=${arrayAt(body, 'jobs') ?? 'n/a'}`,
  },
  {
    id: 'lever',
    label: 'Lever Postings API',
    template: 'https://api.lever.co/v0/postings/{token}?mode=json',
    candidates: ['leverdemo', 'palantir', 'plaid', 'mistral'],
    docs: 'https://github.com/lever/postings-api',
    expect: (body) => `postings=${Array.isArray(body) ? body.length : 'n/a'}`,
  },
  {
    id: 'ashby',
    label: 'Ashby Job Postings API',
    template: 'https://api.ashbyhq.com/posting-api/job-board/{token}',
    candidates: ['openai', 'ramp', 'linear', 'vanta'],
    docs: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    expect: (body) => `jobs=${arrayAt(body, 'jobs') ?? 'n/a'}`,
  },
  {
    id: 'smartrecruiters',
    label: 'SmartRecruiters Posting API',
    template: 'https://api.smartrecruiters.com/v1/companies/{token}/postings',
    candidates: ['DeliveryHero', 'Ubisoft', 'Visa'],
    docs: 'https://developers.smartrecruiters.com/docs/posting-api',
    expect: (body) => `content=${arrayAt(body, 'content') ?? 'n/a'} totalFound=${numberAt(body, 'totalFound') ?? 'n/a'}`,
  },
  {
    id: 'workable',
    label: 'Workable public widget API',
    template: 'https://apply.workable.com/api/v1/widget/accounts/{token}?details=true',
    candidates: ['revolut', 'epilot', 'aircall'],
    docs: 'https://workable.readme.io/reference/jobs',
    expect: (body) => `jobs=${arrayAt(body, 'jobs') ?? 'n/a'}`,
    note: 'every tried account answered 200 with an empty jobs array; the recorded payloads in api-probes.json are the evidence, and no authenticated endpoint was tested',
  },
  {
    id: 'recruitee',
    label: 'Recruitee public offers API',
    template: 'https://{token}.recruitee.com/api/offers/',
    candidates: ['weareplanet', 'channable', 'sendcloud'],
    docs: 'https://docs.recruitee.com/reference/intro',
    expect: (body) => `offers=${arrayAt(body, 'offers') ?? 'n/a'}`,
  },
];

/** robots.txt is per origin, and Recruitee gives every tenant its own origin. */
const robotsOrigins = (urls: string[]): string[] => [
  ...new Set(urls.map((url) => new URL(url).origin)),
];

const outDir = path.resolve(process.argv[2] ?? path.join(REPO_ROOT, 'evidence/run', new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(outDir, { recursive: true });

type SourceResult = {
  id: string;
  label: string;
  docs: string;
  robots: Array<{ origin: string; url: string; status: number | null; disallow: string[] }>;
  attempts: Array<{
    url: string;
    status: number | null;
    ok: boolean;
    elapsed_ms: number;
    shape: string;
    summary: string;
    error: string | null;
  }>;
  note: string | null;
  usable_without_credentials: boolean;
  verdict: string;
};

const results: SourceResult[] = [];

for (const source of SOURCES) {
  const urls = source.candidates.map((token) => source.template.replace('{token}', token));
  const probes: ProbeResult[] = await probeBatch(urls, { delayMs: 1200, timeoutMs: 20_000 });

  const robots: SourceResult['robots'] = [];
  for (const origin of robotsOrigins(urls)) {
    const url = `${origin}/robots.txt`;
    const probe = await probeJson(url, { timeoutMs: 15_000 });
    const disallow =
      probe.ok && typeof probe.body === 'string'
        ? probe.body
            .split('\n')
            .filter((line) => /^\s*Disallow:/i.test(line))
            .map((line) => line.trim())
        : [];
    robots.push({ origin, url, status: probe.status, disallow });
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }

  const attempts = probes.map((probe) => ({
    url: probe.url,
    status: probe.status,
    ok: probe.ok,
    elapsed_ms: probe.elapsed_ms,
    shape: shape(probe.body),
    summary: probe.ok ? source.expect(probe.body) : '',
    error: probe.error,
  }));

  const usable = attempts.some((attempt) => attempt.ok && attempt.status === 200);
  results.push({
    id: source.id,
    label: source.label,
    docs: source.docs,
    robots,
    attempts,
    note: source.note ?? null,
    usable_without_credentials: usable,
    verdict: usable
      ? 'public endpoint answered without credentials; reuse terms still govern storage and redistribution'
      : 'no candidate token answered 200 without credentials',
  });

  console.log(
    `${source.id.padEnd(16)} ${attempts.map((a) => `${a.status ?? 'ERR'}${a.summary ? ` ${a.summary}` : ''}`).join(' | ')}  robots=${robots.map((r) => r.status ?? 'ERR').join('/')}`,
  );
}

const report = {
  generated_at: new Date().toISOString(),
  method:
    'read-only GET requests with a self-identifying user agent, 1200 ms between requests, 20 s timeout, no credentials and no keys',
  results,
};
fs.writeFileSync(path.join(outDir, 'api-probes.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nwrote ${path.join(outDir, 'api-probes.json')}`);
