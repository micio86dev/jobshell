// Tests for the interface language: which locale the app navigates in, and that every message
// exists in every supported language. Offline and pure.
import { describe, expect, it } from 'vitest';

import { MESSAGES, resolveLocale, translate, osLocale } from './locale';

describe('interface language', () => {
  it('the primary language is the navigation language when the app has one', () => {
    expect(resolveLocale('it', 'en-US')).toBe('it');
    expect(resolveLocale('en', 'it-IT')).toBe('en');
  });

  it('without a primary language, the operating system language decides', () => {
    expect(resolveLocale(null, 'it-IT')).toBe('it');
    expect(resolveLocale(null, 'de-DE')).toBe('en');
  });

  it('a primary language the app has no messages for falls back to the system language', () => {
    expect(resolveLocale('fr', 'it-IT')).toBe('it');
  });

  it('the operating system language is read from its region tag', () => {
    expect(osLocale('it-IT')).toBe('it');
    expect(osLocale('EN_gb')).toBe('en');
    expect(osLocale(undefined)).toBe('en');
  });

  it('every message exists in every supported language, so no key is missing in one', () => {
    expect(Object.keys(MESSAGES.it).sort()).toEqual(Object.keys(MESSAGES.en).sort());
    expect(Object.keys(MESSAGES.es).sort()).toEqual(Object.keys(MESSAGES.en).sort());
  });

  it('Spanish is a supported interface language, chosen from the system or the primary language', () => {
    expect(osLocale('es-ES')).toBe('es');
    expect(resolveLocale(null, 'es-MX')).toBe('es');
    expect(resolveLocale('es', 'en-US')).toBe('es');
    expect(translate('es', 'action.next')).toBe('Siguiente');
  });

  it('a message fills its named parameters and falls back to the key when it has none', () => {
    expect(translate('en', 'notice.draftLoadFailed', { reason: 'boom' })).toContain('boom');
    expect(translate('it', 'action.next')).toBe('Avanti');
    expect(translate('en', 'action.next')).toBe('Next');
  });
});
