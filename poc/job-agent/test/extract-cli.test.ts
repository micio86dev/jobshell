// The extraction CLI as a process: the refusals that happen before any key or network is touched.
// Offline. Characterization: the behaviour was built first, and these pin it at the process level.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const CLI = fileURLToPath(new URL('../src/extract-cv-cli.ts', import.meta.url));

const run = (args: string[], input: string) =>
  spawnSync(process.execPath, [CLI, ...args], { input, encoding: 'utf8' });

test('a bare --kind flag is refused with exit 2 and names the values it takes', () => {
  const result = run(['--kind'], 'some cv text');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--kind needs a value: cv or portfolio/);
  assert.equal(result.stdout, '');
});

test('an input past the byte bound is refused whole, as too long, and nothing is printed as a proposal', () => {
  const result = run([], 'é'.repeat(70_000));
  assert.equal(result.status, 2);
  assert.match(result.stderr, /the CV is too long/);
  assert.equal(result.stdout, '');
});
