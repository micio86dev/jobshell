/**
 * Tenant-based ATS boards from the career-ops catalogue: Workable (widget JSON), Teamtailor
 * (RSS) and HireHive (JSON). Each one is a public document per employer, read with a plain GET.
 * A tenant is a plain slug from the verified registry; it is never built from free text.
 */
import { parseRss } from './rss.ts';
import { mentionsRemote, text, type Posting, type SourceAdapter, type SearchOptions } from './types.ts';

const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/i;

const tenantOf = (options: SearchOptions, source: string): string => {
  const tenant = options.tenant?.trim() ?? '';
  if (!TENANT.test(tenant)) {
    throw new Error(`${source}: a board needs a tenant id of letters, digits and "-" (options.tenant)`);
  }
  return tenant;
};

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;

const httpsOnly = (value: string | null): string | null => {
  if (value === null) return null;
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
};

const parseJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/** A bot wall is never data; a JSON or XML body is always data. */
const wallOf = (body: string): 'none' | 'captcha' => {
  const head = body.trimStart().slice(0, 4000);
  if (/^[{[]|^<\?xml|^<rss|^<feed/i.test(head)) return 'none';
  return /<title>\s*(just a moment|attention required)|cf-chl-|captcha-delivery\.com/i.test(head) ? 'captcha' : 'none';
};

/** Workable: `{ name, description, jobs: [...] }` for one account. */
export const workable: SourceAdapter = {
  id: 'workable',
  buildSearchUrl: (_query, options) =>
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(tenantOf(options, 'workable'))}?details=true`,
  detectChallenge: wallOf,
  extractPostings: (body) => {
    const payload = parseJson(body);
    if (!isRecord(payload) || !Array.isArray(payload['jobs'])) return [];
    const company = textOf(payload['name']);
    const postings: Posting[] = [];
    for (const job of payload['jobs']) {
      if (!isRecord(job)) continue;
      const title = textOf(job['title']);
      const url = httpsOnly(textOf(job['url']));
      if (title === null || url === null) continue;
      const place = [textOf(job['city']), textOf(job['country'])].filter((part) => part !== null);
      postings.push({
        source: 'workable',
        id: textOf(job['shortcode']) ?? url,
        title,
        company,
        location: place.length > 0 ? place.join(', ') : null,
        url,
        remote_hint: job['telecommuting'] === true,
        description: null,
        published_at: textOf(job['published_on']),
        salary: null,
      });
    }
    return postings;
  },
};

/** Teamtailor: the tenant's public RSS. Only https links are kept. */
export const teamtailor: SourceAdapter = {
  id: 'teamtailor',
  buildSearchUrl: (_query, options) =>
    `https://${tenantOf(options, 'teamtailor')}.teamtailor.com/jobs.rss`,
  detectChallenge: wallOf,
  extractPostings: (body) =>
    parseRss(body).flatMap((item) => {
      const url = httpsOnly(item.link);
      if (url === null) return [];
      const description = item.description === null ? null : text(item.description);
      return [
        {
          source: 'teamtailor',
          id: item.guid ?? url,
          title: text(item.title),
          company: null,
          location: null,
          url,
          remote_hint: mentionsRemote(description),
          description,
          published_at: item.published_at,
          salary: null,
        },
      ];
    }),
};

/** HireHive: `{ meta, links, items: [...] }` under the tenant host. */
export const hirehive: SourceAdapter = {
  id: 'hirehive',
  buildSearchUrl: (_query, options) =>
    `https://${tenantOf(options, 'hirehive')}.hirehive.com/api/v2/jobs`,
  detectChallenge: wallOf,
  extractPostings: (body) => {
    const payload = parseJson(body);
    if (!isRecord(payload) || !Array.isArray(payload['items'])) return [];
    const postings: Posting[] = [];
    for (const item of payload['items']) {
      if (!isRecord(item)) continue;
      const title = textOf(item['title']);
      const url = httpsOnly(textOf(item['hosted_url']));
      if (title === null || url === null) continue;
      const description = isRecord(item['description']) ? textOf(item['description']['text']) : textOf(item['description']);
      const location = textOf(item['location']);
      postings.push({
        source: 'hirehive',
        id: textOf(item['id']) ?? url,
        title,
        company: null,
        location,
        url,
        remote_hint: mentionsRemote(location),
        description: description === null ? null : text(description),
        published_at: textOf(item['published_date']),
        salary: textOf(item['salary']),
      });
    }
    return postings;
  },
};
