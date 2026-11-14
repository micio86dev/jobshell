// Tests for the ATS board adapters: Lever, Ashby, Recruitee and Personio. Every fixture is
// SYNTHETIC, written for this test after the public shape each ATS documents, and carries no
// real posting. No test touches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ashby, lever, personio, recruitee } from '../src/sources/boards.ts';

const LEVER = JSON.stringify([
  {
    id: 'lv-1',
    text: 'Backend Engineer',
    categories: { location: 'Madrid, Spain', team: 'Engineering', commitment: 'Full-time' },
    workplaceType: 'remote',
    hostedUrl: 'https://jobs.lever.co/acme/lv-1',
    applyUrl: 'https://jobs.lever.co/acme/lv-1/apply',
    createdAt: 1793500000000,
    descriptionPlain: 'Build the payments core.',
    salaryRange: { min: 60000, max: 80000, currency: 'EUR', interval: 'per-year-salary' },
  },
  {
    id: 'lv-2',
    text: 'No link',
    categories: { location: 'Paris' },
  },
]);

test('lever: a posting maps to the shared shape and an item without a link is dropped', () => {
  const postings = lever.extractPostings(LEVER);
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.source, 'lever');
  assert.equal(job?.id, 'lv-1');
  assert.equal(job?.title, 'Backend Engineer');
  assert.equal(job?.location, 'Madrid, Spain');
  assert.equal(job?.url, 'https://jobs.lever.co/acme/lv-1');
  assert.equal(job?.remote_hint, true);
  assert.equal(job?.description, 'Build the payments core.');
  assert.equal(job?.salary, '60000-80000 EUR');
  assert.match(job?.published_at ?? '', /^2026-/);
});

test('lever: the tenant becomes the postings path, and a bad tenant is refused before any request', () => {
  assert.equal(lever.buildSearchUrl('', { tenant: 'jobandtalent' }), 'https://api.lever.co/v0/postings/jobandtalent?mode=json');
  assert.throws(() => lever.buildSearchUrl('', { tenant: '../etc' }), /tenant/);
  assert.throws(() => lever.buildSearchUrl('', {}), /tenant/);
});

test('lever: unparseable JSON extracts nothing instead of throwing', () => {
  assert.deepEqual(lever.extractPostings('<html>nope</html>'), []);
});

const ASHBY = JSON.stringify({
  apiVersion: '1',
  jobs: [
    {
      id: 'ab-1',
      title: 'Data Engineer',
      location: 'Milano',
      isRemote: false,
      isListed: true,
      publishedAt: '2026-11-05T02:20:02.702+00:00',
      jobUrl: 'https://jobs.ashbyhq.com/acme/ab-1',
      descriptionPlain: 'Pipelines and warehouses.',
    },
    {
      id: 'ab-2',
      title: 'Hidden role',
      location: 'Remote',
      isRemote: true,
      isListed: false,
      jobUrl: 'https://jobs.ashbyhq.com/acme/ab-2',
    },
  ],
});

test('ashby: a listed posting maps, an unlisted one is not published and is dropped', () => {
  const postings = ashby.extractPostings(ASHBY);
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.source, 'ashby');
  assert.equal(job?.id, 'ab-1');
  assert.equal(job?.title, 'Data Engineer');
  assert.equal(job?.location, 'Milano');
  assert.equal(job?.remote_hint, false, 'the source says it is not remote, so it is not');
  assert.equal(job?.published_at, '2026-11-05T02:20:02.702Z');
});

test('ashby: the board URL is built from the tenant', () => {
  assert.equal(ashby.buildSearchUrl('', { tenant: 'satispay' }), 'https://api.ashbyhq.com/posting-api/job-board/satispay');
  assert.throws(() => ashby.buildSearchUrl('', { tenant: 'a/b' }), /tenant/);
});

const RECRUITEE = JSON.stringify({
  offers: [
    {
      id: 501,
      title: 'Frontend Developer',
      careers_url: 'https://channable.recruitee.com/o/frontend-developer',
      company_name: 'Channable',
      city: 'Hamburg',
      country: 'Germany',
      remote: true,
      description: '<p>React and TypeScript</p>',
      created_at: '2026-10-30T09:00:00Z',
    },
    { id: 502, title: 'No link', company_name: 'Channable' },
  ],
});

test('recruitee: an offer maps with its own origin link and an offer without one is dropped', () => {
  const postings = recruitee.extractPostings(RECRUITEE);
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.source, 'recruitee');
  assert.equal(job?.id, '501');
  assert.equal(job?.company, 'Channable');
  assert.equal(job?.location, 'Hamburg, Germany');
  assert.equal(job?.url, 'https://channable.recruitee.com/o/frontend-developer');
  assert.equal(job?.remote_hint, true);
  assert.equal(job?.description, 'React and TypeScript');
});

test('recruitee: each tenant has its own origin and the API path', () => {
  assert.equal(recruitee.buildSearchUrl('', { tenant: 'channable' }), 'https://channable.recruitee.com/api/offers/');
  assert.throws(() => recruitee.buildSearchUrl('', { tenant: 'evil.example' }), /tenant/);
});

const PERSONIO = `<?xml version="1.0" encoding="UTF-8"?>
<workzag-jobs>
<position>
    <id>1001</id>
    <office>Berlin</office>
    <department>Product and Tech</department>
    <name>Site Reliability Engineer (d/f/m)</name>
    <jobDescriptions><jobDescription><name>Your role</name><value>Keep the platform running.</value></jobDescription></jobDescriptions>
    <employmentType>permanent</employmentType>
    <seniority>experienced</seniority>
    <schedule>full-time</schedule>
    <createdAt>2026-11-11T17:43:42+00:00</createdAt>
</position>
<position>
    <office>Munich</office>
    <name>No identifier</name>
</position>
</workzag-jobs>`;

test('personio: each position maps to its own job page, and a position without an id is dropped', () => {
  // The XML names no employer, so the tenant the feed was fetched for is passed in.
  const postings = personio.extractPostings(PERSONIO, { tenant: 'acme' });
  assert.equal(postings.length, 1);
  const [job] = postings;
  assert.equal(job?.source, 'personio');
  assert.equal(job?.id, '1001');
  assert.equal(job?.title, 'Site Reliability Engineer (d/f/m)');
  assert.equal(job?.location, 'Berlin');
  assert.equal(job?.url, 'https://acme.jobs.personio.de/job/1001');
  assert.match(job?.description ?? '', /Keep the platform running/);
  assert.equal(job?.published_at, '2026-11-11T17:43:42.000Z');
});

test('personio: the feed URL is built from the tenant and the tenant is validated', () => {
  assert.equal(personio.buildSearchUrl('', { tenant: 'personio' }), 'https://personio.jobs.personio.de/xml');
  assert.throws(() => personio.buildSearchUrl('', { tenant: 'x y' }), /tenant/);
});
