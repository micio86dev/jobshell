// Tests for read-only keyring access. The `security` CLI is injected, so these
// tests never read the real keychain and never need an unlocked login session.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { SERVICE, makeRunner, readSecret, type Runner } from '../src/secrets.ts';

const runnerReturning =
  (status: number, stdout = '', stderr = ''): Runner =>
  () => ({ status, stdout, stderr });

test('a stored secret is returned without trailing whitespace', () => {
  const value = readSecret('anthropic', runnerReturning(0, 'sk-test-value\n'));
  assert.equal(value, 'sk-test-value');
});

test('the CLI is asked for the fixed service and the named account', () => {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const runner: Runner = (cmd, args) => {
    calls.push({ cmd, args });
    return { status: 0, stdout: 'value', stderr: '' };
  };
  readSecret('typesafe', runner);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.cmd, 'security');
  assert.deepEqual(calls[0]?.args, ['find-generic-password', '-s', SERVICE, '-a', 'typesafe', '-w']);
  assert.equal(SERVICE, 'openjob-agent');
});

test('a missing entry returns null instead of throwing', () => {
  const value = readSecret('qwen', runnerReturning(44, '', 'security: The specified item could not be found in the keychain.'));
  assert.equal(value, null);
});

test('a failing CLI throws a message naming the account and never the secret', () => {
  assert.throws(
    () => readSecret('anthropic', runnerReturning(1, '', 'sk-should-not-appear')),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /anthropic/);
      assert.doesNotMatch(error.message, /sk-should-not-appear/);
      return true;
    },
  );
});

test('a killed or timed-out CLI is reported as 124, never as success', () => {
  const timedOut = makeRunner(() => ({ status: null, error: new Error('ETIMEDOUT') }));
  assert.deepEqual(timedOut('security', []), { status: 124, stdout: '', stderr: '' });

  const killed = makeRunner(() => ({ status: null }));
  assert.equal(killed('security', []).status, 1, 'a null status without an error is still a failure');

  const fine = makeRunner(() => ({ status: 0, stdout: 'value\n' }));
  assert.deepEqual(fine('security', []), { status: 0, stdout: 'value\n', stderr: '' });
});

test('the timeout is passed to the spawn call, so a hung keychain cannot block', () => {
  const seen: Array<{ encoding: 'utf8'; timeout: number }> = [];
  const runner = makeRunner((_command, _args, options) => {
    seen.push(options);
    return { status: 0, stdout: 'v' };
  });
  runner('security', []);
  assert.equal(seen[0]?.encoding, 'utf8');
  assert.ok((seen[0]?.timeout ?? 0) > 0, 'a bounded timeout is required');
});
