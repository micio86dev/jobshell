/**
 * Verified tenants of the ATS board feeds.
 *
 * A board feed is one public JSON or XML document per employer, so the source is a list of
 * employers, not a single URL. Every entry here answered 200 with postings in a live read-only
 * probe, and carries the date of that probe. A tenant id is never guessed: a 404 or an empty
 * board is not added. Order is the fetch order: Italy, then Spain, then the rest of Europe,
 * then the world, which is the market preference of the product.
 */

export type Tenant = {
  /** The employer's id as the ATS publishes it (board token, company slug or subdomain). */
  tenant: string;
  /** The day the live probe saw postings there, ISO-8601 date. */
  verified: string;
};

const PROBE_2026_11_14 = '2026-11-14';
const PROBE_2026_11_06 = '2026-11-06';

const tenantsOf = (verified: string, ids: readonly string[]): Tenant[] =>
  ids.map((tenant) => ({ tenant, verified }));

export const TENANTS: Readonly<Record<string, readonly Tenant[]>> = {
  greenhouse: [
    // Spain.
    ...tenantsOf(PROBE_2026_11_14, ['cabify', 'wallapop', 'typeform']),
    // Europe.
    ...tenantsOf(PROBE_2026_11_14, ['n26', 'celonis', 'adyen', 'sumup', 'contentful', 'wise', 'elastic']),
    // Worldwide.
    ...tenantsOf(PROBE_2026_11_14, ['datadog', 'mongodb', 'gitlab', 'cloudflare']),
    ...tenantsOf(PROBE_2026_11_06, ['stripe', 'figma']),
  ],
  lever: [
    ...tenantsOf(PROBE_2026_11_14, ['jobandtalent', 'spotify']),
    ...tenantsOf(PROBE_2026_11_06, ['palantir']),
  ],
  ashby: [
    // Italy.
    ...tenantsOf(PROBE_2026_11_14, ['satispay', 'docebo']),
    // Worldwide.
    ...tenantsOf(PROBE_2026_11_14, ['vanta', 'notion', 'ramp', 'openai', 'replit', 'linear']),
  ],
  recruitee: [...tenantsOf(PROBE_2026_11_06, ['channable'])],
  personio: [...tenantsOf(PROBE_2026_11_14, ['personio'])],
  // Verified 2026-11-15 by the live probe of the career-ops catalogue. Workable accounts answer
  // the public widget; these are worldwide employers, the Italian and Spanish ones are still to find.
  workable: [...tenantsOf('2026-11-15', ['huggingface', 'semios', 'platzi'])],
  teamtailor: [...tenantsOf('2026-11-15', ['templafy'])],
  hirehive: [...tenantsOf('2026-11-15', ['amcsgroup'])],
};

/** The verified tenants of a board source, in fetch order. A source without a board has none. */
export const tenantsFor = (sourceId: string): readonly Tenant[] => TENANTS[sourceId] ?? [];
