import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isAllowed, parseRobots, robotsPathOf, robotsPolicyFor } from '../src/lib/robots.ts';

const UA = 'openjob-phase0-probe';

test('robotsPathOf keeps the query string, which patterns are matched against', () => {
  assert.equal(robotsPathOf('https://example.com/a/b?c=1'), '/a/b?c=1');
  assert.equal(robotsPathOf('https://example.com/'), '/');
});

test('a wildcard group applies when no specific agent matches', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /private\n', UA);
  assert.equal(rules.matched_group, '*');
  assert.equal(isAllowed('https://example.com/private/x', rules), false);
  assert.equal(isAllowed('https://example.com/public', rules), true);
});

test('a specific agent group wins over the wildcard', () => {
  const text = ['User-agent: *', 'Disallow: /', '', 'User-agent: openjob', 'Disallow: /only-this'].join('\n');
  const rules = parseRobots(text, UA);
  assert.equal(rules.matched_group, 'openjob');
  assert.equal(isAllowed('https://example.com/anything', rules), true);
  assert.equal(isAllowed('https://example.com/only-this', rules), false);
});

test('the longest matching agent token wins', () => {
  const text = ['User-agent: openjob', 'Disallow: /a', '', 'User-agent: openjob-phase0-probe', 'Disallow: /b'].join('\n');
  const rules = parseRobots(text, UA);
  assert.equal(rules.matched_group, 'openjob-phase0-probe');
  assert.equal(isAllowed('https://example.com/a', rules), true);
  assert.equal(isAllowed('https://example.com/b', rules), false);
});

test('an empty Disallow means everything is allowed', () => {
  const rules = parseRobots('User-agent: *\nDisallow:\n', UA);
  assert.deepEqual(rules.rules, []);
  assert.equal(isAllowed('https://example.com/anything', rules), true);
});

test('comments and blank lines are ignored', () => {
  const rules = parseRobots('# a comment\n\nUser-agent: *  # inline\nDisallow: /x  # why\n', UA);
  assert.deepEqual(rules.rules, [{ allow: false, pattern: '/x' }]);
  assert.equal(isAllowed('https://example.com/x', rules), false);
});

test('a pattern without an end anchor matches as a prefix (RFC 9309 2.2.2)', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /*/jobs\n', UA);
  // `*` is any run of characters, and an unanchored pattern matches a prefix,
  // so both the collection and its items are disallowed.
  assert.equal(isAllowed('https://example.com/api/v1/jobs', rules), false);
  assert.equal(isAllowed('https://example.com/api/v1/jobs/2', rules), false);
  assert.equal(isAllowed('https://example.com/api/v1/jobsboard', rules), false);
  assert.equal(isAllowed('https://example.com/api/v1/roles', rules), true);
});

test('a dollar anchor matches only the exact path ending', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /*.json$\n', UA);
  assert.equal(isAllowed('https://example.com/data.json', rules), false);
  // The query string is part of the matched path, so the anchor no longer holds.
  assert.equal(isAllowed('https://example.com/data.json?x=1', rules), true);
  assert.equal(isAllowed('https://example.com/data.json/extra', rules), true);
});

test('the longest matching rule wins', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /a\nAllow: /a/b\n', UA);
  assert.equal(isAllowed('https://example.com/a/c', rules), false);
  assert.equal(isAllowed('https://example.com/a/b/c', rules), true);
});

test('Allow breaks a tie at equal pattern length', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /x\nAllow: /x\n', UA);
  assert.equal(isAllowed('https://example.com/x', rules), true);
});

test('crawl-delay is reported from the matched group', () => {
  const rules = parseRobots('User-agent: openjob\nCrawl-delay: 2.5\nDisallow: /z\n', UA);
  assert.equal(rules.crawl_delay_seconds, 2.5);
});

test('crawl-delay from the wildcard group does not override a specific group', () => {
  const text = ['User-agent: *', 'Crawl-delay: 10', '', 'User-agent: openjob', 'Disallow: /z'].join('\n');
  const rules = parseRobots(text, UA);
  assert.equal(rules.crawl_delay_seconds, null);
});

test('an empty robots.txt allows everything', () => {
  const rules = parseRobots('', UA);
  assert.deepEqual(rules.rules, []);
  assert.equal(rules.matched_group, null);
  assert.equal(isAllowed('https://example.com/anything', rules), true);
});

test('a robots.txt that disallows everything blocks every path', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /\n', UA);
  assert.equal(isAllowed('https://example.com/', rules), false);
  assert.equal(isAllowed('https://example.com/a/b/c', rules), false);
});

test('regex metacharacters in a pattern are literal', () => {
  const rules = parseRobots('User-agent: *\nDisallow: /a+b(c)\n', UA);
  assert.equal(isAllowed('https://example.com/a+b(c)', rules), false);
  assert.equal(isAllowed('https://example.com/aab(c)', rules), true);
});

test('a 2xx robots.txt governs the origin', () => {
  const policy = robotsPolicyFor(200, 'User-agent: *\nDisallow: /private\n', UA);
  assert.equal(policy.origin_allowed, true);
  assert.equal(isAllowed('https://example.com/private', policy.rules), false);
});

test('a 4xx robots.txt means no published policy, so access is allowed', () => {
  for (const status of [401, 403, 404, 410]) {
    const policy = robotsPolicyFor(status, '', UA);
    assert.equal(policy.origin_allowed, true, `status ${status}`);
    assert.deepEqual(policy.rules.rules, []);
  }
});

test('a 5xx robots.txt means the origin is treated as fully disallowed', () => {
  const policy = robotsPolicyFor(503, '', UA);
  assert.equal(policy.origin_allowed, false);
  assert.match(policy.reason, /503/);
});

test('an unreachable robots.txt means the origin is treated as fully disallowed', () => {
  const policy = robotsPolicyFor(null, '', UA);
  assert.equal(policy.origin_allowed, false);
  assert.match(policy.reason, /unreachable/);
});

test('an oversized pattern makes the policy unusable instead of compiling a huge regex', () => {
  const pattern = `/${'a'.repeat(600)}`;
  const policy = robotsPolicyFor(200, `User-agent: *\nDisallow: ${pattern}\n`, UA);
  assert.equal(policy.rules.unusable, true);
  assert.equal(policy.origin_allowed, false);
  assert.deepEqual(policy.rules.rules, []);
});

test('too many wildcards make the policy unusable', () => {
  const pattern = `/${'*/'.repeat(20)}`;
  const policy = robotsPolicyFor(200, `User-agent: *\nDisallow: ${pattern}\n`, UA);
  assert.equal(policy.rules.unusable, true);
  assert.equal(policy.origin_allowed, false);
});

test('an ordinary pattern is not marked unusable', () => {
  const policy = robotsPolicyFor(200, 'User-agent: *\nDisallow: /*/jobs\n', UA);
  assert.equal(policy.rules.unusable, false);
  assert.equal(policy.origin_allowed, true);
});
