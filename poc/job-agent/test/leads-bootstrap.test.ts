// Wiring a lead run from the user's choices and keys. Offline: the key reader is a function.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import { defaultLeadSources, wireLead } from '../src/leads/bootstrap.ts';
import { defaultStrategy } from '../src/leads/strategy.ts';
import { profile } from './support.ts';

const strategy = defaultStrategy(profile);
const keys = (known: Record<string, string>) => (account: string): string | null => known[account] ?? null;

test('with both keys, the judge, the model and the web research are all wired', () => {
  const wired = wireLead({ env: {}, readKey: keys({ typesafe: 'jev', anthropic: 'ant' }), strategy, dryRun: false });
  assert.equal(wired.jev?.apiKey, 'jev');
  assert.equal(wired.llm?.provider, 'anthropic');
  assert.equal(wired.research?.model, 'claude-sonnet-5-5');
  assert.equal(wired.researchUnavailable, null);
});

test('a dry run buys nothing: no key is read and no stage is wired', () => {
  let asked = false;
  const wired = wireLead({ env: {}, readKey: () => { asked = true; return 'k'; }, strategy, dryRun: true });
  assert.equal(asked, false);
  assert.deepEqual([wired.jev, wired.llm, wired.research], [null, null, null]);
});

test('a missing key turns that stage off and says why', () => {
  const noModel = wireLead({ env: {}, readKey: keys({ typesafe: 'jev' }), strategy, dryRun: false });
  assert.ok(noModel.jev !== null);
  assert.equal(noModel.llm, null);
  assert.match(noModel.researchUnavailable ?? '', /no Anthropic key is stored/);
  const noJudge = wireLead({ env: {}, readKey: keys({ anthropic: 'ant' }), strategy, dryRun: false });
  assert.equal(noJudge.jev, null);
  assert.ok(noJudge.research !== null);
});

test('another provider gets the plain model calls but not the web research, and the reason names it', () => {
  const wired = wireLead({ env: { JOBSHELL_LLM_PROVIDER: 'openai', JOBSHELL_LLM_MODEL: 'gpt-x' }, readKey: keys({ typesafe: 'jev', openai: 'oa' }), strategy, dryRun: false });
  assert.equal(wired.llm?.provider, 'openai');
  assert.equal(wired.research, null);
  assert.match(wired.researchUnavailable ?? '', /web research needs the Anthropic provider, and OpenAI is chosen/);
});

test('an invalid provider choice is an error, never a silent default', () => {
  assert.throws(() => wireLead({ env: { JOBSHELL_LLM_PROVIDER: 'mistral' }, readKey: keys({}), strategy, dryRun: false }), /unknown LLM provider/);
});

test('the sources an unattended run reads are the allowed ones, with the signal sources and without the superseded one', () => {
  const sources = defaultLeadSources(defaultConfig());
  for (const id of ['hn-hiring', 'hn-jobs', 'yc-hiring', 'sifted', 'techcrunch-startups', 'lever', 'workable']) assert.ok(sources.includes(id), id);
  for (const id of ['hn', 'linkedin', 'indeed', 'remotive']) assert.ok(!sources.includes(id), id);
  const off = defaultLeadSources({ ...defaultConfig(), sources: { sifted: { enabled: false } } });
  assert.ok(!off.includes('sifted'));
});
