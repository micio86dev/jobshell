import { describe, expect, it } from 'vitest';

import { parseReportResult } from './report-result';

describe('parseReportResult', () => {
  it('a model answer becomes the Markdown report', () => {
    const raw = JSON.stringify({ source: 'model', markdown: '## A. Sintesi del ruolo\nTesto.' });
    expect(parseReportResult(raw)).toEqual({ ok: true, markdown: '## A. Sintesi del ruolo\nTesto.' });
  });

  it('a fallback answer becomes its fixed reason, shown as a reason and never as a report', () => {
    const raw = JSON.stringify({ source: 'fallback', reason: 'provider answered 500' });
    expect(parseReportResult(raw)).toEqual({ ok: false, reason: 'provider answered 500' });
  });

  it('a model answer with empty text is refused, not shown as an empty report', () => {
    const raw = JSON.stringify({ source: 'model', markdown: '   ' });
    expect(parseReportResult(raw).ok).toBe(false);
  });

  it('text that is not JSON, or an unknown shape, is refused with a plain reason', () => {
    expect(parseReportResult('not json')).toEqual({ ok: false, reason: 'the report answer could not be read' });
    expect(parseReportResult('[]')).toEqual({ ok: false, reason: 'the report answer could not be read' });
    expect(parseReportResult('{"source":"other"}')).toEqual({
      ok: false,
      reason: 'the report answer could not be read',
    });
  });
});
