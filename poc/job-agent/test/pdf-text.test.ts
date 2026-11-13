// The PDF reader turns a PDF into its text, offline. The fixture is a one-page PDF built here.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { pdfText } from '../src/pdf-text.ts';

const minimalPdf = (text: string): Uint8Array => {
  const stream = `BT /F1 24 Tf 20 60 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
};

test('a PDF with selectable text returns that text', async () => {
  assert.match(await pdfText(minimalPdf('Sviluppatore Rust')), /Sviluppatore Rust/);
});

test('bytes that are not a PDF are refused with an error, never read as text', async () => {
  await assert.rejects(pdfText(new TextEncoder().encode('not a pdf')));
});
