// Tests for the two public feeds added in the source expansion: Himalayas (JSON) and Jobspresso
// (RSS). Every fixture is SYNTHETIC, shaped after the payload each publisher serves, and carries
// no real posting. No test touches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { himalayas, jobspresso } from '../src/sources/feeds.ts';

const HIMALAYAS = JSON.stringify({
  totalCount: 2,
  jobs: [
    {
      guid: 'https://himalayas.app/companies/acme/jobs/platform-engineer',
      title: 'Platform Engineer',
      companyName: 'Acme',
      applicationLink: 'https://himalayas.app/companies/acme/jobs/platform-engineer?utm_source=api',
      description: '<div><p>Kubernetes and Rust.</p></div>',
      locationRestrictions: ['Europe', 'Italy'],
      minSalary: 70000,
      maxSalary: 90000,
      currency: 'EUR',
      pubDate: 1794694560,
    },
    {
      title: 'No link at all',
      companyName: 'Beta',
    },
  ],
});

test('himalayas: a job maps to the shared shape, remote by definition, and a job without a link is dropped', () => {
  const postings = himalayas.extractPostings(HIMALAYAS);
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.source, 'himalayas');
  assert.equal(job?.id, 'https://himalayas.app/companies/acme/jobs/platform-engineer');
  assert.equal(job?.title, 'Platform Engineer');
  assert.equal(job?.company, 'Acme');
  assert.equal(job?.location, 'Europe, Italy');
  assert.equal(job?.url, 'https://himalayas.app/companies/acme/jobs/platform-engineer', 'the canonical link, without the api tracking parameter');
  assert.equal(job?.remote_hint, true);
  assert.equal(job?.description, 'Kubernetes and Rust.');
  assert.equal(job?.salary, '70000-90000 EUR');
  // 1794694560 seconds since the epoch, computed with `node -e 'new Date(1794694560*1000).toISOString()'`.
  assert.equal(job?.published_at, '2026-11-14T22:16:00.000Z');
});

test('himalayas: an unparseable body extracts nothing instead of throwing', () => {
  assert.deepEqual(himalayas.extractPostings('not json'), []);
});

test('himalayas: the search URL is the public jobs endpoint, with the page size kept small', () => {
  const url = himalayas.buildSearchUrl('', {});
  assert.match(url, /^https:\/\/himalayas\.app\/jobs\/api/);
  assert.match(url, /limit=\d+/);
});

const JOBSPRESSO = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
  <title>Jobspresso</title>
  <item>
    <title><![CDATA[Remote Data Analyst at Gamma]]></title>
    <link>https://jobspresso.co/job/remote-data-analyst/</link>
    <description><![CDATA[<p>Work from anywhere in Europe.</p>]]></description>
    <pubDate>Mon, 09 Nov 2026 10:00:00 +0000</pubDate>
    <guid>https://jobspresso.co/?post_type=job&amp;p=77</guid>
  </item>
  <item>
    <title>Item without a link</title>
    <description>skipped</description>
  </item>
</channel></rss>`;

test('jobspresso: each RSS item maps; remote is the premise of the board; an item without a link is dropped', () => {
  const postings = jobspresso.extractPostings(JOBSPRESSO);
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.source, 'jobspresso');
  assert.equal(job?.id, 'https://jobspresso.co/?post_type=job&p=77');
  assert.equal(job?.title, 'Remote Data Analyst at Gamma');
  assert.equal(job?.url, 'https://jobspresso.co/job/remote-data-analyst/');
  assert.equal(job?.remote_hint, true);
  assert.equal(job?.description, 'Work from anywhere in Europe.');
  assert.equal(job?.published_at, '2026-11-09T10:00:00.000Z');
});

test('jobspresso: an empty channel, which is what the feed served on the probe day, is an empty list', () => {
  const EMPTY = '<?xml version="1.0"?><rss version="2.0"><channel><title>Jobspresso</title></channel></rss>';
  assert.deepEqual(jobspresso.extractPostings(EMPTY), []);
});
