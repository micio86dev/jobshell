/**
 * Soak measurement: does a resident browser stay flat while it idles?
 *
 * The benchmark reports a 10 s idle window, which says nothing about drift. A
 * supervisor that keeps a browser alive for hours needs to know whether memory
 * creeps, and whether the process tree is actually gone after close.
 *
 * Protocol: launch a headless persistent context, sit on one page, sample the
 * process subtree every 2 s for the soak duration, then close and confirm that no
 * process from the profile survives.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { chromium, type BrowserContext } from 'playwright';

import { startFixtureServer } from '../runtime-bench/src/fixtures/server.ts';
import { findRootPids, snapshotProcesses } from '../runtime-bench/src/lib/procs.ts';
import { SubtreeSampler } from '../runtime-bench/src/lib/sampler.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const arg = (name: string, fallback: string): string => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : (process.argv[index + 1] ?? fallback);
};

const outDir = path.resolve(
  process.argv[2] ?? path.join(REPO_ROOT, 'evidence/run', new Date().toISOString().replace(/[:.]/g, '-')),
);
const soakMs = Number(arg('soak-ms', '120000'));
if (!Number.isInteger(soakMs) || soakMs < 10_000) {
  console.error('--soak-ms must be an integer >= 10000');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const profileDir = path.join(outDir, 'profile-soak');
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true });

const server = await startFixtureServer();
const sampler = new SubtreeSampler(profileDir, 2000);
let context: BrowserContext | null = null;
let processesAfterClose = -1;

try {
  context = await chromium.launchPersistentContext(profileDir, {
    headless: true,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${server.baseUrl}/app`, { waitUntil: 'domcontentloaded' }).catch(async () => {
    // /app redirects when unauthenticated; the login page is the idle surface then.
    await page.goto(`${server.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  });

  sampler.start();
  await new Promise((resolve) => setTimeout(resolve, soakMs));
  // Stop before teardown: a sample taken while the browser is dying would report
  // zero and turn the drift calculation into nonsense.
  sampler.stop();

  await context.close();
  context = null;
  // Give the OS a moment to reap the subtree before counting.
  await new Promise((resolve) => setTimeout(resolve, 2000));
  processesAfterClose = findRootPids(snapshotProcesses(), profileDir).length;
} finally {
  sampler.stop();
  await context?.close().catch(() => undefined);
  await server.close();
}

const summary = sampler.summary(soakMs);
const series = summary.samples;
const first = series[0];
const last = series[series.length - 1];
const driftPct =
  first !== undefined && last !== undefined && first.rss_mb > 0
    ? Math.round(((last.rss_mb - first.rss_mb) / first.rss_mb) * 1000) / 10
    : null;

const load1m = os.loadavg()[0] ?? 0;

const report = {
  generated_at: new Date().toISOString(),
  // A single timed run, not a benchmark: no median is reported and none should be
  // read into it. The host state is recorded so a reader can judge comparability.
  kind: 'diagnostic, single run',
  protocol: `headless persistent context idling on one page, sampled every 2 s for ${soakMs} ms`,
  host: {
    platform: process.platform,
    arch: process.arch,
    release: os.release(),
    cpus: os.cpus().length,
    total_memory_gb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    load_average_1m: Math.round(load1m * 100) / 100,
    node: process.version,
  },
  soak_ms: soakMs,
  samples: series.length,
  first_rss_mb: first?.rss_mb ?? null,
  last_rss_mb: last?.rss_mb ?? null,
  peak_rss_mb: summary.peak_rss_mb,
  drift_pct: driftPct,
  mean_cpu_pct: summary.idle_mean_cpu_pct,
  sampler_overhead_ms: summary.overhead_ms,
  processes_after_close: processesAfterClose,
  series,
};

fs.writeFileSync(path.join(outDir, 'soak.json'), JSON.stringify(report, null, 2) + '\n');
console.log(
  `soak ${soakMs} ms: ${series.length} samples, first ${report.first_rss_mb} MB, last ${report.last_rss_mb} MB, ` +
    `drift ${driftPct}%, peak ${report.peak_rss_mb} MB, mean CPU ${report.mean_cpu_pct}%, processes after close ${processesAfterClose}`,
);
console.log(`wrote ${path.join(outDir, 'soak.json')}`);

// The soak passes when nothing is left behind. Drift is reported, not asserted:
// a leak threshold would be a product decision, not a Phase 0 one.
process.exit(processesAfterClose === 0 ? 0 : 1);
