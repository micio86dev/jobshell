/**
 * What the user's own decisions say about where good leads come from.
 *
 * The desktop app computes, from the leads the user marked wanted or not wanted, a weight per source
 * and writes it to a file the user can read. The weights only change the ORDER in which companies are
 * judged when the budget cannot judge them all: nothing is ever rejected, scored or hidden because of
 * them, and the buying-signal share and the manual imports keep their places. A weight is bounded, so
 * a source is judged later at worst, never skipped. Without the file (the default: learning is off)
 * the order is exactly what it was.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';

export const MIN_WEIGHT = 0.5;
export const MAX_WEIGHT = 1.5;

const preferencesFile = z.object({ source_weights: z.record(z.string().min(1), z.number().min(MIN_WEIGHT).max(MAX_WEIGHT)) });

export type SourceWeights = Readonly<Record<string, number>>;

export type PreferencesResult = { ok: true; weights: SourceWeights } | { ok: false; reason: string };

/** The weights in a file. A missing path is "no weights"; a file that is not what the app writes is a reason, never a guess. */
export const loadPreferences = (path: string | undefined): PreferencesResult => {
  if (path === undefined) return { ok: true, weights: {} };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, weights: {} };
    return { ok: false, reason: 'the preferences file could not be read' };
  }
  const parsed = preferencesFile.safeParse(raw);
  return parsed.success ? { ok: true, weights: parsed.data.source_weights } : { ok: false, reason: 'the preferences file is not what the app writes' };
};
