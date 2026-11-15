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
  // Verified 2026-11-15 by the live probe. Order: Italy, then Spain, then the rest of the world.
  // Each slug came from a search result and then answered with postings; a 404 or an empty board
  // was left out (pharmaprime, wallbox, easyfairsspain).
  workable: [
    // Italy.
    ...tenantsOf('2026-11-15', ['impactastrategy', 'aliprofessional', 'dentons-europe', 'erg-media', 'dmates', 'alispa', 'allnet-dot-italia-spa', 'webranking', 'moneyfarm']),
    // Spain.
    ...tenantsOf('2026-11-15', ['ukio', 'fernandez', 'oppizi', 'crossbordertalents', 'teleperformance-spain']),
    // World.
    ...tenantsOf('2026-11-15', ['huggingface', 'semios', 'platzi']),
  ],
  teamtailor: [
    // Italy.
    ...tenantsOf('2026-11-15', [
      'wspitaly', 'coldculture', 'unobravointernational', 'roccofortehotelsitaly', 'swanio',
      'grailtalent-1730296269', 'tailorfox', 'huaweitechnologiesitalia', 'tsgitalia', 'kosmos',
      'letuelezioni', 'agilelab', 'alfadocs', 'baconsultingsrl-1749809296', 'strategicmanagementpartners',
    ]),
    // Spain.
    ...tenantsOf('2026-11-15', ['winid', 'hiire', 'inhaus', 'qida', 'adsmurai', 'changegroupspain', 'cataloniahotels', 'knowmadmood', 'nextlane', 'kapres', 'multiversecomputing']),
    // World.
    ...tenantsOf('2026-11-15', ['templafy']),
  ],
  hirehive: [
    // Italy.
    ...tenantsOf('2026-11-15', ['kia-italy', 'the-level-group', 'patagonia']),
    // Spain.
    ...tenantsOf('2026-11-15', ['vanguard']),
    // World, including Europe-wide boards.
    ...tenantsOf('2026-11-15', ['kia-in-europe', 'amcsgroup']),
  ],
  breezy: [
    // Italy.
    ...tenantsOf('2026-11-15', ['information-resources-italy', 'aspria', 'end', 'marex', 'vald', 'alphabet-racing-italia-srl', 'mainstreaming-spa']),
    // Spain.
    ...tenantsOf('2026-11-15', ['alphanumeric-systems', 'clearly', 'incubeta-global', 'critical-software', 'fx-digital', 'cvedia']),
  ],
  rippling: [
    // Italy.
    ...tenantsOf('2026-11-15', ['camlin-careers']),
    // Spain.
    ...tenantsOf('2026-11-15', ['zynap', 'copado', 'capacity']),
  ],
  pinpoint: [
    // Italy.
    ...tenantsOf('2026-11-15', ['field']),
    // Spain.
    ...tenantsOf('2026-11-15', ['anthesisgroup', 'ebiquity']),
  ],
};

/** The verified tenants of a board source, in fetch order. A source without a board has none. */
export const tenantsFor = (sourceId: string): readonly Tenant[] => TENANTS[sourceId] ?? [];
