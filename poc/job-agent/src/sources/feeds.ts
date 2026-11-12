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
import { z } from 'zod';

import { parseRss } from './rss.ts';
import {
  challengeOf,
  isHttpsUrl,
  mentionsRemote,
  posting,
  text,
  toIsoDate,
  type Posting,
  type SourceAdapter,
} from './types.ts';

/** A non-empty text field: a value of another type, or a blank one, is simply absent (null). */
const httpsLink = z
  .string()
  .trim()
  .refine(isHttpsUrl)
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

const shortText = z
  .string()
  .trim()
  .min(1)
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/** A finite number field: anything else is absent (null). */
const number = z
  .number()
  .finite()
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/**
 * A job identifier: non-blank text or a finite number. A value of any other type (an object, a
 * list, a boolean) makes the whole item invalid, so it is skipped rather than stored under a
 * meaningless key such as "[object Object]".
 */
// A blank identifier, or null, is absent, so the fallback to the url applies. Any other type is invalid.
const idValue = z
  .union([z.string().trim().transform((value) => (value.length > 0 ? value : undefined)), z.number().finite()])
  .nullish()
  .transform((value) => value ?? undefined);

/** Every item that fits its schema; an item that does not fit is skipped, never guessed. */
const parseEach = <T extends z.ZodType>(items: unknown[], schema: T): Array<z.output<T>> =>
  items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

/** The list a payload carries under `key`; a payload without it is an empty feed. */
const listUnder = (payload: unknown, key: string): unknown[] => {
  const parsed = z.looseObject({ [key]: z.array(z.unknown()).catch([]) }).safeParse(payload);
  return parsed.success ? (parsed.data[key] ?? []) : [];
};

/** The payload itself as a list: a bare JSON array, or an empty feed. */
const bareList = (payload: unknown): unknown[] => {
  const parsed = z.array(z.unknown()).safeParse(payload);
  return parsed.success ? parsed.data : [];
};

/** A feed, JSON or RSS, is data; only a page that is not a feed can be a challenge. */
const feedChallenge = challengeOf;

const salaryRange = (min: number | null, max: number | null, currency: string): string | null => {
  if (min === null && max === null) return null;
  if (min !== null && max !== null) return `${min}-${max} ${currency}`;
  return `${min ?? max} ${currency}`;
};

/** A JSON feed adapter: URL, then a mapper from the parsed payload. */
const jsonFeed = (
  id: string,
  url: string,
  map: (payload: unknown) => Posting[],
): SourceAdapter => ({
  id,
  buildSearchUrl: () => url,
  detectChallenge: feedChallenge,
  extractPostings: (body) => {
    const payload = safeJson(body);
    return payload === null ? [] : map(payload);
  },
});

const safeJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** An RSS feed adapter: URL, then a mapper from the parsed items. */
const rssFeed = (
  id: string,
  url: (query: string) => string,
  map: (item: ReturnType<typeof parseRss>[number]) => Posting | null,
): SourceAdapter => ({
  id,
  buildSearchUrl: (query: string) => url(query),
  detectChallenge: feedChallenge,
  extractPostings: (body) =>
    parseRss(body)
      .filter((item) => isHttpsUrl(item.link))
      .map(map)
      .filter((value): value is Posting => value !== null),
});

const remoteokJob = z.object({
  id: idValue,
  slug: idValue,
  position: shortText,
  url: httpsLink,
  company: shortText,
  location: shortText,
  description: shortText,
  date: z.unknown().optional(),
  salary_min: number,
  salary_max: number,
});

const remotiveJob = z.object({
  id: idValue,
  title: shortText,
  url: httpsLink,
  company_name: shortText,
  candidate_required_location: shortText,
  description: shortText,
  publication_date: z.unknown().optional(),
  salary: shortText,
});

const arbeitnowJob = z.object({
  slug: idValue,
  title: shortText,
  url: httpsLink,
  company_name: shortText,
  location: shortText,
  remote: z.unknown().optional(),
  description: shortText,
  created_at: z.unknown().optional(),
});

const jobicyJob = z.object({
  id: idValue,
  jobTitle: shortText,
  url: httpsLink,
  companyName: shortText,
  jobGeo: shortText,
  jobExcerpt: shortText,
  pubDate: z.unknown().optional(),
  annualSalaryMin: number,
  annualSalaryMax: number,
  salaryCurrency: shortText,
});

const workingnomadsJob = z.object({
  id: idValue,
  title: shortText,
  url: httpsLink,
  company_name: shortText,
  location: shortText,
  description: shortText,
  pub_date: z.unknown().optional(),
  salary: shortText,
});

const hnHit = z.object({
  objectID: z.string().regex(/^\d{1,20}$/),
  comment_text: shortText,
  created_at: z.unknown().optional(),
});

/** RemoteOK: a bare array whose first element is their own terms notice. */
export const remoteok = jsonFeed('remoteok', 'https://remoteok.com/api', (payload) =>
  parseEach(bareList(payload), remoteokJob)
    .filter((job) => job.position !== null && job.url !== null)
    .map((job) =>
      posting({
        source: 'remoteok',
        id: String(job.id ?? job.slug ?? job.url),
        title: job.position ?? '',
        company: job.company,
        location: job.location,
        url: job.url ?? '',
        remote_hint: true,
        description: job.description === null ? null : text(job.description),
        published_at: toIsoDate(job.date),
        salary: salaryRange(job.salary_min, job.salary_max, 'USD'),
      }),
    ),
);

/** Remotive: `{ jobs: [...] }`, remote-first, includes a salary string. */
export const remotive = jsonFeed('remotive', 'https://remotive.com/api/remote-jobs', (payload) =>
  parseEach(listUnder(payload, 'jobs'), remotiveJob)
    .filter((job) => job.title !== null && job.url !== null)
    .map((job) =>
      posting({
        source: 'remotive',
        id: String(job.id ?? job.url),
        title: job.title ?? '',
        company: job.company_name,
        location: job.candidate_required_location,
        url: job.url ?? '',
        remote_hint: true,
        description: job.description === null ? null : text(job.description),
        published_at: toIsoDate(job.publication_date),
        salary: job.salary,
      }),
    ),
);

/** Arbeitnow: `{ data: [...] }`, strong on Germany and the EU. */
export const arbeitnow = jsonFeed(
  'arbeitnow',
  'https://www.arbeitnow.com/api/job-board-api',
  (payload) =>
    parseEach(listUnder(payload, 'data'), arbeitnowJob)
      .filter((job) => job.title !== null && job.url !== null)
      .map((job) =>
        posting({
          source: 'arbeitnow',
          id: String(job.slug ?? job.url),
          title: job.title ?? '',
          company: job.company_name,
          location: job.location,
          url: job.url ?? '',
          remote_hint: job.remote === true || mentionsRemote(job.location),
          description: job.description === null ? null : text(job.description),
          published_at: toIsoDate(job.created_at),
          salary: null,
        }),
      ),
);

/** Jobicy: `{ jobs: [...] }` with a published salary range. */
export const jobicy = jsonFeed(
  'jobicy',
  'https://jobicy.com/api/v2/remote-jobs?count=50',
  (payload) =>
    parseEach(listUnder(payload, 'jobs'), jobicyJob)
      .filter((job) => job.jobTitle !== null && job.url !== null)
      .map((job) =>
        posting({
          source: 'jobicy',
          id: String(job.id ?? job.url),
          title: job.jobTitle ?? '',
          company: job.companyName,
          location: job.jobGeo,
          url: job.url ?? '',
          remote_hint: true,
          description: job.jobExcerpt === null ? null : text(job.jobExcerpt),
          published_at: toIsoDate(job.pubDate),
          salary: salaryRange(job.annualSalaryMin, job.annualSalaryMax, job.salaryCurrency ?? 'USD'),
        }),
      ),
);

/** Working Nomads: a bare JSON array from their exposed-jobs endpoint. */
export const workingnomads = jsonFeed(
  'workingnomads',
  'https://www.workingnomads.com/api/exposed_jobs/',
  (payload) =>
    parseEach(bareList(payload), workingnomadsJob)
      .filter((job) => job.title !== null && job.url !== null)
      .map((job) =>
        posting({
          source: 'workingnomads',
          id: String(job.id ?? job.url),
          title: job.title ?? '',
          company: job.company_name,
          location: job.location,
          url: job.url ?? '',
          remote_hint: true,
          description: job.description === null ? null : text(job.description),
          published_at: toIsoDate(job.pub_date),
          salary: job.salary,
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
/** IProgrammatori.it: the Italian developer board, published as RSS. */
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
  (payload) =>
    parseEach(listUnder(payload, 'hits'), hnHit)
      .filter((hit) => hit.comment_text !== null)
      .map((hit) => {
        const body = text(hit.comment_text ?? '');
        const firstLine = body.split(/(?<=\.)\s|\n/)[0] ?? body;
        return posting({
          source: 'hn',
          id: String(hit.objectID),
          title: firstLine.slice(0, 120),
          company: null,
          location: null,
          url: `https://news.ycombinator.com/item?id=${String(hit.objectID)}`,
          remote_hint: mentionsRemote(body),
          description: body,
          published_at: toIsoDate(hit.created_at),
          salary: null,
        });
      }),
);
