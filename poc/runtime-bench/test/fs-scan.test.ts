import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';

import { findFilesNamed, parseJsonUnknown, run } from '../src/lib/fs-scan.ts';

const tmpRoots: string[] = [];

const makeTree = (): string => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openjob-scan-'));
  tmpRoots.push(root);
  const layout = ['cli/Cargo.toml', 'Cargo.toml', 'node_modules/x/Cargo.toml', 'deep/a/b/c/Cargo.toml'];
  for (const rel of layout) {
    const full = path.join(root, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '[package]\n');
  }
  return root;
};

after(() => {
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true });
});

test('findFilesNamed finds manifests up to the depth limit and skips vendor directories', () => {
  const root = makeTree();
  const found = findFilesNamed(root, root, 'Cargo.toml', 2);
  assert.deepEqual(found, ['Cargo.toml', 'cli/Cargo.toml']);
});

test('findFilesNamed returns relative paths sorted for stable evidence', () => {
  const root = makeTree();
  const found = findFilesNamed(root, root, 'Cargo.toml', 5);
  assert.deepEqual(found, ['Cargo.toml', 'cli/Cargo.toml', 'deep/a/b/c/Cargo.toml']);
});

test('findFilesNamed throws for a missing directory instead of reporting no match', () => {
  assert.throws(() => findFilesNamed('/nonexistent-openjob-dir', '/tmp', 'Cargo.toml', 1));
});

test('run distinguishes success from failure and keeps stderr', () => {
  const ok = run(os.tmpdir(), 'git', ['--version']);
  assert.equal(ok.ok, true);
  assert.match(ok.stdout, /git version/);
  assert.equal(ok.exit_code, 0);

  const failed = run(os.tmpdir(), 'git', ['--definitely-not-a-flag']);
  assert.equal(failed.ok, false);
  assert.equal(failed.stdout, '');
  assert.equal(failed.exit_code, 129);
  assert.match(failed.stderr, /unknown option|usage/i);
});

test('run reports failure with a non-zero exit code for a missing binary', () => {
  const failed = run(os.tmpdir(), 'openjob-definitely-not-a-binary', []);
  assert.equal(failed.ok, false);
  assert.equal(failed.stdout, '');
  assert.notEqual(failed.exit_code, 0);
});

test('parseJsonUnknown returns null for invalid JSON and the value otherwise', () => {
  assert.equal(parseJsonUnknown('{not json'), null);
  assert.deepEqual(parseJsonUnknown('{"a":1}'), { a: 1 });
});
