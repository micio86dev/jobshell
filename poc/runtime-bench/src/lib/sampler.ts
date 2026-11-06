import { findRootPids, snapshotProcesses, sumSubtree } from './procs.ts';

export type Sample = {
  at_ms: number;
  rss_mb: number;
  cpu_pct: number;
  processes: number;
  /** Time this sample spent inside the synchronous `ps` call. */
  sample_ms: number;
};

export type ResourceSummary = {
  samples: Sample[];
  peak_rss_mb: number;
  /** Mean RSS over the samples taken inside the idle window. */
  idle_mean_rss_mb: number | null;
  /** Mean CPU percentage over the idle window. */
  idle_mean_cpu_pct: number | null;
  /** Total event-loop time consumed by sampling itself, disclosed in the report. */
  overhead_ms: number;
  max_sample_ms: number;
};

/**
 * Samples the browser process subtree identified by `marker`.
 *
 * RSS is reported in MiB and CPU as a percentage derived from the growth of
 * cumulative CPU seconds, not from ps' lifetime average, so a burst of work is
 * visible instead of being diluted by process age.
 *
 * `ps` is synchronous, so every sample briefly blocks the event loop of the
 * process that also times the protocol. The cost is measured per sample and
 * reported, so a reader can see whether the numbers are contaminated.
 */
export class SubtreeSampler {
  readonly #marker: string;
  readonly #intervalMs: number;
  #timer: NodeJS.Timeout | null = null;
  #startedAt = 0;
  #lastCpuSeconds = 0;
  #lastSampleAt = 0;
  #samples: Sample[] = [];

  constructor(marker: string, intervalMs = 500) {
    this.#marker = marker;
    this.#intervalMs = intervalMs;
  }

  get samples(): Sample[] {
    return this.#samples;
  }

  start(): void {
    this.#startedAt = Date.now();
    this.#lastSampleAt = this.#startedAt;
    this.#lastCpuSeconds = 0;
    this.#timer = setInterval(() => this.#sample(), this.#intervalMs);
    this.#timer.unref();
  }

  /**
   * Stop sampling. Call this BEFORE closing the browser: the idle window is
   * computed from the tail of the series, so samples taken during teardown would
   * contaminate the idle mean.
   */
  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  #sample(): void {
    try {
      this.#sampleOnce();
    } catch {
      // A transient ps failure must not kill the run; the series simply has a gap.
    }
  }

  #sampleOnce(): void {
    const sampleStart = performance.now();
    const now = Date.now();
    const rows = snapshotProcesses();
    const roots = findRootPids(rows, this.#marker);
    const totals = sumSubtree(rows, roots);
    const elapsedSeconds = Math.max((now - this.#lastSampleAt) / 1000, 0.001);
    const cpuDelta = Math.max(totals.cpu_seconds - this.#lastCpuSeconds, 0);
    this.#lastCpuSeconds = totals.cpu_seconds;
    this.#lastSampleAt = now;
    this.#samples.push({
      at_ms: now - this.#startedAt,
      rss_mb: Math.round((totals.rss_kb / 1024) * 10) / 10,
      cpu_pct: Math.round((cpuDelta / elapsedSeconds) * 1000) / 10,
      processes: totals.processes,
      sample_ms: Math.round((performance.now() - sampleStart) * 10) / 10,
    });
  }

  summary(idleWindowMs: number): ResourceSummary {
    const peak = this.#samples.reduce((max, sample) => Math.max(max, sample.rss_mb), 0);
    const lastAt = this.#samples.reduce((max, sample) => Math.max(max, sample.at_ms), 0);
    const windowStart = Math.max(lastAt - idleWindowMs, 0);
    const idle = this.#samples.filter((sample) => sample.at_ms >= windowStart);
    const mean = (values: number[]): number | null =>
      values.length === 0 ? null : Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10;
    return {
      samples: this.#samples,
      peak_rss_mb: peak,
      idle_mean_rss_mb: mean(idle.map((sample) => sample.rss_mb)),
      idle_mean_cpu_pct: mean(idle.map((sample) => sample.cpu_pct)),
      overhead_ms: Math.round(this.#samples.reduce((sum, sample) => sum + sample.sample_ms, 0) * 10) / 10,
      max_sample_ms: this.#samples.reduce((max, sample) => Math.max(max, sample.sample_ms), 0),
    };
  }
}
