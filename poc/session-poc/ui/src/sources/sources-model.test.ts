// Tests for the sources page model: reading the rows the agent prints, checking an employer the
// user types, and the one line of status each source shows. Pure functions, no window.
import { describe, expect, it } from 'vitest';

import { parseRows, sourceStatusLine, validateEmployer } from './sources-model';

const ROW = {
  id: 'greenhouse',
  isBoard: true,
  enabled: true,
  reachable: true,
  userTenants: ['acme'],
  verifiedTenants: 16,
};

describe('parseRows', () => {
  it('reads the rows the agent prints as JSON', () => {
    const result = parseRows([ROW]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([ROW]);
  });

  it('refuses anything that is not a list of rows, and names the problem without echoing the data', () => {
    for (const raw of [null, 'x', [{ id: 42 }], [{ ...ROW, enabled: 'yes' }]]) {
      const result = parseRows(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toMatch(/yes|42/);
    }
  });
});

describe('validateEmployer', () => {
  it('accepts a plain employer slug', () => {
    expect(validateEmployer('acme')).toBeNull();
    expect(validateEmployer('beta-co')).toBeNull();
  });

  it('refuses an empty value, and a value that is a URL, a path or a key', () => {
    expect(validateEmployer('   ')).toBe('empty');
    expect(validateEmployer('https://evil.example')).toBe('invalid');
    expect(validateEmployer('a/b')).toBe('invalid');
    expect(validateEmployer('sk-live-abc')).toBe('invalid');
  });
});

describe('sourceStatusLine', () => {
  it('says why a source is not running: the policy refuses it, or the user switched it off', () => {
    expect(sourceStatusLine({ ...ROW, reachable: false })).toBe('il criterio di sicurezza non la consente');
    expect(sourceStatusLine({ ...ROW, enabled: false })).toBe('disattivata da te');
    expect(sourceStatusLine(ROW)).toBe('attiva');
  });
});
