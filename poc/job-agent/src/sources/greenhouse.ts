/**
 * Greenhouse board feeds.
 *
 * The one source here that needs no browser at all: a public JSON endpoint per
 * employer, documented in `docs/phase-0/11-api-integration-matrix.md` and already
 * probed in Phase 0. This is what "fast" looks like — one HTTP call for hundreds of
 * postings, no challenge to defeat.
 */
import { z } from 'zod';

import { challengeOf, mentionsRemote, text, toIsoDate, type Challenge, type Posting, type SearchOptions, type SourceAdapter } from './types.ts';

const BOARD_URL = 'https://boards-api.greenhouse.io/v1/boards';

/** A board job as Greenhouse publishes it. A field of the wrong type is absent; a missing URL drops the job. */
const shortText = z.string().refine((value) => value.trim().length > 0).nullish().catch(null).transform((value) => value ?? null);
const greenhouseJob = z.object({
  absolute_url: shortText,
  title: shortText,
  location: z.object({ name: shortText }).nullish().catch(null).transform((value) => value?.name ?? null),
  content: shortText,
  updated_at: z.unknown().optional(),
});

const buildSearchUrl = (_query: string, options: SearchOptions): string => {
  if (options.tenant === undefined || options.tenant.trim().length === 0) {
    throw new Error('greenhouse: a board feed needs a tenant token (options.tenant)');
  }
  // The board feed has no query parameter; filtering by the user's logic happens
  // after the fetch, on the parsed postings.
  return `${BOARD_URL}/${encodeURIComponent(options.tenant)}/jobs?content=true`;
};

const detectChallenge = challengeOf;

const extractPostings = (body: string): Posting[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }
  const list = z.looseObject({ jobs: z.array(z.unknown()).catch([]) }).safeParse(parsed);
  if (!list.success) return [];

  const postings: Posting[] = [];
  for (const raw of list.data.jobs) {
    const job = greenhouseJob.safeParse(raw);
    if (!job.success) continue;
    const absoluteUrl = job.data.absolute_url;
    if (absoluteUrl === null) continue;

    let id: string;
    try {
      const url = new URL(absoluteUrl);
      // Only an https link is a posting: javascript:, data: and plain http are not shown.
      if (url.protocol !== 'https:') continue;
      id = url.pathname.split('/').filter((part) => part.length > 0).pop() ?? '';
    } catch {
      continue;
    }
    if (id.length === 0) continue;

    const location = job.data.location;
    const content = job.data.content;
    postings.push({
      source: 'greenhouse',
      id,
      title: job.data.title ?? '',
      company: null,
      location,
      url: absoluteUrl,
      remote_hint: mentionsRemote(location),
      description: content === null ? null : text(content),
      published_at: toIsoDate(job.data.updated_at),
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
