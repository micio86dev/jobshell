/**
 * ATS board feeds beyond Greenhouse: Lever, Ashby, Recruitee and Personio.
 *
 * Each one is a public, unauthenticated document per employer. The employer is a tenant id the
 * runner reads from the verified registry (tenants.ts). A tenant id that is not a plain slug is
 * refused before any URL is built, so a config value can never steer the request elsewhere.
 */
import { z } from 'zod';

import {
  challengeOf,
  firstGroup,
  isHttpsUrl,
  mentionsRemote,
  posting,
  text,
  toIsoDate,
  type Posting,
  type SearchOptions,
  type SourceAdapter,
} from './types.ts';

const TENANT = /^[a-z0-9][a-z0-9-]{0,62}$/i;

/** The employer id, or a refusal. Only a plain slug reaches a URL. */
const tenantOf = (options: SearchOptions, source: string): string => {
  const tenant = options.tenant?.trim() ?? '';
  if (!TENANT.test(tenant)) {
    throw new Error(`${source}: a board feed needs a tenant id of letters, digits and "-" (options.tenant)`);
  }
  return tenant;
};

/** A non-blank text field: any other type, or a blank value, is absent (null). */
const shortText = z
  .string()
  .trim()
  .min(1)
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/** An absolute https link: anything else is absent, so the posting is dropped. */
const httpsLink = z
  .string()
  .trim()
  .refine(isHttpsUrl)
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/** A finite number, or absent. */
const finiteNumber = z
  .number()
  .finite()
  .nullish()
  .catch(null)
  .transform((value) => value ?? null);

/** Every item that fits its schema; an item that does not fit is skipped, never guessed. */
const parseEach = <T extends z.ZodType>(items: unknown[], schema: T): Array<z.output<T>> =>
  items.flatMap((item) => {
    const parsed = schema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });

const safeJson = (body: string): unknown => {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
};

const salaryRange = (min: number | null, max: number | null, currency: string | null): string | null => {
  if (min === null && max === null) return null;
  const amount = min !== null && max !== null ? `${min}-${max}` : String(min ?? max);
  return currency === null ? amount : `${amount} ${currency}`;
};

// ---------------------------------------------------------------- Lever

const leverPosting = z.object({
  id: shortText,
  text: shortText,
  hostedUrl: httpsLink,
  createdAt: z.unknown().optional(),
  descriptionPlain: shortText,
  workplaceType: shortText,
  categories: z.object({ location: shortText }).nullish().catch(null),
  salaryRange: z
    .object({ min: finiteNumber, max: finiteNumber, currency: shortText })
    .nullish()
    .catch(null),
});

/** Lever: a bare JSON array of postings, one per open role. */
export const lever: SourceAdapter = {
  id: 'lever',
  buildSearchUrl: (_query, options) =>
    `https://api.lever.co/v0/postings/${encodeURIComponent(tenantOf(options, 'lever'))}?mode=json`,
  detectChallenge: challengeOf,
  extractPostings: (body) => {
    const payload = safeJson(body);
    if (!Array.isArray(payload)) return [];
    return parseEach(payload, leverPosting)
      .filter((job) => job.text !== null && job.hostedUrl !== null)
      .map((job) => {
        const location = job.categories?.location ?? null;
        const workplace = job.workplaceType;
        return posting({
          source: 'lever',
          id: job.id ?? job.hostedUrl ?? '',
          title: job.text ?? '',
          company: null,
          location,
          url: job.hostedUrl ?? '',
          // Lever states the workplace type itself; only when it is missing do we read the location.
          remote_hint: workplace === null ? mentionsRemote(location) : workplace === 'remote',
          description: job.descriptionPlain === null ? null : text(job.descriptionPlain),
          published_at: toIsoDate(job.createdAt),
          salary: salaryRange(job.salaryRange?.min ?? null, job.salaryRange?.max ?? null, job.salaryRange?.currency ?? null),
        });
      });
  },
};

// ---------------------------------------------------------------- Ashby

const ashbyJob = z.object({
  id: shortText,
  title: shortText,
  location: shortText,
  isRemote: z.boolean().nullish().catch(null),
  isListed: z.boolean().nullish().catch(null),
  publishedAt: z.unknown().optional(),
  jobUrl: httpsLink,
  descriptionPlain: shortText,
});

/** Ashby: `{ jobs: [...] }`. An unlisted job is not published, so it is not a posting. */
export const ashby: SourceAdapter = {
  id: 'ashby',
  buildSearchUrl: (_query, options) =>
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(tenantOf(options, 'ashby'))}`,
  detectChallenge: challengeOf,
  extractPostings: (body) => {
    const parsed = z.looseObject({ jobs: z.array(z.unknown()).catch([]) }).safeParse(safeJson(body));
    if (!parsed.success) return [];
    return parseEach(parsed.data.jobs, ashbyJob)
      .filter((job) => job.isListed !== false && job.title !== null && job.jobUrl !== null)
      .map((job) =>
        posting({
          source: 'ashby',
          id: job.id ?? job.jobUrl ?? '',
          title: job.title ?? '',
          company: null,
          location: job.location,
          url: job.jobUrl ?? '',
          remote_hint: job.isRemote ?? mentionsRemote(job.location),
          description: job.descriptionPlain === null ? null : text(job.descriptionPlain),
          published_at: toIsoDate(job.publishedAt),
          salary: null,
        }),
      );
  },
};

// ---------------------------------------------------------------- Recruitee

const recruiteeOffer = z.object({
  id: z.union([z.number().finite(), z.string().trim().min(1)]).nullish().catch(null),
  title: shortText,
  careers_url: httpsLink,
  company_name: shortText,
  city: shortText,
  country: shortText,
  remote: z.boolean().nullish().catch(null),
  description: shortText,
  created_at: z.unknown().optional(),
});

/** Recruitee: `{ offers: [...] }`, on the tenant's own origin, so the URL is per tenant. */
export const recruitee: SourceAdapter = {
  id: 'recruitee',
  buildSearchUrl: (_query, options) =>
    `https://${tenantOf(options, 'recruitee')}.recruitee.com/api/offers/`,
  detectChallenge: challengeOf,
  extractPostings: (body) => {
    const parsed = z.looseObject({ offers: z.array(z.unknown()).catch([]) }).safeParse(safeJson(body));
    if (!parsed.success) return [];
    return parseEach(parsed.data.offers, recruiteeOffer)
      .filter((offer) => offer.title !== null && offer.careers_url !== null)
      .map((offer) => {
        const location = [offer.city, offer.country].filter((part): part is string => part !== null).join(', ') || null;
        return posting({
          source: 'recruitee',
          id: offer.id === null || offer.id === undefined ? (offer.careers_url ?? '') : String(offer.id),
          title: offer.title ?? '',
          company: offer.company_name,
          location,
          url: offer.careers_url ?? '',
          remote_hint: offer.remote ?? mentionsRemote(location),
          description: offer.description === null ? null : text(offer.description),
          published_at: toIsoDate(offer.created_at),
          salary: null,
        });
      });
  },
};

// ---------------------------------------------------------------- Personio

/** The raw `<position>` elements, in document order. */
const personioPositions = (body: string): string[] =>
  [...body.matchAll(/<position>([\s\S]*?)<\/position>/g)].map((match) => match[1] ?? '');

/**
 * A field of one position. The nested job descriptions carry their own `<name>`, so they are
 * removed before the field is read, and the description is read from them separately.
 */
const personioField = (block: string, name: string): string | null =>
  firstGroup(block.replace(/<jobDescriptions>[\s\S]*?<\/jobDescriptions>/g, ''), new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));

const personioDescription = (block: string): string | null => {
  const description = firstGroup(block, /<jobDescriptions>([\s\S]*?)<\/jobDescriptions>/);
  return description === null || description.length === 0 ? null : description;
};

/**
 * Personio: an XML document per employer, `<workzag-jobs>` of `<position>`. The XML names no
 * employer, so the tenant the feed was fetched for builds each posting's own page.
 */
export const personio: SourceAdapter = {
  id: 'personio',
  buildSearchUrl: (_query, options) =>
    `https://${tenantOf(options, 'personio')}.jobs.personio.de/xml`,
  detectChallenge: challengeOf,
  extractPostings: (body, options) => {
    if (options?.tenant === undefined || !TENANT.test(options.tenant)) return [];
    const tenant = options.tenant;
    return personioPositions(body).flatMap((block) => {
      const id = personioField(block, 'id');
      const title = personioField(block, 'name');
      if (id === null || title === null || !/^\d{1,20}$/.test(id)) return [];
      const createdAt = personioField(block, 'createdAt');
      return [
        posting({
          source: 'personio',
          id,
          title,
          company: null,
          location: personioField(block, 'office'),
          url: `https://${tenant}.jobs.personio.de/job/${id}`,
          remote_hint: null,
          description: personioDescription(block),
          published_at: toIsoDate(createdAt),
          salary: null,
        }),
      ];
    });
  },
};
