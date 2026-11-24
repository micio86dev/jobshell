/**
 * Turning postings into signals, and signals into companies.
 *
 * The company key is deliberately boring: a normalised name first, then the employer's own site,
 * then the board tenant. Two spellings of one company must meet; two companies must never merge,
 * so a name that is only a legal suffix identifies nothing.
 */
import { createHash } from 'node:crypto';

import type { Posting } from '../sources/types.ts';
import type { Signal } from './types.ts';

const LEGAL_SUFFIXES = new Set([
  'inc', 'incorporated', 'llc', 'ltd', 'limited', 'plc', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'ag', 'kg', 'ug', 'bv', 'nv', 'sa', 'sas', 'sarl', 'srl', 'spa', 'sl', 'slu', 'ab', 'oy', 'as', 'aps',
]);

/** Lowercase, no accents, no punctuation, no legal form. An empty result means "not a company name". */
export const normalizeCompanyName = (name: string): string => {
  const plain = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const words = plain.split(' ').filter((word) => word !== '');
  // "S.r.l." and "B.V." arrive as separate letters once punctuation is gone: join them first.
  const joined: string[] = [];
  let letters = '';
  for (const word of words) {
    if (word.length === 1 && /[a-z]/.test(word)) {
      letters += word;
      continue;
    }
    if (letters !== '') joined.push(letters);
    letters = '';
    joined.push(word);
  }
  if (letters !== '') joined.push(letters);
  const kept = joined.filter((word) => !LEGAL_SUFFIXES.has(word));
  return kept.join(' ');
};

/** Hosts that publish other people's jobs or news: their domain says nothing about the employer. */
const AGGREGATOR_HOSTS = [
  'linkedin.com', 'indeed.com', 'ziprecruiter.com', 'glassdoor.com', 'news.ycombinator.com', 'ycombinator.com',
  'reddit.com', 'facebook.com', 'google.com', 'remoteok.com', 'weworkremotely.com', 'jobicy.com', 'himalayas.app',
  'arbeitnow.com', 'getonbrd.com', 'workingnomads.com', 'cryptocurrencyjobs.co', 'iprogrammatori.it',
  'jobsearch.api.jobtechdev.se', 'arbetsformedlingen.se', 'mastodon.social', 'github.com', 'twitter.com', 'x.com',
];

/** Board hosts: the tenant is the employer's id on that board. */
const BOARDS: Array<{ ats: string; match: (host: string, path: string[]) => string | null }> = [
  { ats: 'greenhouse', match: (host, path) => (/(^|\.)greenhouse\.io$/.test(host) ? (path[0] ?? null) : null) },
  { ats: 'lever', match: (host, path) => (host === 'jobs.lever.co' ? (path[0] ?? null) : null) },
  { ats: 'workable', match: (host, path) => (host === 'apply.workable.com' ? (path[0] ?? null) : null) },
  { ats: 'teamtailor', match: (host) => (host.endsWith('.teamtailor.com') ? host.slice(0, -'.teamtailor.com'.length) : null) },
  { ats: 'recruitee', match: (host) => (host.endsWith('.recruitee.com') ? host.slice(0, -'.recruitee.com'.length) : null) },
  { ats: 'breezy', match: (host) => (host.endsWith('.breezy.hr') ? host.slice(0, -'.breezy.hr'.length) : null) },
  { ats: 'hirehive', match: (host) => (host.endsWith('.hirehive.com') ? host.slice(0, -'.hirehive.com'.length) : null) },
  { ats: 'pinpoint', match: (host) => (host.endsWith('.pinpointhq.com') ? host.slice(0, -'.pinpointhq.com'.length) : null) },
  { ats: 'rippling', match: (host, path) => (host === 'ats.rippling.com' ? (path[0] ?? null) : null) },
  { ats: 'personio', match: (host) => (host.endsWith('.jobs.personio.de') ? host.slice(0, -'.jobs.personio.de'.length) : null) },
];

const TWO_LABEL_SUFFIXES = ['co.uk', 'org.uk', 'com.au', 'com.br', 'co.nz', 'co.jp', 'com.mx'];

const parsed = (url: string): URL | null => {
  try {
    const value = new URL(url);
    return value.protocol === 'https:' || value.protocol === 'http:' ? value : null;
  } catch {
    return null;
  }
};

/** The registrable part of a host: "careers.acme.io" and "www.acme.io" are both "acme.io". */
export const registrableDomain = (host: string): string => {
  const labels = host.replace(/^www\./, '').split('.');
  const lastTwo = labels.slice(-2).join('.');
  if (TWO_LABEL_SUFFIXES.includes(lastTwo)) return labels.slice(-3).join('.');
  return labels.slice(-2).join('.');
};

const isAggregator = (host: string): boolean =>
  AGGREGATOR_HOSTS.some((aggregator) => host === aggregator || host.endsWith(`.${aggregator}`));

/** The key a company is known by across sources, or null when nothing identifies it. */
export const companyKeyOf = (input: { company: string | null; url: string }): string | null => {
  const named = input.company === null ? '' : normalizeCompanyName(input.company);
  if (named !== '') return `n:${named}`;
  const url = parsed(input.url);
  if (url === null) return null;
  const host = url.hostname.toLowerCase();
  const path = url.pathname.split('/').filter((part) => part !== '');
  for (const board of BOARDS) {
    const tenant = board.match(host, path);
    if (tenant !== null && tenant !== '') return `t:${board.ats}:${tenant.toLowerCase()}`;
  }
  if (isAggregator(host)) return null;
  return `d:${registrableDomain(host)}`;
};

const idOf = (source: string, id: string): string =>
  createHash('sha256').update(`${source}:${id}`).digest('hex').slice(0, 16);

/** A job posting as a signal: the lowest-grade evidence that a company is hiring, and the carrier of the rest. */
export const postingToSignal = (posting: Posting, now: Date): Signal => ({
  id: idOf(posting.source, posting.id),
  type: 'job_posting',
  source: posting.source,
  sources: [posting.source],
  url: posting.url,
  title: posting.title,
  text: posting.description,
  company_name: posting.company,
  location: posting.location,
  remote_hint: posting.remote_hint,
  salary: posting.salary,
  published_at: posting.published_at,
  observed_at: now.toISOString(),
});

const normalizeTitle = (title: string): string =>
  title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The key two signals share when they describe the same item: same company and same title, or the same page. */
const dedupeKeyOf = (signal: Signal): string => {
  const company = companyKeyOf({ company: signal.company_name, url: signal.url });
  return company === null ? `u:${signal.url}` : `${company}|${normalizeTitle(signal.title)}`;
};

/** One signal per item: the first one read stays, and the sources that repeat it are added to it. */
export const dedupeSignals = (signals: readonly Signal[]): Signal[] => {
  const byKey = new Map<string, Signal>();
  for (const signal of signals) {
    const key = dedupeKeyOf(signal);
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { ...signal, sources: [...signal.sources] });
      continue;
    }
    for (const source of signal.sources) if (!existing.sources.includes(source)) existing.sources.push(source);
  }
  return [...byKey.values()];
};

export type CompanyGroup = { key: string; name: string; signals: Signal[] };

/** Signals by company. A signal nothing identifies is returned apart, never dropped silently. */
export const groupByCompany = (
  signals: readonly Signal[],
): { companies: CompanyGroup[]; unidentified: Signal[] } => {
  const groups = new Map<string, CompanyGroup>();
  const unidentified: Signal[] = [];
  for (const signal of signals) {
    const key = companyKeyOf({ company: signal.company_name, url: signal.url });
    if (key === null) {
      unidentified.push(signal);
      continue;
    }
    const group = groups.get(key) ?? { key, name: signal.company_name ?? key, signals: [] };
    // A real name beats a key-shaped placeholder from an earlier signal.
    if (group.name === key && signal.company_name !== null) group.name = signal.company_name;
    group.signals.push(signal);
    groups.set(key, group);
  }
  return { companies: [...groups.values()], unidentified };
};
