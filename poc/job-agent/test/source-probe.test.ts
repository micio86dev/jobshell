// Tests for the pure parts of the live source probe: the robots.txt rule and the verdict for one
// probed URL. The network part lives in the CLI and is never run by the test suite.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { robotsAllows, verdictOf } from '../src/source-probe.ts';

test('robots: an empty or absent policy allows everything', () => {
  assert.equal(robotsAllows('', '/anything'), true);
});

test('robots: a blanket disallow for every agent refuses every path', () => {
  // The SmartRecruiters case recorded in Phase 0: answers 200, but its robots.txt disallows everything.
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n', '/v1/companies/x/postings'), false);
});

test('robots: a specific disallow refuses only its prefix, and the longest rule wins', () => {
  const robots = 'User-agent: *\nDisallow: /apply\nAllow: /\n';
  assert.equal(robotsAllows(robots, '/apply/now'), false);
  assert.equal(robotsAllows(robots, '/jobs/api'), true);
});

test('robots: an allow longer than a disallow re-opens its path', () => {
  const robots = 'User-agent: *\nDisallow: /jobs\nAllow: /jobs/api\n';
  assert.equal(robotsAllows(robots, '/jobs/api'), true);
  assert.equal(robotsAllows(robots, '/jobs/other'), false);
});

test('robots: a wildcard in a rule matches the way the crawler reads it', () => {
  // The Himalayas pattern: pagination parameters are refused, the public API path is not.
  const robots = 'User-agent: *\nDisallow: /jobs*&page=\nDisallow: /jobs/*?page=\n';
  assert.equal(robotsAllows(robots, '/jobs?q=dev&page=2'), false);
  assert.equal(robotsAllows(robots, '/jobs/api?limit=100'), true);
});

test('robots: only the rules of the wildcard group apply to this client', () => {
  const robots = 'User-agent: somebot\nDisallow: /\n\nUser-agent: *\nDisallow: /private\n';
  assert.equal(robotsAllows(robots, '/jobs'), true);
  assert.equal(robotsAllows(robots, '/private/x'), false);
});

test('verdict: a posting that passes every gate is ok', () => {
  assert.equal(verdictOf({ status: 200, challenge: 'none', postings: 3, robotsAllowed: true }), 'ok');
});

test('verdict: a refusal by robots is recorded before any other fact', () => {
  assert.equal(verdictOf({ status: 200, challenge: 'none', postings: 3, robotsAllowed: false }), 'blocked_by_robots');
});

test('verdict: a publisher refusal (403, 429) is recorded as blocked, never retried', () => {
  assert.equal(verdictOf({ status: 403, challenge: 'none', postings: 0, robotsAllowed: true }), 'blocked_by_publisher');
  assert.equal(verdictOf({ status: 429, challenge: 'none', postings: 0, robotsAllowed: true }), 'blocked_by_publisher');
});

test('verdict: another HTTP error, a challenge and an empty board are three different outcomes', () => {
  assert.equal(verdictOf({ status: 404, challenge: 'none', postings: 0, robotsAllowed: true }), 'http_error');
  assert.equal(verdictOf({ status: 200, challenge: 'captcha', postings: 0, robotsAllowed: true }), 'challenge');
  assert.equal(verdictOf({ status: 200, challenge: 'none', postings: 0, robotsAllowed: true }), 'empty');
});
