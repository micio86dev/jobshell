/**
 * The outreach draft: a short message the user can edit and send themselves.
 *
 * Nothing here sends anything: the module has no address to send to and no channel to send on. The
 * draft may rest only on facts that carry evidence, and every number in it must be in the evidence
 * or be the user's own years of experience, the same guard the tailored CV follows.
 */
import { z } from 'zod';
import { askModel, type AskDeps } from '../llm-call.ts';
import type { UserProfile } from '../profile.ts';
import type { LeadStrategy } from './strategy.ts';
import type { Contact, Fact, Signal } from './types.ts';

export type Lang = 'en' | 'it' | 'es';

const LANGUAGE_NAME: Record<Lang, string> = { en: 'English', it: 'Italian', es: 'Spanish' };
const MAX_BODY = 1200;

/** English for the markets that work in it, the company's own language where it is one the user speaks. */
export const languageFor = (country: string | null, preferred: readonly Lang[]): Lang => {
  const fallback = preferred[0] ?? 'en';
  if (country === 'IT' && preferred.includes('it')) return 'it';
  if (country !== null && ['ES', 'MX', 'AR', 'CO', 'CL', 'PE'].includes(country) && preferred.includes('es')) return 'es';
  if (country !== null && ['DE', 'NL', 'CH', 'GB', 'US', 'IE', 'CA', 'AU', 'SE', 'DK', 'NO', 'FI'].includes(country)) return 'en';
  return fallback === 'en' ? 'en' : (country === null ? 'en' : fallback);
};

const draftSchema = z.object({
  subject: z.string().min(3).max(140),
  body: z.string().min(40).max(MAX_BODY),
  facts_used: z.array(z.string()).max(8),
});

export type Draft = { lang: Lang; subject: string; body: string; fact_ids: string[] };
export type DraftResult = { ok: true; draft: Draft; usage: { input_tokens: number; output_tokens: number } } | { ok: false; reason: string };

export type DraftInput = {
  company: string;
  website: string | null;
  lang: Lang;
  facts: readonly Fact[];
  signals: readonly Signal[];
  contact: Contact | null;
  need: string;
  profile: UserProfile;
  strategy: LeadStrategy;
};

const digits = (value: string): string[] => value.replace(/(\d)[,.\s](?=\d{3}\b)/g, '$1').match(/\d+/g) ?? [];

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

const usable = (facts: readonly Fact[]): Fact[] => facts.filter((fact) => fact.provenance !== 'inferred');

export const draftPrompt = (input: DraftInput): string => {
  const facts = usable(input.facts).map((fact) => `- ${fact.field}: ${fact.value} [${fact.provenance}]`).join('\n');
  const signals = input.signals.slice(0, 3).map((signal) => `- ${signal.title}`).join('\n');
  return [
    `Write a first outreach message in ${LANGUAGE_NAME[input.lang]} from a senior freelance software engineer to ${input.company}.`,
    input.contact === null ? 'The recipient is unknown: address the team.' : `The recipient is the ${input.contact.role}${input.contact.name === null ? '' : `, ${input.contact.name}`}.`,
    '',
    `The engineer: ${input.profile.years_experience} years of experience; offers ${input.strategy.offerings.slice(0, 6).join('; ')}; works remotely and with international companies.`,
    `Why this company: ${input.need === '' ? 'it shows signs of needing engineering capacity' : input.need}`,
    'What is known about it (use only these, and only the ones that matter):',
    facts === '' ? '- nothing beyond the signals below' : facts,
    'Signals:',
    signals,
    '',
    'Rules:',
    '- At most 110 words. Plain, specific, no flattery, no sales phrases, no "I hope this finds you well".',
    '- Name one concrete thing about the company and one concrete way the engineer can help with it.',
    '- State no number, date or name that is not in the facts or the signals above. Do not invent projects or clients.',
    '- Suggest one small next step, such as a short call. No links. End with the signature line [Your name].',
    '',
    'Return ONLY JSON: {"subject": string, "body": string, "facts_used": [field names from the facts you relied on]}',
  ].join('\n');
};

/** Check a draft against its evidence. Returns the reason it fails, or null when it stands. */
export const checkDraft = (draft: z.infer<typeof draftSchema>, input: DraftInput): string | null => {
  const allowed = usable(input.facts);
  const fields = new Set(allowed.map((fact) => fact.field));
  if (!draft.facts_used.every((field) => fields.has(field))) return 'it cites a fact that has no evidence';
  const evidence = [
    ...allowed.flatMap((fact) => [fact.value, fact.quote ?? '']),
    ...input.signals.flatMap((signal) => [signal.title, signal.text ?? '']),
    input.company,
    String(input.profile.years_experience),
  ].join(' ');
  const known = new Set(digits(evidence));
  const stray = digits(`${draft.subject} ${draft.body}`).find((run) => run.length >= 2 && !known.has(run));
  if (stray !== undefined) return `it states a number that is not in the evidence: ${stray}`;
  if (/https?:\/\/|www\./i.test(draft.body)) return 'it contains a link';
  if (!draft.body.includes('[Your name]')) return 'it does not end with the signature placeholder';
  return null;
};

/** Draft one message. A draft that fails its checks is refused, never repaired by hand. */
export const draftOutreach = async (input: DraftInput, deps: AskDeps): Promise<DraftResult> => {
  const asked = await askModel(draftPrompt(input), { ...deps, maxTokens: 1200 });
  if (!asked.ok) return { ok: false, reason: asked.reason };
  const parsed = draftSchema.safeParse(objectIn(asked.text));
  if (!parsed.success) return { ok: false, reason: 'the draft did not match the expected shape' };
  const problem = checkDraft(parsed.data, input);
  if (problem !== null) return { ok: false, reason: problem };
  return { ok: true, draft: { lang: input.lang, subject: parsed.data.subject, body: parsed.data.body, fact_ids: parsed.data.facts_used }, usage: asked.usage };
};
