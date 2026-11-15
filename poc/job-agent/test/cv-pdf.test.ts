// The CV PDF: plain text, so an applicant tracking system can read it. Each test reads the
// generated file back with the same reader the CV intake uses, so the check is on the bytes.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { markdownToPdf } from '../src/cv-pdf.ts';
import { pdfText } from '../src/pdf-text.ts';

test('the text of a short CV comes back out of the PDF', async () => {
  const pdf = markdownToPdf('# Profilo\nSviluppatore Rust, perché conosce il desktop.');
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /Profilo/);
  assert.match(text, /Sviluppatore Rust, perché conosce il desktop\./, 'accents survive');
});

test('markdown markers are removed; bullets become a bullet character', async () => {
  const pdf = markdownToPdf('## Competenze\n- **Rust**, `cargo`\n- Tauri');
  const text = await pdfText(new Uint8Array(pdf));
  assert.doesNotMatch(text, /\*\*|`|##/);
  assert.match(text, /Rust, cargo/);
  assert.match(text, /Tauri/);
});

test('parentheses and backslashes are escaped, so they print as written', async () => {
  const pdf = markdownToPdf('Esperienza (2020-2024) \\ path');
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /Esperienza \(2020-2024\) \\ path/);
});

test('a long CV spans several pages and keeps every line', async () => {
  const lines = Array.from({ length: 120 }, (_, index) => `Riga ${index + 1} del curriculum.`);
  const pdf = markdownToPdf(lines.join('\n'));
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /Riga 1 del curriculum\./);
  assert.match(text, /Riga 120 del curriculum\./);
  // 120 lines at 14 pt on an A4 page with 50 pt margins: 742 pt of text height, 53 lines a page.
  assert.match(pdf.toString('latin1'), /\/Count 3 /, 'three pages, not one overflowing line');
});

test('a character outside the Latin-1 range is replaced, not written as broken bytes', async () => {
  const pdf = markdownToPdf('Lingua: 日本語 e Rust');
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /Rust/);
});

test('the name is set large, sections are capitals with a rule under them', async () => {
  const markdown = '# Mario Rossi\nmario@example.test | Roma\n\n## Esperienza\n- Sviluppo Rust';
  const pdf = markdownToPdf(markdown);
  const raw = pdf.toString('latin1');
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /ESPERIENZA/, 'section titles are capitals');
  assert.match(raw, /\/F2 22 Tf/, 'the name is in bold, 22 points');
  assert.match(raw, / m \S+ \S+ l S/, 'a rule is drawn under each section title');
});

test('bullets hang: the bullet sits left of its text, and the text colour is set', () => {
  const raw = markdownToPdf('## Competenze\n- Rust e Tauri').toString('latin1');
  assert.match(raw, /\(\x95\) Tj/, 'the bullet glyph is drawn on its own');
  assert.match(raw, /0\.13 0\.13 0\.13 rg/, 'body text is set in a dark ink, not pure black');
});

test('contact lines right under the name are muted', () => {
  const raw = markdownToPdf('# Mario\nmario@example.test').toString('latin1');
  assert.match(raw, /0\.42 0\.42 0\.42 rg/);
});
