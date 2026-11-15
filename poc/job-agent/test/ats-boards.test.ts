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

import { breezy, pinpoint, rippling } from '../src/sources/ats-boards.ts';

test('breezy reads the tenant /json array, skips removed-looking rows, keeps https links', () => {
  assert.equal(breezy.buildSearchUrl('', { tenant: 'clearly' }), 'https://clearly.breezy.hr/json');
  const body = JSON.stringify([
    {
      id: 'a7b9',
      name: 'Growth Marketing Manager',
      url: 'https://clearly.breezy.hr/p/a7b9-growth-marketing-manager',
      published: '2026-10-02T14:55:05.458Z',
      location: { name: 'Madrid', is_remote: false, country: { name: 'Spain' } },
      company: { name: 'Clearly' },
    },
    { id: 'x', name: 'No link' },
  ]);
  const postings = breezy.extractPostings(body, { tenant: 'clearly' });
  assert.equal(postings.length, 1, 'a row without an https link is skipped');
  assert.equal(postings[0]?.title, 'Growth Marketing Manager');
  assert.equal(postings[0]?.company, 'Clearly');
  assert.equal(postings[0]?.location, 'Madrid, Spain');
  assert.equal(postings[0]?.published_at, '2026-10-02T14:55:05.458Z');
});

test('pinpoint reads data[] from postings.json, with a text description', () => {
  assert.equal(pinpoint.buildSearchUrl('', { tenant: 'field' }), 'https://field.pinpointhq.com/postings.json');
  const body = JSON.stringify({
    data: [
      {
        id: 'ec63',
        title: 'BESS Engineer',
        url: 'https://field.pinpointhq.com/en/postings/ec63',
        location: { city: 'Rome', name: 'IT - Rome' },
        description: '<p>Battery <b>storage</b> systems.</p>',
        workplace_type_text: 'Hybrid',
      },
    ],
  });
  const postings = pinpoint.extractPostings(body, { tenant: 'field' });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.location, 'IT - Rome');
  assert.equal(postings[0]?.description, 'Battery storage systems.');
});

test('rippling reads items[] from the board, with the link and the department', () => {
  assert.equal(
    rippling.buildSearchUrl('', { tenant: 'zynap' }),
    'https://ats.rippling.com/api/v2/board/zynap/jobs',
  );
  const body = JSON.stringify({
    items: [
      {
        id: '8afb',
        name: 'Senior Full-Stack Engineer',
        url: 'https://ats.rippling.com/zynap/jobs/8afb',
        department: 'Engineering',
        locations: ['Barcelona, Spain'],
      },
    ],
    totalItems: 1,
  });
  const postings = rippling.extractPostings(body, { tenant: 'zynap' });
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.title, 'Senior Full-Stack Engineer');
  assert.equal(postings[0]?.location, 'Barcelona, Spain');
  assert.equal(postings[0]?.url, 'https://ats.rippling.com/zynap/jobs/8afb');
});
