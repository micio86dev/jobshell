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
    throw new Error(`ziprecruiter: ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  const items = asRecord(parsed)?.['postings'];
  if (!Array.isArray(items)) throw new Error(`ziprecruiter: ${path} has no postings array`);

  const postings: Posting[] = [];
  for (const item of items) {
    const job = asRecord(item);
    if (job === null) continue;
    const id = typeof job['id'] === 'string' ? job['id'] : null;
    const title = typeof job['title'] === 'string' ? job['title'] : null;
    if (id === null || title === null) continue;
    if (!ID_PATTERN.test(id)) continue;
    const providedUrl = typeof job['url'] === 'string' ? job['url'] : null;
    postings.push(
      posting({
        source: 'ziprecruiter',
        id,
        title: text(title),
        company: typeof job['company'] === 'string' ? job['company'] : null,
        location: typeof job['location'] === 'string' ? job['location'] : null,
        url:
          providedUrl !== null && isSafeUrl(providedUrl)
            ? providedUrl
            : `https://www.ziprecruiter.com/jobs/${encodeURIComponent(id)}`,
        remote_hint: typeof job['location'] === 'string' ? /remote|remoto/i.test(job['location']) : null,
        description: typeof job['description'] === 'string' ? text(job['description']).slice(0, 4000) : null,
        published_at: toIsoDate(job['published_at']),
        salary: typeof job['salary'] === 'string' ? job['salary'] : null,
      }),
    );
  }
  return postings;
};
