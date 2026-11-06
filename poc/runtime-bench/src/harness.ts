import fs from 'node:fs';
import path from 'node:path';

import { makeAgentBrowserAdapter } from './adapters/agent-browser.ts';
import { makePlaywrightAdapter } from './adapters/playwright.ts';
import type { Adapter, AdapterContext, AdapterRun } from './adapters/types.ts';
import { startFixtureServer, writeUploadFixture } from './fixtures/server.ts';
import { aggregate, type Aggregate as StatsAggregate } from './lib/stats.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const arg = (name: string, fallback: string | null = null): string | null => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
};

const flag = (name: string): boolean => process.argv.includes(`--${name}`);

const positiveInt = (name: string, fallback: number, min: number): number => {
  const raw = arg(name, String(fallback)) ?? String(fallback);
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min) {
    console.error(`--${name} must be an integer >= ${min}, received ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return value;
};

const runs = positiveInt('runs', 3, 1);
const idleMs = positiveInt('idle-ms', 10000, 1000);
const only = arg('only');
const outDir = path.resolve(arg('out') ?? path.join(REPO_ROOT, 'evidence/run', new Date().toISOString().replace(/[:.]/g, '-')));
fs.mkdirSync(outDir, { recursive: true });

const chromiumExecutable = path.join(
  process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? path.join(REPO_ROOT, '.cache/pw-browsers'),
  'chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const adapters: Adapter[] = [
  makePlaywrightAdapter({ name: 'playwright-headless', mode: 'headless' }),
  makePlaywrightAdapter({ name: 'playwright-headed', mode: 'headed' }),
  makePlaywrightAdapter({ name: 'playwright-chrome-headed', mode: 'headed', channel: 'chrome' }),
  makeAgentBrowserAdapter({
    name: 'agent-browser-headed',
    mode: 'headed',
    executablePath: chromiumExecutable,
    session: 'openjob-bench',
  }),
];

const selected = only === null ? adapters : adapters.filter((adapter) => adapter.name === only);
if (selected.length === 0) {
  console.error(`unknown adapter ${only ?? ''}; known: ${adapters.map((a) => a.name).join(', ')}`);
  process.exit(1);
}

const server = await startFixtureServer();
const results: AdapterRun[] = [];
const skipped: Array<{ adapter: string; reason: string }> = [];

for (const adapter of selected) {
  const availability = await adapter.availability();
  if (!availability.available) {
    skipped.push({ adapter: adapter.name, reason: availability.reason ?? 'unavailable' });
    console.log(`SKIP ${adapter.name}: ${availability.reason ?? 'unavailable'}`);
    continue;
  }

  for (let runIndex = 1; runIndex <= runs; runIndex += 1) {
    const runDir = path.join(outDir, adapter.name, `run-${runIndex}`);
    fs.mkdirSync(runDir, { recursive: true });
    const ctx: AdapterContext = {
      baseUrl: server.baseUrl,
      userDataDir: path.join(runDir, 'profile'),
      downloadDir: path.join(runDir, 'downloads'),
      uploadFile: writeUploadFixture(path.join(runDir, 'fixtures')),
      idleMs,
    };
    fs.mkdirSync(ctx.downloadDir, { recursive: true });

    const result = await adapter.run(ctx);
    results.push(result);
    console.log(
      `${adapter.name} run ${runIndex}: ${result.ok ? 'ok' : 'FAILED'} ${
        result.timings ? `launch=${result.timings.launch_ms}ms snapshot=${result.timings.snapshot_ms}ms peak=${result.resources?.peak_rss_mb ?? '?'}MB` : result.error ?? ''
      }`,
    );
  }
}

await server.close();

type NumericTimingKey =
  | 'launch_ms'
  | 'login_nav_ms'
  | 'form_submit_ms'
  | 'app_ready_ms'
  | 'snapshot_ms'
  | 'snapshot_chars'
  | 'iframe_ms'
  | 'download_ms'
  | 'download_bytes'
  | 'upload_ms'
  | 'heavy_nav_ms'
  | 'idle_ms'
  | 'close_ms';

type AggregateRow = {
  adapter: string;
  mode: string;
  runs_ok: number;
  runs_failed: number;
  launch_ms: StatsAggregate;
  snapshot_ms: StatsAggregate;
  form_submit_ms: StatsAggregate;
  app_ready_ms: StatsAggregate;
  iframe_ms: StatsAggregate;
  download_ms: StatsAggregate;
  upload_ms: StatsAggregate;
  heavy_nav_ms: StatsAggregate;
  close_ms: StatsAggregate;
  peak_rss_mb: StatsAggregate;
  idle_mean_rss_mb: StatsAggregate;
  idle_mean_cpu_pct: StatsAggregate;
  sampler_overhead_ms: StatsAggregate;
  errors: string[];
  notes: string[];
};

const aggregateRows: AggregateRow[] = adapters
  .filter((adapter) => results.some((result) => result.adapter === adapter.name))
  .map((adapter) => {
    const rows = results.filter((result) => result.adapter === adapter.name);
    const ok = rows.filter((row) => row.ok && row.timings !== null);
    const timing = (key: NumericTimingKey): StatsAggregate =>
      aggregate(ok.map((row) => row.timings?.[key] ?? null));
    return {
      adapter: adapter.name,
      mode: adapter.mode,
      runs_ok: ok.length,
      runs_failed: rows.length - ok.length,
      launch_ms: timing('launch_ms'),
      snapshot_ms: timing('snapshot_ms'),
      form_submit_ms: timing('form_submit_ms'),
      app_ready_ms: timing('app_ready_ms'),
      iframe_ms: timing('iframe_ms'),
      download_ms: timing('download_ms'),
      upload_ms: timing('upload_ms'),
      heavy_nav_ms: timing('heavy_nav_ms'),
      close_ms: timing('close_ms'),
      peak_rss_mb: aggregate(ok.map((row) => row.resources?.peak_rss_mb ?? null)),
      idle_mean_rss_mb: aggregate(ok.map((row) => row.resources?.idle_mean_rss_mb ?? null)),
      idle_mean_cpu_pct: aggregate(ok.map((row) => row.resources?.idle_mean_cpu_pct ?? null)),
      sampler_overhead_ms: aggregate(ok.map((row) => row.resources?.sampler_overhead_ms ?? null)),
      errors: rows.filter((row) => !row.ok).map((row) => row.error ?? 'unknown error'),
      notes: [...new Set(rows.flatMap((row) => row.notes))],
    };
  });

const report = {
  generated_at: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpus: (await import('node:os')).cpus().length,
    total_memory_gb: Math.round(((await import('node:os')).totalmem() / 1024 ** 3) * 10) / 10,
  },
  protocol: {
    runs_per_adapter: runs,
    idle_sample_ms: idleMs,
    fixture: 'local 127.0.0.1 fixture server (login, app, iframe, download, upload, heavy DOM)',
    resource_sampling:
      'process subtree matched by unique profile path, sampled every 500 ms; CPU from cumulative CPU-time delta; the sampler\'s own synchronous ps cost is reported per adapter as sampler_overhead_ms',
  },
  skipped,
  aggregate: aggregateRows,
  raw: results,
};

fs.writeFileSync(path.join(outDir, 'bench.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nwrote ${path.join(outDir, 'bench.json')}`);
if (!flag('quiet')) {
  for (const row of aggregateRows) {
    console.log(
      [
        row.adapter.padEnd(26),
        `ok=${row.runs_ok}/${row.runs_ok + row.runs_failed}`,
        `launch=${String(row.launch_ms.median ?? 'n/a').padStart(5)}ms(n=${row.launch_ms.n})`,
        `snapshot=${String(row.snapshot_ms.median ?? 'n/a').padStart(4)}ms`,
        `idle=${String(row.idle_mean_rss_mb.median ?? 'n/a').padStart(6)}MB`,
        `cpu=${String(row.idle_mean_cpu_pct.median ?? 'n/a').padStart(5)}%`,
        `peak=${String(row.peak_rss_mb.median ?? 'n/a').padStart(6)}MB`,
      ].join('  '),
    );
  }
}
