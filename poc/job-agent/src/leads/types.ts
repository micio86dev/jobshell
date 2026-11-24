/**
 * The shapes of the lead pipeline.
 *
 * A lead is a company with evidence that it may buy this person's services. Every statement the
 * pipeline makes about a company is a `Fact` with a provenance, so a guess can never be shown
 * as a verified figure. These types hold no secret and no contact detail that was not read from a
 * public page.
 */

/** What kind of evidence a signal is. */
export const SIGNAL_TYPES = [
  'job_posting',
  'freelance_request',
  'funding',
  'hiring_growth',
  'product_launch',
  'modernization',
  'leadership_vacancy',
  'contract_win',
  'expansion',
  'community_post',
  'manual_import',
] as const;
export type SignalType = (typeof SIGNAL_TYPES)[number];

/** One piece of evidence, as a source published it. */
export type Signal = {
  /** Stable for the same source and the same item, so a re-read never makes a second signal. */
  id: string;
  type: SignalType;
  /** The source that first produced it. */
  source: string;
  /** Every source that produced the same item, the first one included. */
  sources: string[];
  url: string;
  title: string;
  text: string | null;
  company_name: string | null;
  location: string | null;
  remote_hint: boolean | null;
  salary: string | null;
  published_at: string | null;
  observed_at: string;
};

/**
 * How a fact is known.
 *
 * - verified: read on an official page of the company or an official filing.
 * - reported: stated by a third party (press, directory) that names its source.
 * - estimated: a third-party estimate or a range.
 * - inferred: the model's reading of the evidence; never shown as a fact.
 */
export const PROVENANCES = ['verified', 'reported', 'estimated', 'inferred'] as const;
export type Provenance = (typeof PROVENANCES)[number];

export type Fact = {
  field: string;
  value: string;
  provenance: Provenance;
  /** Where it was read. Required for every provenance except inferred. */
  source_url: string | null;
  /** The words of the source that carry the fact. */
  quote: string | null;
};

export type ContactChannel = 'email' | 'form' | 'profile' | 'page';

/** A public business contact. It exists only with the page it was read from and the words that show it. */
export type Contact = {
  role: string;
  name: string | null;
  channel: ContactChannel;
  /** An address, a form or a profile link, exactly as the page shows it. */
  value: string;
  source_url: string;
  quote: string;
  /** True when the evidence names this person or channel for this company. */
  verified: boolean;
};

export type Company = {
  key: string;
  name: string;
  website: string | null;
  country: string | null;
  facts: Fact[];
};
