import { describe, expect, it } from 'vitest';
import { describeKeyCheck, type KeyCheckReport } from './key-check';

const report = (overrides: Partial<KeyCheckReport>): KeyCheckReport => ({
  account: 'typesafe',
  outcome: 'valid',
  status: null,
  detail: '',
  ...overrides,
});

describe('describeKeyCheck', () => {
  it('says a valid key is valid, in the ok tone', () => {
    expect(describeKeyCheck(report({ outcome: 'valid' }))).toEqual({
      tone: 'ok',
      text: 'chiave valida',
    });
  });

  it('says a rejected key is wrong or expired, and names the status', () => {
    const result = describeKeyCheck(report({ outcome: 'rejected', status: 401 }));
    expect(result.tone).toBe('bad');
    expect(result.text).toContain('401');
    expect(result.text).toContain('scaduta');
  });

  it('says a key could not be verified, without calling it wrong', () => {
    const result = describeKeyCheck(report({ outcome: 'unverified', detail: 'HTTP 500' }));
    expect(result.tone).toBe('unknown');
    expect(result.text).toContain('HTTP 500');
    expect(result.text).toContain('non verificata');
  });

  it('says when no key is stored, and points to the field to fill', () => {
    expect(describeKeyCheck(report({ outcome: 'missing' }))).toEqual({
      tone: 'unknown',
      text: 'nessuna chiave salvata',
    });
  });
});
