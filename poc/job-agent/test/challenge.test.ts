// A feed is data, not a challenge page: a job that mentions a word a challenge page uses must not
// stop the run. Offline; the adapters are called with fixed bodies.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hn, remoteok } from '../src/sources/feeds.ts';
import { greenhouse } from '../src/sources/greenhouse.ts';

const jobWithWord = JSON.stringify([
  { id: 1, position: 'Rust Engineer', url: 'https://example.test/1', description: 'We do not use captcha in our product. Too many requests are a bug we fix.' },
]);

test('a JSON feed whose job text mentions a challenge word is data, not a challenge', () => {
  assert.equal(remoteok.detectChallenge(jobWithWord), 'none');
  assert.equal(remoteok.extractPostings(jobWithWord).length, 1);
});

test('a real challenge page is still recognised', () => {
  assert.equal(remoteok.detectChallenge('<html><body>Please solve this captcha</body></html>'), 'captcha');
  assert.equal(remoteok.detectChallenge('<html>Too many requests, HTTP 429</html>'), 'rate_limited');
});

test('greenhouse: a job whose content mentions a challenge word is still a posting', () => {
  const body = JSON.stringify({
    jobs: [{ absolute_url: 'https://boards.example.test/acme/jobs/42', title: 'Rust', content: 'captcha and 429 are not our topic' }],
  });
  assert.equal(greenhouse.detectChallenge(body), 'none');
  assert.equal(greenhouse.extractPostings(body).length, 1);
});

test('greenhouse: a job URL that is not https is refused', () => {
  const body = JSON.stringify({
    jobs: [
      { absolute_url: 'javascript:alert(1)', title: 'Bad' },
      { absolute_url: 'http://boards.example.test/acme/jobs/43', title: 'Plain http' },
      { absolute_url: 'https://boards.example.test/acme/jobs/44', title: 'Good' },
    ],
  });
  const ids = greenhouse.extractPostings(body).map((p) => p.id);
  assert.deepEqual(ids, ['44'], 'only https job links are postings');
});

test('every feed refuses a job link that is not https, not only Greenhouse', () => {
  const body = JSON.stringify([{ id: 2, position: 'Rust', url: 'javascript:alert(1)' }]);
  assert.equal(remoteok.extractPostings(body).length, 0, 'a javascript: link is not a posting');
});

test('hacker news: a comment id that is not digits is refused, so it cannot change the link', () => {
  const body = JSON.stringify({ hits: [{ objectID: '1&x=y', comment_text: 'We are hiring.' }] });
  assert.equal(hn.extractPostings(body).length, 0, 'an id that is not a number is not an id');
});
