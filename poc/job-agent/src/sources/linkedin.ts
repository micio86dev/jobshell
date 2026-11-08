/**
 * LinkedIn results pages.
 *
 * LinkedIn publishes no candidate-side job API, and automating a signed-in session
 * is prohibited by its user agreement. This adapter therefore parses a page the
 * user is already allowed to look at, and the policy module keeps the source in
 * `measurement_only`: an attended session, human pace, stop at the first challenge.
 */
import { attribute, firstGroup, mentionsRemote, toIsoDate, type Challenge, type Posting, type SearchOptions, type SourceAdapter } from './types.ts';

const SEARCH_URL = 'https://www.linkedin.com/jobs/search/';
const VIEW_URL = /href="(https:\/\/www\.linkedin\.com\/jobs\/view\/(\d+)[^"]*)"/;

const buildSearchUrl = (query: string, options: SearchOptions): string => {
  const url = new URL(SEARCH_URL);
  url.searchParams.set('keywords', query);
  if (options.location !== undefined) url.searchParams.set('location', options.location);
  // f_WT=2 is LinkedIn's own remote-work filter; sending it is a normal search.
  if (options.remote === true) url.searchParams.set('f_WT', '2');
  return url.toString();
};

const detectChallenge = (body: string): Challenge => {
  if (/captcha/i.test(body)) return 'captcha';
  if (/authwall/i.test(body)) return 'authwall';
  if (/\b429\b|too many requests/i.test(body)) return 'rate_limited';
  return 'none';
};

const extractPostings = (body: string): Posting[] => {
  const postings = new Map<string, Posting>();
  for (const block of body.match(/<li[\s\S]*?<\/li>/g) ?? []) {
    const anchor = VIEW_URL.exec(block);
    const id = anchor?.[2];
    if (id === undefined || anchor?.[1] === undefined) continue;
    if (postings.has(id)) continue;

    const title = firstGroup(block, /<h3[^>]*>([\s\S]*?)<\/h3>/);
    if (title === null || title.length === 0) continue;

    const href = new URL(anchor[1]);
    const location = firstGroup(block, /class="job-search-card__location"[^>]*>([\s\S]*?)<\/span>/);
    postings.set(id, {
      source: 'linkedin',
      id,
      title,
      company: firstGroup(block, /<h4[^>]*>([\s\S]*?)<\/h4>/),
      location,
      url: `${href.origin}${href.pathname}`,
      remote_hint: mentionsRemote(location) || mentionsRemote(title),
      description: null,
      published_at: toIsoDate(attribute(block, 'time', 'datetime')),
      salary: null,
    });
  }
  return [...postings.values()];
};

export const linkedin: SourceAdapter = {
  id: 'linkedin',
  buildSearchUrl,
  detectChallenge,
  extractPostings,
};
