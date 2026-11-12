// Tests for the RSS reader and the eight no-key public feeds. Every fixture is
// SYNTHETIC and shaped after the payload the source publishes; no test touches the
// network and no real posting is copied.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  arbeitnow,
  hn,
  iprogrammatori,
  jobicy,
  remoteok,
  remotive,
  weworkremotely,
  workingnomads,
} from '../src/sources/feeds.ts';
import { adapterFor, listSources } from '../src/sources/registry.ts';
import { parseRss } from '../src/sources/rss.ts';

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel>
  <item>
    <title><![CDATA[Acme: Senior Rust Engineer]]></title>
    <link>https://example.test/jobs/1</link>
    <description><![CDATA[<p>Remote, EU timezone</p>]]></description>
    <pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate>
    <guid>job-1</guid>
  </item>
  <item>
    <title>Item without a link</title>
    <description>skipped</description>
  </item>
</channel></rss>`;

test('rss: CDATA is unwrapped, entities decoded and the date normalised', () => {
  const items = parseRss(RSS);
  assert.equal(items.length, 1, 'an item without a link is skipped');
  const [item] = items;
  assert.equal(item?.title, 'Acme: Senior Rust Engineer');
  assert.equal(item?.link, 'https://example.test/jobs/1');
  assert.equal(item?.description, 'Remote, EU timezone');
  assert.equal(item?.published_at, '2026-11-02T10:00:00.000Z');
  assert.equal(item?.guid, 'job-1');
});

test('rss: a document that is not a feed yields nothing instead of throwing', () => {
  assert.deepEqual(parseRss('<html><body>not a feed</body></html>'), []);
});

test('registry: every implemented adapter is reachable by id', () => {
  const ids = listSources();
  for (const id of [
    'arbeitnow',
    'greenhouse',
    'hn',
    'indeed',
    'iprogrammatori',
    'jobicy',
    'linkedin',
    'remoteok',
    'remotive',
    'weworkremotely',
    'workingnomads',
  ]) {
    assert.ok(ids.includes(id), `${id} missing from the registry`);
    assert.equal(adapterFor(id)?.id, id);
  }
  assert.equal(adapterFor('monster'), null, 'an unimplemented source is null, never a guess');
});

test('remoteok: the terms notice is not a posting', () => {
  const payload = JSON.stringify([
    { last_updated: 1794096003, legal: 'API Terms of Service: be nice' },
    {
      id: 101,
      slug: 'acme-rust',
      position: 'Rust Engineer',
      company: 'Acme',
      location: 'Worldwide',
      url: 'https://remoteok.com/remote-jobs/101',
      date: 1794000000,
      salary_min: 90000,
      salary_max: 120000,
      description: '<p>Build things</p>',
    },
  ]);
  const postings = remoteok.extractPostings(payload);
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.id, '101');
  assert.equal(job?.title, 'Rust Engineer');
  assert.equal(job?.company, 'Acme');
  assert.equal(job?.remote_hint, true);
  assert.equal(job?.salary, '90000-120000 USD');
  assert.equal(job?.description, 'Build things');
  assert.match(job?.published_at ?? '', /^2026-/);
});

test('remotive: the jobs array is mapped and a job without a url is dropped', () => {
  const payload = JSON.stringify({
    jobs: [
      {
        id: 7,
        title: 'Platform Engineer',
        company_name: 'Beta',
        candidate_required_location: 'Europe',
        url: 'https://remotive.com/jobs/7',
        publication_date: '2026-11-01T08:00:00Z',
        salary: '$90k - $110k',
        description: '<p>Kubernetes</p>',
      },
      { id: 8, title: 'No url' },
    ],
  });
  const postings = remotive.extractPostings(payload);
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.id, '7');
  assert.equal(postings[0]?.company, 'Beta');
  assert.equal(postings[0]?.salary, '$90k - $110k');
  assert.equal(postings[0]?.published_at, '2026-11-01T08:00:00.000Z');
});

test('arbeitnow: the data array is mapped and the remote flag is honoured', () => {
  const payload = JSON.stringify({
    data: [
      {
        slug: 'dev-berlin-1',
        title: 'Backend Developer',
        company_name: 'Gamma GmbH',
        location: 'Berlin',
        url: 'https://arbeitnow.test/jobs/1',
        created_at: 1794000000,
        remote: true,
        description: '<p>Go</p>',
      },
    ],
  });
  const postings = arbeitnow.extractPostings(payload);
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.id, 'dev-berlin-1');
  assert.equal(postings[0]?.remote_hint, true);
  assert.equal(postings[0]?.location, 'Berlin');
});

test('jobicy: the salary range uses the published currency', () => {
  const payload = JSON.stringify({
    jobs: [
      {
        id: 55,
        jobTitle: 'Data Engineer',
        companyName: 'Delta',
        jobGeo: 'Anywhere',
        url: 'https://jobicy.test/jobs/55',
        pubDate: '2026-11-03 09:00:00',
        annualSalaryMin: 70000,
        annualSalaryMax: 90000,
        salaryCurrency: 'EUR',
        jobExcerpt: 'Pipelines',
      },
    ],
  });
  const postings = jobicy.extractPostings(payload);
  assert.equal(postings[0]?.salary, '70000-90000 EUR');
  assert.equal(postings[0]?.published_at?.slice(0, 10), '2026-11-03');
});

test('workingnomads: a bare array is mapped', () => {
  const payload = JSON.stringify([
    {
      url: 'https://www.workingnomads.com/job/go/1/',
      title: 'SRE',
      company_name: 'Epsilon',
      location: 'Remote',
      description: '<p>On-call</p>',
    },
  ]);
  const postings = workingnomads.extractPostings(payload);
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.title, 'SRE');
  assert.equal(postings[0]?.remote_hint, true);
});

test('weworkremotely: the company is split off the title prefix', () => {
  const postings = weworkremotely.extractPostings(RSS);
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.company, 'Acme');
  assert.equal(postings[0]?.title, 'Senior Rust Engineer');
  assert.equal(postings[0]?.id, 'job-1');
});

test('iprogrammatori: an Italian posting keeps its date and detects smart working', () => {
  const italian = `<?xml version="1.0"?><rss version="2.0"><channel>
    <item>
      <title>Middle/Senior Java Developer</title>
      <link>https://www.iprogrammatori.it/lavoro/offerta/1</link>
      <description>Roma (Smart Working)</description>
      <pubDate>Tue, 03 Nov 2026 07:30:00 GMT</pubDate>
      <guid>offerta-1</guid>
    </item>
  </channel></rss>`;
  const postings = iprogrammatori.extractPostings(italian);
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.id, 'offerta-1');
  assert.equal(postings[0]?.remote_hint, true, 'smart working counts as remote');
  assert.equal(postings[0]?.published_at, '2026-11-03T07:30:00.000Z');
});

test('hn: a comment becomes a posting pointing at the thread', () => {
  const payload = JSON.stringify({
    hits: [
      {
        objectID: '4499',
        comment_text: 'Acme | Senior Rust Engineer | Remote (EU) | Full-time',
        created_at: '2026-11-01T12:00:00Z',
      },
      { objectID: '4500' },
    ],
  });
  const postings = hn.extractPostings(payload);
  assert.equal(postings.length, 1);
  assert.equal(postings[0]?.id, '4499');
  assert.equal(postings[0]?.url, 'https://news.ycombinator.com/item?id=4499');
  assert.equal(postings[0]?.remote_hint, true);
  assert.match(postings[0]?.title ?? '', /Senior Rust Engineer/);
});

test('every feed reports a rate-limit body and tolerates a broken payload', () => {
  for (const adapter of [remoteok, remotive, arbeitnow, jobicy, workingnomads, hn]) {
    assert.equal(adapter.detectChallenge('Too Many Requests'), 'rate_limited', adapter.id);
    assert.deepEqual(adapter.extractPostings('{ broken'), [], adapter.id);
  }
  assert.equal(iprogrammatori.detectChallenge('429'), 'rate_limited');
  assert.deepEqual(iprogrammatori.extractPostings('not xml'), []);
});

test('every feed builds an absolute https URL without needing options', () => {
  for (const adapter of [remoteok, remotive, arbeitnow, jobicy, workingnomads, weworkremotely, iprogrammatori, hn]) {
    const url = new URL(adapter.buildSearchUrl('rust engineer', {}));
    assert.equal(url.protocol, 'https:', adapter.id);
  }
});

test('ziprecruiter: the app file becomes postings, and a missing file is not an error', async () => {
  const { readPostings } = await import('../src/sources/ziprecruiter.ts');

  const file = JSON.stringify({
    source: 'ziprecruiter',
    postings: [
      { id: 'z1', title: 'Rust Engineer', company: 'Acme', location: 'Remote', url: 'https://example.test/z1', published_at: '2026-11-01T00:00:00Z' },
      { title: 'no id' },
    ],
  });
  const postings = readPostings('/tmp/zip.json', () => file);
  assert.equal(postings.length, 1, 'an entry without an id is skipped');
  assert.equal(postings[0]?.source, 'ziprecruiter');
  assert.equal(postings[0]?.title, 'Rust Engineer');
  assert.equal(postings[0]?.remote_hint, true);
  assert.equal(postings[0]?.published_at, '2026-11-01T00:00:00.000Z');

  assert.deepEqual(readPostings('/tmp/missing.json', () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }), []);

  const unsafe = JSON.stringify({
    postings: [
      { id: 'z2', title: 'XSS', url: 'javascript:alert(1)' },
      { id: 'with/slash', title: 'bad id' },
      { id: 'z3', title: 'no url' },
    ],
  });
  const safe = readPostings('/tmp/zip.json', () => unsafe);
  assert.equal(safe.length, 2, 'an id with a slash is refused');
  assert.match(safe[0]?.url ?? '', /^https:\/\/www\.ziprecruiter\.com\/jobs\/z2$/, 'a javascript url is replaced');
  assert.match(safe[1]?.url ?? '', /^https:\/\/www\.ziprecruiter\.com\/jobs\/z3$/);

  assert.throws(() => readPostings('/tmp/bad.json', () => 'not json'), /not valid JSON/);
  assert.throws(() => readPostings('/tmp/bad.json', () => '{"nope":1}'), /no postings array/);
});

test('remotive: a field of the wrong type is absent, and an item that is not an object is skipped', () => {
  const body = JSON.stringify({
    jobs: [
      { id: 1, title: 42, url: 'https://example.test/1' },
      'not an object',
      { id: 2, title: 'Rust Engineer', url: 'https://example.test/2', salary: 99 },
    ],
  });
  const postings = remotive.extractPostings(body);
  assert.equal(postings.length, 1, 'the numeric title drops its item; the string is skipped');
  assert.equal(postings[0]?.title, 'Rust Engineer');
  assert.equal(postings[0]?.salary, null, 'a salary that is not text is absent, not guessed');
});

test('an item whose id is not text or a number is skipped, never stored as "[object Object]" or an empty key', () => {
  const remotiveBody = JSON.stringify({
    jobs: [
      { id: { nested: true }, title: 'Rust Engineer', url: 'https://example.test/a' },
      { id: 7, title: 'Go Engineer', url: 'https://example.test/b' },
    ],
  });
  const remotivePostings = remotive.extractPostings(remotiveBody);
  assert.deepEqual(remotivePostings.map((p) => p.id), ['7'], 'an object id is not an identity');

  const hnBody = JSON.stringify({ hits: [{ comment_text: 'We are hiring Rust engineers.' }, { objectID: '99', comment_text: 'We hire Go.' }] });
  const hnPostings = hn.extractPostings(hnBody);
  assert.deepEqual(hnPostings.map((p) => p.id), ['99'], 'a comment without an id is not a posting with an empty key');
});

test('a blank id is treated as missing: the job keeps its url as identity', () => {
  const body = JSON.stringify({ jobs: [{ id: '   ', title: 'Rust Engineer', url: 'https://example.test/blank' }] });
  const postings = remotive.extractPostings(body);
  assert.equal(postings.length, 1, 'a blank id is not a reason to lose the job');
  assert.equal(postings[0]?.id, 'https://example.test/blank');
});

test('a null id is absent too: the job keeps its url as identity', () => {
  const body = JSON.stringify({ jobs: [{ id: null, title: 'Rust Engineer', url: 'https://example.test/null' }] });
  const postings = remotive.extractPostings(body);
  assert.equal(postings.length, 1, 'JSON null means absent, not an invalid item');
  assert.equal(postings[0]?.id, 'https://example.test/null');
});
