import { describe, expect, it } from 'vitest';

import { renderMarkdown } from './markdown-html';

describe('renderMarkdown', () => {
  it('escapes everything the model wrote, so text can never become markup', () => {
    expect(renderMarkdown('<script>alert("x")</script>')).toBe(
      '<p>&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;</p>',
    );
  });

  it('turns headings, lists and paragraphs into their elements', () => {
    const html = renderMarkdown('## A. Sintesi del ruolo\n\nRiga uno\nriga due\n\n- primo\n- secondo');
    expect(html).toBe(
      '<h2>A. Sintesi del ruolo</h2><p>Riga uno riga due</p><ul><li>primo</li><li>secondo</li></ul>',
    );
  });

  it('renders bold and italics', () => {
    expect(renderMarkdown('**forte** e *leggero*')).toBe('<p><strong>forte</strong> e <em>leggero</em></p>');
  });

  it('keeps only http and https links, and opens them safely', () => {
    expect(renderMarkdown('[annuncio](https://example.test/1)')).toBe(
      '<p><a href="https://example.test/1" target="_blank" rel="noopener noreferrer">annuncio</a></p>',
    );
    expect(renderMarkdown('[bad](javascript:alert(1))')).toBe('<p>bad</p>');
  });
});
