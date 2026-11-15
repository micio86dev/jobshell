// The report request is validated at the boundary: a malformed request is refused with a
// fixed reason, never passed to the model.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseReportRequest } from '../src/report.ts';

const valid = {
  posting: { title: 'Senior Rust Engineer', company: 'Acme', url: 'https://example.test/1', description: 'Rust desktop apps.' },
  cv: 'Twelve years with Rust.',
  verdict: 'yes',
  gaps: [],
};

test('a well-formed request becomes the report input', () => {
  const result = parseReportRequest(JSON.stringify(valid));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.input, valid);
});

test('a company or a description may be null, the rest is required', () => {
  const result = parseReportRequest(
    JSON.stringify({ ...valid, posting: { ...valid.posting, company: null, description: null } }),
  );
  assert.equal(result.ok, true);
});

test('text that is not JSON is refused with a plain reason', () => {
  const result = parseReportRequest('not json');
  assert.deepEqual(result, { ok: false, reason: 'the report request is not valid JSON' });
});

test('a request without a posting title or url is refused, naming the field', () => {
  const noTitle = parseReportRequest(JSON.stringify({ ...valid, posting: { ...valid.posting, title: '' } }));
  assert.deepEqual(noTitle, { ok: false, reason: 'posting.title is required' });
  const noUrl = parseReportRequest(JSON.stringify({ ...valid, posting: { ...valid.posting, url: 42 } }));
  assert.deepEqual(noUrl, { ok: false, reason: 'posting.url is required' });
});

test('gaps must be a list of strings', () => {
  const result = parseReportRequest(JSON.stringify({ ...valid, gaps: 'none' }));
  assert.deepEqual(result, { ok: false, reason: 'gaps must be a list of strings' });
});
