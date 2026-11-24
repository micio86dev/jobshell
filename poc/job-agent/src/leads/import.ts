/**
 * Manual import: the way a lead enters from a place the agent may not read by itself.
 *
 * A Facebook group, a LinkedIn post or a message the user received cannot be collected without
 * bypassing a login, so the user pastes the text, or a public link, and everything after that is
 * automatic. A link is read only when it is a public https page that its robots.txt allows; a
 * login-walled site is refused with the instruction to paste the text instead.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { FetchLike } from '../jev.ts';
import { robotsAllows } from '../source-probe.ts';
import { mentionsRemote } from '../sources/types.ts';
import { signalId } from './company.ts';
import { plain } from './sources.ts';
import { signalSchema, type Signal } from './types.ts';

const MAX_TEXT = 4000;
const MIN_TEXT = 30;
const LOGIN_WALLED = ['facebook.com', 'fb.com', 'linkedin.com', 'instagram.com', 'x.com', 'twitter.com'];

export type ImportInput = { text?: string | null | undefined; url?: string | null | undefined };

const hostOf = (url: string): URL | null => {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? parsed : null;
  } catch {
    return null;
  }
};

/** Why a link cannot be read, or null when it can. Only a public https page on a real host is read. */
/** Names that point at the machine or the local network, or that turn any address into a name. */
const NOT_PUBLIC_SUFFIXES = ['.local', '.localhost', '.internal', '.localdomain', '.lan', '.home', '.corp', '.intranet', 'nip.io', 'sslip.io', 'xip.io', 'localtest.me'];

export const refuseLink = (url: string): string | null => {
  const parsed = hostOf(url);
  if (parsed === null) return 'only a public https link can be read';
  // A trailing dot names the same host ("linkedin.com." is linkedin.com): compare the host without it.
  const host = parsed.hostname.toLowerCase().replace(/\.+$/, '');
  if (LOGIN_WALLED.some((wall) => host === wall || host.endsWith(`.${wall}`))) {
    return `${host} needs a login, which the agent never uses: paste the text of the post instead`;
  }
  // An address, in any notation, is not a public name: an IPv6 literal has a colon, and a name whose last
  // label is all digits (or that is only digits and dots) is an IPv4 address in disguise.
  const lastLabel = host.split('.').pop() ?? '';
  const isAddress = host.includes(':') || host.includes('[') || /^[\d.]+$/.test(host) || /^\d+$/.test(lastLabel) || /^0x[0-9a-f]+$/i.test(lastLabel);
  const local = host === 'localhost' || NOT_PUBLIC_SUFFIXES.some((suffix) => (suffix.startsWith('.') ? host.endsWith(suffix) : host === suffix || host.endsWith(`.${suffix}`)));
  if (isAddress || local || !host.includes('.')) return 'only a public host can be read';
  return null;
};

/** The text of a public page, if its robots.txt allows the request. Never follows a redirect. */
export const fetchImportPage = async (
  url: string,
  fetchImpl: FetchLike,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
  const refusal = refuseLink(url);
  if (refusal !== null) return { ok: false, reason: refusal };
  const parsed = new URL(url);
  const headers = { 'user-agent': 'jobshell-job-agent/0.1 (manual import)' };
  // The page is read only for a host that is public by name. A public name that a resolver points at a private
  // address is not detected here: the link is one the user chose, and a redirect is never followed.
  // A redirect is never followed: its target could be a private address or a login-walled site the checks above never saw.
  const get = { method: 'GET', headers, redirect: 'manual' } as const;
  const redirected = (status: number): boolean => status >= 300 && status < 400;
  try {
    const robots = await fetchImpl(`${parsed.origin}/robots.txt`, get);
    if (redirected(robots.status)) return { ok: false, reason: 'the site robots.txt redirects, so its policy cannot be read' };
    const policy = robots.status === 200 ? robots.text : robots.status === 404 || robots.status === 410 ? '' : null;
    if (policy === null) return { ok: false, reason: 'the site robots.txt could not be read' };
    if (!robotsAllows(policy, `${parsed.pathname}${parsed.search}`)) return { ok: false, reason: 'the site robots.txt does not allow reading this page' };
    const page = await fetchImpl(url, get);
    if (redirected(page.status)) return { ok: false, reason: 'the link redirects: open it, then paste the text or the final link' };
    if (page.status !== 200) return { ok: false, reason: `the page answered ${page.status}` };
    const text = plain(page.text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '));
    return text.length < MIN_TEXT ? { ok: false, reason: 'the page has no readable text' } : { ok: true, text: text.slice(0, MAX_TEXT) };
  } catch {
    return { ok: false, reason: 'the page could not be fetched' };
  }
};

/** A pasted text, or the text of a link, as a signal. The company is left for the identification step. */
export const buildImportSignal = (
  input: { text: string; url: string | null },
  now: Date,
): Signal | { error: string } => {
  const body = input.text.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  if (body.length < MIN_TEXT) return { error: 'the text is too short to read: paste the whole post' };
  const digest = createHash('sha256').update(input.url ?? body).digest('hex').slice(0, 16);
  return {
    id: signalId('manual-import', digest),
    type: 'manual_import',
    source: 'manual-import',
    sources: ['manual-import'],
    url: input.url ?? `manual://import/${digest}`,
    title: body.slice(0, 140),
    text: body,
    company_name: null,
    location: null,
    remote_hint: mentionsRemote(body) ? true : null,
    salary: null,
    published_at: now.toISOString(),
    observed_at: now.toISOString(),
  };
};

/** Resolve an import request into a signal: the text when there is one, else the page behind the link. */
export const importSignal = async (
  input: ImportInput,
  deps: { fetchImpl: FetchLike; now: Date },
): Promise<{ ok: true; signal: Signal } | { ok: false; reason: string }> => {
  const url = input.url?.trim() === '' ? null : (input.url?.trim() ?? null);
  let text = input.text?.trim() ?? '';
  if (text === '' && url !== null) {
    const page = await fetchImportPage(url, deps.fetchImpl);
    if (!page.ok) return page;
    text = page.text;
  }
  if (text === '') return { ok: false, reason: 'paste the text of the post or give a public link' };
  const built = buildImportSignal({ text, url }, deps.now);
  return 'error' in built ? { ok: false, reason: built.error } : { ok: true, signal: built };
};

const importsDir = (evidenceDir: string): string => join(evidenceDir, 'imports');

/** Keep an import until the next run reads it. The same text is the same file, so a double click is one import. */
export const saveImport = (evidenceDir: string, signal: Signal): void => {
  const dir = importsDir(evidenceDir);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${signal.id}.json`), `${JSON.stringify(signal, null, 2)}\n`, 'utf8');
};

/** The imports waiting for a run. Each is marked done as it is read, so it is read once. */
export const takeImports = (evidenceDir: string): Signal[] => {
  const dir = importsDir(evidenceDir);
  if (!existsSync(dir)) return [];
  const signals: Signal[] = [];
  for (const name of readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    try {
      const checked = signalSchema.safeParse(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      // A file that is not a signal is left where it is: it is never trusted and never stops a run.
      if (!checked.success) continue;
      signals.push(checked.data);
    } catch {
      // A damaged file is left alone; it never stops a run.
      continue;
    }
    renameSync(join(dir, name), join(dir, `${name}.done`));
  }
  return signals;
};
