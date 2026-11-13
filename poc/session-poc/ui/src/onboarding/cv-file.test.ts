import { describe, expect, it, vi } from 'vitest';

// The app loads the pdf.js worker through a Vite asset URL; in the test runner it is the file itself.
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: decodeURIComponent(new URL('../../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).pathname),
}));
import { cvFileKind, readCvFile } from './cv-file';
import { installBinaryPolyfills } from './binary-polyfill';

describe('cvFileKind', () => {
  it('accepts a PDF, a text file and a markdown file, by name or media type', () => {
    expect(cvFileKind({ name: 'cv.pdf', type: 'application/pdf' })).toBe('pdf');
    expect(cvFileKind({ name: 'cv.txt', type: 'text/plain' })).toBe('text');
    expect(cvFileKind({ name: 'cv.md', type: '' })).toBe('text');
  });

  it('refuses any other file, so no document is read as a CV by mistake', () => {
    expect(cvFileKind({ name: 'cv.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })).toBeNull();
    expect(cvFileKind({ name: 'photo.png', type: 'image/png' })).toBeNull();
  });
});

describe('binary polyfills for the PDF reader', () => {
  it('provides the hex and base64 conversions the PDF reader calls, with the standard results', () => {
    installBinaryPolyfills();
    const bytes = new Uint8Array([0, 1, 254, 255]);
    expect(bytes.toHex()).toBe('0001feff');
    expect(Uint8Array.fromHex('0001feff')).toEqual(bytes);
    expect(bytes.toBase64()).toBe('AAH+/w==');
    expect(Uint8Array.fromBase64('AAH+/w==')).toEqual(bytes);
  });

  it('refuses a hex string that is not an even run of hex digits, with a syntax error', () => {
    installBinaryPolyfills();
    expect(() => Uint8Array.fromHex('0g')).toThrow(SyntaxError);
    expect(() => Uint8Array.fromHex('abc')).toThrow(SyntaxError);
  });
});

/** A one-page PDF with the given text, built with correct offsets, for an offline read. */
const minimalPdf = (text: string): Uint8Array<ArrayBuffer> => {
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
  return new TextEncoder().encode(body) as Uint8Array<ArrayBuffer>;
};

describe('readCvFile on a PDF', () => {
  it('returns the selectable text of a PDF, even when the engine lacks the binary methods', async () => {
    const bytes = minimalPdf('Sviluppatore Rust');
    const file = new File([bytes], 'cv.pdf', { type: 'application/pdf' });
    expect(await readCvFile(file)).toContain('Sviluppatore Rust');
  });
});
