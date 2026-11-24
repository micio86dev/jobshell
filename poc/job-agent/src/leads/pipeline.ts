/**
 * One run of the lead pipeline, with everything injected.
 *
 * COLLECT → DEDUPLICATE → IDENTIFY → GROUP BY COMPANY → FREE FILTER → JUDGE → PRE-SCORE → RESEARCH
 * → SCORE → GATE → OUTREACH DRAFT. Discovery and qualification stay apart: nothing is discarded
 * for lacking the words a filter expects, only for what is wrong whatever the profile says, and
 * every loss is counted with its reason. The paid steps run on the most promising companies first,
 * inside the budget the strategy sets, and the cost of the run is measured.
 */
import type { AgentConfig } from '../config.ts';
import type { FetchLike, JeDeps } from '../jev.ts';
import type { AskDeps } from '../llm-call.ts';
import type { UserProfile } from '../profile.ts';
import { contentKey, type LeadCache } from './cache.ts';
import { candidateContext, classificationSchema, classifySignal, isSuspicious, QUESTIONS_VERSION, type Classification } from './classify.ts';
import { collectSignals } from './collect.ts';
import { dedupeSignals, groupByCompany, type CompanyGroup } from './company.ts';
import { CostMeter } from './cost.ts';
import { emptyMetrics, explain, type RunMetrics } from './diagnostics.ts';
import { enrichCompany, signalFacts, type Enrichment } from './enrich.ts';
import { identifyCompanies } from './identify.ts';
import { draftOutreach, languageFor } from './outreach.ts';
import { prefilter, type Negative, type Ranked } from './prefilter.ts';
import { planLeadQueries } from './queries.ts';
import type { ResearchDeps } from './research.ts';
import { needSummary, nextAction, scoreCase, type CaseInput, type Scored } from './score.ts';
import type { LeadStrategy } from './strategy.ts';
import { contactSchema, factSchema, type Contact, type Fact, type Signal } from './types.ts';
import { z } from 'zod';

const CACHE_TTL_DAYS = 14;
/** A judge that fails this many times in a row is down: stop paying for timeouts. */
const JUDGE_FAILURE_LIMIT = 3;
const MAX_REJECTED_KEPT = 30;
/** The kinds of signal that are news about a company, not an advertisement it placed. */
const BUYING_SIGNALS: readonly string[] = ['funding', 'hiring_growth', 'product_launch', 'expansion', 'contract_win', 'modernization'];
/** The share of the judgment budget kept for them, so a run does not spend it all on vacancies. */
const BUYING_SIGNAL_SHARE = 0.3;

/**
 * Who gets judged: what the user pasted first, then the best buying signals up to their share, then the
 * best of everything else. Companies with no advertisement are part of the product, and a cheap score
 * that favours vacancies would otherwise never reach them.
 */
export const chooseForJudgment = <T extends { fromImport: boolean; primary: { pre_score: number; signal: { type: string } } }>(
  cases: readonly T[],
  budget: number,
): T[] => {
  const imports = cases.filter((item) => item.fromImport);
  const rest = cases.filter((item) => !item.fromImport);
  const reserved = budget >= 3 ? Math.max(1, Math.round(budget * BUYING_SIGNAL_SHARE)) : 0;
  const news = rest.filter((item) => BUYING_SIGNALS.includes(item.primary.signal.type)).slice(0, reserved);
  const chosen = new Set<T>(news);
  const others = rest.filter((item) => !chosen.has(item));
  const room = Math.max(0, budget - news.length);
  return [...imports, ...news, ...others.slice(0, room)];
};
const MAX_DRAFTS = 10;

export type LeadRunDeps = {
  config: AgentConfig;
  profile: UserProfile;
  strategy: LeadStrategy;
  sources: string[];
  fetchImpl: FetchLike;
  /** The judge. Null means the key is missing: nothing can be qualified. */
  jev: JeDeps | null;
  /** Plain model calls: naming companies, queries, outreach. Null when no provider key is stored. */
  llm: AskDeps | null;
  /** Research with web tools. Null when the provider cannot do it or has no key. */
  research: ResearchDeps | null;
  researchUnavailable?: string | null;
  /** Read the sources and apply the free filters, and buy nothing. */
  dryRun?: boolean;
  cache: LeadCache;
  imports: Signal[];
  now: Date;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (message: string) => void;
};

export type LeadDocument = {
  run: { id: string; started_at: string; finished_at: string; metrics: RunMetrics & { explanation: string[] }; cost: RunMetrics['cost'] };
  leads: LeadEntry[];
};

export type LeadEntry = {
  company_key: string;
  company_name: string;
  website: string | null;
  country: string | null;
  qualified: boolean;
  rejection_reason: string | null;
  summary: string;
  why_match: string;
  next_action: string;
  score: { total: number; confidence: number; completeness: number; dimensions: Scored['dimensions'] };
  signals: Array<{ id: string; type: string; source: string; url: string; title: string; quote: string | null; published_at: string | null; observed_at: string }>;
  facts: Fact[];
  contacts: Contact[];
  outreach: Array<{ lang: string; subject: string; body: string; fact_ids: string[] }>;
};

type Case = {
  group: CompanyGroup;
  kept: Ranked[];
  primary: Ranked;
  classification: Classification | null;
  enrichment: Enrichment | null;
  facts: Fact[];
  contacts: Contact[];
  scored: Scored | null;
  input: CaseInput | null;
  fromImport: boolean;
};

const enrichmentCache = z.object({
  status: z.literal('ok'),
  website: z.string().nullable(),
  country: z.string().nullable(),
  summary: z.string(),
  legitimacy: z.enum(['real', 'doubtful', 'unknown']),
  legitimacy_reason: z.string(),
  engineering_need: z.string(),
  facts: z.array(factSchema),
  contacts: z.array(contactSchema),
  dropped: z.array(z.object({ kind: z.enum(['fact', 'contact']), field: z.string(), reason: z.string() })),
  searches: z.number(),
  usage: z.object({ input_tokens: z.number(), output_tokens: z.number() }),
});

const message = (error: unknown): string => (error instanceof Error ? error.message.slice(0, 200) : 'unknown error');

const count = (record: Record<string, number>, key: string): void => {
  record[key] = (record[key] ?? 0) + 1;
};

const dedupeFacts = (facts: readonly Fact[]): Fact[] => {
  const seen = new Set<string>();
  const out: Fact[] = [];
  for (const fact of facts) {
    const key = `${fact.field}|${fact.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(fact);
  }
  return out;
};

/** The site of an employer, when a signal links to it rather than to a board or a feed. */
const websiteHint = (group: CompanyGroup): string | null => {
  if (!group.key.startsWith('d:')) return null;
  return `https://${group.key.slice(2)}`;
};

export const runLeads = async (deps: LeadRunDeps): Promise<LeadDocument> => {
  const { strategy, now } = deps;
  const meter = new CostMeter(deps.llm?.model ?? deps.research?.model ?? 'none');
  const metrics = emptyMetrics(strategy.threshold, meter.summary(), deps.dryRun === true);
  const stamp = (label: string): (() => void) => {
    const started = Date.now();
    return () => {
      metrics.ms[label] = (metrics.ms[label] ?? 0) + (Date.now() - started);
    };
  };
  const progress = (text: string): void => deps.onProgress?.(text);
  const startedAt = now.toISOString();

  // 1. Queries and collection.
  const doneQueries = stamp('queries');
  const planned = await planLeadQueries(deps.profile, strategy, deps.llm);
  if (planned.source === 'fallback' && planned.reason !== null && deps.llm !== null) metrics.errors.push({ stage: 'queries', message: planned.reason });
  doneQueries();

  const doneCollect = stamp('collect');
  progress('collecting signals');
  const collected = await collectSignals({
    config: deps.config,
    fetchImpl: deps.fetchImpl,
    now,
    sources: deps.sources,
    queries: planned.queries,
    ...(deps.sleep === undefined ? {} : { sleep: deps.sleep }),
    onProgress: progress,
  });
  doneCollect();
  metrics.sources = collected.reports;
  const all = [...deps.imports, ...collected.signals];
  metrics.signals.collected = all.length;
  let signals = dedupeSignals(all);
  metrics.signals.unique = signals.length;

  // 2. Name the companies the signals do not name, when a model is available.
  if (deps.llm !== null && signals.some((signal) => signal.company_name === null)) {
    const doneIdentify = stamp('identify');
    progress('naming companies');
    const identified = await identifyCompanies(signals, deps.llm);
    meter.llm(identified.usage);
    signals = identified.signals;
    metrics.signals.identified_by_model = identified.identified;
    if (identified.failure !== null) metrics.errors.push({ stage: 'identify', message: identified.failure });
    doneIdentify();
  }
  const grouped = groupByCompany(signals);
  metrics.signals.unidentified = grouped.unidentified.length;
  metrics.companies.found = grouped.companies.length;

  // 3. The free filter: only what is wrong whatever the profile says.
  const importIds = new Set(deps.imports.map((signal) => signal.id));
  const cases: Case[] = [];
  for (const group of grouped.companies) {
    const filtered = prefilter(group.signals, strategy, now);
    for (const drop of filtered.dropped) for (const reason of drop.negatives) count(metrics.prefilter_dropped, reason satisfies Negative);
    const [primary] = filtered.kept;
    if (primary === undefined) {
      metrics.companies.with_every_signal_dropped += 1;
      continue;
    }
    cases.push({
      group,
      kept: filtered.kept,
      primary,
      classification: null,
      enrichment: null,
      facts: signalFacts(filtered.kept.map((ranked) => ranked.signal)),
      contacts: [],
      scored: null,
      input: null,
      fromImport: group.signals.some((signal) => importIds.has(signal.id)),
    });
  }
  metrics.companies.after_filter = cases.length;
  // What the user pasted is judged first, whatever the budget; the rest by the cheap score.
  cases.sort((a, b) => Number(b.fromImport) - Number(a.fromImport) || b.primary.pre_score - a.primary.pre_score);

  // 4. The judge, on the most promising companies, with the cache first.
  const context = candidateContext(deps.profile, strategy);
  const contextKey = contentKey(context, String(QUESTIONS_VERSION));
  const doneJudge = stamp('judge');
  let consecutiveFailures = 0;
  let judged = 0;
  if (deps.jev === null) {
    metrics.judge.available = false;
    metrics.errors.push({ stage: 'judge', message: 'no judgment key is stored' });
  } else {
    for (const item of chooseForJudgment(cases, strategy.classify_budget)) {
      const signal = item.primary.signal;
      const key = contentKey(signal.id, signal.title, signal.text, contextKey);
      const cached = classificationSchema.safeParse(deps.cache.verdict(key, now, CACHE_TTL_DAYS));
      if (cached.success) {
        item.classification = { ...cached.data, usage: { input_tokens: 0, output_tokens: 0 } };
        metrics.companies.from_cache += 1;
        judged += 1;
        continue;
      }
      progress(`judging ${judged + 1}/${Math.min(cases.length, strategy.classify_budget)}`);
      try {
        const classification = await classifySignal(signal, context, deps.jev);
        meter.jev(classification.usage.input_tokens);
        deps.cache.setVerdict(key, classification, now);
        item.classification = classification;
        metrics.judge.calls += 1;
        judged += 1;
        consecutiveFailures = 0;
      } catch (error) {
        metrics.judge.failed += 1;
        metrics.errors.push({ stage: 'judge', message: message(error) });
        consecutiveFailures += 1;
        if (consecutiveFailures >= JUDGE_FAILURE_LIMIT) {
          metrics.judge.available = false;
          break;
        }
      }
    }
  }
  doneJudge();
  metrics.companies.classified = cases.filter((item) => item.classification !== null).length;

  const judgedCases = cases.filter((item): item is Case & { classification: Classification } => item.classification !== null);
  const caseInput = (item: Case & { classification: Classification }, enrichment: Enrichment | null): CaseInput => {
    const ok = enrichment?.status === 'ok' ? enrichment : null;
    return {
      primary: item.primary.signal,
      signals: item.kept.map((ranked) => ranked.signal),
      classification: item.classification,
      facts: item.facts,
      contacts: item.contacts,
      legitimacy: ok === null ? null : ok.legitimacy,
      country: ok?.country ?? null,
      tech_hits: item.primary.tech_hits,
      researched: ok !== null,
      strategy,
    };
  };

  // 5. A first score without research, to choose who is worth researching.
  for (const item of judgedCases) item.scored = scoreCase(caseInput(item, null));

  // 6. Research on the promising companies, inside the budget, with the cache first.
  const canResearch = deps.research !== null;
  metrics.research.available = canResearch;
  if (!canResearch) metrics.research.reason = deps.researchUnavailable ?? 'no Anthropic key is stored, or the provider chosen cannot search the web';
  if (deps.research !== null) {
    const doneResearch = stamp('research');
    const worthIt = judgedCases
      .filter((item) => !isSuspicious(item.classification) && !['unrelated', 'recruitment_marketing'].includes(item.classification.need.verdict) && (item.scored?.total ?? 0) >= strategy.threshold * 0.7)
      .sort((a, b) => (b.scored?.total ?? 0) - (a.scored?.total ?? 0))
      .slice(0, strategy.enrich_budget);
    for (const [index, item] of worthIt.entries()) {
      if (meter.spent() >= strategy.usd_cap) {
        metrics.research.skipped_for_budget = worthIt.length - index;
        break;
      }
      progress(`researching ${index + 1}/${worthIt.length}: ${item.group.name}`);
      const cached = enrichmentCache.safeParse(deps.cache.research(item.group.key, now, CACHE_TTL_DAYS));
      let enrichment: Enrichment;
      if (cached.success) {
        enrichment = cached.data;
      } else {
        enrichment = await enrichCompany(item.group.name, item.kept.map((ranked) => ranked.signal), websiteHint(item.group), deps.research);
        if (enrichment.status === 'ok') {
          meter.llm(enrichment.usage, enrichment.searches);
          deps.cache.setResearch(item.group.key, enrichment, now);
        }
      }
      if (enrichment.status === 'unavailable') {
        metrics.research.failed += 1;
        metrics.errors.push({ stage: 'research', message: enrichment.reason });
        // A refused key or an empty account will fail every company: say it once and stop spending requests.
        if (/key was refused|no credit/.test(enrichment.reason)) {
          metrics.research.available = false;
          metrics.research.reason = enrichment.reason;
          break;
        }
        continue;
      }
      item.enrichment = enrichment;
      item.facts = dedupeFacts([...item.facts, ...enrichment.facts]);
      item.contacts = enrichment.contacts;
      metrics.research.companies += 1;
      metrics.research.facts_kept += enrichment.facts.filter((fact) => fact.provenance !== 'inferred').length;
      metrics.research.facts_downgraded += enrichment.dropped.filter((drop) => drop.kind === 'fact').length;
      metrics.research.contacts_kept += enrichment.contacts.length;
      metrics.research.contacts_dropped += enrichment.dropped.filter((drop) => drop.kind === 'contact').length;
    }
    doneResearch();
  }

  // 7. The final score and the gate.
  const rejectedReasons: Record<string, number> = {};
  for (const item of judgedCases) {
    item.input = caseInput(item, item.enrichment);
    item.scored = scoreCase(item.input);
    if (!item.scored.qualified) {
      const first = (item.scored.rejection_reason ?? 'rejected').split(';')[0] ?? 'rejected';
      count(rejectedReasons, first.replace(/\d+(\.\d+)?/g, 'N').trim());
      if (item.classification.quality.suspicion >= 0.6) metrics.judge.suspicious += 1;
    }
  }
  metrics.rejected = rejectedReasons;
  const qualified = judgedCases.filter((item) => item.scored?.qualified === true).sort((a, b) => (b.scored?.total ?? 0) - (a.scored?.total ?? 0));
  metrics.qualified = qualified.length;
  const best = judgedCases
    .filter((item) => item.scored?.qualified === false)
    .sort((a, b) => (b.scored?.total ?? 0) - (a.scored?.total ?? 0))[0];
  if (best?.scored != null) metrics.best_rejected = { company: best.group.name, score: best.scored.total, reason: best.scored.rejection_reason ?? '' };

  // 8. Outreach drafts for the qualified, never sent.
  const drafts = new Map<string, LeadEntry['outreach']>();
  if (deps.llm !== null) {
    const doneDrafts = stamp('outreach');
    for (const item of qualified.slice(0, MAX_DRAFTS)) {
      if (meter.spent() >= strategy.usd_cap) break;
      const ok = item.enrichment?.status === 'ok' ? item.enrichment : null;
      const lang = languageFor(ok?.country ?? null, strategy.outreach_languages);
      progress(`drafting for ${item.group.name}`);
      const result = await draftOutreach(
        {
          company: item.group.name,
          website: ok?.website ?? null,
          lang,
          facts: item.facts,
          signals: item.kept.map((ranked) => ranked.signal),
          contact: item.contacts[0] ?? null,
          need: ok?.engineering_need ?? item.primary.signal.title,
          profile: deps.profile,
          strategy,
        },
        deps.llm,
      );
      if (result.ok) {
        meter.llm(result.usage);
        drafts.set(item.group.key, [{ lang: result.draft.lang, subject: result.draft.subject, body: result.draft.body, fact_ids: result.draft.fact_ids }]);
        metrics.outreach.drafted += 1;
      } else {
        metrics.outreach.refused += 1;
        metrics.errors.push({ stage: 'outreach', message: `${item.group.name}: ${result.reason}` });
      }
    }
    doneDrafts();
  }

  // 9. The document the app stores.
  const entry = (item: Case & { classification: Classification }): LeadEntry => {
    const scored = item.scored as Scored;
    const input = item.input as CaseInput;
    const ok = item.enrichment?.status === 'ok' ? item.enrichment : null;
    const website = ok?.website ?? websiteHint(item.group);
    const technical = scored.dimensions.filter((dimension) => dimension.name === 'technical_relevance' || dimension.name === 'profile_relevance');
    return {
      company_key: item.group.key,
      company_name: item.group.name,
      website,
      country: ok?.country ?? null,
      qualified: scored.qualified,
      rejection_reason: scored.rejection_reason,
      summary: needSummary(input, ok?.engineering_need ?? ''),
      why_match: technical.map((dimension) => dimension.explanation).join(' '),
      next_action: nextAction(input, website),
      score: { total: scored.total, confidence: scored.confidence, completeness: scored.completeness, dimensions: scored.dimensions },
      signals: item.kept.slice(0, 5).map(({ signal }) => ({
        id: signal.id, type: signal.type, source: signal.sources.join(','), url: signal.url, title: signal.title,
        quote: signal.text === null ? null : signal.text.slice(0, 240), published_at: signal.published_at, observed_at: signal.observed_at,
      })),
      facts: item.facts,
      contacts: item.contacts,
      outreach: drafts.get(item.group.key) ?? [],
    };
  };
  const rejectedEntries = judgedCases
    .filter((item) => item.scored?.qualified === false)
    .sort((a, b) => (b.scored?.total ?? 0) - (a.scored?.total ?? 0))
    .slice(0, MAX_REJECTED_KEPT);
  const leads = [...qualified, ...rejectedEntries].map(entry);

  metrics.cost = meter.summary();
  const explanation = explain(metrics);
  const finishedAt = new Date().toISOString();
  return {
    run: { id: `lead-run-${startedAt.replace(/[:.]/g, '-')}`, started_at: startedAt, finished_at: finishedAt, metrics: { ...metrics, explanation }, cost: metrics.cost },
    leads,
  };
};
