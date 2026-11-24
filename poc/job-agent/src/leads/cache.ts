/**
 * What a run remembers so the next one does not pay twice: the judge's verdict on a signal, and the
 * research on a company. Both expire, both are keyed by their content, and a damaged file is an
 * empty cache, never an error that stops a run. The file holds no key and no personal data beyond
 * what the run already stored.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { z } from 'zod';

const DAY_MS = 86_400_000;

const entry = z.object({ at: z.string(), value: z.unknown() });
const fileSchema = z.object({ version: z.literal(1), verdicts: z.record(z.string(), entry), research: z.record(z.string(), entry) });
type File = z.infer<typeof fileSchema>;

export type LeadCache = {
  verdict(key: string, now: Date, ttlDays: number): unknown;
  setVerdict(key: string, value: unknown, now: Date): void;
  research(key: string, now: Date, ttlDays: number): unknown;
  setResearch(key: string, value: unknown, now: Date): void;
  save(): void;
};

/** A key that changes whenever what was judged, or who it was judged for, changes. */
export const contentKey = (...parts: ReadonlyArray<string | null>): string =>
  createHash('sha256').update(parts.map((part) => part ?? '').join('\u0000')).digest('hex').slice(0, 32);

const fresh = (found: { at: string; value: unknown } | undefined, now: Date, ttlDays: number): unknown => {
  if (found === undefined) return undefined;
  const age = now.getTime() - new Date(found.at).getTime();
  return Number.isFinite(age) && age >= 0 && age <= ttlDays * DAY_MS ? found.value : undefined;
};

export const openCache = (path: string): LeadCache => {
  let data: File = { version: 1, verdicts: {}, research: {} };
  if (existsSync(path)) {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      if (parsed.success) data = parsed.data;
    } catch {
      // A damaged cache is an empty one.
    }
  }
  return {
    verdict: (key, now, ttlDays) => fresh(data.verdicts[key], now, ttlDays),
    setVerdict: (key, value, now) => {
      data.verdicts[key] = { at: now.toISOString(), value };
    },
    research: (key, now, ttlDays) => fresh(data.research[key], now, ttlDays),
    setResearch: (key, value, now) => {
      data.research[key] = { at: now.toISOString(), value };
    },
    save: () => {
      mkdirSync(dirname(path), { recursive: true });
      const temporary = `${path}.tmp`;
      writeFileSync(temporary, JSON.stringify(data), 'utf8');
      renameSync(temporary, path);
    },
  };
};
