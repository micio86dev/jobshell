// The complete tailored CV: the wizard's data (CV, title, skills, years, languages, portfolio)
// goes in as the only facts the model may use, and the numeric guard knows those facts.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { parseReportRequest, type ReportInput } from '../src/report.ts';
import { tailorCv, tailorInstruction } from '../src/tailor.ts';

const candidate = {
  headline: 'Backend developer',
  capabilities: ['Rust', 'Tauri'],
  seniority: 'senior',
  years_experience: 12,
  languages: ['it', 'en'],
  portfolio: 'https://portfolio.example.test/mario',
};

const posting = {
  title: 'Senior Rust Engineer',
  company: 'Acme',
  url: 'https://example.test/jobs/1',
  description: 'We build desktop apps with Rust.',
};

const input: ReportInput = { posting, cv: 'Mario Rossi. Rust developer, team lead.', verdict: 'yes', gaps: [], candidate };

const answer = (text: string) =>
  JSON.stringify({ content: [{ type: 'text', text }], usage: { input_tokens: 300, output_tokens: 200 } });

const fakeFetch = (body: string) => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init: init as RequestInit });
    return { status: 200, text: body };
  };
  return { calls, fetchImpl };
};

test('the request carries the wizard data as candidate facts', () => {
  const raw = JSON.stringify({
    posting: { title: 'Engineer', url: 'https://example.test/1', company: 'Acme', description: null },
    cv: 'Mario Rossi.',
    verdict: 'yes',
    gaps: [],
    candidate,
  });
  const parsed = parseReportRequest(raw);
  assert.equal(parsed.ok, true);
  if (parsed.ok) assert.deepEqual(parsed.input.candidate, candidate);
});

test('a candidate with a wrong type is refused with a fixed reason', () => {
  const raw = JSON.stringify({
    posting: { title: 'Engineer', url: 'https://example.test/1', company: null, description: null },
    cv: 'Mario Rossi.',
    verdict: 'yes',
    gaps: [],
    candidate: { years_experience: 'twelve' },
  });
  assert.deepEqual(parseReportRequest(raw), { ok: false, reason: 'candidate.years_experience must be a number or null' });
});

test('the instruction asks for a complete CV and carries the candidate facts and the portfolio', () => {
  const instruction = tailorInstruction(input);
  assert.match(instruction, /complete professional CV/);
  assert.match(instruction, /Backend developer/);
  assert.match(instruction, /portfolio\.example\.test\/mario/);
  assert.match(instruction, /<candidate>/);
});

test('a number that only the candidate facts carry is accepted', async () => {
  const cv = 'Mario Rossi. Rust developer.';
  const { fetchImpl } = fakeFetch(answer('# Mario Rossi\n12 anni di esperienza con Rust.'));
  const result = await tailorCv({ ...input, cv }, { apiKey: 'sk-test', model: 'claude-test', fetchImpl });
  assert.equal(result.source, 'model');
});

test('the tailored CV gets room for a full document, not the short report size', async () => {
  const { calls, fetchImpl } = fakeFetch(answer('# Mario Rossi'));
  await tailorCv(input, { apiKey: 'sk-test', model: 'claude-test', fetchImpl });
  const body = String(calls[0]?.init.body ?? '');
  assert.match(body, /"max_tokens":\s*6000/);
});
