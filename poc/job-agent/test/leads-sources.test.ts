// The signal sources parse recorded real bodies (public pages, trimmed). Offline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { hnHiring, hnJobs, sifted, SIGNAL_SOURCES, techcrunchStartups, ycHiring } from '../src/leads/sources.ts';

const fixture = (name: string): string => readFileSync(new URL(`./fixtures/leads/${name}`, import.meta.url), 'utf8');
const now = new Date('2026-11-24T12:00:00Z');
const LIST = hnHiring.requests(now)[0] ?? '';

test('the HN source starts from the thread list and follows the newest "Who is hiring" thread, not the "wants to be hired" one', () => {
  const urls = hnHiring.follow?.(fixture('hn-thread-list.json'), { now, url: LIST }) ?? [];
  assert.ok(urls.length >= 1);
  assert.ok(urls[0]?.includes('story_50338728'), 'the November hiring thread');
  assert.ok(urls.every((url) => !url.includes('50338726')), 'never the thread where people offer themselves');
});

test('a thread older than forty days is not followed', () => {
  assert.deepEqual(hnHiring.follow?.(fixture('hn-thread-list.json'), { now: new Date('2027-02-01T00:00:00Z'), url: LIST }), []);
});

test('a comment page follows nothing further and the thread list yields no signal', () => {
  assert.deepEqual(hnHiring.follow?.('{}', { now, url: 'https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_1' }), []);
  assert.deepEqual(hnHiring.parse(fixture('hn-thread-list.json'), { now, url: LIST }), []);
});

test('top-level hiring comments become signals with the company read from the first line', () => {
  const signals = hnHiring.parse(fixture('hn-thread-comments.json'), { now, url: 'https://hn.algolia.com/api/v1/search_by_date?tags=comment,story_50338728&page=0' });
  const companies = signals.map((signal) => signal.company_name);
  assert.ok(companies.includes('outGoing'));
  assert.ok(companies.includes('Common Prefix'));
  const common = signals.find((signal) => signal.company_name === 'Common Prefix');
  assert.equal(common?.source, 'hn-hiring');
  assert.equal(common?.remote_hint, true);
  assert.match(common?.url ?? '', /^https:\/\/news\.ycombinator\.com\/item\?id=\d+$/);
  assert.ok(!(common?.title ?? '').includes('&#x'), 'entities are decoded');
});

test('a reply, and a person offering their own work, are not companies seeking help', () => {
  const signals = hnHiring.parse(fixture('hn-thread-comments.json'), { now, url: 'x' });
  assert.ok(signals.every((signal) => !/are you still accepting/i.test(signal.title)), 'a reply is skipped');
  assert.ok(signals.every((signal) => !/^SEEKING FREELANCE/i.test(signal.title)), 'an offer of work is skipped');
});

test('the YC job posts name the company and keep the link the post carries', () => {
  const signals = hnJobs.parse(fixture('hn-jobs.json'), { now, url: 'x' });
  assert.ok(signals.length >= 3);
  const easypost = signals.find((signal) => signal.title.startsWith('EasyPost'));
  assert.equal(easypost?.company_name, 'EasyPost');
  assert.equal(easypost?.url, 'https://www.easypost.com/careers/');
});

test('only funding news becomes a signal, and the company is named only when the title says so plainly', () => {
  const signals = techcrunchStartups.parse(fixture('techcrunch-startups.xml'), { now, url: 'x' });
  assert.ok(signals.length > 0);
  assert.ok(signals.every((signal) => signal.type === 'funding' && signal.source === 'techcrunch-startups'));
  const supertake = signals.find((signal) => signal.title.startsWith('Supertake raises'));
  assert.equal(supertake?.company_name, 'Supertake');
  // "Spend management platform Payhawk announces ..." is not a name: it stays unidentified, never guessed.
  assert.ok(signals.every((signal) => signal.company_name === null || signal.company_name.split(' ').length <= 3));
});

test('Sifted funding news is read the same way, with the date the feed gives', () => {
  const signals = sifted.parse(fixture('sifted.xml'), { now, url: 'x' });
  assert.ok(signals.length > 0);
  assert.ok(signals.every((signal) => signal.published_at !== null));
  assert.equal(signals.find((signal) => signal.title.startsWith('Defence startup Agon raises'))?.type, 'funding');
});

test('YC companies that are hiring become hiring signals, and an inactive one is dropped', () => {
  const signals = ycHiring.parse(fixture('yc-hiring.json'), { now, url: 'x' });
  assert.equal(signals.length, 3);
  assert.ok(signals.every((signal) => signal.type === 'hiring_growth' && signal.published_at === null));
  assert.ok(signals.every((signal) => signal.url.startsWith('https://www.ycombinator.com/companies/')));
  assert.ok(!signals.some((signal) => signal.company_name === 'Dead Co'));
  assert.match(signals[0]?.text ?? '', /Team size \d+/);
});

test('a source never throws on a body that is not what it expects', () => {
  for (const source of SIGNAL_SOURCES) {
    assert.deepEqual(source.parse('<html>nope</html>', { now, url: 'x' }), []);
    assert.deepEqual(source.parse('', { now, url: 'x' }), []);
  }
});

test('signal ids are stable across reads', () => {
  const a = hnJobs.parse(fixture('hn-jobs.json'), { now, url: 'x' });
  const b = hnJobs.parse(fixture('hn-jobs.json'), { now: new Date('2027-01-01'), url: 'x' });
  assert.deepEqual(a.map((signal) => signal.id), b.map((signal) => signal.id));
});
