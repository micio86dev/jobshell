/**
 * Turns the Markdown of a report or a tailored CV into HTML for the window. Every character the
 * model wrote is escaped first, so the text can never become markup; only the few constructs
 * below are turned into elements, and a link is kept only when it is http or https.
 */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);

/** Bold, italics and links, applied to text that is already escaped. */
const inline = (escaped: string): string =>
  escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^()]*\))*\)/g, '$1');

const HEADING = /^(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export const renderMarkdown = (markdown: string): string => {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;

  const flushParagraph = (): void => {
    if (paragraph.length > 0) out.push(`<p>${inline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };
  const flushList = (): void => {
    if (list !== null) {
      const items = list.items.map((item) => `<li>${inline(escapeHtml(item))}</li>`).join('');
      out.push(`<${list.tag}>${items}</${list.tag}>`);
    }
    list = null;
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (line.trim() === '') {
      flushParagraph();
      flushList();
    } else if (heading !== null) {
      flushParagraph();
      flushList();
      const level = Math.min(heading[1]?.length ?? 1, 3);
      out.push(`<h${level}>${inline(escapeHtml(heading[2] ?? ''))}</h${level}>`);
    } else if (bullet !== null || numbered !== null) {
      flushParagraph();
      const tag = bullet !== null ? 'ul' : 'ol';
      if (list !== null && list.tag !== tag) flushList();
      if (list === null) list = { tag, items: [] };
      list.items.push((bullet ?? numbered)?.[1] ?? '');
    } else {
      flushList();
      paragraph.push(line.trim());
    }
  }
  flushParagraph();
  flushList();
  return out.join('');
};
