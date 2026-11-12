/**
 * Pure logic of the onboarding wizard: step state, the finish rule, the mapping to the agent's
 * profile key names, the proposals from a CV or portfolio, the summary, and the apply-scope
 * decision. No DOM and no Tauri here, so every rule is tested offline.
 *
 * Rules that come from the spec, the user and the agent:
 * - An unstated field stays empty; nothing is invented. Remote never means worldwide by default.
 * - Languages are a hard filter: the search is only in the languages the user speaks, at the level
 *   given. Each language row needs its level and its usage, chosen by the user.
 * - One language is primary: it is the language the app navigates in, and it must be spoken.
 * - Employee and contractor eligibility are separate lists; an empty list means not stated.
 * - The mapped profile is still checked by the agent's validator before it is saved.
 *
 * Issues and summary labels are message keys, so the interface shows them in its own language.
 */
import type { MessageKey } from '../i18n/locale';
import type {
  CvProposal,
  ContractType,
  DraftInput,
  LanguageLevel,
  LanguageUsage,
  RemoteMode,
  RemoteScope,
  Seniority,
  StoredProfile,
  Strength,
} from './schema';

export type LanguageItem = { code: string; level: LanguageLevel | null; usage: LanguageUsage | null };

export type WizardDraft = {
  /** The CV text. The agent needs it to score postings, so a profile cannot be saved without it. */
  cv: string;
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
  languages: { primary: string | null; items: LanguageItem[] };
};

/** The message of each wizard step's label. The location step is labelled "Where" in the interface. */
export const STEP_LABEL_KEYS = {
  cv: 'step.cv',
  work: 'step.work',
  location: 'step.where',
  languages: 'step.languages',
  summary: 'step.summary',
} as const satisfies Record<string, MessageKey>;

export type StepState = 'empty' | 'partial' | 'complete';
export type StepStatus = { work: StepState; location: StepState; languages: StepState };

/** A problem that stops the finish: a message key, with the values its message needs. */
export type Issue = { key: MessageKey; params?: Record<string, string> };

/** The profile in the agent's own key names: what the validator reads. */
export type ProfilePayload = {
  cv: string;
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
  primary_language: string;
  min_salary: null;
  timezone_overlap_hours: null;
  exclude_companies: string[];
  exclude_terms: string[];
  accepted_gaps: string[];
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
  cv: '',
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
  languages: { primary: null, items: [] },
});

const filled = (text: string): boolean => text.trim().length > 0;

const profileIssues = (draft: WizardDraft): Issue[] => {
  const issues: Issue[] = [];
  if (!filled(draft.cv)) issues.push({ key: 'issue.cv' });
  if (!filled(draft.headline)) issues.push({ key: 'issue.headline' });
  if (draft.capabilities.length === 0) issues.push({ key: 'issue.capabilities' });
  if (draft.seniority === null) issues.push({ key: 'issue.seniority' });
  if (draft.years_experience === null) issues.push({ key: 'issue.years' });
  return issues;
};

const workIssues = (draft: WizardDraft): Issue[] =>
  draft.work.contract_types.length === 0 ? [{ key: 'issue.contract' }] : [];

const locationIssues = (draft: WizardDraft): Issue[] => {
  const location = draft.location;
  if (!location.remote_modes.includes('remote')) return [];
  const issues: Issue[] = [];
  if (location.remote_scope === null) issues.push({ key: 'issue.remoteScope' });
  if (location.remote_scope === 'countries' && location.remote_countries.length === 0) {
    issues.push({ key: 'issue.remoteCountries' });
  }
  if (location.remote_scope === 'residence' && !location.residence) issues.push({ key: 'issue.residence' });
  return issues;
};

const languageRowIssues = (draft: WizardDraft): Issue[] =>
  draft.languages.items
    .filter((item) => item.level === null || item.usage === null)
    .map((item) => ({ key: 'issue.languageIncomplete' as const, params: { code: item.code } }));

const primaryIssues = (draft: WizardDraft): Issue[] => {
  const primary = draft.languages.primary;
  if (primary === null) return [{ key: 'issue.primaryMissing' }];
  if (!draft.languages.items.some((item) => item.code === primary)) return [{ key: 'issue.primaryNotSpoken' }];
  return [];
};

const languageIssues = (draft: WizardDraft): Issue[] => {
  if (draft.languages.items.length === 0) return [{ key: 'issue.languageNone' }];
  return [...languageRowIssues(draft), ...primaryIssues(draft)];
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
    filled(draft.headline) ||
    draft.capabilities.length > 0 ||
    draft.seniority !== null ||
    draft.years_experience !== null ||
    draft.work.contract_types.length > 0;
  const work: StepState = !workStarted
    ? 'empty'
    : profileIssues(draft).length === 0 && workIssues(draft).length === 0
      ? 'complete'
      : 'partial';

  const location: StepState = !hasLocationInput(draft)
    ? 'empty'
    : locationIssues(draft).length === 0
      ? 'complete'
      : 'partial';

  const languages: StepState =
    draft.languages.items.length === 0 && draft.languages.primary === null
      ? 'empty'
      : languageIssues(draft).length === 0
        ? 'complete'
        : 'partial';

  return { work, location, languages };
};

/** The rule the finish button follows: every required field is present and valid. */
export const canFinish = (draft: WizardDraft): boolean => toUserProfile(draft).ok;

export type ProfileResult = { ok: true; profile: ProfilePayload } | { ok: false; issues: Issue[] };

/** Map the draft to the agent's profile. Refused with the issues when the draft is incomplete. */
export const toUserProfile = (draft: WizardDraft): ProfileResult => {
  const issues = [
    ...profileIssues(draft),
    ...workIssues(draft),
    ...locationIssues(draft),
    ...languageIssues(draft),
  ];
  if (issues.length > 0 || draft.seniority === null || draft.years_experience === null) {
    return { ok: false, issues };
  }
  const location = draft.location;
  const remote = location.remote_modes.includes('remote');
  const scope = remote ? location.remote_scope : null;
  const primary = draft.languages.primary ?? '';

  return {
    ok: true,
    profile: {
      cv: draft.cv,
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
      primary_language: primary,
      min_salary: null,
      timezone_overlap_hours: null,
      exclude_companies: [],
      exclude_terms: [],
      accepted_gaps: [],
      portfolio: null,
      ...AGENT_DEFAULTS,
      // Languages are always a hard filter, so their strength is always mandatory.
      strengths: {
        languages: 'mandatory',
        remote_modes: location.strength,
        onsite_cities: location.strength,
        countries: location.strength,
        contract_types: draft.work.strength,
        min_salary: 'mandatory',
      },
      language_proficiency: Object.fromEntries(
        draft.languages.items.flatMap((item) =>
          item.level !== null && item.usage !== null ? [[item.code, { level: item.level, usage: item.usage }]] : [],
        ),
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

/**
 * The operating system language becomes the primary language when none is chosen yet, and it is
 * added as a row to complete. A primary language already chosen is kept.
 */
export const withDefaultPrimary = (draft: WizardDraft, systemCode: string): WizardDraft => {
  if (draft.languages.primary !== null) return { ...draft, languages: { ...draft.languages } };
  const items = draft.languages.items.some((item) => item.code === systemCode)
    ? draft.languages.items
    : [...draft.languages.items, { code: systemCode, level: null, usage: null }];
  return { ...draft, languages: { primary: systemCode, items } };
};

/** Add the proposed languages the draft does not have yet, and fill a missing level. Values the user chose are kept. */
const withLanguages = (draft: WizardDraft, proposed: Array<{ code: string; level: LanguageLevel | null }>): WizardDraft => {
  // Every row is copied, so the draft that came in is never changed.
  let items = draft.languages.items.map((item) => ({ ...item }));
  for (const language of proposed) {
    const existing = items.find((item) => item.code === language.code);
    if (existing === undefined) {
      items = [...items, { code: language.code, level: language.level, usage: null }];
    } else if (existing.level === null) {
      // A row without a level takes the one the document states; a level the user chose is kept.
      items = items.map((item) => (item.code === language.code ? { ...item, level: language.level } : item));
    }
  }
  return { ...draft, languages: { primary: draft.languages.primary, items } };
};

/** The languages a CV or portfolio states, as codes and levels. */
export const proposedLanguages = (proposal: CvProposal): Array<{ code: string; level: LanguageLevel | null }> =>
  proposal.fields.languages.map((language) => ({ code: language.code, level: language.level }));

/**
 * Fill the draft from a CV proposal, field by field, and only where the user has not typed a
 * value. A language the CV states is added as a row; its usage is the user's to choose. A
 * fallback proposal fills nothing. The input draft is not changed.
 */
export const applyProposal = (draft: WizardDraft, proposal: CvProposal): WizardDraft => {
  if (proposal.source !== 'model') return { ...draft, languages: { ...draft.languages } };
  const fields = proposal.fields;
  const filledFields: WizardDraft = {
    ...draft,
    headline: filled(draft.headline) ? draft.headline : (fields.headline ?? ''),
    capabilities: draft.capabilities.length > 0 ? draft.capabilities : fields.capabilities,
    seniority: draft.seniority ?? fields.seniority,
    years_experience: draft.years_experience ?? fields.years_experience,
  };
  return withLanguages(filledFields, proposedLanguages(proposal));
};

/** A portfolio adds only the languages it states. Every other field is left as it is. */
export const applyPortfolioLanguages = (draft: WizardDraft, proposal: CvProposal): WizardDraft => {
  if (proposal.source !== 'model') return { ...draft, languages: { ...draft.languages } };
  return withLanguages(draft, proposedLanguages(proposal));
};

/**
 * The draft a saved profile came from. Editing starts from what was saved, so nothing is lost
 * or invented on the way back.
 */
export const profileToDraft = (profile: StoredProfile): WizardDraft => ({
  cv: profile.cv,
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
    primary: profile.primary_language,
    items: profile.languages.map((code) => {
      const proficiency = profile.language_proficiency[code];
      return {
        code,
        level: proficiency?.level ?? null,
        usage: proficiency?.usage ?? null,
      };
    }),
  },
});

/** A draft read back from storage (already parsed by the zod boundary) with defaults for every part it does not have. */
export const hydrateDraft = (input: DraftInput): WizardDraft => {
  const base = emptyDraft();
  return {
    cv: input.cv ?? base.cv,
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
      primary: input.languages?.primary ?? null,
      items: (input.languages?.items ?? []).map((item) => ({
        code: item.code,
        level: item.level,
        usage: item.usage,
      })),
    },
  };
};

/** A change to the profile asks which searches it applies to. The same profile asks nothing. */
export const applyScopeNeedsChoice = (before: ProfilePayload, after: ProfilePayload): boolean =>
  canonical(before) !== canonical(after);

/** A key-order-independent text of a value, so two equal profiles compare equal. */
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};

/**
 * One line of the summary. `value` is plain text, or null when the field is not stated. `codes`
 * are enumerated values the interface translates, named by `kind`.
 */
export type SummaryRow = {
  label: MessageKey;
  value: string | null;
  codes?: string[];
  kind?: 'contract' | 'mode' | 'scope' | 'lang' | 'characters';
};

const joined = (values: string[]): string | null => (values.length > 0 ? values.join(', ') : null);

/** The profile as the user reads it back. Languages are rendered by the interface, with their levels. */
export const summaryRows = (draft: WizardDraft): SummaryRow[] => [
  { label: 'summary.headline', value: filled(draft.headline) ? draft.headline.trim() : null },
  { label: 'summary.capabilities', value: joined(draft.capabilities) },
  { label: 'summary.seniority', value: draft.seniority },
  {
    label: 'summary.contract',
    value: null,
    codes: draft.work.contract_types,
    kind: 'contract',
  },
  { label: 'summary.workModes', value: null, codes: draft.location.remote_modes, kind: 'mode' },
  {
    label: 'summary.remoteScope',
    value: null,
    codes: draft.location.remote_scope === null ? [] : [draft.location.remote_scope],
    kind: 'scope',
  },
  { label: 'summary.remoteCountries', value: joined(draft.location.remote_countries) },
  { label: 'summary.onsiteCities', value: joined(draft.location.onsite_cities) },
  { label: 'summary.employeeCountries', value: joined(draft.location.employee_countries) },
  { label: 'summary.contractorCountries', value: joined(draft.location.contractor_countries) },
  {
    label: 'summary.primary',
    value: null,
    codes: draft.languages.primary === null ? [] : [draft.languages.primary],
    kind: 'lang',
  },
  {
    label: 'summary.cv',
    value: filled(draft.cv) ? String(draft.cv.trim().length) : null,
    kind: 'characters',
  },
];
