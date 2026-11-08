/**
 * Greenhouse board feeds.
 *
 * The one source here that needs no browser at all: a public JSON endpoint per
 * employer, documented in `docs/phase-0/11-api-integration-matrix.md` and already
 * probed in Phase 0. This is what "fast" looks like — one HTTP call for hundreds of
 * postings, no challenge to defeat.
 */
import { asRecord, mentionsRemote, text, toIsoDate, type Challenge, type Posting, type SearchOptions, type SourceAdapter } from './types.ts';

const BOARD_URL = 'https://boards-api.greenhouse.io/v1/boards';

const buildSearchUrl = (_query: string, options: SearchOptions): string => {
  if (options.tenant === undefined || options.tenant.trim().length === 0) {
    throw new Error('greenhouse: a board feed needs a tenant token (options.tenant)');
  }
  // The board feed has no query parameter; filtering by the user's logic happens
  // after the fetch, on the parsed postings.
  return `${BOARD_URL}/${encodeURIComponent(options.tenant)}/jobs?content=true`;
};

const detectChallenge = (body: string): Challenge => {
  if (/captcha/i.test(body)) return 'captcha';
  if (/\b429\b|too many requests/i.test(body)) return 'rate_limited';
  return 'none';
};

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value : null;

const extractPostings = (body: string): Posting[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const jobs = asRecord(parsed)?.['jobs'];
  if (!Array.isArray(jobs)) return [];

  const postings: Posting[] = [];
  for (const raw of jobs) {
    const job = asRecord(raw);
    if (job === null) continue;
    const absoluteUrl = asString(job['absolute_url']);
    if (absoluteUrl === null) continue;

    let id: string;
    try {
      const url = new URL(absoluteUrl);
      id = url.pathname.split('/').filter((part) => part.length > 0).pop() ?? '';
    } catch {
      continue;
    }
    if (id.length === 0) continue;

    const location = asString(asRecord(job['location'])?.['name']);
    const content = asString(job['content']);
    postings.push({
      source: 'greenhouse',
      id,
      title: asString(job['title']) ?? '',
      company: null,
      location,
      url: absoluteUrl,
      remote_hint: mentionsRemote(location),
      description: content === null ? null : text(content),
      published_at: toIsoDate(job['updated_at']),
      salary: null,
    });
  }
  return postings;
};

export const greenhouse: SourceAdapter = {
  id: 'greenhouse',
  buildSearchUrl,
  detectChallenge,
  extractPostings,
};
