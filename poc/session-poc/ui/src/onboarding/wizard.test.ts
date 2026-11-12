// Tests for the onboarding wizard logic. Pure functions only: no DOM, no Tauri, offline.
import { describe, expect, it } from 'vitest';

import {
  applyPortfolioLanguages,
  applyProposal,
  applyScopeNeedsChoice,
  canFinish,
  emptyDraft,
  hydrateDraft,
  profileToDraft,
  proposedLanguages,
  stepStatus,
  summaryRows,
  toUserProfile,
  STEP_LABEL_KEYS,
  withDefaultPrimary,
  type WizardDraft,
} from './wizard';
import { draftSchema, type CvProposal } from './schema';
import { MESSAGES } from '../i18n/locale';

const CV_TEXT = 'Twelve years building desktop apps with Rust and Python. Led a team of four.';

const completeDraft = (): WizardDraft => ({
  ...emptyDraft(),
  cv: CV_TEXT,
  headline: 'Desktop engineer',
  capabilities: ['Rust', 'Python'],
  seniority: 'senior',
  years_experience: 12,
  work: { contract_types: ['employee'], strength: 'mandatory' },
  location: {
    remote_modes: ['remote'],
    strength: 'mandatory',
    remote_scope: 'europe',
    remote_countries: [],
    onsite_cities: [],
    employee_countries: ['IT'],
    contractor_countries: [],
  },
  languages: {
    primary: 'en',
    items: [{ code: 'en', level: 'fluent', usage: 'comfortable' }],
  },
});

describe('step status', () => {
  it('an empty draft has every step empty, so the wizard starts with nothing invented', () => {
    expect(stepStatus(emptyDraft())).toEqual({ work: 'empty', location: 'empty', languages: 'empty' });
  });

  it('a complete draft has every step complete', () => {
    expect(stepStatus(completeDraft())).toEqual({ work: 'complete', location: 'complete', languages: 'complete' });
  });

  it('remote without a stated scope is a partial location step: remote never means worldwide by default', () => {
    const draft = completeDraft();
    draft.location.remote_scope = null;
    expect(stepStatus(draft).location).toBe('partial');
    expect(toUserProfile(draft).ok).toBe(false);
  });

  it('a countries scope needs at least one country', () => {
    const draft = completeDraft();
    draft.location.remote_scope = 'countries';
    draft.location.remote_countries = [];
    expect(stepStatus(draft).location).toBe('partial');
    draft.location.remote_countries = ['DE'];
    expect(stepStatus(draft).location).toBe('complete');
  });

  it('a language without a level or a usage keeps the languages step partial', () => {
    const draft = completeDraft();
    draft.languages.items = [{ code: 'en', level: null, usage: 'comfortable' }];
    expect(stepStatus(draft).languages).toBe('partial');
  });
});

describe('finishing the wizard', () => {
  it('cannot finish without a language', () => {
    const draft = completeDraft();
    draft.languages = { primary: null, items: [] };
    expect(canFinish(draft)).toBe(false);
  });

  it('cannot finish without a primary language, because the app needs one to navigate', () => {
    const draft = completeDraft();
    draft.languages.primary = null;
    const result = toUserProfile(draft);
    expect(!result.ok && result.issues.map((issue) => issue.key)).toContain('issue.primaryMissing');
  });

  it('the primary language must be one of the spoken languages', () => {
    const draft = completeDraft();
    draft.languages.primary = 'it';
    const result = toUserProfile(draft);
    expect(!result.ok && result.issues.map((issue) => issue.key)).toContain('issue.primaryNotSpoken');
  });

  it('a language row without its level or its usage stops the finish, and names the language', () => {
    const draft = completeDraft();
    draft.languages.items = [{ code: 'en', level: 'fluent', usage: null }];
    const result = toUserProfile(draft);
    expect(!result.ok && result.issues).toContainEqual({ key: 'issue.languageIncomplete', params: { code: 'en' } });
  });

  it('cannot finish without a contract type, because the agent requires one', () => {
    const draft = completeDraft();
    draft.work.contract_types = [];
    expect(canFinish(draft)).toBe(false);
  });

  it('a partial draft can be kept: optional fields may stay empty', () => {
    const draft = completeDraft();
    draft.headline = '';
    draft.years_experience = null;
    draft.seniority = null;
    expect(canFinish(draft)).toBe(false);
    expect(stepStatus(draft).languages).toBe('complete');
  });
});

describe('the profile the agent validates', () => {
  it('a complete draft becomes a full profile with the wizard fields in the agent key names', () => {
    const result = toUserProfile(completeDraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const profile = result.profile;
    expect(profile.headline).toBe('Desktop engineer');
    expect(profile.cv).toBe(CV_TEXT);
    expect(profile.contract_types).toEqual(['employee']);
    expect(profile.remote_modes).toEqual(['remote']);
    expect(profile.remote_scope).toBe('europe');
    expect(profile.languages).toEqual(['en']);
    expect(profile.primary_language).toBe('en');
    expect(profile.language_proficiency).toEqual({ en: { level: 'fluent', usage: 'comfortable' } });
    expect(profile.eligibility).toEqual({ employee: ['IT'], contractor: [], residence: null });
  });

  it('languages are always a hard filter, so their strength is always mandatory', () => {
    const result = toUserProfile(completeDraft());
    expect(result.ok && result.profile.strengths.languages).toBe('mandatory');
  });

  it('a draft without the CV text cannot finish, and the issue is a message key', () => {
    const draft = completeDraft();
    draft.cv = '   ';
    const result = toUserProfile(draft);
    expect(!result.ok && result.issues.map((issue) => issue.key)).toContain('issue.cv');
  });

  it('an unstated employee or contractor list stays empty, which the agent reads as no filter', () => {
    const draft = completeDraft();
    draft.location.employee_countries = [];
    const result = toUserProfile(draft);
    expect(result.ok && result.profile.eligibility.employee).toEqual([]);
  });

  it('an incomplete draft returns the issues instead of a profile', () => {
    const result = toUserProfile(emptyDraft());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.length).toBeGreaterThan(0);
  });
});

describe('primary language default', () => {
  it('without a primary language, the operating system language becomes the default and a row to complete', () => {
    const next = withDefaultPrimary(emptyDraft(), 'it');
    expect(next.languages.primary).toBe('it');
    expect(next.languages.items).toEqual([{ code: 'it', level: null, usage: null }]);
  });

  it('a primary language the user already chose is kept', () => {
    const draft = completeDraft();
    expect(withDefaultPrimary(draft, 'it').languages.primary).toBe('en');
  });
});

describe('CV and portfolio proposals', () => {
  const proposal: CvProposal = {
    source: 'model',
    reason: null,
    fields: {
      headline: 'Desktop engineer',
      capabilities: ['Rust'],
      domains: [],
      seniority: 'senior',
      years_experience: 12,
      languages: [
        { code: 'en', level: 'fluent' },
        { code: 'it', level: null },
      ],
    },
  };

  it('fills only the fields the user has not filled, and never overrides a value the user typed', () => {
    const draft = emptyDraft();
    draft.headline = 'My own headline';
    const next = applyProposal(draft, proposal);
    expect(next.headline).toBe('My own headline');
    expect(next.capabilities).toEqual(['Rust']);
    expect(next.seniority).toBe('senior');
    expect(next.years_experience).toBe(12);
  });

  it('a CV language arrives as a row with the level the CV states, and the usage is left for the user', () => {
    const next = applyProposal(emptyDraft(), proposal);
    expect(next.languages.items).toEqual([
      { code: 'en', level: 'fluent', usage: null },
      { code: 'it', level: null, usage: null },
    ]);
  });

  it('a CV language the user already has is not added twice, and the user’s level is kept', () => {
    const next = applyProposal(completeDraft(), proposal);
    expect(next.languages.items.filter((item) => item.code === 'en')).toEqual([
      { code: 'en', level: 'fluent', usage: 'comfortable' },
    ]);
  });

  it('a language row the system added without a level takes the level the CV states, and a level the user chose is kept', () => {
    const withDefault = withDefaultPrimary(emptyDraft(), 'en');
    const filledFromCv = applyProposal(withDefault, proposal);
    expect(filledFromCv.languages.items.find((item) => item.code === 'en')?.level).toBe('fluent');
    const chosen = completeDraft();
    chosen.languages.items = [{ code: 'en', level: 'basic', usage: 'limited' }];
    expect(applyProposal(chosen, proposal).languages.items[0]).toEqual({ code: 'en', level: 'basic', usage: 'limited' });
  });

  it('applying a proposal never changes the draft it was given, rows included', () => {
    const draft = withDefaultPrimary(emptyDraft(), 'en');
    const before = JSON.stringify(draft);
    applyProposal(draft, proposal);
    applyPortfolioLanguages(draft, proposal);
    expect(JSON.stringify(draft)).toBe(before);
  });

  it('a fallback proposal fills nothing', () => {
    const fallback: CvProposal = {
      source: 'fallback',
      reason: 'provider answered 401',
      fields: { headline: null, capabilities: [], domains: [], seniority: null, years_experience: null, languages: [] },
    };
    expect(applyProposal(emptyDraft(), fallback)).toEqual(emptyDraft());
  });

  it('a portfolio adds only the languages it states, and changes nothing else', () => {
    const portfolio: CvProposal = {
      source: 'model',
      reason: null,
      fields: {
        headline: 'Other',
        capabilities: ['Go'],
        domains: [],
        seniority: 'lead',
        years_experience: 3,
        languages: [{ code: 'de', level: 'basic' }],
      },
    };
    const next = applyPortfolioLanguages(completeDraft(), portfolio);
    expect(next.languages.items.map((item) => item.code)).toEqual(['en', 'de']);
    expect(next.headline).toBe('Desktop engineer');
    expect(next.capabilities).toEqual(['Rust', 'Python']);
  });

  it('the proposed languages keep their codes and levels, with no name translation', () => {
    expect(proposedLanguages(proposal)).toEqual([
      { code: 'en', level: 'fluent' },
      { code: 'it', level: null },
    ]);
  });
});

describe('editing a saved profile', () => {
  it('a saved profile becomes the same draft again, so the edit starts from what was saved', () => {
    const first = toUserProfile(completeDraft());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const back = toUserProfile(profileToDraft(first.profile));
    expect(back).toEqual(first);
  });
});

describe('apply scope', () => {
  it('a change to the profile asks which searches it applies to', () => {
    const before = toUserProfile(completeDraft());
    const changed = completeDraft();
    changed.headline = 'Lead engineer';
    const after = toUserProfile(changed);
    expect(before.ok && after.ok && applyScopeNeedsChoice(before.profile, after.profile)).toBe(true);
  });

  it('a profile with the same content in another key order is the same profile', () => {
    const first = toUserProfile(completeDraft());
    if (!first.ok) throw new Error('fixture must be complete');
    const reordered = Object.fromEntries(Object.entries(first.profile).reverse()) as typeof first.profile;
    expect(applyScopeNeedsChoice(first.profile, reordered)).toBe(false);
  });

  it('saving the same profile again asks nothing', () => {
    const first = toUserProfile(completeDraft());
    const second = toUserProfile(completeDraft());
    expect(first.ok && second.ok && applyScopeNeedsChoice(first.profile, second.profile)).toBe(false);
  });
});

describe('a saved draft read back', () => {
  it('a partial saved draft keeps the defaults of the parts it does not have', () => {
    const parsed = draftSchema.parse({ location: { remote_modes: ['onsite'] } });
    const draft = hydrateDraft(parsed);
    expect(draft.location.remote_modes).toEqual(['onsite']);
    expect(draft.location.remote_scope).toBe(null);
    expect(draft.work).toEqual({ contract_types: [], strength: 'mandatory' });
    expect(draft.languages).toEqual({ primary: null, items: [] });
  });
});

describe('summary', () => {
  it('shows an unstated field as unstated, never as a value', () => {
    const draft = completeDraft();
    draft.location.employee_countries = [];
    const row = summaryRows(draft).find((line) => line.label === 'summary.employeeCountries');
    expect(row?.value).toBe(null);
  });

  it('a stated field carries its value', () => {
    const row = summaryRows(completeDraft()).find((line) => line.label === 'summary.headline');
    expect(row?.value).toBe('Desktop engineer');
  });
});

describe('step labels', () => {
  it('every wizard step has a message in every language, so no raw key reaches the screen', () => {
    for (const key of Object.values(STEP_LABEL_KEYS)) {
      expect(MESSAGES.en[key]).toBeDefined();
      expect(MESSAGES.it[key]).toBeDefined();
    }
  });
});
