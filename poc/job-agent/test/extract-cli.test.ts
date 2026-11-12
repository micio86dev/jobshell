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

test('a --kind that is neither cv nor portfolio is refused by the CLI itself, before any key is read', () => {
  const result = run(['--kind', 'resume'], 'some cv text');
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--kind must be cv or portfolio/);
  assert.equal(result.stdout, '');
});

const PORTFOLIO_CLI = fileURLToPath(new URL('../src/portfolio-link-cli.ts', import.meta.url));

test('the portfolio check refuses a link that is not a public https address, before any request', () => {
  const result = spawnSync(process.execPath, [PORTFOLIO_CLI], { input: 'http://192.168.1.10/me\n', encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /the portfolio link must be a public https address/);
  assert.equal(result.stdout, '');
});
