import { z } from 'zod';
/**
 * Postings ZipRecruiter's MCP server returned, read from the file the desktop app wrote.
 *
 * The app owns the OAuth token and the MCP call; the agent owns the judgment. This module is
 * the seam between them: a file in the evidence directory, in one documented shape.
 */
import { readFileSync } from 'node:fs';

import { asRecord, posting, text, toIsoDate, type Posting } from './types.ts';

/**
 * An id we accept: the value is interpolated into a URL, so a slash or a scheme must not
 * reach it.
 */
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** A link we accept. `javascript:` in an href is executable, so only https gets through. */
const isSafeUrl = (value: string): boolean => /^https:\/\/[^\s]+$/i.test(value);

/** The file the desktop app writes. */
export const postingsFile = (evidenceDir: string): string => `${evidenceDir}/ziprecruiter.json`;

/**
 * One posting record from the file. A field that does not fit is dropped to nothing; an id or a
 * title that does not fit drops the whole record, because it cannot be shown or deduplicated.
 */
const zipRecruiterPosting = z.object({
  id: z.string().regex(ID_PATTERN),
  title: z.string().min(1),
  company: z.string().nullish().catch(undefined),
  location: z.string().nullish().catch(undefined),
  url: z.string().nullish().catch(undefined),
  description: z.string().nullish().catch(undefined),
  salary: z.string().nullish().catch(undefined),
  published_at: z.unknown().optional(),
});

/**
 * Read the file into postings.
 *
 * A missing file is not an error: it means ZipRecruiter was never fetched. A file that
 * exists but cannot be read is an error, because silently skipping it would hide a real
 * failure behind "no postings today".
 */
export const readPostings = (path: string, read: (path: string) => string = (p) => readFileSync(p, 'utf8')): Posting[] => {
  let raw: string;
  try {
    raw = read(path);
  } catch (error) {
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    if (code === 'ENOENT') return [];
    throw new Error(`ziprecruiter: cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    // Node quotes a fragment of the input in its message: keep only the position, never the text.
    const position = error instanceof Error ? /at position (\d+)/.exec(error.message)?.[1] : undefined;
    throw new Error(`ziprecruiter: ${path} is not valid JSON${position === undefined ? '' : ` (at character ${position})`}`);
  }

  const items = asRecord(parsed)?.['postings'];
  if (!Array.isArray(items)) throw new Error(`ziprecruiter: ${path} has no postings array`);

  const postings: Posting[] = [];
  for (const item of items) {
    const parsed = zipRecruiterPosting.safeParse(item);
    if (!parsed.success) continue;
    const job = parsed.data;
    const providedUrl = job.url ?? null;
    postings.push(
      posting({
        source: 'ziprecruiter',
        id: job.id,
        title: text(job.title),
        company: job.company ?? null,
        location: job.location ?? null,
        url:
          providedUrl !== null && isSafeUrl(providedUrl)
            ? providedUrl
            : `https://www.ziprecruiter.com/jobs/${encodeURIComponent(job.id)}`,
        remote_hint: job.location === undefined || job.location === null ? null : /remote|remoto/i.test(job.location),
        description: job.description === undefined || job.description === null ? null : text(job.description).slice(0, 4000),
        published_at: toIsoDate(job.published_at),
        salary: job.salary ?? null,
      }),
    );
  }
  return postings;
};
