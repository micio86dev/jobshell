import { describe, expect, it } from 'vitest';
import { emptyDraft, toUserProfile, type WizardDraft } from './wizard';
import { isPortfolioLink, parseCheckResult } from './portfolio-link';

describe('isPortfolioLink', () => {
  it('accepts a public https address and refuses the rest', () => {
    expect(isPortfolioLink('https://example.com/me')).toBe(true);
    expect(isPortfolioLink('http://example.com/me')).toBe(false);
    expect(isPortfolioLink('https://user:pw@example.com/')).toBe(false);
    expect(isPortfolioLink('https://localhost/me')).toBe(false);
    expect(isPortfolioLink('https://192.168.1.10/me')).toBe(false);
    expect(isPortfolioLink('not a link')).toBe(false);
  });
});

describe('parseCheckResult', () => {
  it('reads the agent verdict and refuses anything else', () => {
    expect(parseCheckResult('{"reachable":true,"status":200,"text":"English"}')).toEqual({ reachable: true, status: 200, text: 'English' });
    expect(parseCheckResult('{"reachable":"yes"}')).toBeNull();
    expect(parseCheckResult('not json')).toBeNull();
  });
});

const completeDraftWith = (portfolio: string): WizardDraft => ({
  ...emptyDraft(),
  cv: 'Twelve years of Rust and Python.',
  portfolio,
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
  languages: { primary: 'en', items: [{ code: 'en', level: 'fluent', usage: 'comfortable' }] },
});

describe('the portfolio link in the profile', () => {
  it('is kept in the saved profile, and an empty link is no portfolio', () => {
    const withLink = toUserProfile(completeDraftWith('https://example.test/p'));
    expect(withLink.ok && withLink.profile.portfolio).toBe('https://example.test/p');
    const without = toUserProfile(completeDraftWith(''));
    expect(without.ok && without.profile.portfolio).toBe(null);
  });
});
