/**
 * Public sources taken from the career-ops catalogue that answered a plain, read-only GET in the
 * live probe. Each adapter is pure: it builds the URL and maps a body it was handed.
 *
 * Shapes were read from the live responses on 2026-11-15; the fixtures in test/catalog.test.ts
 * copy those shapes with invented content.
 */
import { parseRss } from './rss.ts';
import { mentionsRemote, text, type Posting, type SourceAdapter } from './types.ts';

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

const safeJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

/**
 * A bot wall, not data. Only the markers of a challenge page count, and only in an HTML body: a
 * JSON or XML feed can mention "captcha" in a job text and is still data.
 */
const wallOf = (body: string): 'none' | 'captcha' => {
  const head = body.trimStart().slice(0, 4000);
  if (/^[{[]|^<\?xml|^<rss|^<feed/i.test(head)) return 'none';
  return /<title>\s*(just a moment|attention required)|cf-chl-|captcha-delivery\.com/i.test(head) ? 'captcha' : 'none';
};

const jsonSource = (
  id: string,
  url: string,
  map: (payload: unknown) => Posting[],
): SourceAdapter => ({
  id,
  buildSearchUrl: () => url,
  detectChallenge: wallOf,
  extractPostings: (body) => {
    const payload = safeJson(body);
    return payload === null ? [] : map(payload);
  },
});

/**
 * GetOnBrd: Spanish and Latin American tech jobs, `{ data: [{ id, attributes, links }] }`.
 * The job link is `links.public_url`; the body is HTML, so it is reduced to text.
 */
export const getonbrd: SourceAdapter = jsonSource(
  'getonbrd',
  'https://www.getonbrd.com/api/v0/categories/programming/jobs?per_page=50&expand[]=company',
  (payload) => {
    if (!isRecord(payload) || !Array.isArray(payload['data'])) return [];
    const postings: Posting[] = [];
    for (const job of payload['data']) {
      if (!isRecord(job)) continue;
      const attributes = isRecord(job['attributes']) ? job['attributes'] : {};
      const links = isRecord(job['links']) ? job['links'] : {};
      const title = textOf(attributes['title']);
      const url = httpsOnly(textOf(links['public_url']));
      if (title === null || url === null) continue;
      const description = textOf(attributes['description']);
      postings.push({
        source: 'getonbrd',
        id: String(job['id'] ?? url),
        title,
        company: null,
        location: null,
        url,
        remote_hint: attributes['remote'] === true || mentionsRemote(textOf(attributes['remote_modality'])),
        description: description === null ? null : text(description),
        published_at: null,
        salary: null,
      });
    }
    return postings;
  },
);

/**
 * Platsbanken (Arbetsförmedlingen, Sweden): the open JobTech search. Results are under `hits`;
 * `positions` is only the count. Removed ads are skipped.
 */
export const platsbanken: SourceAdapter = jsonSource(
  'platsbanken',
  'https://jobsearch.api.jobtechdev.se/search?q=utvecklare&limit=100',
  (payload) => {
    if (!isRecord(payload) || !Array.isArray(payload['hits'])) return [];
    const postings: Posting[] = [];
    for (const hit of payload['hits']) {
      if (!isRecord(hit) || hit['removed'] === true) continue;
      const title = textOf(hit['headline']);
      const url = httpsOnly(textOf(hit['webpage_url']));
      if (title === null || url === null) continue;
      const employer = isRecord(hit['employer']) ? hit['employer'] : {};
      const address = isRecord(hit['workplace_address']) ? hit['workplace_address'] : {};
      const description = isRecord(hit['description']) ? textOf(hit['description']['text']) : null;
      const place = [textOf(address['municipality']), textOf(address['country'])].filter((part) => part !== null);
      postings.push({
        source: 'platsbanken',
        id: String(hit['id'] ?? url),
        title,
        company: textOf(employer['name']),
        location: place.length > 0 ? place.join(', ') : null,
        url,
        remote_hint: mentionsRemote(textOf(hit['workplace_model'])),
        description: description === null ? null : text(description),
        published_at: textOf(hit['publication_date']),
        salary: textOf(hit['salary_description']),
      });
    }
    return postings;
  },
);

/**
 * Cryptocurrency Jobs: an RSS feed of remote crypto roles. Titles read "Role at Company" and are
 * encoded twice in the feed, so they are decoded twice.
 */
export const cryptocurrencyjobs: SourceAdapter = {
  id: 'cryptocurrencyjobs',
  buildSearchUrl: () => 'https://cryptocurrencyjobs.co/index.xml',
  detectChallenge: wallOf,
  extractPostings: (body) =>
    parseRss(body).flatMap((item) => {
      const url = httpsOnly(item.link);
      if (url === null) return [];
      const headline = text(text(item.title));
      const split = headline.lastIndexOf(' at ');
      const title = split > 0 ? headline.slice(0, split) : headline;
      const company = split > 0 ? headline.slice(split + 4) : null;
      const description = item.description === null ? null : text(item.description);
      return [
        {
          source: 'cryptocurrencyjobs',
          id: item.guid ?? url,
          title,
          company,
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
