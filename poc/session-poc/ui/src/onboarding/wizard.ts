/**
 * Pure logic of the onboarding wizard: step state, the finish rule, the mapping to the agent's
 * profile key names, the summary, and the apply-scope decision. No DOM and no Tauri here, so
 * every rule is tested offline.
 *
 * Rules that come from the spec and the agent:
 * - An unstated field stays empty; nothing is invented. Remote never means worldwide by default.
 * - At least one language is required, and the language preference must be mandatory.
 * - Employee and contractor eligibility are separate lists; an empty list means not stated.
 * - The mapped profile is still checked by the agent's validator before it is saved.
 */
import type { DraftInput, StoredProfile } from './schema';
import type {
  CvProposal,
  ContractType,
  LanguageLevel,
  LanguageUsage,
  RemoteMode,
  RemoteScope,
  Seniority,
  Strength,
} from './schema';

export type LanguageItem = { code: string; level: LanguageLevel; usage: LanguageUsage };

export type WizardDraft = {
  headline: string;
  capabilities: string[];
  seniority: Seniority | null;
  years_experience: number | null;
  work: { contract_types: ContractType[]; strength: Strength };
  location: {
    remote_modes: RemoteMode[];
    strength: Strength;
    remote_scope: RemoteScope | null;
    remote_countries: string[];
    onsite_cities: string[];
    employee_countries: string[];
    contractor_countries: string[];
    residence?: string | null;
  };
  languages: { items: LanguageItem[]; strength: Strength };
};

export type StepState = 'empty' | 'partial' | 'complete';
export type StepStatus = { work: StepState; location: StepState; languages: StepState };

/** The profile in the agent's own key names: what the validator reads. */
export type ProfilePayload = {
  headline: string;
  capabilities: string[];
  domains: string[];
  seniority: Seniority;
  years_experience: number;
  remote_modes: RemoteMode[];
  onsite_cities: string[];
  countries: string[];
  contract_types: ContractType[];
  languages: string[];
  min_salary: null;
  timezone_overlap_hours: null;
  exclude_companies: string[];
  exclude_terms: string[];
  accepted_gaps: string[];
  cv: string;
  portfolio: null;
  threshold: number;
  daily_cap: number;
  scoring_budget: number;
  strengths: Record<string, Strength>;
  language_proficiency: Record<string, { level: LanguageLevel; usage: LanguageUsage }>;
  eligibility: { employee: string[]; contractor: string[]; residence: string | null };
  remote_scope: RemoteScope | null;
};

/**
 * The agent's example defaults for the fields the wizard does not ask about
 * (poc/job-agent/profile.example.json). They are not user preferences.
 */
const AGENT_DEFAULTS = { threshold: 0.9, daily_cap: 2, scoring_budget: 120 } as const;

export const emptyDraft = (): WizardDraft => ({
  headline: '',
  capabilities: [],
  seniority: null,
  years_experience: null,
  work: { contract_types: [], strength: 'mandatory' },
  location: {
    remote_modes: [],
    strength: 'mandatory',
    remote_scope: null,
    remote_countries: [],
    onsite_cities: [],
    employee_countries: [],
    contractor_countries: [],
    residence: null,
  },
  languages: { items: [], strength: 'mandatory' },
});

const filled = (text: string): boolean => text.trim().length > 0;

const profileIssues = (draft: WizardDraft): string[] => {
  const issues: string[] = [];
  if (!filled(draft.headline)) issues.push('Write a headline.');
  if (draft.capabilities.length === 0) issues.push('Add at least one capability.');
  if (draft.seniority === null) issues.push('Choose the seniority.');
  if (draft.years_experience === null) issues.push('Enter the years of experience.');
  return issues;
};

const workIssues = (draft: WizardDraft): string[] =>
  draft.work.contract_types.length === 0 ? ['Choose at least one contract type.'] : [];

const locationIssues = (draft: WizardDraft): string[] => {
  const location = draft.location;
  if (!location.remote_modes.includes('remote')) return [];
  const issues: string[] = [];
  if (location.remote_scope === null) issues.push('Choose the remote scope: it is never worldwide by default.');
  if (location.remote_scope === 'countries' && location.remote_countries.length === 0) {
    issues.push('Enter at least one country for remote work.');
  }
  if (location.remote_scope === 'residence' && !location.residence) {
    issues.push('Enter the country of residence for remote work.');
  }
  return issues;
};

const languageIssues = (draft: WizardDraft): string[] => {
  const issues: string[] = [];
  if (draft.languages.items.length === 0) issues.push('Add at least one language.');
  if (draft.languages.strength !== 'mandatory') issues.push('Languages must be mandatory.');
  return issues;
};

const hasLocationInput = (draft: WizardDraft): boolean => {
  const l = draft.location;
  return (
    l.remote_modes.length > 0 ||
    l.onsite_cities.length > 0 ||
    l.employee_countries.length > 0 ||
    l.contractor_countries.length > 0 ||
    l.remote_scope !== null ||
    Boolean(l.residence)
  );
};

/** Each step is empty, partial (started but not valid yet), or complete. */
export const stepStatus = (draft: WizardDraft): StepStatus => {
  const workStarted =
    filled(draft.headline) || draft.capabilities.length > 0 || draft.seniority !== null || draft.years_experience !== null || draft.work.contract_types.length > 0;
  const work: StepState =
    !workStarted ? 'empty' : profileIssues(draft).length === 0 && workIssues(draft).length === 0 ? 'complete' : 'partial';

  const location: StepState = !hasLocationInput(draft)
    ? 'empty'
    : locationIssues(draft).length === 0
      ? 'complete'
      : 'partial';

  const languages: StepState =
    draft.languages.items.length === 0
      ? 'empty'
      : draft.languages.strength === 'mandatory'
        ? 'complete'
        : 'partial';

  return { work, location, languages };
};

/** Every issue that stops the profile from being saved. Empty when the profile can be built. */
const allIssues = (draft: WizardDraft): string[] => [
  ...profileIssues(draft),
  ...workIssues(draft),
  ...locationIssues(draft),
  ...languageIssues(draft),
];

/** The rule the finish button follows: every required field is present and valid. */
export const canFinish = (draft: WizardDraft): boolean => allIssues(draft).length === 0;

export type ProfileResult = { ok: true; profile: ProfilePayload } | { ok: false; issues: string[] };

/** Map the draft to the agent's profile. Refused with the issues when the draft is incomplete. */
export const toUserProfile = (draft: WizardDraft): ProfileResult => {
  const issues = allIssues(draft);
  if (issues.length > 0 || draft.seniority === null || draft.years_experience === null) {
    return { ok: false, issues };
  }
  const location = draft.location;
  const remote = location.remote_modes.includes('remote');
  const scope = remote ? location.remote_scope : null;

  return {
    ok: true,
    profile: {
      headline: draft.headline.trim(),
      capabilities: draft.capabilities,
      domains: [],
      seniority: draft.seniority,
      years_experience: draft.years_experience,
      remote_modes: location.remote_modes,
      onsite_cities: location.onsite_cities,
      countries: scope === 'countries' ? location.remote_countries.map((code) => code.toUpperCase()) : [],
      contract_types: draft.work.contract_types,
      languages: draft.languages.items.map((item) => item.code),
      min_salary: null,
      timezone_overlap_hours: null,
      exclude_companies: [],
      exclude_terms: [],
      accepted_gaps: [],
      cv: '',
      portfolio: null,
      ...AGENT_DEFAULTS,
      strengths: {
        languages: draft.languages.strength,
        remote_modes: location.strength,
        onsite_cities: location.strength,
        countries: location.strength,
        contract_types: draft.work.strength,
        min_salary: 'mandatory',
      },
      language_proficiency: Object.fromEntries(
        draft.languages.items.map((item) => [item.code, { level: item.level, usage: item.usage }]),
      ),
      eligibility: {
        employee: location.employee_countries,
        contractor: location.contractor_countries,
        residence: location.residence ?? null,
      },
      remote_scope: scope,
    },
  };
};

/** A change to the profile asks which searches it applies to. The same profile asks nothing. */
export const applyScopeNeedsChoice = (before: ProfilePayload, after: ProfilePayload): boolean =>
  JSON.stringify(before) !== JSON.stringify(after);

export type SummaryLine = { label: string; value: string };

const NOT_STATED = 'Not stated';
const listOrNotStated = (values: string[]): string => (values.length > 0 ? values.join(', ') : NOT_STATED);

const CONTRACT_LABELS: Record<ContractType, string> = { employee: 'employee', freelance: 'freelance' };
const STRENGTH_LABELS: Record<Strength, string> = {
  mandatory: 'mandatory',
  preferred: 'preferred',
  acceptable: 'acceptable',
};

/** The profile as the user reads it back: one line per field, unstated shown as such. */
export const summaryLines = (draft: WizardDraft): SummaryLine[] => [
  { label: 'Headline', value: filled(draft.headline) ? draft.headline.trim() : NOT_STATED },
  { label: 'Capabilities', value: listOrNotStated(draft.capabilities) },
  { label: 'Seniority', value: draft.seniority ?? NOT_STATED },
  {
    label: 'Contract',
    value:
      draft.work.contract_types.length > 0
        ? `${draft.work.contract_types.map((type) => CONTRACT_LABELS[type]).join(', ')} (${STRENGTH_LABELS[draft.work.strength]})`
        : NOT_STATED,
  },
  { label: 'Work modes', value: listOrNotStated(draft.location.remote_modes) },
  { label: 'Remote scope', value: draft.location.remote_scope ?? NOT_STATED },
  { label: 'Remote countries', value: listOrNotStated(draft.location.remote_countries) },
  { label: 'Onsite cities', value: listOrNotStated(draft.location.onsite_cities) },
  { label: 'Employee countries', value: listOrNotStated(draft.location.employee_countries) },
  { label: 'Freelance countries', value: listOrNotStated(draft.location.contractor_countries) },
  {
    label: 'Languages',
    value:
      draft.languages.items.length > 0
        ? draft.languages.items.map((item) => `${item.code} (${item.level}, ${item.usage})`).join(', ')
        : NOT_STATED,
  },
];

/** Language names a CV may state, as the ISO 639-1 codes the agent uses. Unknown names are ignored. */
// A Map, not an object: an object would also answer for inherited names such as "constructor".
const LANGUAGE_CODES = new Map<string, string>([
  ['english', 'en'],
  ['italian', 'it'],
  ['italiano', 'it'],
  ['spanish', 'es'],
  ['french', 'fr'],
  ['german', 'de'],
  ['portuguese', 'pt'],
]);

/** The languages a CV names that the wizard knows. They are suggestions, added with a level in step 3. */
export const proposedLanguageCodes = (proposal: CvProposal): string[] => {
  const codes: string[] = [];
  for (const name of proposal.fields.languages) {
    const code = LANGUAGE_CODES.get(name.trim().toLowerCase());
    if (code !== undefined && !codes.includes(code)) codes.push(code);
  }
  return codes;
};

/**
 * Fill the draft from a CV proposal, field by field, and only where the user has not typed a
 * value. A fallback proposal fills nothing. The input draft is not changed.
 */
export const applyProposal = (draft: WizardDraft, proposal: CvProposal): WizardDraft => {
  if (proposal.source !== 'model') return { ...draft };
  const fields = proposal.fields;
  return {
    ...draft,
    headline: filled(draft.headline) ? draft.headline : (fields.headline ?? ''),
    capabilities: draft.capabilities.length > 0 ? draft.capabilities : fields.capabilities,
    seniority: draft.seniority ?? fields.seniority,
    years_experience: draft.years_experience ?? fields.years_experience,
  };
};

/**
 * The draft a saved profile came from. Editing starts from what was saved, so nothing is lost
 * or invented on the way back.
 */
export const profileToDraft = (profile: StoredProfile): WizardDraft => ({
  headline: profile.headline,
  capabilities: profile.capabilities,
  seniority: profile.seniority,
  years_experience: profile.years_experience,
  work: {
    contract_types: profile.contract_types,
    strength: profile.strengths.contract_types ?? 'mandatory',
  },
  location: {
    remote_modes: profile.remote_modes,
    strength: profile.strengths.remote_modes ?? 'mandatory',
    remote_scope: profile.remote_scope,
    remote_countries: profile.remote_scope === 'countries' ? profile.countries : [],
    onsite_cities: profile.onsite_cities,
    employee_countries: profile.eligibility.employee,
    contractor_countries: profile.eligibility.contractor,
    residence: profile.eligibility.residence,
  },
  languages: {
    items: profile.languages.flatMap((code) => {
      const proficiency = profile.language_proficiency[code];
      return proficiency ? [{ code, level: proficiency.level, usage: proficiency.usage }] : [];
    }),
    strength: profile.strengths.languages ?? 'mandatory',
  },
});

/**
 * A draft read back from storage (already parsed by the zod boundary) with the defaults filled
 * in for every part it does not have. Nothing a part omits is invented.
 */
export const hydrateDraft = (input: DraftInput): WizardDraft => {
  const base = emptyDraft();
  return {
    headline: input.headline ?? base.headline,
    capabilities: input.capabilities ?? base.capabilities,
    seniority: input.seniority ?? base.seniority,
    years_experience: input.years_experience ?? base.years_experience,
    work: {
      contract_types: input.work?.contract_types ?? base.work.contract_types,
      strength: input.work?.strength ?? base.work.strength,
    },
    location: {
      remote_modes: input.location?.remote_modes ?? base.location.remote_modes,
      strength: input.location?.strength ?? base.location.strength,
      remote_scope: input.location?.remote_scope ?? base.location.remote_scope,
      remote_countries: input.location?.remote_countries ?? base.location.remote_countries,
      onsite_cities: input.location?.onsite_cities ?? base.location.onsite_cities,
      employee_countries: input.location?.employee_countries ?? base.location.employee_countries,
      contractor_countries: input.location?.contractor_countries ?? base.location.contractor_countries,
      residence: input.location?.residence ?? null,
    },
    languages: {
      items: (input.languages?.items ?? []).map((item) => ({ ...item })),
      strength: input.languages?.strength ?? base.languages.strength,
    },
  };
};
