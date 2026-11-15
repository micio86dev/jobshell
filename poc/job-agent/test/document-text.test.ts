// The text a generated CV or letter ships with must read as written by the candidate:
// no dashes that mark machine output, no arrows, check marks, emoji or curly quotes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanForDocument } from '../src/tailor.ts';

test('an em dash becomes a comma and a dash between years becomes a hyphen', () => {
  assert.equal(cleanForDocument('Senior developer — Rust team, 2019–2021'), 'Senior developer, Rust team, 2019-2021');
  assert.equal(cleanForDocument('backend—frontend'), 'backend, frontend');
});

test('arrows, check marks, bullets and emoji are removed', () => {
  assert.equal(cleanForDocument('Python → Rust ✓ shipped 🚀 done'), 'Python, Rust shipped done');
  assert.equal(cleanForDocument('• first ★ second'), 'first second');
});

test('curly quotes become straight quotes and accents are kept', () => {
  assert.equal(cleanForDocument('“Responsabile” di progetto, perché no’'), '"Responsabile" di progetto, perché no\'');
});
