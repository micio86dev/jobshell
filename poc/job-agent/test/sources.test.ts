// Tests for the three source adapters. Every fixture below is SYNTHETIC: written
// for this test, shaped after the public markup/JSON the source documents, and
// carrying no third-party content. No test touches the network.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { greenhouse } from '../src/sources/greenhouse.ts';
import { indeed } from '../src/sources/indeed.ts';
import { linkedin } from '../src/sources/linkedin.ts';

// Synthetic LinkedIn results page: one well-formed card, one card without a
// title, one duplicate of the first id.
const LINKEDIN_PAGE = `
<ul class="jobs-search__results-list">
  <li><div class="base-card">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4012345678/?refId=abc"></a>
    <h3 class="base-search-card__title"> Senior Rust Engineer </h3>
    <h4 class="base-search-card__subtitle"><a href="/company/acme">Acme Srl</a></h4>
    <span class="job-search-card__location">Milano, Lombardia, Italia</span>
  </div></li>
  <li><div class="base-card">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4099999999/"></a>
    <span class="job-search-card__location">Roma, Italia</span>
  </div></li>
  <li><div class="base-card">
    <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/4012345678/"></a>
    <h3 class="base-search-card__title">Senior Rust Engineer</h3>
  </div></li>
</ul>`;

// Synthetic Indeed results page: one well-formed card and one without a title.
const INDEED_PAGE = `
<div id="mosaic-provider-jobcards">
  <a id="job_abc123" href="/viewjob?jk=abc123&amp;from=serp">
    <h2 data-testid="jobTitle"><span>Backend Engineer (Remote)</span></h2>
  </a>
  <span data-testid="company-name">Beta Labs</span>
  <div data-testid="text-location">Italia (Remoto)</div>
  <a id="job_def456" href="https://it.indeed.com/viewjob?jk=def456"></a>
</div>`;

// Synthetic Greenhouse board payload, shaped as documented in
// docs/phase-0/11-api-integration-matrix.md.
const GREENHOUSE_JSON = JSON.stringify({
  jobs: [
    {
      id: 7654321,
      title: 'Platform Engineer',
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/7654321',
      location: { name: 'Remote - Europe' },
      content: '&lt;p&gt;Kubernetes and Go&lt;/p&gt;',
    },
    {
      id: 7654322,
      absolute_url: 'https://boards.greenhouse.io/acme/jobs/7654322',
      location: { name: 'Berlin' },
    },
    { id: 7654323, title: 'No URL here', location: { name: 'Remote' } },
  ],
});

test('linkedin: a normal page yields one posting per unique card', () => {
  const postings = linkedin.extractPostings(LINKEDIN_PAGE);
  assert.equal(postings.length, 1, 'the duplicate id and the titleless card are dropped');
  const [posting] = postings;
  assert.equal(posting?.id, '4012345678');
  assert.equal(posting?.source, 'linkedin');
  assert.equal(posting?.title, 'Senior Rust Engineer');
  assert.equal(posting?.company, 'Acme Srl');
  assert.equal(posting?.location, 'Milano, Lombardia, Italia');
  assert.equal(posting?.url, 'https://www.linkedin.com/jobs/view/4012345678/');
});

test('linkedin: an empty body extracts nothing instead of throwing', () => {
  assert.deepEqual(linkedin.extractPostings(''), []);
});

test('linkedin: each challenge marker is recognised', () => {
  assert.equal(linkedin.detectChallenge(LINKEDIN_PAGE), 'none');
  assert.equal(linkedin.detectChallenge('<div id="authwall">Sign in</div>'), 'authwall');
  assert.equal(linkedin.detectChallenge('<iframe src="https://captcha.example/x"></iframe>'), 'captcha');
  assert.equal(linkedin.detectChallenge('<h1>429 Too Many Requests</h1>'), 'rate_limited');
});

test('linkedin: the search URL carries the query and the remote filter', () => {
  const url = new URL(linkedin.buildSearchUrl('rust engineer', { location: 'Italia', remote: true }));
  assert.equal(url.hostname, 'www.linkedin.com');
  assert.equal(url.pathname, '/jobs/search/');
  assert.equal(url.searchParams.get('keywords'), 'rust engineer');
  assert.equal(url.searchParams.get('location'), 'Italia');
  assert.equal(url.searchParams.get('f_WT'), '2', 'f_WT=2 is the remote-work filter');
});

test('indeed: a normal page yields postings and skips the titleless card', () => {
  const postings = indeed.extractPostings(INDEED_PAGE);
  assert.equal(postings.length, 1);
  const [posting] = postings;
  assert.equal(posting?.id, 'abc123');
  assert.equal(posting?.source, 'indeed');
  assert.equal(posting?.title, 'Backend Engineer (Remote)');
  assert.equal(posting?.company, 'Beta Labs');
  assert.equal(posting?.location, 'Italia (Remoto)');
  assert.equal(posting?.url, 'https://it.indeed.com/viewjob?jk=abc123');
  assert.equal(posting?.remote_hint, true, 'a "remote" marker in the location sets the hint');
});

test('indeed: each challenge marker is recognised', () => {
  assert.equal(indeed.detectChallenge(INDEED_PAGE), 'none');
  assert.equal(indeed.detectChallenge('<a href="https://secure.indeed.com/auth">Accedi</a>'), 'authwall');
  assert.equal(indeed.detectChallenge('<div class="cf-challenge-running">checking</div>'), 'captcha');
  assert.equal(indeed.detectChallenge('Too Many Requests'), 'rate_limited');
});

test('indeed: the search URL carries the query and location', () => {
  const url = new URL(indeed.buildSearchUrl('go developer', { location: 'Milano' }));
  assert.equal(url.searchParams.get('q'), 'go developer');
  assert.equal(url.searchParams.get('l'), 'Milano');
});

test('greenhouse: the board payload is mapped and the incomplete job dropped', () => {
  const postings = greenhouse.extractPostings(GREENHOUSE_JSON);
  assert.equal(postings.length, 2, 'a job without absolute_url has no id and is dropped');
  const [first, second] = postings;
  assert.equal(first?.id, '7654321');
  assert.equal(first?.source, 'greenhouse');
  assert.equal(first?.title, 'Platform Engineer');
  assert.equal(first?.company, null, 'a board feed names no company; the tenant does');
  assert.equal(first?.location, 'Remote - Europe');
  assert.equal(first?.url, 'https://boards.greenhouse.io/acme/jobs/7654321');
  assert.equal(first?.remote_hint, true);
  assert.equal(second?.id, '7654322');
  assert.equal(second?.remote_hint, false);
});

test('greenhouse: unparseable JSON extracts nothing instead of throwing', () => {
  assert.deepEqual(greenhouse.extractPostings('<html>not json</html>'), []);
});

test('greenhouse: each challenge marker is recognised', () => {
  assert.equal(greenhouse.detectChallenge(GREENHOUSE_JSON), 'none');
  assert.equal(greenhouse.detectChallenge('{"error":"Too Many Requests"}'), 'rate_limited');
  assert.equal(greenhouse.detectChallenge('<html><div class="captcha"></div></html>'), 'captcha');
});

test('greenhouse: the board URL is built from the tenant token', () => {
  assert.equal(
    greenhouse.buildSearchUrl('any', { tenant: 'acme' }),
    'https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true',
  );
  assert.throws(() => greenhouse.buildSearchUrl('any', {}), /tenant/);
});