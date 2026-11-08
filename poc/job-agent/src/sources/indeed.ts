/**
 * Indeed results pages.
 *
 * Indeed's partner APIs are employer-side, and the publisher job-search API that
 * used to read postings was retired in 2024. Its official MCP server is documented
 * as available only to a Claude connector, so it is not a product path. This
 * adapter parses a results page the user may already look at, and the policy module
 * keeps the source in `measurement_only`.
 */
import { firstGroup, mentionsRemote, type Challenge, type Posting, type SearchOptions, type SourceAdapter } from './types.ts';

const SEARCH_URL = 'https://it.indeed.com/jobs';
const VIEW_HREF = /href="([^"]*viewjob\?jk=([A-Za-z0-9]+)[^"]*)"/g;

const buildSearchUrl = (query: string, options: SearchOptions): string => {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('q', query);
  if (options.location !== undefined) url.searchParams.set('l', options.location);
  return url.toString();
};

const detectChallenge = (body: string): Challenge => {
  if (/captcha|cf-challenge/i.test(body)) return 'captcha';
  if (/secure\.indeed\.com\/auth/i.test(body)) return 'authwall';
  if (/\b429\b|too many requests/i.test(body)) return 'rate_limited';
  return 'none';
};

const extractPostings = (body: string): Posting[] => {
  const anchors = [...body.matchAll(VIEW_HREF)];
  const postings = new Map<string, Posting>();

  for (const [index, match] of anchors.entries()) {
    const id = match[2];
    if (id === undefined || postings.has(id)) continue;

    // Cards are not wrapped in a single container, so each anchor owns the text up
    // to the next anchor. A card that yields no title is a fragment, not a posting.
    const start = match.index ?? 0;
    const end = anchors[index + 1]?.index ?? Math.min(body.length, start + 3000);
    const window = body.slice(start, end);

    const title = firstGroup(window, /data-testid="jobTitle"[^>]*>([\s\S]*?)<\/h2>/);
    if (title === null || title.length === 0) continue;

    const location = firstGroup(window, /data-testid="text-location"[^>]*>([\s\S]*?)<\//);
    postings.set(id, {
      source: 'indeed',
      id,
      title,
      company: firstGroup(window, /data-testid="company-name"[^>]*>([\s\S]*?)<\//),
      location,
      url: `https://it.indeed.com/viewjob?jk=${id}`,
      remote_hint: mentionsRemote(location) || mentionsRemote(title),
      description: null,
      published_at: null,
      salary: null,
    });
  }
  return [...postings.values()];
};

export const indeed: SourceAdapter = {
  id: 'indeed',
  buildSearchUrl,
  detectChallenge,
  extractPostings,
};
