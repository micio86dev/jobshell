/**
 * Business intelligence for one company, with guards the model cannot talk its way past.
 *
 * The model researches with web tools and answers in JSON. Nothing it says becomes a fact until
 * code has checked it against what the tools actually returned:
 *
 * - a source address must be one the tools touched;
 * - a quote must appear in a page the model read, or in a passage the provider cited;
 * - a number in a figure must appear in its quote;
 * - "verified" needs the company's own site or an official register; anything else is "reported";
 * - a contact needs the page, the words and, for an email, the address itself in that page.
 *
 * What fails is not hidden: a fact falls back to "inferred" (shown as the model's reading, never
 * as a figure) and a contact is dropped. Both are counted in `dropped`, so a run can say why.
 */
import { z } from 'zod';
import { registrableDomain } from './company.ts';
import { canonicalUrl, research, type Evidence, type ResearchDeps } from './research.ts';
import type { Contact, Fact, Signal } from './types.ts';
import { PROVENANCES } from './types.ts';

export const FACT_FIELDS = [
  'website', 'country', 'description', 'business_model', 'industry', 'company_size', 'revenue', 'profitability',
  'funding', 'investors', 'growth', 'hiring', 'product_launch', 'contract_win', 'acquisition', 'technology',
  'public_company', 'engineering_need',
] as const;

/** Fields whose value is a figure: its digits must be in its quote. */
const FIGURE_FIELDS: readonly string[] = ['revenue', 'profitability', 'funding', 'company_size'];

const CONTACT_ROLES = ['CTO', 'Technical Director', 'VP of Engineering', 'Head of Engineering', 'Engineering Manager', 'Founder', 'CEO'];

/** Registers and filings that make a fact "verified" even though they are not the company's own site. */
const OFFICIAL_HOSTS = ['sec.gov', 'companieshouse.gov.uk', 'find-and-update.company-information.service.gov.uk', 'handelsregister.de', 'kvk.nl', 'registroimprese.it', 'zefix.ch', 'bolagsverket.se', 'infogreffe.fr'];

const FREE_MAIL = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'aol.com', 'gmx.com', 'gmx.de', 'web.de', 'libero.it', 'tiscali.it'];

const factIn = z.object({
  field: z.enum(FACT_FIELDS),
  value: z.string().min(1).max(300),
  provenance: z.enum(PROVENANCES),
  source_url: z.string().nullable().optional(),
  quote: z.string().max(500).nullable().optional(),
});

const contactIn = z.object({
  role: z.string().min(1).max(80),
  name: z.string().max(120).nullable().optional(),
  channel: z.enum(['email', 'form', 'profile', 'page']),
  value: z.string().min(1).max(300),
  source_url: z.string().min(1),
  quote: z.string().min(1).max(500),
});

export const enrichmentIn = z.object({
  company: z.string().max(200),
  website: z.string().nullable().optional(),
  country: z.string().length(2).nullable().optional(),
  summary: z.string().max(800),
  legitimacy: z.enum(['real', 'doubtful', 'unknown']),
  legitimacy_reason: z.string().max(400).optional(),
  engineering_need: z.string().max(600).optional(),
  facts: z.array(factIn).max(40),
  contacts: z.array(contactIn).max(10),
});
type EnrichmentIn = z.infer<typeof enrichmentIn>;

export type Dropped = { kind: 'fact' | 'contact'; field: string; reason: string };

export type Enrichment =
  | {
      status: 'ok';
      website: string | null;
      country: string | null;
      summary: string;
      legitimacy: 'real' | 'doubtful' | 'unknown';
      legitimacy_reason: string;
      engineering_need: string;
      facts: Fact[];
      contacts: Contact[];
      dropped: Dropped[];
      searches: number;
      usage: { input_tokens: number; output_tokens: number };
    }
  | { status: 'unavailable'; reason: string };

const norm = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u2026/g, '...')
    .replace(/\s+/g, ' ')
    .trim();

/** Everything the tools showed for one address, normalised: pages read in full and passages cited. */
const textsFor = (evidence: Evidence, url: string): string[] => {
  const key = canonicalUrl(url);
  return [
    ...evidence.documents.filter((doc) => doc.url === key).map((doc) => norm(doc.text)),
    // A provider cuts a cited passage with "...": the cut is not part of the page.
    ...evidence.citations.filter((cite) => cite.url === key).map((cite) => norm(cite.cited_text).replace(/\.{3}$/, '').trim()),
  ];
};

const MIN_QUOTE = 8;

const quoteVerified = (evidence: Evidence, url: string, quote: string): boolean => {
  const wanted = norm(quote).replace(/\.{3}$/, '').trim();
  return wanted.length >= MIN_QUOTE && textsFor(evidence, url).some((text) => text.includes(wanted));
};

const hostOf = (url: string): string | null => {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
};

const digitRuns = (value: string): string[] => value.replace(/[,.\s](?=\d{3}\b)/g, '').match(/\d+/g) ?? [];

const figureInQuote = (value: string, quote: string): boolean => {
  const inQuote = digitRuns(quote);
  const runs = digitRuns(value);
  return runs.length === 0 || runs.every((run) => inQuote.includes(run));
};

const isOfficial = (url: string, website: string | null): boolean => {
  const host = hostOf(url);
  if (host === null) return false;
  if (OFFICIAL_HOSTS.some((official) => host === official || host.endsWith(`.${official}`))) return true;
  const own = website === null ? null : hostOf(website);
  return own !== null && registrableDomain(own) === registrableDomain(host);
};

/** Check the model's answer against the evidence. Pure: the same input always gives the same output. */
export const guardEnrichment = (
  raw: EnrichmentIn,
  evidence: Evidence,
  hint: { website: string | null },
): { website: string | null; facts: Fact[]; contacts: Contact[]; dropped: Dropped[] } => {
  const dropped: Dropped[] = [];

  // The website is accepted only if a page of that site was actually seen.
  const seenHosts = new Set([...evidence.urls].map((url) => hostOf(url)).filter((host): host is string => host !== null).map(registrableDomain));
  const claimed = raw.website ?? hint.website;
  const claimedHost = claimed === null || claimed === undefined ? null : hostOf(claimed);
  const website = claimed !== null && claimed !== undefined && claimedHost !== null && (seenHosts.has(registrableDomain(claimedHost)) || claimed === hint.website)
    ? `https://${claimedHost.replace(/^www\./, '')}`
    : null;

  const facts: Fact[] = [];
  for (const fact of raw.facts) {
    const inferred = (reason: string | null): Fact => {
      if (reason !== null) dropped.push({ kind: 'fact', field: fact.field, reason });
      return { field: fact.field, value: fact.value, provenance: 'inferred', source_url: null, quote: null };
    };
    if (fact.provenance === 'inferred') {
      facts.push(inferred(null));
      continue;
    }
    const url = fact.source_url ?? null;
    const quote = fact.quote ?? null;
    if (url === null || !evidence.urls.has(canonicalUrl(url))) {
      facts.push(inferred('the source is not a page the research touched'));
      continue;
    }
    if (quote === null || !quoteVerified(evidence, url, quote)) {
      facts.push(inferred('the quote is not in the page'));
      continue;
    }
    if (FIGURE_FIELDS.includes(fact.field) && !figureInQuote(fact.value, quote)) {
      facts.push(inferred('the figure is not in the quote'));
      continue;
    }
    const provenance = fact.provenance === 'verified' && !isOfficial(url, website) ? 'reported' : fact.provenance;
    facts.push({ field: fact.field, value: fact.value, provenance, source_url: canonicalUrl(url), quote });
  }

  const contacts: Contact[] = [];
  for (const contact of raw.contacts) {
    const drop = (reason: string): void => {
      dropped.push({ kind: 'contact', field: contact.role, reason });
    };
    if (!evidence.urls.has(canonicalUrl(contact.source_url))) {
      drop('the page was not touched by the research');
      continue;
    }
    if (!quoteVerified(evidence, contact.source_url, contact.quote)) {
      drop('the quote is not in the page');
      continue;
    }
    const where = textsFor(evidence, contact.source_url);
    if (contact.channel === 'email') {
      const address = contact.value.trim().toLowerCase();
      const domain = address.split('@')[1] ?? '';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) {
        drop('not an email address');
        continue;
      }
      if (FREE_MAIL.includes(domain)) {
        drop('a personal mailbox, not a business contact');
        continue;
      }
      if (!where.some((text) => text.includes(address))) {
        drop('the address is not in the page');
        continue;
      }
    } else if (
      !/^https:\/\//.test(contact.value) ||
      // A link counts when the research touched it, or when the page it was read on shows it.
      !(evidence.urls.has(canonicalUrl(contact.value)) || where.some((text) => text.includes(norm(contact.value))))
    ) {
      drop('the link was not touched by the research');
      continue;
    }
    // A named person must be named in the words quoted from the page.
    if (contact.name !== null && contact.name !== undefined && contact.name !== '' && !norm(contact.quote).includes(norm(contact.name))) {
      drop('the name is not in the quote');
      continue;
    }
    contacts.push({
      role: contact.role,
      name: contact.name === undefined || contact.name === '' ? null : contact.name,
      channel: contact.channel,
      value: contact.channel === 'email' ? contact.value.trim().toLowerCase() : contact.value,
      source_url: canonicalUrl(contact.source_url),
      quote: contact.quote,
      verified: true,
    });
  }
  return { website, facts, contacts, dropped };
};

/** The first JSON object in a model answer. */
const objectIn = (text: string): unknown => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

const SYSTEM = [
  'You research companies for a senior freelance software engineer who is looking for clients.',
  'Use the web tools. Report only what a page you searched or read states. Never invent a figure, a name, an address or a link.',
  'Not finding something is a correct answer: leave it out. Answer with one JSON object and nothing else.',
].join(' ');

export const enrichPrompt = (company: string, signals: readonly Signal[], hintWebsite: string | null): string => {
  const evidence = signals
    .slice(0, 4)
    .map((signal) => `- [${signal.type}] ${signal.title}${signal.text === null ? '' : ` :: ${signal.text.slice(0, 300)}`} (${signal.url})`)
    .join('\n');
  return [
    `Company: ${company}`,
    ...(hintWebsite === null ? [] : [`Website hint: ${hintWebsite}`]),
    'Why it came up:',
    evidence,
    '',
    'Find out: what the company does and sells, its business model, size, location, funding and investors, revenue or profitability if public, growth and hiring signals, recent launches, contracts or acquisitions, its technology, and whether it is a real business.',
    'Judge whether it plausibly needs outside software engineers (a contractor, freelancer or consultant) and why.',
    `Find public business contacts for these roles only: ${CONTACT_ROLES.join(', ')}. Use the company site, its contact or team page, or public professional profiles.`,
    '',
    'Rules for every fact and contact:',
    '- source_url: a page you searched or read. quote: words copied exactly from that page, 200 characters at most.',
    '- provenance: "verified" only when the page is the company own site or an official register; "reported" for press or a directory that names its source; "estimated" for a third-party estimate; "inferred" for your own reading (no source needed).',
    '- A contact email must appear letter for letter in the page. Never guess an address from a pattern.',
    `- fact fields allowed: ${FACT_FIELDS.join(', ')}.`,
    '',
    'JSON shape: {"company": string, "website": string|null, "country": "ISO 3166 alpha-2"|null, "summary": string, "legitimacy": "real"|"doubtful"|"unknown", "legitimacy_reason": string, "engineering_need": string, "facts": [{"field","value","provenance","source_url","quote"}], "contacts": [{"role","name","channel":"email"|"form"|"profile"|"page","value","source_url","quote"}]}',
  ].join('\n');
};

/** Facts the signals themselves prove: the words are in the signal text, so the evidence is already in hand. */
export const signalFacts = (signals: readonly Signal[]): Fact[] => {
  const facts: Fact[] = [];
  for (const signal of signals) {
    if (signal.type === 'funding') {
      facts.push({ field: 'funding', value: signal.title, provenance: 'reported', source_url: signal.url, quote: signal.title });
    } else if (signal.type === 'hiring_growth') {
      const size = /Team size (\d+)/.exec(signal.text ?? '');
      if (size?.[1] !== undefined) {
        facts.push({ field: 'company_size', value: `${size[1]} people`, provenance: 'reported', source_url: signal.url, quote: `Team size ${size[1]}` });
      }
      facts.push({ field: 'hiring', value: 'Listed as hiring', provenance: 'reported', source_url: signal.url, quote: signal.title });
    } else if (signal.type === 'job_posting' || signal.type === 'freelance_request') {
      facts.push({ field: 'hiring', value: signal.title.slice(0, 160), provenance: 'reported', source_url: signal.url, quote: signal.title.slice(0, 160) });
    }
  }
  return facts;
};

export type EnrichDeps = ResearchDeps;

/** Research one company and return only what survives the guards. A failure is a reason, never a guess. */
export const enrichCompany = async (
  company: string,
  signals: readonly Signal[],
  hintWebsite: string | null,
  deps: EnrichDeps,
): Promise<Enrichment> => {
  const result = await research(SYSTEM, enrichPrompt(company, signals, hintWebsite), deps);
  if (!result.ok) return { status: 'unavailable', reason: result.reason };
  const parsed = enrichmentIn.safeParse(objectIn(result.text));
  if (!parsed.success) return { status: 'unavailable', reason: 'the research answer did not match the expected shape' };
  const guarded = guardEnrichment(parsed.data, result.evidence, { website: hintWebsite });
  return {
    status: 'ok',
    website: guarded.website,
    country: parsed.data.country ?? null,
    summary: parsed.data.summary,
    legitimacy: parsed.data.legitimacy,
    legitimacy_reason: parsed.data.legitimacy_reason ?? '',
    engineering_need: parsed.data.engineering_need ?? '',
    facts: guarded.facts,
    contacts: guarded.contacts,
    dropped: guarded.dropped,
    searches: result.searches,
    usage: result.usage,
  };
};
