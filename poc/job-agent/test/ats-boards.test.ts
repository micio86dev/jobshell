// Tenant-based ATS boards: Workable widget, Teamtailor RSS and HireHive JSON. Offline, on
// fixtures that copy the live shapes read on 2026-11-15.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hirehive, teamtailor, workable } from '../src/sources/ats-boards.ts';

test('workable builds the widget URL for its tenant and maps each job', () => {
  assert.equal(
    workable.buildSearchUrl('', { tenant: 'huggingface' }),
    'https://apply.workable.com/api/v1/widget/accounts/huggingface?details=true',
  );
  const body = JSON.stringify({
    name: 'Hugging Face',
    jobs: [
      {
        title: 'Open-Source Machine Learning Engineer',
        shortcode: '81B46579FE',
        url: 'https://apply.workable.com/j/81B46579FE',
        telecommuting: true,
        country: 'France',
        city: 'Paris',
        published_on: '2026-05-29',
      },
      { title: 'No link', shortcode: 'X' },
    ],
  });
  const postings = workable.extractPostings(body, { tenant: 'huggingface' });
  assert.equal(postings.length, 1, 'a job without a https link is skipped');
  assert.deepEqual(postings[0], {
    source: 'workable',
    id: '81B46579FE',
    title: 'Open-Source Machine Learning Engineer',
    company: 'Hugging Face',
    location: 'Paris, France',
    url: 'https://apply.workable.com/j/81B46579FE',
    remote_hint: true,
    description: null,
    published_at: '2026-05-29',
    salary: null,
  });
});

test('workable refuses a tenant that is not a plain slug', () => {
  assert.throws(() => workable.buildSearchUrl('', { tenant: 'a/b' }), /tenant/);
  assert.throws(() => workable.buildSearchUrl('', {}), /tenant/);
});

test('teamtailor reads the tenant RSS and keeps only https links', () => {
  assert.equal(teamtailor.buildSearchUrl('', { tenant: 'templafy' }), 'https://templafy.teamtailor.com/jobs.rss');
  const body = `<?xml version="1.0"?><rss><channel>
    <item><title>Customer Support Agent</title><link>https://career.teamtailor.com/jobs/6137826</link>
      <guid>6137826</guid><pubDate>Mon, 09 Nov 2026 10:00:00 +0000</pubDate>
      <description>Help our customers in Italian and English.</description></item>
    <item><title>Plain http</title><link>http://insecure.example.test/j</link></item>
  </channel></rss>`;
  const postings = teamtailor.extractPostings(body, { tenant: 'templafy' });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.title, 'Customer Support Agent');
  assert.equal(postings[0]?.url, 'https://career.teamtailor.com/jobs/6137826');
  assert.equal(postings[0]?.description, 'Help our customers in Italian and English.');
});

test('hirehive reads items under the tenant host and keeps the hosted link', () => {
  assert.equal(hirehive.buildSearchUrl('', { tenant: 'amcsgroup' }), 'https://amcsgroup.hirehive.com/api/v2/jobs');
  const body = JSON.stringify({
    meta: {},
    links: {},
    items: [
      {
        id: 'job_OXplgX',
        title: 'Software Support Technical Team Lead',
        location: 'Cebu',
        hosted_url: 'https://amcsgroup.hirehive.com/software-support-te',
        published_date: '2026-11-13T11:21:36.537Z',
        description: { text: 'Lead the team.' },
      },
    ],
  });
  const postings = hirehive.extractPostings(body, { tenant: 'amcsgroup' });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.id, 'job_OXplgX');
  assert.equal(postings[0]?.location, 'Cebu');
  assert.equal(postings[0]?.url, 'https://amcsgroup.hirehive.com/software-support-te');
  assert.equal(postings[0]?.description, 'Lead the team.');
});

test('a body that is not the expected shape gives no postings, never a crash', () => {
  assert.deepEqual(workable.extractPostings('not json', { tenant: 'x' }), []);
  assert.deepEqual(hirehive.extractPostings('{"items":"nope"}', { tenant: 'x' }), []);
});
