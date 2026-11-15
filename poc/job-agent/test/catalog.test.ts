// The catalogue adapters, offline, on synthetic fixtures that copy the live shapes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cryptocurrencyjobs, getonbrd, platsbanken } from '../src/sources/catalog.ts';

test('getonbrd maps each job to a posting with its public link and text description', () => {
  const body = JSON.stringify({
    data: [
      {
        id: 'dev-backend-1',
        attributes: {
          title: 'Desarrollador Backend',
          description: '<ul><li>Experiencia con <strong>Java</strong></li></ul>',
          remote: true,
          remote_modality: 'remote',
        },
        links: { public_url: 'https://www.getonbrd.com/jobs/dev-backend-1' },
      },
      { id: 'no-link', attributes: { title: 'Sin enlace' }, links: {} },
    ],
  });
  const postings = getonbrd.extractPostings(body);
  assert.equal(postings.length, 1, 'a job without a link is skipped');
  assert.deepEqual(postings[0], {
    source: 'getonbrd',
    id: 'dev-backend-1',
    title: 'Desarrollador Backend',
    company: null,
    location: null,
    url: 'https://www.getonbrd.com/jobs/dev-backend-1',
    remote_hint: true,
    description: 'Experiencia con Java',
    published_at: null,
    salary: null,
  });
});

test('getonbrd answers nothing for a body that is not its shape', () => {
  assert.deepEqual(getonbrd.extractPostings('{"error":"nope"}'), []);
  assert.deepEqual(getonbrd.extractPostings('not json'), []);
});

test('platsbanken reads hits, not the position count, and skips removed ads', () => {
  const body = JSON.stringify({
    total: { value: 2 },
    positions: 2,
    hits: [
      {
        id: 31727571,
        headline: 'Senior utvecklare observability',
        webpage_url: 'https://arbetsformedlingen.se/platsbanken/annonser/31727571',
        employer: { name: 'Exempel AB' },
        workplace_address: { municipality: 'Sundbyberg', country: 'Sverige' },
        description: { text: 'Vi bygger <b>system</b> i team.' },
        publication_date: '2026-11-13T13:15:54',
        salary_description: 'Enligt överenskommelse',
        workplace_model: 'Remote',
      },
      { id: 2, headline: 'Borttagen', webpage_url: 'https://arbetsformedlingen.se/x', removed: true },
    ],
  });
  const postings = platsbanken.extractPostings(body);
  assert.equal(postings.length, 1, 'the removed ad is skipped');
  assert.equal(postings[0]?.id, '31727571');
  assert.equal(postings[0]?.title, 'Senior utvecklare observability');
  assert.equal(postings[0]?.company, 'Exempel AB');
  assert.equal(postings[0]?.location, 'Sundbyberg, Sverige');
  assert.equal(postings[0]?.description, 'Vi bygger system i team.');
  assert.equal(postings[0]?.remote_hint, true);
  assert.equal(postings[0]?.salary, 'Enligt överenskommelse');
});

test('cryptocurrencyjobs splits "Role at Company" and decodes the double encoding', () => {
  const body = `<?xml version="1.0"?><rss><channel>
    <item>
      <title>Senior Business Development &amp;amp; Partnerships Manager at Meridian Ledger</title>
      <description>A full-time position that is 100% remote with no geographical restrictions.</description>
      <pubDate>Wed, 11 Nov 2026 16:29:46 +0200</pubDate>
      <guid>https://cryptocurrencyjobs.co/sales/meridian-ledger-senior</guid>
      <link>https://cryptocurrencyjobs.co/sales/meridian-ledger-senior</link>
    </item>
    <item>
      <title>Plain http link</title>
      <link>http://insecure.example.test/job</link>
    </item>
  </channel></rss>`;
  const postings = cryptocurrencyjobs.extractPostings(body);
  assert.equal(postings.length, 1, 'an item with a plain http link is refused');
  assert.equal(postings[0]?.title, 'Senior Business Development & Partnerships Manager');
  assert.equal(postings[0]?.company, 'Meridian Ledger');
  assert.equal(postings[0]?.url, 'https://cryptocurrencyjobs.co/sales/meridian-ledger-senior');
  assert.equal(postings[0]?.remote_hint, true);
});

test('a bot wall is reported as a captcha challenge, never parsed as jobs', () => {
  assert.equal(platsbanken.detectChallenge('<title>Just a moment...</title>'), 'captcha');
  assert.equal(platsbanken.detectChallenge('{"hits":[]}'), 'none');
});
