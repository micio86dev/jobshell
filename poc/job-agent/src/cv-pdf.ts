/**
 * The CV as a PDF: text on A4 with the standard Helvetica, no images and no embedded fonts, so
 * an applicant tracking system reads every word. Markdown becomes a layout: the first heading is
 * the name, the lines under it are contact details, each section is a capitalised title with a
 * rule under it, and list items hang from a bullet. Colour is only ink, grey and one accent.
 *
 * Characters outside Latin-1 cannot be drawn with the standard fonts, so they become "?".
 */

const PAGE_WIDTH = 595;
const PAGE_HEIGHT = 842;
const MARGIN = 56;
const RIGHT = PAGE_WIDTH - MARGIN;
const TOP = PAGE_HEIGHT - MARGIN;
const BODY_SIZE = 10;
const CONTACT_SIZE = 9.5;
const LEADING = 1.42;
const BULLET_INDENT = 14;

const INK = '0.13 0.13 0.13';
const MUTED = '0.42 0.42 0.42';
const ACCENT = '0.12 0.23 0.42';
const RULE = '0.78 0.78 0.78';

/** One drawn row. `bullet` puts a bullet glyph just left of `x`; `rule` draws a rule under the row. */
type Line = {
  text: string;
  size: number;
  bold: boolean;
  color: string;
  x: number;
  before: number;
  bullet: boolean;
  rule: boolean;
};

type Placed = { line: Line; baseline: number };

const cleanMarkers = (text: string): string =>
  text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`([^`]*)`/g, '$1');

/** Characters that fit in a width at a size, with a margin for Helvetica's wider letters. */
const columnsFor = (width: number, size: number): number => Math.max(12, Math.floor(width / (size * 0.55)));

type Style = Pick<Line, 'size' | 'bold' | 'color' | 'x' | 'before' | 'rule'>;

/** Split a paragraph into rows that fit the width. Only the first row keeps the space before. */
const wrap = (text: string, style: Style, bullet: boolean): Line[] => {
  const columns = columnsFor(RIGHT - style.x, style.size);
  const rows: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter((part) => part.length > 0)) {
    const next = current.length === 0 ? word : `${current} ${word}`;
    if (next.length > columns && current.length > 0) {
      rows.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  rows.push(current);
  return rows.map((row, index) => ({
    ...style,
    text: row,
    before: index === 0 ? style.before : 0,
    rule: style.rule && index === rows.length - 1,
    bullet: bullet && index === 0,
  }));
};

const toLines = (markdown: string): Line[] => {
  const lines: Line[] = [];
  let inHeader = true;
  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.trim().length === 0) continue;

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1]?.length ?? 1;
      const text = cleanMarkers(heading[2] ?? '');
      if (level === 1) {
        lines.push(...wrap(text, { size: 22, bold: true, color: ACCENT, x: MARGIN, before: 0, rule: false }, false));
      } else if (level === 2) {
        inHeader = false;
        lines.push(
          ...wrap(text.toUpperCase(), { size: 11, bold: true, color: ACCENT, x: MARGIN, before: 16, rule: true }, false),
        );
      } else {
        inHeader = false;
        lines.push(...wrap(text, { size: 10.5, bold: true, color: INK, x: MARGIN, before: 8, rule: false }, false));
      }
      continue;
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    if (bullet) {
      inHeader = false;
      const style = { size: BODY_SIZE, bold: false, color: INK, x: MARGIN + BULLET_INDENT, before: 3, rule: false };
      lines.push(...wrap(cleanMarkers(bullet[1] ?? ''), style, true));
      continue;
    }

    const text = cleanMarkers(line);
    lines.push(
      ...wrap(
        text,
        inHeader
          ? { size: CONTACT_SIZE, bold: false, color: MUTED, x: MARGIN, before: 3, rule: false }
          : { size: BODY_SIZE, bold: false, color: INK, x: MARGIN, before: 4, rule: false },
        false,
      ),
    );
  }
  return lines;
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

/**
 * Place the lines on pages, top to bottom. The space between two rows follows the larger of the
 * two sizes, so a big name and a small contact line both sit where they should.
 */
const paginate = (lines: Line[]): Placed[][] => {
  const pages: Placed[][] = [[]];
  let previous: Line | null = null;
  let baseline = TOP;
  for (const line of lines) {
    baseline = previous === null ? TOP - line.size : baseline - Math.max(previous.size, line.size) * LEADING - line.before;
    if (baseline < MARGIN) {
      pages.push([]);
      baseline = TOP - line.size;
    }
    pages[pages.length - 1]?.push({ line, baseline });
    previous = line;
  }
  return pages;
};

const contentFor = (page: Placed[]): string => {
  const operations: string[] = [];
  for (const { line, baseline } of page) {
    if (line.text.length === 0) continue;
    const y = baseline.toFixed(2);
    operations.push(`${line.color} rg`);
    if (line.bullet) {
      operations.push(`BT /F1 ${BODY_SIZE} Tf ${(line.x - BULLET_INDENT + 3).toFixed(2)} ${y} Td (${encodeText('•')}) Tj ET`);
    }
    const font = line.bold ? 'F2' : 'F1';
    operations.push(`BT /${font} ${line.size} Tf ${line.x.toFixed(2)} ${y} Td (${encodeText(line.text)}) Tj ET`);
    if (line.rule) {
      const ruleY = (baseline - 4).toFixed(2);
      operations.push(`q ${RULE} RG 0.6 w ${MARGIN} ${ruleY} m ${RIGHT} ${ruleY} l S Q`);
    }
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
