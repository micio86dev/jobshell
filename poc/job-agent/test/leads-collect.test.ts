// Collection runs under the same policy as the job pipeline and always says why a source gave nothing.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { defaultConfig } from '../src/config.ts';
import type { FetchLike } from '../src/jev.ts';
import { collectSignals } from '../src/leads/collect.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/leads/${name}`, import.meta.url), 'utf8');
const now = new Date('2026-11-24T12:00:00Z');
const config = defaultConfig();
const noSleep = async (): Promise<void> => undefined;

const serve = (routes: Record<string, { status: number; text: string }>): { urls: string[]; fetchImpl: FetchLike } => {
  const urls: string[] = [];
  return {
    urls,
    fetchImpl: async (url) => {
      urls.push(url);
      const hit = Object.entries(routes).find(([prefix]) => url.startsWith(prefix));
      return hit === undefined ? { status: 404, text: '' } : hit[1];
    },
  };
};

test('the HN thread is followed in two steps: the list first, then the comment pages of the newest thread', async () => {
  const { urls, fetchImpl } = serve({
    'https://hn.algolia.com/api/v1/search_by_date?tags=story': { status: 200, text: fixture('hn-thread-list.json') },
    'https://hn.algolia.com/api/v1/search_by_date?tags=comment': { status: 200, text: fixture('hn-thread-comments.json') },
  });
  const { signals, reports } = await collectSignals({ config, fetchImpl, now, sources: ['hn-hiring'], queries: [], sleep: noSleep });
  // The list, then the 378 comments of the thread in two pages of 200.
  assert.equal(urls.length, 3);
  assert.ok(urls[1]?.includes('story_50338728') && urls[1]?.includes('page=0'));
  assert.ok(urls[2]?.includes('page=1'));
  assert.ok(signals.length >= 3);
  assert.equal(reports[0]?.source, 'hn-hiring');
  assert.equal(reports[0]?.skipped, null);
  assert.equal(reports[0]?.postings, signals.length);
});

test('a source the user switched off costs nothing and says so', async () => {
  const { urls, fetchImpl } = serve({});
  const off = { ...config, sources: { 'yc-hiring': { enabled: false } } };
  const { reports } = await collectSignals({ config: off, fetchImpl, now, sources: ['yc-hiring'], queries: [], sleep: noSleep });
  assert.equal(urls.length, 0);
  assert.equal(reports[0]?.skipped, 'disabled by the user');
});

test('a source the policy does not know is prohibited, never fetched', async () => {
  const { urls, fetchImpl } = serve({});
  const { reports } = await collectSignals({ config, fetchImpl, now, sources: ['made-up-source'], queries: [], sleep: noSleep });
  assert.equal(urls.length, 0);
  assert.equal(reports[0]?.skipped, 'policy: prohibited');
});

test('a session-driven source is left to the extension', async () => {
  const { urls, fetchImpl } = serve({});
  const { reports } = await collectSignals({ config, fetchImpl, now, sources: ['linkedin'], queries: [], sleep: noSleep });
  assert.equal(urls.length, 0);
  assert.match(reports[0]?.skipped ?? '', /browser extension/);
});

test('an error status stops that source with its reason and the others still run', async () => {
  const { fetchImpl } = serve({
    'https://yc-oss.github.io': { status: 503, text: '' },
    'https://sifted.eu': { status: 200, text: fixture('sifted.xml') },
  });
  const { signals, reports } = await collectSignals({ config, fetchImpl, now, sources: ['yc-hiring', 'sifted'], queries: [], sleep: noSleep });
  assert.equal(reports[0]?.skipped, 'status 503');
  assert.equal(reports[1]?.skipped, null);
  assert.ok(signals.length > 0 && signals.every((signal) => signal.source === 'sifted'));
});

test('a network failure is a skip with a reason, not a crash', async () => {
  const fetchImpl: FetchLike = async () => {
    throw new Error('offline');
  };
  const { reports } = await collectSignals({ config, fetchImpl, now, sources: ['sifted'], queries: [], sleep: noSleep });
  assert.equal(reports[0]?.skipped, 'fetch failed: offline');
});

test('a posting adapter is read through the same plan and its postings become signals', async () => {
  const body = JSON.stringify({ data: [{ slug: 'a-1', title: 'Senior Laravel Developer', company_name: 'Acme', description: 'Laravel', url: 'https://www.arbeitnow.com/jobs/a-1', remote: true, created_at: 1766000000, location: 'Berlin', tags: [] }] });
  const { fetchImpl } = serve({ 'https://www.arbeitnow.com': { status: 200, text: body } });
  const { signals, reports } = await collectSignals({ config, fetchImpl, now, sources: ['arbeitnow'], queries: ['laravel'], sleep: noSleep });
  assert.equal(reports[0]?.skipped, null);
  assert.equal(signals[0]?.type, 'job_posting');
  assert.equal(signals[0]?.company_name, 'Acme');
});
