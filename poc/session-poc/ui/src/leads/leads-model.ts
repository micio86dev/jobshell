/**
 * What the lead screens accept from the backend and how they present it.
 *
 * Everything that crosses from Rust is validated here, with zod, before a component sees it, and a
 * failure names the problem without echoing the data. Evidence is presented by how much it proves:
 * what a page states comes before an estimate, and the model's own reading is kept apart and never
 * shown as a fact.
 */
import { z } from 'zod';

export const VIEWS = ['inbox', 'later', 'contacted', 'dismissed'] as const;
export type View = (typeof VIEWS)[number];

const STATUSES = ['new', 'interesting', 'not_interesting', 'contacted', 'later', 'converted'] as const;
export type Status = (typeof STATUSES)[number];

const PROVENANCES = ['verified', 'reported', 'estimated', 'inferred'] as const;
export type Provenance = (typeof PROVENANCES)[number];

const leadSchema = z.object({
  id: z.number(),
  company_key: z.string(),
  company_name: z.string(),
  website: z.string().nullable(),
  country: z.string().nullable(),
  qualified: z.boolean(),
  rejection_reason: z.string().nullable(),
  score: z.number(),
  confidence: z.number(),
  completeness: z.number(),
  status: z.enum(STATUSES),
  summary: z.string(),
  why_match: z.string(),
  next_action: z.string(),
  updated_at: z.string(),
  run_id: z.string().nullable(),
  signal_count: z.number(),
  contact_count: z.number(),
  draft_count: z.number(),
});
export type Lead = z.infer<typeof leadSchema>;

const factSchema = z.object({
  id: z.number(),
  field: z.string(),
  value: z.string(),
  provenance: z.enum(PROVENANCES),
  source_url: z.string().nullable(),
  quote: z.string().nullable(),
});
export type Fact = z.infer<typeof factSchema>;

const detailSchema = z.object({
  lead: leadSchema,
  scores: z.array(z.object({ name: z.string(), points: z.number(), max: z.number(), explanation: z.string(), evidence: z.array(z.string()) })),
  signals: z.array(z.object({ id: z.string(), type: z.string(), source: z.string(), url: z.string(), title: z.string(), quote: z.string().nullable(), published_at: z.string().nullable() })),
  facts: z.array(factSchema),
  contacts: z.array(z.object({ role: z.string(), name: z.string().nullable(), channel: z.enum(['email', 'form', 'profile', 'page']), value: z.string(), source_url: z.string(), quote: z.string(), verified: z.boolean() })),
  // A draft is always a draft: a record that says otherwise is refused, not shown.
  drafts: z.array(z.object({ lang: z.enum(['en', 'it', 'es']), subject: z.string(), body: z.string(), fact_ids: z.array(z.string()), status: z.literal('draft') })),
  events: z.array(z.object({ event: z.enum(STATUSES), note: z.string().nullable(), at: z.string() })),
});
export type LeadDetail = z.infer<typeof detailSchema>;

const costSchema = z.object({
  jev_input_tokens: z.number(),
  llm_input_tokens: z.number(),
  llm_output_tokens: z.number(),
  web_searches: z.number(),
  llm_usd: z.number().nullable(),
  search_usd: z.number(),
  usd_known: z.number(),
  includes_unpriced: z.boolean(),
});
export type Cost = z.infer<typeof costSchema>;

const runSummarySchema = z.object({
  path: z.string(),
  run_id: z.string(),
  dry_run: z.boolean(),
  leads: z.number(),
  qualified: z.number(),
  explanation: z.array(z.string()),
  cost: costSchema,
  stored_leads: z.number(),
  skipped_unevidenced: z.number(),
});
export type RunSummary = z.infer<typeof runSummarySchema>;

const countMap = z.record(z.string(), z.number());
const runRowSchema = z.object({
  id: z.string(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
  metrics: z.object({
    explanation: z.array(z.string()).default([]),
    qualified: z.number().default(0),
    dry_run: z.boolean().default(false),
    sources: z.array(z.object({ source: z.string(), postings: z.number(), skipped: z.string().nullable() })).default([]),
    signals: z.object({ collected: z.number(), unique: z.number(), unidentified: z.number() }).partial().default({}),
    companies: z.object({ found: z.number(), after_filter: z.number(), classified: z.number(), from_cache: z.number() }).partial().default({}),
    prefilter_dropped: countMap.default({}),
    rejected: countMap.default({}),
    errors: z.array(z.object({ stage: z.string(), message: z.string() })).default([]),
  }),
  cost: costSchema.partial().default({}),
});
export type RunRow = z.infer<typeof runRowSchema>;

type Parsed<T, K extends string> = { ok: true } & Record<K, T> | { ok: false; error: string };

export const parseLeads = (raw: unknown): Parsed<Lead[], 'leads'> => {
  if (!Array.isArray(raw)) return { ok: false, error: 'the lead list is not a list' };
  const parsed = z.array(leadSchema).safeParse(raw);
  return parsed.success ? { ok: true, leads: parsed.data } : { ok: false, error: 'a lead has a field of the wrong type' };
};

export const parseDetail = (raw: unknown): Parsed<LeadDetail, 'detail'> => {
  const parsed = detailSchema.safeParse(raw);
  return parsed.success ? { ok: true, detail: parsed.data } : { ok: false, error: 'the lead detail has a field of the wrong type' };
};

export const parseRunSummary = (text: string): Parsed<RunSummary, 'summary'> => {
  try {
    const parsed = runSummarySchema.safeParse(JSON.parse(text));
    return parsed.success ? { ok: true, summary: parsed.data } : { ok: false, error: 'the run summary has a field of the wrong type' };
  } catch {
    return { ok: false, error: 'the run summary is not valid' };
  }
};

export const parseRuns = (raw: unknown): Parsed<RunRow[], 'runs'> => {
  const parsed = z.array(runRowSchema).safeParse(raw);
  return parsed.success ? { ok: true, runs: parsed.data } : { ok: false, error: 'a run has a field of the wrong type' };
};

const PROOF_ORDER: Record<Provenance, number> = { verified: 0, reported: 1, estimated: 2, inferred: 3 };

/** What the evidence proves first; the model's own readings apart, because they are not facts. */
export const orderFacts = (facts: readonly Fact[]): { proven: Fact[]; readings: Fact[] } => {
  const sorted = [...facts].sort((a, b) => PROOF_ORDER[a.provenance] - PROOF_ORDER[b.provenance]);
  return { proven: sorted.filter((fact) => fact.provenance !== 'inferred'), readings: sorted.filter((fact) => fact.provenance === 'inferred') };
};

export const confidenceLevel = (confidence: number): 'high' | 'mid' | 'low' =>
  confidence >= 0.7 ? 'high' : confidence >= 0.5 ? 'mid' : 'low';

export const scoreTone = (score: number): 'strong' | 'good' | 'weak' => (score >= 75 ? 'strong' : score >= 55 ? 'good' : 'weak');

/** The decisions a lead offers, in the order the buttons appear. */
export const ACTIONS = ['interesting', 'dismiss', 'contacted', 'later', 'converted', 'reopen'] as const;
export type Action = (typeof ACTIONS)[number];

const EVENT_OF: Record<Action, Status> = {
  interesting: 'interesting',
  dismiss: 'not_interesting',
  contacted: 'contacted',
  later: 'later',
  converted: 'converted',
  reopen: 'new',
};

export const actionEvent = (action: Action): Status => EVENT_OF[action];

const effortSchema = z.object({ seconds: z.number(), leads_reviewed: z.number(), decided: z.number(), wanted: z.number() });
export type Effort = z.infer<typeof effortSchema>;

export const parseEffort = (raw: unknown): Effort | null => {
  const parsed = effortSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};

/** A look shorter than this is a click through, and one longer than the cap is a window left open. */
export const MIN_LOOK_SECONDS = 2;
export const MAX_LOOK_SECONDS = 600;

/** The seconds to record for a lead that was open from `startedMs` to `endedMs`; 0 when it is not worth recording. */
export const lookSeconds = (startedMs: number, endedMs: number): number => {
  const seconds = Math.round((endedMs - startedMs) / 1000);
  return seconds < MIN_LOOK_SECONDS ? 0 : Math.min(seconds, MAX_LOOK_SECONDS);
};

/** Wanted opportunities per hour of the user's time, or null when less than a minute was measured. */
export const wantedPerHour = (effort: Effort): number | null =>
  effort.seconds < 60 ? null : Math.round(((effort.wanted * 3600) / effort.seconds) * 10) / 10;

/** The cost of a run in one line: what has a price, what has none, and the searches. */
type MaybeCost = { [K in keyof Cost]?: Cost[K] | undefined };

export const costLine = (cost: MaybeCost, qualified = 0): string => {
  const parts: string[] = [];
  const spent = cost.usd_known ?? 0;
  const tokens = (cost.jev_input_tokens ?? 0) + (cost.llm_input_tokens ?? 0) + (cost.llm_output_tokens ?? 0);
  if (spent === 0 && tokens === 0 && (cost.web_searches ?? 0) === 0) return 'nothing was bought';
  parts.push(`US$ ${spent.toFixed(2)}${cost.includes_unpriced === true && (cost.jev_input_tokens ?? 0) > 0 ? ` (without the judgment service tokens, ${cost.jev_input_tokens})` : ''}`);
  if ((cost.web_searches ?? 0) > 0) parts.push(`${cost.web_searches} searches`);
  // The price of what the user actually gets: the known spend over the leads that qualified.
  if (qualified > 0 && spent > 0) parts.push(`US$ ${(spent / qualified).toFixed(2)} per qualified lead`);
  return parts.join(', ');
};
