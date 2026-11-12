// The text normaliser for job descriptions. Offline and pure.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { text } from '../src/sources/types.ts';

test('an escaped tag in a description is text, not markup to strip', () => {
  assert.equal(text('<p>Use &lt;b&gt; tags &amp; more</p>'), 'Use <b> tags & more');
});

test('an escaped entity is decoded once: &amp;lt; is the text &lt;, not <', () => {
  assert.equal(text('&amp;lt;'), '&lt;');
});

test('markup is stripped and the whitespace collapsed', () => {
  assert.equal(text('<div>Rust&nbsp;&nbsp;engineer</div>\n<p>remote</p>'), 'Rust engineer remote');
});
