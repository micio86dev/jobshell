/**
 * The no-key public feeds: the base of the acquisition layer.
 *
 * Every source here answered a plain GET in the Phase 0.5 probe with no credential
 * and no browser. They are the cheapest and safest way to get real postings, and
 * they carry the volume that makes a daily funnel possible at all.
 *
 * A source that answers with HTML instead of a feed is not here: those need the
 * browser extension, because parsing their pages with a scraper is the thing that
 * gets blocked and gets accounts banned.
 */
import { parseRss } from './rss.ts';
import {
  asRecord,
  mentionsRemote,
  posting,
  text,
  toIsoDate,
  type Challenge,
  type Posting,
  type SearchOptions,
  type SourceAdapter,
} from './types.ts';

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const num = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const arrayOf = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const safeJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** A JSON feed refuses politely; it never answers with a CAPTCHA. */
const jsonChallenge = (body: string): Challenge => {
  if (/captcha/i.test(body)) return 'captcha';
  if (/\b429\b|too many requests/i.test(body)) return 'rate_limited';
  return 'none';
};

const rssChallenge = (body: string): Challenge => {
  if (/captcha/i.test(body)) return 'captcha';
  if (/\b429\b|too many requests/i.test(body)) return 'rate_limited';
  return 'none';
};

const salaryRange = (min: unknown, max: unknown, currency: string): string | null => {
  const low = num(min);
  const high = num(max);
  if (low === null && high === null) return null;
  if (low !== null && high !== null) return `${low}-${high} ${currency}`;
  return `${low ?? high} ${currency}`;
};

/** A JSON feed adapter: URL, then a mapper from the parsed payload. */
const jsonFeed = (
  id: string,
  url: string,
  map: (payload: unknown) => Posting[],
): SourceAdapter => ({
  id,
  buildSearchUrl: () => url,
  detectChallenge: jsonChallenge,
  extractPostings: (body) => {
    const payload = safeJson(body);
    return payload === null ? [] : map(payload);
  },
});

/** An RSS feed adapter: URL, then a mapper from the parsed items. */
const rssFeed = (
  id: string,
  url: (query: string) => string,
  map: (item: ReturnType<typeof parseRss>[number]) => Posting | null,
): SourceAdapter => ({
  id,
  buildSearchUrl: (query: string) => url(query),
  detectChallenge: rssChallenge,
  extractPostings: (body) =>
    parseRss(body)
      .map(map)
      .filter((value): value is Posting => value !== null),
});

/** RemoteOK: a bare array whose first element is their own terms notice. */
export const remoteok = jsonFeed('remoteok', 'https://remoteok.com/api', (payload) =>
  arrayOf(payload)
    .map(asRecord)
    .filter((job): job is Record<string, unknown> => job !== null)
    .filter((job) => str(job['position']) !== null && str(job['url']) !== null)
    .map((job) =>
      posting({
        source: 'remoteok',
        id: String(job['id'] ?? job['slug'] ?? job['url']),
        title: str(job['position']) ?? '',
        company: str(job['company']),
        location: str(job['location']),
        url: str(job['url']) ?? '',
        remote_hint: true,
        description: str(job['description']) === null ? null : text(str(job['description']) ?? ''),
        published_at: toIsoDate(job['date']),
        salary: salaryRange(job['salary_min'], job['salary_max'], 'USD'),
      }),
    ),
);

/** Remotive: `{ jobs: [...] }`, remote-first, includes a salary string. */
export const remotive = jsonFeed('remotive', 'https://remotive.com/api/remote-jobs', (payload) => {
  const jobs = asRecord(payload)?.['jobs'];
  return arrayOf(jobs)
    .map(asRecord)
    .filter((job): job is Record<string, unknown> => job !== null)
    .filter((job) => str(job['title']) !== null && str(job['url']) !== null)
    .map((job) =>
      posting({
        source: 'remotive',
        id: String(job['id'] ?? job['url']),
        title: str(job['title']) ?? '',
        company: str(job['company_name']),
        location: str(job['candidate_required_location']),
        url: str(job['url']) ?? '',
        remote_hint: true,
        description: str(job['description']) === null ? null : text(str(job['description']) ?? ''),
        published_at: toIsoDate(job['publication_date']),
        salary: str(job['salary']),
      }),
    );
});

/** Arbeitnow: `{ data: [...] }`, strong on Germany and the EU. */
export const arbeitnow = jsonFeed(
  'arbeitnow',
  'https://www.arbeitnow.com/api/job-board-api',
  (payload) => {
    const jobs = asRecord(payload)?.['data'];
    return arrayOf(jobs)
      .map(asRecord)
      .filter((job): job is Record<string, unknown> => job !== null)
      .filter((job) => str(job['title']) !== null && str(job['url']) !== null)
      .map((job) =>
        posting({
          source: 'arbeitnow',
          id: String(job['slug'] ?? job['url']),
          title: str(job['title']) ?? '',
          company: str(job['company_name']),
          location: str(job['location']),
          url: str(job['url']) ?? '',
          remote_hint: job['remote'] === true || mentionsRemote(str(job['location'])),
          description: str(job['description']) === null ? null : text(str(job['description']) ?? ''),
          published_at: toIsoDate(job['created_at']),
          salary: null,
        }),
      );
  },
);

/** Jobicy: `{ jobs: [...] }` with a published salary range. */
export const jobicy = jsonFeed(
  'jobicy',
  'https://jobicy.com/api/v2/remote-jobs?count=50',
  (payload) => {
    const jobs = asRecord(payload)?.['jobs'];
    return arrayOf(jobs)
      .map(asRecord)
      .filter((job): job is Record<string, unknown> => job !== null)
      .filter((job) => str(job['jobTitle']) !== null && str(job['url']) !== null)
      .map((job) =>
        posting({
          source: 'jobicy',
          id: String(job['id'] ?? job['url']),
          title: str(job['jobTitle']) ?? '',
          company: str(job['companyName']),
          location: str(job['jobGeo']),
          url: str(job['url']) ?? '',
          remote_hint: true,
          description: str(job['jobExcerpt']) === null ? null : text(str(job['jobExcerpt']) ?? ''),
          published_at: toIsoDate(job['pubDate']),
          salary: salaryRange(
            job['annualSalaryMin'],
            job['annualSalaryMax'],
            str(job['salaryCurrency']) ?? 'USD',
          ),
        }),
      );
  },
);

/** Working Nomads: a bare JSON array from their exposed-jobs endpoint. */
export const workingnomads = jsonFeed(
  'workingnomads',
  'https://www.workingnomads.com/api/exposed_jobs/',
  (payload) =>
    arrayOf(payload)
      .map(asRecord)
      .filter((job): job is Record<string, unknown> => job !== null)
      .filter((job) => str(job['title']) !== null && str(job['url']) !== null)
      .map((job) =>
        posting({
          source: 'workingnomads',
          id: String(job['id'] ?? job['url']),
          title: str(job['title']) ?? '',
          company: str(job['company_name']),
          location: str(job['location']),
          url: str(job['url']) ?? '',
          remote_hint: true,
          description: str(job['description']) === null ? null : text(str(job['description']) ?? ''),
          published_at: toIsoDate(job['pub_date']),
          salary: str(job['salary']),
        }),
      ),
);

/** We Work Remotely: RSS. The company is the prefix of the title when present. */
export const weworkremotely = rssFeed(
  'weworkremotely',
  () => 'https://weworkremotely.com/categories/remote-programming-jobs.rss',
  (item) => {
    const separator = item.title.indexOf(':');
    const company = separator > 0 ? item.title.slice(0, separator).trim() : null;
    const title = separator > 0 ? item.title.slice(separator + 1).trim() : item.title;
    if (title.length === 0) return null;
    return posting({
      source: 'weworkremotely',
      id: item.guid ?? item.link,
      title,
      company,
      location: null,
      url: item.link,
      remote_hint: true,
      description: item.description,
      published_at: item.published_at,
      salary: null,
    });
  },
);

/** IProgrammatori.it: the Italian developer board, RSS with 490+ items. */
export const iprogrammatori = rssFeed(
  'iprogrammatori',
  () => 'https://www.iprogrammatori.it/rss/offerte-di-lavoro.xml',
  (item) =>
    posting({
      source: 'iprogrammatori',
      id: item.guid ?? item.link,
      title: item.title,
      company: null,
      location: null,
      url: item.link,
      remote_hint:
        mentionsRemote(item.title) ||
        mentionsRemote(item.description) ||
        /smart working/i.test(`${item.title} ${item.description ?? ''}`),
      description: item.description,
      published_at: item.published_at,
      salary: null,
    }),
);

/**
 * Hacker News "Who is hiring": unstructured but very high signal for developers.
 *
 * Each comment is one posting written by a human. Title, company and location are
 * not separate fields, so the adapter keeps the raw comment as the description and
 * puts its first line in the title; extracting the fields is a judgment, and that
 * belongs to the scoring layer, not here.
 */
export const hn = jsonFeed(
  'hn',
  'https://hn.algolia.com/api/v1/search?query=who%20is%20hiring&tags=comment',
  (payload) => {
    const hits = asRecord(payload)?.['hits'];
    return arrayOf(hits)
      .map(asRecord)
      .filter((hit): hit is Record<string, unknown> => hit !== null)
      .filter((hit) => str(hit['comment_text']) !== null)
      .map((hit) => {
        const body = text(str(hit['comment_text']) ?? '');
        const firstLine = body.split(/(?<=\.)\s|\n/)[0] ?? body;
        return posting({
          source: 'hn',
          id: String(hit['objectID'] ?? ''),
          title: firstLine.slice(0, 120),
          company: null,
          location: null,
          url: `https://news.ycombinator.com/item?id=${String(hit['objectID'] ?? '')}`,
          remote_hint: mentionsRemote(body),
          description: body,
          published_at: toIsoDate(hit['created_at']),
          salary: null,
        });
      });
  },
);
