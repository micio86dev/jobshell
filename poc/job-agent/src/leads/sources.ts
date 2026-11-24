/**
 * Signal sources: public places where a company shows that it may need external engineers.
 *
 * Like a posting adapter, a signal source is pure. It names the URLs it needs, says which
 * follow-up URLs a response opens, and parses a body it is handed. The runner owns the network, the
 * pace and the policy. Every source here was probed live (robots.txt first, then one GET) before it
 * was allowed; the verdicts are in docs/lead-sources.md and evidence/source-probe/.
 */
import { parseRss } from '../sources/rss.ts';
import { asRecord, challengeOf, toIsoDate, type Challenge } from '../sources/types.ts';
import { signalId } from './company.ts';
import type { Signal } from './types.ts';

export type SourceContext = { now: Date; url: string };

export type SignalSource = {
  id: string;
  label: string;
  /** The URLs to fetch first. */
  requests(now: Date): string[];
  /** Further URLs a response opens, such as the pages of one thread. Bounded by the page ceiling. */
  follow?(body: string, context: SourceContext): string[];
  detectChallenge(body: string): Challenge;
  parse(body: string, context: SourceContext): Signal[];
};

const DAY_MS = 86_400_000;
const MAX_TEXT = 4000;

const NAMED: Record<string, string> = { lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', amp: '&' };

/** Tags removed, then every entity decoded once, numeric ones included. */
export const plain = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
      if (body.startsWith('#')) return String.fromCodePoint(Number.parseInt(body.slice(1), 10));
      return NAMED[body.toLowerCase()] ?? match;
    })
    .replace(/\s+/g, ' ')
    .trim();

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

const ALGOLIA = 'https://hn.algolia.com/api/v1/search_by_date';
const THREAD_LIST = `${ALGOLIA}?tags=story,author_whoishiring&query=hiring&hitsPerPage=6`;
/** A thread older than this is last month's news: its companies hired already. */
const THREAD_MAX_AGE_DAYS = 40;
const COMMENT_PAGE = 200;
const MAX_COMMENT_PAGES = 3;

const commentUrl = (storyId: string, page: number): string =>
  `${ALGOLIA}?tags=comment,story_${storyId}&hitsPerPage=${COMMENT_PAGE}&page=${page}`;

/** A person offering their own work, not a company seeking help. */
const OFFERING_WORK = /^\s*(seeking\s+(work|freelanc)|looking for (work|a job|freelance)|available for (hire|work)|freelancer available)/i;
const CONTRACT_WORDS = /\b(contract|contractor|freelanc\w*|part[- ]time|consultan\w*|fractional)\b/i;

/**
 * "Ask HN: Who is hiring?": companies that wrote one line each, "Company | Role | Place | REMOTE".
 * The newest thread is read, and only its top-level comments: a reply is a candidate asking a question.
 */
export const hnHiring: SignalSource = {
  id: 'hn-hiring',
  label: 'Hacker News: Who is hiring',
  requests: () => [THREAD_LIST],
  follow: (body, { now, url }) => {
    if (url !== THREAD_LIST) return [];
    const hits = list(asRecord(parseJson(body))?.['hits']);
    for (const hit of hits) {
      const record = asRecord(hit);
      const title = str(record?.['title']);
      const id = str(record?.['objectID']);
      const created = toIsoDate(record?.['created_at']);
      if (record === null || title === null || id === null || created === null) continue;
      if (!/who is hiring/i.test(title)) continue;
      if (now.getTime() - new Date(created).getTime() > THREAD_MAX_AGE_DAYS * DAY_MS) return [];
      const comments = typeof record['num_comments'] === 'number' ? record['num_comments'] : COMMENT_PAGE;
      const pages = Math.min(MAX_COMMENT_PAGES, Math.max(1, Math.ceil(comments / COMMENT_PAGE)));
      return Array.from({ length: pages }, (_unused, page) => commentUrl(id, page));
    }
    return [];
  },
  detectChallenge: challengeOf,
  parse: (body, { now, url }) => {
    if (url === THREAD_LIST) return [];
    const signals: Signal[] = [];
    for (const hit of list(asRecord(parseJson(body))?.['hits'])) {
      const record = asRecord(hit);
      if (record === null) continue;
      const id = str(record['objectID']);
      const html = str(record['comment_text']);
      // Only a top-level comment is a posting: its parent is the thread itself.
      if (id === null || html === null || String(record['parent_id']) !== String(record['story_id'])) continue;
      const first = plain(html.split(/<p>/i)[0] ?? html);
      if (first.length < 12 || OFFERING_WORK.test(first)) continue;
      const segments = first.split('|').map((part) => part.trim());
      const named = segments.length > 1 ? (segments[0] ?? '') : '';
      const company = named.length >= 2 && named.length <= 60 && !/https?:|@/.test(named) ? named : null;
      signals.push({
        id: signalId('hn-hiring', id),
        type: CONTRACT_WORDS.test(first) ? 'freelance_request' : 'job_posting',
        source: 'hn-hiring',
        sources: ['hn-hiring'],
        url: `https://news.ycombinator.com/item?id=${id}`,
        title: first.slice(0, 160),
        text: plain(html).slice(0, MAX_TEXT),
        company_name: company,
        location: null,
        remote_hint: /\bremote\b/i.test(first) ? true : null,
        salary: null,
        published_at: toIsoDate(record['created_at']),
        observed_at: now.toISOString(),
      });
    }
    return signals;
  },
};

/** The company named in "Acme (YC S13) Is Hiring ...", or null. */
const HIRING_TITLE = /^(.{2,60}?)\s+(?:\(YC [^)]*\)\s+)?(?:is|are)\s+hiring\b/i;

/** The YC job board on Hacker News: one post per company that is hiring right now. */
export const hnJobs: SignalSource = {
  id: 'hn-jobs',
  label: 'Hacker News: YC jobs',
  requests: () => [`${ALGOLIA}?tags=job&hitsPerPage=30`],
  detectChallenge: challengeOf,
  parse: (body, { now }) => {
    const signals: Signal[] = [];
    for (const hit of list(asRecord(parseJson(body))?.['hits'])) {
      const record = asRecord(hit);
      const id = str(record?.['objectID']);
      const title = str(record?.['title']);
      if (record === null || id === null || title === null) continue;
      const link = str(record['url']);
      signals.push({
        id: signalId('hn-jobs', id),
        type: 'job_posting',
        source: 'hn-jobs',
        sources: ['hn-jobs'],
        url: link !== null && link.startsWith('https://') ? link : `https://news.ycombinator.com/item?id=${id}`,
        title: plain(title),
        text: null,
        company_name: HIRING_TITLE.exec(plain(title))?.[1]?.trim() ?? null,
        location: null,
        remote_hint: null,
        salary: null,
        published_at: toIsoDate(record['created_at']),
        observed_at: now.toISOString(),
      });
    }
    return signals;
  },
};

const FUNDING = /\b(raises?|raised|raising|secures?|secured|lands?|closes?|snags?|bags?|nabs?|funding|pre-seed|seed|series\s+[a-e]|valuation|investment|backs?|backed|invests?)\b/i;
/** The subject of "X raises ...": a short capitalised prefix. A longer or generic one names no company. */
const FUNDED_SUBJECT = /^((?:[A-Z0-9][\w.&'-]*)(?:\s+(?:[A-Z0-9][\w.&'-]*|AI|of|for)){0,2})\s+(?:raises?|raised|secures?|lands?|closes?|snags?|bags?|nabs?|gets?|announces)\b/;

const fundingSource = (id: string, label: string, url: string): SignalSource => ({
  id,
  label,
  requests: () => [url],
  detectChallenge: challengeOf,
  parse: (body, { now }) => {
    const signals: Signal[] = [];
    for (const item of parseRss(body)) {
      const title = plain(item.title);
      if (!FUNDING.test(title)) continue;
      signals.push({
        id: signalId(id, item.guid ?? item.link),
        type: 'funding',
        source: id,
        sources: [id],
        url: item.link,
        title,
        text: item.description === null ? null : plain(item.description).slice(0, 1200),
        company_name: FUNDED_SUBJECT.exec(title)?.[1] ?? null,
        location: null,
        remote_hint: null,
        salary: null,
        published_at: item.published_at,
        observed_at: now.toISOString(),
      });
    }
    return signals;
  },
});

export const techcrunchStartups = fundingSource('techcrunch-startups', 'TechCrunch: Startups', 'https://techcrunch.com/category/startups/feed/');
export const sifted = fundingSource('sifted', 'Sifted: European startups', 'https://sifted.eu/feed');

/** Companies with a team too large to need outside engineers for lack of hands. */
const YC_MAX_TEAM = 300;

/**
 * Y Combinator companies that are hiring. The YC directory itself cannot be read with a plain GET
 * (its listing is rendered by script), so this reads a public mirror of it that is refreshed daily;
 * a fact from here is "reported", not "verified".
 */
export const ycHiring: SignalSource = {
  id: 'yc-hiring',
  label: 'Y Combinator: companies hiring',
  requests: () => ['https://yc-oss.github.io/api/companies/hiring.json'],
  detectChallenge: challengeOf,
  parse: (body, { now }) => {
    const signals: Signal[] = [];
    for (const entry of list(parseJson(body))) {
      const record = asRecord(entry);
      const name = str(record?.['name']);
      const url = str(record?.['url']);
      if (record === null || name === null || url === null) continue;
      const team = typeof record['team_size'] === 'number' ? record['team_size'] : null;
      if (record['isHiring'] === false || record['nonprofit'] === true) continue;
      if (record['status'] !== 'Active') continue;
      if (team !== null && team > YC_MAX_TEAM) continue;
      const oneLiner = str(record['one_liner']) ?? '';
      const description = str(record['long_description']) ?? '';
      const facts = [
        team === null ? null : `Team size ${team}.`,
        str(record['stage']) === null ? null : `Stage ${str(record['stage'])}.`,
        str(record['batch']) === null ? null : `YC ${str(record['batch'])}.`,
      ].filter((part): part is string => part !== null);
      signals.push({
        id: signalId('yc-hiring', String(record['id'] ?? url)),
        type: 'hiring_growth',
        source: 'yc-hiring',
        sources: ['yc-hiring'],
        url,
        title: oneLiner === '' ? name : `${name}: ${oneLiner}`,
        text: [oneLiner, description.slice(0, 800), ...facts].filter((part) => part !== '').join(' ').slice(0, MAX_TEXT),
        company_name: name,
        location: str(record['all_locations']),
        remote_hint: list(record['regions']).includes('Remote') ? true : null,
        salary: null,
        published_at: null,
        observed_at: now.toISOString(),
      });
    }
    return signals;
  },
};

export const SIGNAL_SOURCES: readonly SignalSource[] = [hnHiring, hnJobs, techcrunchStartups, sifted, ycHiring];

export const signalSourceFor = (id: string): SignalSource | null => SIGNAL_SOURCES.find((source) => source.id === id) ?? null;
