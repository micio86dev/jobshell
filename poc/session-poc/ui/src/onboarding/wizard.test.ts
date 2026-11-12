// Tests for the onboarding wizard logic. Pure functions only: no DOM, no Tauri, offline.
import { describe, expect, it } from 'vitest';

import {
  applyProposal,
  applyScopeNeedsChoice,
  canFinish,
  emptyDraft,
  hydrateDraft,
  profileToDraft,
  proposedLanguageCodes,
  stepStatus,
  summaryLines,
  toUserProfile,
  type WizardDraft,
} from './wizard';
import { draftSchema, type CvProposal } from './schema';

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
    items: [{ code: 'en', level: 'fluent', usage: 'comfortable' }],
    strength: 'mandatory',
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
});

describe('finishing the wizard', () => {
  it('cannot finish without a language, because one mandatory language is required', () => {
    const draft = completeDraft();
    draft.languages.items = [];
    expect(canFinish(draft)).toBe(false);
  });

  it('cannot finish when the language preference is not mandatory', () => {
    const draft = completeDraft();
    draft.languages.strength = 'preferred';
    expect(canFinish(draft)).toBe(false);
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
    expect(profile.contract_types).toEqual(['employee']);
    expect(profile.remote_modes).toEqual(['remote']);
    expect(profile.remote_scope).toBe('europe');
    expect(profile.languages).toEqual(['en']);
    expect(profile.language_proficiency).toEqual({ en: { level: 'fluent', usage: 'comfortable' } });
    expect(profile.eligibility).toEqual({ employee: ['IT'], contractor: [], residence: null });
    expect(profile.strengths.languages).toBe('mandatory');
  });

  it('the CV text is carried into the profile unchanged, because the agent needs it to score postings', () => {
    const result = toUserProfile(completeDraft());
    expect(result.ok && result.profile.cv).toBe(CV_TEXT);
  });

  it('a draft without the CV text cannot finish, because the agent refuses a profile without it', () => {
    const draft = completeDraft();
    draft.cv = '   ';
    const result = toUserProfile(draft);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.issues.some((issue) => issue.includes('CV'))).toBe(true);
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

  it('a country that is not a two-letter code is refused at the draft boundary', () => {
    expect(draftSchema.safeParse({ location: { employee_countries: ['Italy'] } }).success).toBe(false);
    expect(draftSchema.safeParse({ location: { remote_countries: ['it'] } }).success).toBe(false);
  });

  it('saving the same profile again asks nothing', () => {
    const first = toUserProfile(completeDraft());
    const second = toUserProfile(completeDraft());
    expect(first.ok && second.ok && applyScopeNeedsChoice(first.profile, second.profile)).toBe(false);
  });
});

describe('summary', () => {
  it('shows an unstated field as not stated, never as a value', () => {
    const draft = completeDraft();
    draft.location.employee_countries = [];
    const lines = summaryLines(draft);
    expect(lines.find((line) => line.label === 'Employee countries')?.value).toBe('Not stated');
  });
});

describe('CV proposal', () => {
  const proposal: CvProposal = {
    source: 'model',
    reason: null,
    fields: {
      headline: 'Desktop engineer',
      capabilities: ['Rust'],
      domains: [],
      seniority: 'senior',
      years_experience: 12,
      languages: ['English', 'Klingon'],
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

  it('does not change the draft it was given', () => {
    const draft = emptyDraft();
    applyProposal(draft, proposal);
    expect(draft.headline).toBe('');
  });

  it('reads the languages the CV names as codes, and ignores a name it does not know', () => {
    expect(proposedLanguageCodes(proposal)).toEqual(['en']);
  });

  it('a language name that is an object property name is not a language', () => {
    const tricky: CvProposal = {
      ...proposal,
      fields: { ...proposal.fields, languages: ['constructor', '__proto__', 'toString'] },
    };
    expect(proposedLanguageCodes(tricky)).toEqual([]);
  });

  it('a fallback proposal fills nothing', () => {
    const fallback: CvProposal = {
      source: 'fallback',
      reason: 'provider answered 401',
      fields: { headline: null, capabilities: [], domains: [], seniority: null, years_experience: null, languages: [] },
    };
    expect(applyProposal(emptyDraft(), fallback)).toEqual(emptyDraft());
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

describe('a saved draft read back', () => {
  it('a partial saved draft keeps the defaults of the parts it does not have', () => {
    const parsed = draftSchema.parse({ location: { remote_modes: ['onsite'] } });
    const draft = hydrateDraft(parsed);
    expect(draft.location.remote_modes).toEqual(['onsite']);
    expect(draft.location.remote_scope).toBe(null);
    expect(draft.work).toEqual({ contract_types: [], strength: 'mandatory' });
    expect(draft.languages).toEqual({ items: [], strength: 'mandatory' });
  });
});
