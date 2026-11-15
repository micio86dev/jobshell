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

test('a job title is bold and the date line under it is muted, so the entry reads at a glance', () => {
  const raw = markdownToPdf('### Sviluppatore Full Stack, Azienda\n2021 - oggi').toString('latin1');
  assert.match(raw, /\/F2 10\.5 Tf [\d.]+ [\d.]+ Td \(Sviluppatore Full Stack, Azienda\)/, 'the title is bold');
  assert.match(raw, /0\.42 0\.42 0\.42 rg\nBT \/F1 9\.5 Tf [\d.]+ [\d.]+ Td \(2021 - oggi\)/, 'the date is muted');
});

test('a sentence that fits the measure stays on one row instead of wrapping early', () => {
  const sentence = 'Sviluppo applicazioni web moderne con Rust e Vue, attenzione a performance e sicurezza.';
  const raw = markdownToPdf(sentence).toString('latin1');
  assert.equal((raw.match(/\) Tj/g) ?? []).length, 1, 'one row of text, not two');
});

test('an en dash in a date range and curly quotes print as the dash and quotes, not question marks', async () => {
  const pdf = markdownToPdf('Dal 2019 – 2021, ruolo “senior”');
  const text = await pdfText(new Uint8Array(pdf));
  assert.doesNotMatch(text, /\?/, 'no replacement marks');
  assert.match(text, /2019 – 2021/);
  assert.match(text, /“senior”/);
});

test('a decomposed accent prints as one accented letter', async () => {
  const pdf = markdownToPdf('Perchè no'); // "Perche" + combining grave accent
  const text = await pdfText(new Uint8Array(pdf));
  assert.match(text, /Perchè no/);
});

test('wide capitals wrap before the right margin instead of running past it', () => {
  // Thirty "WW" words at 10 pt are about 650 pt of Helvetica, wider than the 483 pt measure: two rows.
  const raw = markdownToPdf('WW '.repeat(30).trim()).toString('latin1');
  assert.equal((raw.match(/\) Tj/g) ?? []).length, 2);
});

test('contact lines right under the name are muted', () => {
  const raw = markdownToPdf('# Mario\nmario@example.test').toString('latin1');
  assert.match(raw, /0\.42 0\.42 0\.42 rg/);
});
