// The lead screens' rules: what the app accepts from the backend, how evidence is ordered and shown,
// and what each decision button records. Pure and offline.
import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  actionEvent,
  confidenceLevel,
  costLine,
  orderFacts,
  parseDetail,
  parseLeads,
  parseRunSummary,
  parseRuns,
  scoreTone,
  type Fact,
} from './leads-model';

const lead = {
  id: 1, company_key: 'n:acme', company_name: 'Acme', website: 'https://acme.test', country: 'DE', qualified: true, rejection_reason: null,
  score: 78.5, confidence: 0.81, completeness: 0.57, status: 'new', summary: 'Asks for outside engineers.', why_match: 'Laravel and Vue.',
  next_action: 'Write to the CTO.', updated_at: '2026-11-24 10:00:00', run_id: 'lead-run-1', signal_count: 2, contact_count: 1, draft_count: 1,
};

describe('what the app accepts from the backend', () => {
  it('reads a list of leads', () => {
    const parsed = parseLeads([lead]);
    expect(parsed.ok && parsed.leads[0]?.company_name).toBe('Acme');
  });

  it('refuses a lead with a status the app does not know, without echoing the data', () => {
    const parsed = parseLeads([{ ...lead, status: 'sent' }]);
    expect(parsed).toEqual({ ok: false, error: 'a lead has a field of the wrong type' });
  });

  it('refuses anything that is not a list', () => {
    expect(parseLeads({})).toEqual({ ok: false, error: 'the lead list is not a list' });
  });

  it('reads one lead with its evidence and refuses a draft that is not a draft', () => {
    const detail = {
      lead, scores: [{ name: 'b2b_potential', points: 20, max: 25, explanation: 'x', evidence: ['s1'] }],
      signals: [{ id: 's1', type: 'job_posting', source: 'lever', url: 'https://x.test', title: 'T', quote: null, published_at: null }],
      facts: [{ id: 1, field: 'funding', value: 'Series A', provenance: 'reported', source_url: 'https://n.test', quote: 'raised' }],
      contacts: [{ role: 'CTO', name: 'Jo', channel: 'page', value: 'https://a.test/team', source_url: 'https://a.test/team', quote: 'Jo, CTO', verified: true }],
      drafts: [{ lang: 'en', subject: 'S', body: 'B', fact_ids: ['funding'], status: 'draft' }],
      events: [{ event: 'contacted', note: null, at: '2026-11-24' }],
    };
    expect(parseDetail(detail).ok).toBe(true);
    expect(parseDetail({ ...detail, drafts: [{ ...detail.drafts[0], status: 'sent' }] }).ok).toBe(false);
    expect(parseDetail({ ...detail, facts: [{ ...detail.facts[0], provenance: 'guess' }] }).ok).toBe(false);
  });

  it('reads the summary of a run and the history of runs', () => {
    const summary = parseRunSummary(JSON.stringify({ path: '/e/lead-run-1.json', run_id: 'lead-run-1', dry_run: false, leads: 5, qualified: 2, explanation: ['2 qualified leads'], cost: { jev_input_tokens: 1000, llm_input_tokens: 0, llm_output_tokens: 0, web_searches: 0, llm_usd: null, search_usd: 0, usd_known: 0, includes_unpriced: true }, stored_leads: 5, skipped_unevidenced: 1 }));
    expect(summary.ok && summary.summary.qualified).toBe(2);
    expect(parseRunSummary('not json').ok).toBe(false);
    const runs = parseRuns([{ id: 'r1', started_at: 's', finished_at: null, metrics: { explanation: ['a'], qualified: 0 }, cost: {} }]);
    expect(runs.ok && runs.runs[0]?.id).toBe('r1');
  });
});

describe('how evidence is shown', () => {
  const fact = (provenance: Fact['provenance'], value: string): Fact => ({ id: 1, field: 'funding', value, provenance, source_url: provenance === 'inferred' ? null : 'https://x.test', quote: null });

  it('puts what is proven before what is only a reading, and keeps the readings apart', () => {
    const ordered = orderFacts([fact('inferred', 'guess'), fact('estimated', 'range'), fact('verified', 'site'), fact('reported', 'press')]);
    expect(ordered.proven.map((entry) => entry.value)).toEqual(['site', 'press', 'range']);
    expect(ordered.readings.map((entry) => entry.value)).toEqual(['guess']);
  });

  it('names how sure the evidence is, in three levels', () => {
    expect(confidenceLevel(0.9)).toBe('high');
    expect(confidenceLevel(0.6)).toBe('mid');
    expect(confidenceLevel(0.2)).toBe('low');
  });

  it('shades a score by how far it is from the line', () => {
    expect(scoreTone(80)).toBe('strong');
    expect(scoreTone(65)).toBe('good');
    expect(scoreTone(40)).toBe('weak');
  });
});

describe('what each decision records', () => {
  it('maps every button to one event the backend accepts, and reopening is an event too', () => {
    expect(ACTIONS.map((action) => actionEvent(action))).toEqual(['interesting', 'not_interesting', 'contacted', 'later', 'converted', 'new']);
  });
});

describe('the cost of a run', () => {
  it('says what it knows and that part of it has no price', () => {
    const base = { jev_input_tokens: 4000, llm_input_tokens: 10500, llm_output_tokens: 1350, web_searches: 3, llm_usd: 0.0345, search_usd: 0.03, usd_known: 0.0645, includes_unpriced: true };
    expect(costLine(base)).toBe('US$ 0.06 (without the judgment service tokens, 4000), 3 searches');
    expect(costLine({ ...base, includes_unpriced: false, web_searches: 0, search_usd: 0, usd_known: 0.03, llm_usd: 0.03 })).toBe('US$ 0.03');
    expect(costLine({ ...base, llm_usd: null, usd_known: 0, web_searches: 0, search_usd: 0, includes_unpriced: true, jev_input_tokens: 0, llm_input_tokens: 0, llm_output_tokens: 0 })).toBe('nothing was bought');
  });
});
