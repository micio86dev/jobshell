/**
 * A small, dependency-free RSS 2.0 reader.
 *
 * The job feeds in this catalogue publish RSS rather than JSON, so the runner
 * needs a parser that does not pull a library for six fields. It is deliberately
 * forgiving: a feed with one broken item yields the other items, and an item with
 * no link is skipped because a posting without a URL cannot be verified.
 */
import { text, toIsoDate } from './types.ts';

export type RssItem = {
  title: string;
  link: string;
  description: string | null;
  published_at: string | null;
  guid: string | null;
};

const unwrapCdata = (value: string): string =>
  value.replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/g, '$1');

const tag = (item: string, name: string): string | null => {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i').exec(item);
  return match?.[1] === undefined ? null : unwrapCdata(match[1]).trim();
};

/** Parse an RSS 2.0 document into items. Atom is not supported on purpose. */
export const parseRss = (xml: string): RssItem[] => {
  const items: RssItem[] = [];
  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const item = match[1];
    if (item === undefined) continue;

    const title = tag(item, 'title');
    const link = tag(item, 'link');
    if (title === null || title.length === 0) continue;
    if (link === null || link.length === 0) continue;

    const description = tag(item, 'description');
    items.push({
      title: text(title),
      link: text(link),
      description: description === null ? null : text(description),
      published_at: toIsoDate(tag(item, 'pubDate')),
      guid: tag(item, 'guid'),
    });
  }
  return items;
};
