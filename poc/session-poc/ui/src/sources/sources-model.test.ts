// Tests for the sources page model: reading the rows the agent prints, grouping and naming each
// source, the summary line, the employer check and the status line. Pure functions, no window.
import { describe, expect, it } from 'vitest';

import {
  displayName,
  employerMessage,
  filterRows,
  groupOf,
  parseRows,
  sourceStatusLine,
  summarize,
  validateEmployer,
  type SourceRow,
} from './sources-model';

const ROW: SourceRow = {
  id: 'greenhouse',
  isBoard: true,
  enabled: true,
  reachable: true,
  automation: 'allowed',
  userTenants: ['acme'],
  verifiedTenants: 16,
};

const row = (patch: Partial<SourceRow>): SourceRow => ({ ...ROW, ...patch });

describe('parseRows', () => {
  it('reads the rows the agent prints as JSON', () => {
    const result = parseRows([ROW]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([ROW]);
  });

  it('refuses anything that is not a list of rows, and names the problem without echoing the data', () => {
    for (const raw of [null, 'x', [{ id: 42 }], [{ ...ROW, enabled: 'yes' }], [{ ...ROW, automation: 'maybe' }]]) {
      const result = parseRows(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).not.toMatch(/yes|42|maybe/);
    }
  });
});

describe('displayName', () => {
  it('shows the name a person knows the source by, and falls back to the id for an unknown one', () => {
    expect(displayName('weworkremotely')).toBe('We Work Remotely');
    expect(displayName('iprogrammatori')).toBe('IProgrammatori');
    expect(displayName('hn')).toBe('Hacker News');
    expect(displayName('something-new')).toBe('something-new');
  });
});

describe('groupOf', () => {
  it('puts each source in the group the user reasons about: companies, public feeds, account, extension, blocked', () => {
    expect(groupOf(row({ isBoard: true }))).toBe('companies');
    expect(groupOf(row({ id: 'remoteok', isBoard: false, automation: 'allowed' }))).toBe('feeds');
    expect(groupOf(row({ id: 'ziprecruiter', isBoard: false, automation: 'allowed' }))).toBe('account');
    expect(groupOf(row({ id: 'linkedin', isBoard: false, automation: 'measurement_only' }))).toBe('extension');
    expect(groupOf(row({ id: 'ashby', isBoard: true, automation: 'prohibited', reachable: false }))).toBe('blocked');
  });
});

describe('sourceStatusLine', () => {
  it('says what is true for each mode, in plain words', () => {
    expect(sourceStatusLine(ROW)).toBe('attiva');
    expect(sourceStatusLine(row({ enabled: false }))).toBe('disattivata da te');
    expect(sourceStatusLine(row({ id: 'linkedin', automation: 'measurement_only', reachable: false }))).toBe(
      'si usa solo dall\'estensione del browser, con un tuo clic',
    );
    expect(sourceStatusLine(row({ id: 'ashby', automation: 'prohibited', reachable: false }))).toBe(
      'non consentita: nessun accesso verificabile',
    );
  });
});

describe('summarize', () => {
  it('counts the sources that run, the ones you switched off, the extension-only ones and the blocked ones', () => {
    const rows = [
      ROW,
      row({ id: 'remoteok', isBoard: false, enabled: false }),
      row({ id: 'linkedin', automation: 'measurement_only', reachable: false }),
      row({ id: 'ashby', automation: 'prohibited', reachable: false }),
    ];
    expect(summarize(rows)).toEqual({ active: 1, off: 1, extension: 1, blocked: 1 });
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

describe('filterRows', () => {
  it('matches the name the person sees or the id, ignoring case and surrounding spaces', () => {
    const rows = [ROW, row({ id: 'weworkremotely', isBoard: false })];
    expect(filterRows(rows, '  WE WORK ')).toHaveLength(1);
    expect(filterRows(rows, 'greenhouse')).toHaveLength(1);
    expect(filterRows(rows, '')).toHaveLength(2);
    expect(filterRows(rows, 'zzz')).toHaveLength(0);
  });
});

describe('employerMessage', () => {
  it('turns each refusal into a sentence the person can act on, with no value echoed', () => {
    expect(employerMessage('empty')).toMatch(/Scrivi/);
    expect(employerMessage('invalid')).toMatch(/solo lettere, numeri e trattini/);
  });
});
