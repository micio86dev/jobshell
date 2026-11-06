/** Median of a list of measurements; `null` for an empty list. Never fabricates a zero. */
export const median = (values: number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] ?? null;
  const lower = sorted[middle - 1];
  const upper = sorted[middle];
  if (lower === undefined || upper === undefined) return null;
  // No rounding here: peak_rss_mb, idle CPU and sampler overhead are decimals.
  return (lower + upper) / 2;
};

/** Keep only measured values, so a missing measurement cannot enter an aggregate. */
export const measured = (values: Array<number | null>): number[] =>
  values.filter((value): value is number => value !== null && Number.isFinite(value));

export type Aggregate = { median: number | null; n: number; values: number[] };

export const aggregate = (values: Array<number | null>): Aggregate => {
  const kept = measured(values);
  return { median: median(kept), n: kept.length, values: kept };
};
