// Manual import: the way a lead enters from a place the agent may not read by itself.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import type { FetchLike } from '../src/jev.ts';
import { buildImportSignal, fetchImportPage, importSignal, refuseLink, saveImport, takeImports } from '../src/leads/import.ts';

const now = new Date('2026-11-24T12:00:00Z');
const POST = 'Cerchiamo un senior Laravel freelance per un progetto B2B di sei mesi, remoto, partita IVA. Scrivere in privato.';

const page = (routes: Record<string, { status: number; text: string }>): { urls: string[]; fetchImpl: FetchLike } => {
  const urls: string[] = [];
  return { urls, fetchImpl: async (url) => { urls.push(url); return routes[url] ?? { status: 404, text: '' }; } };
};

test('a pasted post becomes a manual signal with a stable id and no invented company', () => {
  const signal = buildImportSignal({ text: POST, url: null }, now);
  assert.ok(!('error' in signal));
  if ('error' in signal) return;
  assert.equal(signal.type, 'manual_import');
  assert.equal(signal.company_name, null);
  assert.equal(signal.remote_hint, true);
  assert.match(signal.url, /^manual:\/\/import\//);
  const again = buildImportSignal({ text: `  ${POST}  `, url: null }, new Date('2027-01-01'));
  assert.ok(!('error' in again));
  if (!('error' in again)) assert.equal(again.id, signal.id);
});

test('a text too short to read is refused with what to do', () => {
  assert.deepEqual(buildImportSignal({ text: 'hi', url: null }, now), { error: 'the text is too short to read: paste the whole post' });
});

test('a login-walled site is never fetched: the user is asked to paste the text', async () => {
  const { urls, fetchImpl } = page({});
  const result = await importSignal({ url: 'https://www.facebook.com/groups/laravel/posts/1' }, { fetchImpl, now });
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /paste the text/);
  assert.equal(urls.length, 0);
});

test('only a public https host is read: no http, no address, no local name', () => {
  assert.notEqual(refuseLink('http://example.com/a'), null);
  assert.notEqual(refuseLink('https://127.0.0.1/a'), null);
  assert.notEqual(refuseLink('https://localhost/a'), null);
  assert.notEqual(refuseLink('https://intranet/a'), null);
  assert.notEqual(refuseLink('https://printer.local/a'), null);
  assert.equal(refuseLink('https://jobs.example.com/a'), null);
});

test('a public page is read after its robots.txt, and its text becomes the signal', async () => {
  const { urls, fetchImpl } = page({
    'https://jobs.example.com/robots.txt': { status: 404, text: '' },
    'https://jobs.example.com/p/1': { status: 200, text: `<html><script>var x=1</script><body><h1>Freelance Laravel</h1><p>${POST}</p></body></html>` },
  });
  const result = await importSignal({ url: 'https://jobs.example.com/p/1' }, { fetchImpl, now });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.signal.url, 'https://jobs.example.com/p/1');
  assert.ok(result.signal.text?.includes('Laravel freelance'));
  assert.ok(!result.signal.text?.includes('var x'));
  assert.deepEqual(urls, ['https://jobs.example.com/robots.txt', 'https://jobs.example.com/p/1']);
});

test('a page robots.txt refuses is not requested, and an unreadable robots.txt stops the read', async () => {
  const refused = page({ 'https://jobs.example.com/robots.txt': { status: 200, text: 'User-agent: *\nDisallow: /p/' } });
  const first = await fetchImportPage('https://jobs.example.com/p/1', refused.fetchImpl);
  assert.equal(first.ok, false);
  assert.deepEqual(refused.urls, ['https://jobs.example.com/robots.txt']);
  const unreadable = page({ 'https://jobs.example.com/robots.txt': { status: 500, text: '' } });
  assert.equal((await fetchImportPage('https://jobs.example.com/p/1', unreadable.fetchImpl)).ok, false);
});

test('an import with neither text nor link says what to provide', async () => {
  const { fetchImpl } = page({});
  const result = await importSignal({}, { fetchImpl, now });
  assert.deepEqual(result, { ok: false, reason: 'paste the text of the post or give a public link' });
});

test('imports wait in a folder, are read once, and a double click is one import', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobshell-import-'));
  const built = buildImportSignal({ text: POST, url: null }, now);
  assert.ok(!('error' in built));
  if ('error' in built) return;
  saveImport(dir, built);
  saveImport(dir, built);
  assert.equal(readdirSync(join(dir, 'imports')).length, 1);
  assert.equal(takeImports(dir).length, 1);
  assert.equal(takeImports(dir).length, 0);
});

test('a redirect is never followed: the target could be a private address or a walled site', async () => {
  const redirects = page({ 'https://jobs.example.com/robots.txt': { status: 404, text: '' }, 'https://jobs.example.com/p/1': { status: 302, text: '' } });
  const result = await fetchImportPage('https://jobs.example.com/p/1', redirects.fetchImpl);
  assert.equal(result.ok, false);
  assert.match(result.ok ? '' : result.reason, /redirects/);
  const robotsRedirect = page({ 'https://jobs.example.com/robots.txt': { status: 301, text: '' } });
  assert.equal((await fetchImportPage('https://jobs.example.com/p/1', robotsRedirect.fetchImpl)).ok, false);
  assert.deepEqual(robotsRedirect.urls, ['https://jobs.example.com/robots.txt']);
});

test('a damaged or edited import file is ignored, not trusted and not fatal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jobshell-import-bad-'));
  mkdirSync(join(dir, 'imports'));
  writeFileSync(join(dir, 'imports', 'a.json'), JSON.stringify({ id: 'x', title: 'only two fields' }));
  writeFileSync(join(dir, 'imports', 'b.json'), '{not json');
  assert.deepEqual(takeImports(dir), []);
  assert.equal(readdirSync(join(dir, 'imports')).length, 2, 'nothing is deleted or marked done');
});
