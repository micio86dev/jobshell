// The posting schema shared by the bridge and MCP. Offline and pure.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parsePosting, parsePostings } from '../src/posting-input.ts';

const base = { source: 'remoteok', id: '1', title: 'Rust Engineer', url: 'https://example.test/1' };

test('a posting with a web url is accepted and absent optional fields are null', () => {
  const posting = parsePosting(base);
  assert.equal(posting?.url, 'https://example.test/1');
  assert.equal(posting?.company, null);
  assert.equal(posting?.remote_hint, null);
});

test('a link that is not http or https with a host is refused', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', 'https://', 'https://   ', 'http://']) {
    assert.equal(parsePosting({ ...base, url }), null, `${url} is not a posting link`);
  }
});

test('a wrong-typed optional field is absent, and an item without a usable core field is skipped', () => {
  const posting = parsePosting({ ...base, salary: 99, remote_hint: 'yes' });
  assert.equal(posting?.salary, null);
  assert.equal(posting?.remote_hint, null);
  assert.equal(parsePosting({ ...base, title: '   ' }), null);
  assert.deepEqual(parsePostings([base, 'nope', { ...base, id: 7 }]).map((p) => p.id), ['1']);
});
