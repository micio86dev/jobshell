/**
 * Company research through the user's own command-line program (a subscription), with no API key.
 *
 * The API path trusts what the provider's web tools report. Here nothing is taken on the program's
 * word: it may search (Claude Code and Codex can) and only to name addresses; our own code then reads
 * those public pages, keeps their text, and a second request, with no tools at all, extracts facts and
 * contacts from that text. The guards that follow are the same ones as on the API path, and they now
 * compare every quote with a page we read ourselves.
 *
 * A program with no web search still works: it is given the company's own website when one is known,
 * and the pages read from it. What it cannot find stays unknown.
 */
import { CLI_LABEL, WEB_SEARCH_PROGRAMS, runCli, type CliDeps, type CliProvider } from '../llm-cli.ts';
import { fetchImportPage, refuseLink } from './import.ts';
import { canonicalUrl, type Evidence, type ResearchDeps, type ResearchResult } from './research.ts';
import type { FetchLike } from '../jev.ts';

/** What a company's pages give the model: enough to read a team page, bounded so a request stays small. */
const PAGE_CHARS = 9_000;
const TOTAL_CHARS = 36_000;

export type CliResearch = {
  provider: CliProvider;
  model: string;
  deps?: CliDeps;
  /** Whether the program may search the web; absent means what its kind is known to offer. */
  web?: boolean;
};

const DISCOVERY = (brief: string, limit: number, web: boolean): string =>
  [
    'You are helping to find public web pages about one company. Do not research the company yet.',
    web
      ? 'Search the web and return the addresses of its own public pages (home, about, team, contact) and of at most two pages that report on it (press, funding, a business register). Return only addresses you saw in search results.'
      : 'You cannot search the web in this request. From your own knowledge, return the address of the company\'s own website and of its about, team and contact pages ONLY if you are sure they exist; otherwise return an empty list. Never guess an address.',
    'Never return LinkedIn, Facebook, Instagram or X addresses.',
    `Answer with one JSON object and nothing else: {"urls": ["https://..."]} with at most ${limit} addresses.`,
    '',
    'The brief:',
    brief,
  ].join('\n');

const OVERRIDE = [
  'IMPORTANT. In this run you have no web tools: ignore every instruction above about searching or fetching.',
  'The pages below were read for you. A fact or a contact is allowed only if a page below states it. source_url must be the address of one of those pages, and quote must be words copied exactly from that page.',
  'A page that is not below was not read: leave out what it would have told you. Answer with one JSON object and nothing else.',
].join(' ');

/** Addresses in an answer: the JSON list when there is one, else any https address written out. */
export const addressesIn = (text: string): string[] => {
  const found: string[] = [];
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const parsed: unknown = JSON.parse(text.slice(start, end + 1));
      const list = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)['urls'] : null;
      if (Array.isArray(list)) found.push(...list.filter((entry): entry is string => typeof entry === 'string'));
    } catch {
      // fall through to the written-out addresses
    }
  }
  if (found.length === 0) found.push(...(text.match(/https:\/\/[^\s"'<>)\]]+/g) ?? []));
  return found;
};

const hintIn = (brief: string): string | null => {
  const hint = /^Website hint: (\S+)/m.exec(brief)?.[1];
  if (hint === undefined) return null;
  return /^https?:\/\//i.test(hint) ? hint : `https://${hint}`;
};

/** The addresses worth reading: public, not behind a login, one page per address, the known site first. */
export const candidates = (brief: string, discovered: string[], limit: number): string[] => {
  const hint = hintIn(brief);
  const all = [...(hint === null ? [] : [hint]), ...discovered];
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of all) {
    if (refuseLink(raw) !== null) continue;
    const key = canonicalUrl(raw);
    if (seen.has(key)) continue;
    seen.add(key);
    kept.push(raw);
    if (kept.length >= limit) break;
  }
  return kept;
};

export const researchViaCli = async (system: string, prompt: string, deps: ResearchDeps, cli: CliResearch, fetchImpl: FetchLike): Promise<ResearchResult> => {
  const label = CLI_LABEL[cli.provider];
  const web = cli.web ?? WEB_SEARCH_PROGRAMS.includes(cli.provider);
  const limit = Math.max(1, deps.maxFetches);

  let discovered: string[] = [];
  let searches = 0;
  // With a search, the program names pages. Without one it is asked only when the company's site is not known.
  if ((web && deps.maxSearches > 0) || (!web && hintIn(prompt) === null)) {
    const found = await runCli(cli.provider, cli.model, DISCOVERY(prompt, limit, web), { ...cli.deps, ...(web ? { web: true } : {}) });
    if (!found.ok) return { ok: false, reason: found.reason };
    searches = web ? 1 : 0;
    discovered = addressesIn(found.text);
  }

  const evidence: Evidence = { urls: new Set(), documents: [], citations: [] };
  let budget = TOTAL_CHARS;
  for (const address of candidates(prompt, discovered, limit)) {
    if (budget <= 0) break;
    const page = await fetchImportPage(address, fetchImpl, Math.min(PAGE_CHARS, budget));
    if (!page.ok) continue;
    const url = canonicalUrl(address);
    evidence.urls.add(url);
    evidence.documents.push({ url, text: page.text });
    budget -= page.text.length;
  }
  if (evidence.documents.length === 0) {
    return { ok: false, reason: `no public page of the company could be read (${label} ${web ? 'searched the web' : 'has no web search here'})` };
  }

  const pages = evidence.documents.map((document) => `<page url="${document.url}">\n${document.text}\n</page>`).join('\n');
  const answer = await runCli(cli.provider, cli.model, [system, '', prompt, '', OVERRIDE, '', pages].join('\n'), { ...cli.deps });
  if (!answer.ok) return { ok: false, reason: answer.reason };
  // A search on a subscription has no price per search, so none is counted: the cost meter stays at zero.
  void searches;
  return { ok: true, text: answer.text, evidence, searches: 0, usage: { input_tokens: 0, output_tokens: 0 } };
};
