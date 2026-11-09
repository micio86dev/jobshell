// Tests for reading the keys. Writing happens in the desktop app through the OS keyring,
// so there is nothing here that could put a secret in a file.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { KEY_ACCOUNTS, asKeyAccount, keyStatus, readKey } from '../src/keys.ts';

/** The real keyring holds the user's own keys; these tests never read it. */
const noKeyring = (): null => null;

test('a key present in the keyring is returned', () => {
  const keyring = (account: string): string | null => (account === 'typesafe' ? 'ts_test' : null);
  assert.equal(readKey('typesafe', keyring), 'ts_test');
});

test('an absent key is null, not an empty string', () => {
  assert.equal(readKey('typesafe', noKeyring), null);
});

test('an empty entry is treated as absent', () => {
  const keyring = (): string => '   ';
  assert.equal(readKey('typesafe', keyring), null, 'whitespace is not a key');
});

test('the status reports which accounts have one, and nothing else', () => {
  const keyring = (account: string): string | null => (account === 'qwen' ? 'q' : null);
  assert.deepEqual(keyStatus(keyring), { typesafe: false, anthropic: false, qwen: true });
  assert.deepEqual([...KEY_ACCOUNTS], ['typesafe', 'anthropic', 'qwen']);
});

test('only the known accounts are accepted', () => {
  assert.equal(asKeyAccount('typesafe'), 'typesafe');
  assert.equal(asKeyAccount('openai'), null);
  assert.equal(asKeyAccount(42), null);
});
