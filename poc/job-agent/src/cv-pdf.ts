/**
 * The CV as a PDF: plain text on A4, standard Helvetica, no images and no embedded fonts. That
 * is what an applicant tracking system reads reliably. Markdown is reduced to its text: headings
 * become bold lines, bullets become a bullet character, and the markers are removed.
 *
 * Characters outside Latin-1 cannot be drawn with the standard fonts, so they become "?".
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 50;
const BODY_SIZE = 10;
const WRAP_COLUMNS = 92;

type Line = { text: string; size: number; bold: boolean };

const cleanMarkers = (text: string): string =>
  text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]*)`/g, '$1');

/** Split a line into rows that fit the column at this font size. */
const wrap = (text: string, size: number, bold: boolean): Line[] => {
  const columns = Math.max(20, Math.floor((WRAP_COLUMNS * BODY_SIZE) / size));
  const rows: Line[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length > columns && current.length > 0) {
      rows.push({ text: current, size, bold });
      current = word;
    } else {
      current = next;
    }
  }
  rows.push({ text: current, size, bold });
  return rows;
};

const toLines = (markdown: string): Line[] => {
  const lines: Line[] = [];
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) {
      lines.push({ text: '', size: BODY_SIZE, bold: false });
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const size = heading[1]?.length === 1 ? 14 : 12;
      lines.push(...wrap(cleanMarkers(heading[2] ?? ''), size, true));
      continue;
    }
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const body = bullet ? `• ${bullet[1] ?? ''}` : line;
    lines.push(...wrap(cleanMarkers(body), BODY_SIZE, false));
  }
  return lines.length > 0 ? lines : [{ text: '', size: BODY_SIZE, bold: false }];
};

/** One character as a PDF string byte: printable ASCII and Latin-1 pass, the rest becomes "?". */
const encodeChar = (character: string): string => {
  const code = character.codePointAt(0) ?? 0;
  if (character === '(' || character === ')' || character === '\\') return `\\${character}`;
  // WinAnsi has a bullet at 0x95; the bullet used for list items is written there.
  if (code === 0x2022) return '\x95';
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) return character;
  return '?';
};

const encodeText = (text: string): string => Array.from(text, encodeChar).join('');

const LINE_SPACING = 1.4;

/** Lay the lines out on pages, top to bottom, starting a new page when the bottom margin is reached. */
const paginate = (lines: Line[]): Line[][] => {
  const pages: Line[][] = [[]];
  let y = PAGE_HEIGHT - MARGIN;
  for (const line of lines) {
    const step = line.size * LINE_SPACING;
    if (y - step < MARGIN) {
      pages.push([]);
      y = PAGE_HEIGHT - MARGIN;
    }
    pages[pages.length - 1]?.push(line);
    y -= step;
  }
  return pages;
};

const contentFor = (page: Line[]): string => {
  let y = PAGE_HEIGHT - MARGIN - (page[0]?.size ?? BODY_SIZE);
  const operations: string[] = [];
  for (const line of page) {
    if (line.text.length > 0) {
      const font = line.bold ? 'F2' : 'F1';
      operations.push(`BT /${font} ${line.size} Tf ${MARGIN} ${y.toFixed(2)} Td (${encodeText(line.text)}) Tj ET`);
    }
    y -= line.size * LINE_SPACING;
  }
  return operations.join('\n');
};

/** Build the whole PDF file. Offsets are byte positions, so every string is Latin-1 (one byte each). */
export const markdownToPdf = (markdown: string): Buffer => {
  const pages = paginate(toLines(markdown));
  const pageCount = pages.length;
  // Object numbers: 1 catalog, 2 page tree, 3 regular font, 4 bold font, then a page and its content per page.
  const pageId = (index: number): number => 5 + index * 2;
  const contentId = (index: number): number => 6 + index * 2;
  const kids = pages.map((_, index) => `${pageId(index)} 0 R`).join(' ');

  const objects: Map<number, string> = new Map();
  objects.set(1, '<< /Type /Catalog /Pages 2 0 R >>');
  objects.set(2, `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} >>`);
  objects.set(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.set(4, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  pages.forEach((page, index) => {
    objects.set(
      pageId(index),
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId(index)} 0 R >>`,
    );
    const content = contentFor(page);
    objects.set(contentId(index), `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });

  const header = '%PDF-1.4\n%âãÏÓ\n';
  let body = header;
  const offsets: number[] = [];
  const total = objects.size;
  for (let id = 1; id <= total; id += 1) {
    offsets.push(body.length);
    body += `${id} 0 obj\n${objects.get(id) ?? ''}\nendobj\n`;
  }
  const xrefOffset = body.length;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
};
