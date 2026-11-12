/**
 * The shape every source adapter shares.
 *
 * An adapter is pure: it builds a URL, recognises a challenge, and parses a body
 * it is handed. It never opens a socket and never drives a browser, so it can be
 * tested against a fixture and reused by the runner, the bridge and the extension
 * without change.
 */

export type Posting = {
  source: string;
  id: string;
  title: string;
  company: string | null;
  location: string | null;
  url: string;
  remote_hint: boolean | null;
  description: string | null;
  /** ISO-8601 date the source published the posting, when it says so. */
  published_at: string | null;
  /** Salary text as the source published it, never parsed into a number here. */
  salary: string | null;
};

/** What the page says instead of results. `none` means a normal page. */
export type Challenge = 'none' | 'authwall' | 'captcha' | 'rate_limited';

export type SearchOptions = {
  location?: string;
  remote?: boolean;
  limit?: number;
  /** ATS board token, required by board feeds. */
  tenant?: string;
};

export type SourceAdapter = {
  id: string;
  buildSearchUrl(query: string, options: SearchOptions): string;
  detectChallenge(body: string): Challenge;
  extractPostings(body: string): Posting[];
};

/** Decode the few entities these pages use, strip tags, collapse whitespace. */
const ENTITIES: Record<string, string> = {
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  nbsp: ' ',
  amp: '&',
};

/**
 * Plain text from a description: markup is removed first, on the raw HTML, and the entities are
 * decoded afterwards in one pass. Decoding first would turn an escaped tag such as &lt;b&gt; into
 * markup and delete it.
 */
export const text = (html: string): string =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(lt|gt|quot|#39|nbsp|amp);/g, (_match, name: string) => ENTITIES[name] ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** True when a field names remote work. */
export const mentionsRemote = (value: string | null): boolean =>
  value !== null && /\b(remote|remoto|remota|fully remote|telelavoro)\b/i.test(value);

/** First capture group of the first match, or null. */
export const firstGroup = (body: string, pattern: RegExp): string | null => {
  const match = pattern.exec(body);
  const value = match?.[1];
  return value === undefined ? null : text(value);
};

/** Value of an attribute on the first matching tag, or null. */
export const attribute = (body: string, tag: string, name: string): string | null => {
  const match = new RegExp(`<${tag}[^>]*\\s${name}="([^"]*)"`, 'i').exec(body);
  return match?.[1] ?? null;
};

/**
 * Normalise a date the source published into ISO-8601, or null.
 *
 * Accepts a Unix timestamp in seconds or milliseconds, and any string `Date` can
 * parse (RFC 822 from RSS, ISO from JSON). An unparseable date is null, never a
 * guess: freshness filters must not invent an age.
 */
export const toIsoDate = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  return null;
};

/** A plain object, never an array: every payload shape here is an object. */
export const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/** A posting assembled from a source payload, with the boring fields defaulted. */
export const posting = (fields: Partial<Posting> & Pick<Posting, 'source' | 'id' | 'title' | 'url'>): Posting => ({
  company: null,
  location: null,
  remote_hint: null,
  description: null,
  published_at: null,
  salary: null,
  ...fields,
});

/**
 * A body that is a feed document is data: a job may mention any word, including the ones a
 * challenge page uses. XML is always a feed. JSON is a feed unless it is an error envelope (an
 * object with `error` or `message`) or a bare value, because those are how a service says
 * "too many requests" in JSON.
 */
export const isFeedDocument = (body: string): boolean => {
  if (/^\s*(<\?xml|<rss|<feed)/i.test(body)) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  if (Array.isArray(parsed)) return true;
  // A bare number, string, boolean or null is not a feed; neither is an error envelope.
  if (typeof parsed === 'object' && parsed !== null) return !('error' in parsed || 'message' in parsed);
  return false;
};

/** The challenge a non-feed page shows, checked against the patterns the adapter knows. */
export const challengeOf = (body: string): Challenge => {
  if (isFeedDocument(body)) return 'none';
  if (/captcha/i.test(body)) return 'captcha';
  if (/\b429\b|too many requests/i.test(body)) return 'rate_limited';
  return 'none';
};

/** An absolute https link. Anything else (javascript:, data:, plain http, a relative path) is not a link to show. */
export const isHttpsUrl = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};
