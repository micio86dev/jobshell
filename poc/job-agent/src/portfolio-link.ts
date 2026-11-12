/**
 * A portfolio is a link the user gives. It must be a public https address with no credentials.
 * The check is read-only: one GET per hop, a timeout, a bounded body and an identifying user agent.
 * Redirects are followed by hand, and every hop is checked the same way as the first address.
 *
 * Limit: only the address text is checked, not what a name resolves to. A public-looking name that
 * points at a private address is not caught here.
 */
import { z } from 'zod';

import { text } from './sources/types.ts';

const TIMEOUT_MS = 10_000;
const MAX_HOPS = 3;
const MAX_BODY_CHARS = 1_000_000;
const USER_AGENT = 'openjob-agent (portfolio link check)';

const PRIVATE_V4 = [
  /^10\./, /^127\./, /^0\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./,
];

const isPrivateHost = (host: string): boolean => {
  const name = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true;
  if (name === '::1' || /^f[cd]/.test(name) || /^fe80:/.test(name)) return true;
  return PRIVATE_V4.some((pattern) => pattern.test(name));
};

const publicHttpsUrl = (value: string): URL | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.hostname.length === 0 || isPrivateHost(url.hostname)) return null;
  return url;
};

export const portfolioLinkShape = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => publicHttpsUrl(value) !== null, 'the portfolio link must be a public https address');

export const parsePortfolioLink = (value: unknown): { ok: true; link: string } | { ok: false } => {
  const parsed = portfolioLinkShape.safeParse(value);
  return parsed.success ? { ok: true, link: parsed.data } : { ok: false };
};

export type PortfolioCheck = { reachable: boolean; status: number; text: string };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

const NOT_REACHABLE = (status: number): PortfolioCheck => ({ reachable: false, status, text: '' });

const redirectTarget = (location: string, from: URL): URL | null => {
  try {
    return publicHttpsUrl(new URL(location, from).href);
  } catch {
    return null;
  }
};

export const checkPortfolioLink = async (link: string, fetchImpl: Fetch): Promise<PortfolioCheck> => {
  const first = publicHttpsUrl(link);
  if (first === null) return NOT_REACHABLE(0);
  let current: URL = first;

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    let response: Response;
    try {
      response = await fetchImpl(current.href, {
        redirect: 'manual',
        headers: { 'user-agent': USER_AGENT, accept: 'text/html,text/plain;q=0.9' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // The network error text can name internal hosts: it is never returned.
      return NOT_REACHABLE(0);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const next = location === null ? null : redirectTarget(location, current);
      if (next === null) return NOT_REACHABLE(response.status);
      current = next;
      continue;
    }

    if (response.status < 200 || response.status >= 300) return NOT_REACHABLE(response.status);
    const body = (await response.text()).slice(0, MAX_BODY_CHARS);
    return { reachable: true, status: response.status, text: text(body) };
  }
  return NOT_REACHABLE(0);
};
