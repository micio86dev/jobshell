// Tests for the shared "already shown" memory. The point of this module is that a
// corrupt file is an error and a write never replaces history, so both are pinned.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { loadSeen, saveSeen } from '../src/seen.ts';

const dir = (): string => mkdtempSync(join(tmpdir(), 'openjob-seen-'));

test('no path at all is a legitimate first run', () => {
  assert.deepEqual([...loadSeen(null)], []);
});

test('a missing file is an error for an explicit path, a first run for the CLI', () => {
  assert.throws(() => loadSeen('/nonexistent/seen.json'), /unreadable/);
  assert.deepEqual([...loadSeen('/nonexistent/seen.json', 'empty')], []);
});

test('corrupt JSON and a non-array are errors that name the file', () => {
  const root = dir();
  const corrupt = join(root, 'corrupt.json');
  writeFileSync(corrupt, 'not json', 'utf8');
  assert.throws(
    () => loadSeen(corrupt),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /unreadable/);
      assert.ok(error.message.includes(corrupt), 'the message names the file');
      return true;
    },
  );

  const object = join(root, 'object.json');
  writeFileSync(object, '{"a":1}', 'utf8');
  assert.throws(() => loadSeen(object), /not a JSON array/);
});

test('a valid file of keys is read as it is', () => {
  const root = dir();
  const path = join(root, 'seen.json');
  writeFileSync(path, '["remoteok:1","hn:2"]', 'utf8');
  assert.deepEqual([...loadSeen(path)].sort(), ['hn:2', 'remoteok:1']);
});

test('a write merges into the existing history instead of replacing it', () => {
  const root = dir();
  const path = join(root, 'seen.json');
  writeFileSync(path, '["remoteok:1"]', 'utf8');

  saveSeen(path, ['hn:2']);

  assert.deepEqual([...loadSeen(path)].sort(), ['hn:2', 'remoteok:1']);
  assert.equal(readFileSync(path, 'utf8').trimEnd().endsWith(']'), true);
});

test('a write over a corrupt file fails instead of overwriting the history', () => {
  const root = dir();
  const path = join(root, 'seen.json');
  writeFileSync(path, 'not json', 'utf8');
  assert.throws(() => saveSeen(path, ['hn:2']), /unreadable/);
  assert.throws(() => loadSeen(path, 'empty'), /unreadable/, 'a corrupt file is never a first run');
  assert.equal(readFileSync(path, 'utf8'), 'not json', 'the corrupt file is left untouched for a human');
});

test('a corrupt entry in the memory file is an error, never silently dropped', () => {
  const dir = mkdtempSync(join(tmpdir(), 'seen-'));
  const path = join(dir, 'seen.json');
  writeFileSync(path, JSON.stringify(['hn:1', 42, 'hn:3']));
  assert.throws(() => loadSeen(path, 'empty'), /not a JSON array of keys/, 'a non-string key is corruption, not a key to skip');
  rmSync(dir, { recursive: true, force: true });
});

test('a save leaves no temporary or lock file behind, and the result is the merged keys', () => {
  const root = dir();
  const path = join(root, 'seen.json');
  writeFileSync(path, '["remoteok:1"]', 'utf8');
  saveSeen(path, ['hn:2']);
  assert.deepEqual(readdirSync(root).sort(), ['seen.json'], 'only the memory file remains');
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), ['hn:2', 'remoteok:1']);
});

test('a save that cannot take the lock refuses, and never overwrites the memory', () => {
  const root = dir();
  const path = join(root, 'seen.json');
  writeFileSync(path, '["remoteok:1"]', 'utf8');
  writeFileSync(`${path}.lock`, 'held by another run', 'utf8');
  assert.throws(() => saveSeen(path, ['hn:2']), /lock/i, 'another run holds the memory');
  assert.equal(readFileSync(path, 'utf8'), '["remoteok:1"]', 'the held memory is untouched');
  assert.equal(readFileSync(`${path}.lock`, 'utf8'), 'held by another run', 'the other run keeps its lock');
});
