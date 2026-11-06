/** Shared contract for every runtime adapter in the benchmark. */

/**
 * A measured duration in milliseconds, or `null` when the adapter genuinely did
 * not measure that step (for example a CLI runtime whose launch command already
 * navigates, so a separate login-navigation measurement does not exist).
 *
 * `null` is never coerced to `0`: a fabricated zero would drag a median toward
 * a performance that no run observed.
 */
export type Measured = number | null;

export type StepTimings = {
  /** Time until the browser automation handle is usable. */
  launch_ms: Measured;
  /** Navigate to the local login page, when that is a separate step. */
  login_nav_ms: Measured;
  /** Fill both fields and submit — measures dynamic interaction cost. */
  form_submit_ms: Measured;
  /** Wait for the authenticated app page, when measured separately. */
  app_ready_ms: Measured;
  /** Accessibility-tree snapshot of the app page. */
  snapshot_ms: Measured;
  snapshot_chars: Measured;
  /** Read text from inside the iframe. */
  iframe_ms: Measured;
  iframe_text: string | null;
  /** Click the download link and observe the file. */
  download_ms: Measured;
  download_bytes: Measured;
  /** Set a file on the input element. */
  upload_ms: Measured;
  /** Navigate to the DOM-heavy page and wait for content. */
  heavy_nav_ms: Measured;
  /** Idle period sampled for RSS/CPU. */
  idle_ms: Measured;
  close_ms: Measured;
};

export type AdapterRun = {
  adapter: string;
  mode: 'headless' | 'headed';
  ok: boolean;
  error: string | null;
  timings: StepTimings | null;
  resources: {
    peak_rss_mb: number;
    idle_mean_rss_mb: number | null;
    idle_mean_cpu_pct: number | null;
    samples: number;
    processes_peak: number;
    /** Total time the sampler spent blocked inside synchronous `ps` calls. */
    sampler_overhead_ms: number;
    sampler_max_sample_ms: number;
  } | null;
  notes: string[];
};

export type AdapterContext = {
  baseUrl: string;
  userDataDir: string;
  downloadDir: string;
  uploadFile: string;
  idleMs: number;
};

export type Adapter = {
  name: string;
  mode: 'headless' | 'headed';
  /** Whether the runtime can run this protocol at all, and why not when it cannot. */
  availability: () => Promise<{ available: boolean; reason: string | null }>;
  run: (ctx: AdapterContext) => Promise<AdapterRun>;
};
