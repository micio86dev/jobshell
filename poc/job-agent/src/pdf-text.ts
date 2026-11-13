/**
 * The text of a PDF, read in Node. The webview's own PDF reader failed on some files, so the
 * CV is read here, where the same reader is known to work. Only the text is returned; a file
 * with no selectable text returns an empty string, which the caller treats as no text.
 */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export const pdfText = async (bytes: Uint8Array): Promise<string> => {
  const pdf = await getDocument({ data: bytes, disableFontFace: true, verbosity: 0 }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= pdf.numPages; number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item && typeof item.str === 'string' ? item.str : '')).join(' '));
  }
  return pages.join('\n').trim();
};
