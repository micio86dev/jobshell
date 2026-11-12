/**
 * A posting that arrives from outside the agent: from the browser extension through the bridge,
 * or as a tool argument over MCP. One schema decides what counts as a posting for both, so a link
 * the bridge refuses is refused by MCP too.
 */
import { z } from 'zod';

import type { Posting } from './sources/types.ts';

const nonBlank = (value: string): boolean => value.trim().length > 0;

const optionalText = z.string().nullish().catch(undefined);

/** An http or https link that names a host: a scheme alone, or a blank host, is not a link. */
const isWebLink = (value: string): boolean => {
  if (!/^https?:\/\//i.test(value)) return false;
  try {
    return new URL(value).hostname.length > 0;
  } catch {
    return false;
  }
};

const postingInput = z.object({
  source: z.string().refine(nonBlank),
  id: z.string().refine(nonBlank),
  title: z.string().refine(nonBlank),
  // Only web links: a javascript: or data: link is never a posting to show or judge.
  url: z.string().refine(isWebLink, { error: 'url must be an http or https link with a host' }),
  company: optionalText,
  location: optionalText,
  remote_hint: z.boolean().nullish().catch(undefined),
  description: optionalText,
  published_at: optionalText,
  salary: optionalText,
});

/** One posting as the agent uses it. An absent optional field is null, and a description is capped. */
export const parsePosting = (raw: unknown): Posting | null => {
  const parsed = postingInput.safeParse(raw);
  if (!parsed.success) return null;
  const item = parsed.data;
  return {
    source: item.source,
    id: item.id,
    title: item.title,
    url: item.url,
    company: item.company ?? null,
    location: item.location ?? null,
    remote_hint: item.remote_hint ?? null,
    description: item.description === undefined || item.description === null ? null : item.description.slice(0, 4000),
    published_at: item.published_at ?? null,
    salary: item.salary ?? null,
  };
};

/**
 * Every posting in the list that fits. An item without a usable source, id, title or web url is
 * skipped; an optional field of the wrong type is absent, never guessed.
 */
export const parsePostings = (items: unknown[]): Posting[] =>
  items.flatMap((item) => {
    const posting = parsePosting(item);
    return posting === null ? [] : [posting];
  });
