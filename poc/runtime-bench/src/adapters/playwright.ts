import fs from 'node:fs';
import path from 'node:path';

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';

import { SubtreeSampler } from '../lib/sampler.ts';
import type { Adapter, AdapterContext, AdapterRun, StepTimings } from './types.ts';

export type PlaywrightOptions = {
  name: string;
  mode: 'headless' | 'headed';
  /** Playwright channel, e.g. "chrome" to drive the installed Google Chrome. */
  channel?: string;
  executablePath?: string;
};

const now = (): number => performance.now();
const ms = (from: number): number => Math.round(now() - from);

const measure = async (ctx: AdapterContext, options: PlaywrightOptions): Promise<AdapterRun> => {
  const notes: string[] = [];
  const sampler = new SubtreeSampler(ctx.userDataDir, 500);
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  const timings: StepTimings = {
    launch_ms: null,
    login_nav_ms: null,
    form_submit_ms: null,
    app_ready_ms: null,
    snapshot_ms: null,
    snapshot_chars: null,
    iframe_ms: null,
    iframe_text: null,
    download_ms: null,
    download_bytes: null,
    upload_ms: null,
    heavy_nav_ms: null,
    idle_ms: null,
    close_ms: null,
  };

  try {
    sampler.start();
    let t = now();
    context = await chromium.launchPersistentContext(ctx.userDataDir, {
      headless: options.mode === 'headless',
      acceptDownloads: true,
      ...(options.channel ? { channel: options.channel } : {}),
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
    browser = context.browser();
    timings.launch_ms = ms(t);
    if (browser === null) notes.push('persistent context exposes no browser handle');

    const page: Page = context.pages()[0] ?? (await context.newPage());

    t = now();
    await page.goto(`${ctx.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
    timings.login_nav_ms = ms(t);

    t = now();
    await page.fill('#email', 'candidate@example.test');
    await page.fill('#password', 'fixture-password');
    await Promise.all([page.waitForURL('**/app'), page.click('#submit')]);
    timings.form_submit_ms = ms(t);

    t = now();
    await page.waitForSelector('#welcome');
    timings.app_ready_ms = ms(t);

    t = now();
    const snapshot = await page.locator('body').ariaSnapshot();
    timings.snapshot_ms = ms(t);
    timings.snapshot_chars = snapshot.length;

    t = now();
    const frame = page.frameLocator('#frame');
    timings.iframe_text = await frame.locator('#frame-text').innerText();
    timings.iframe_ms = ms(t);

    t = now();
    const downloadPromise = page.waitForEvent('download');
    await page.click('#download');
    const download = await downloadPromise;
    const savedTo = path.join(ctx.downloadDir, 'offer.txt');
    await download.saveAs(savedTo);
    timings.download_ms = ms(t);
    timings.download_bytes = fs.statSync(savedTo).size;

    t = now();
    await page.setInputFiles('#upload', ctx.uploadFile);
    timings.upload_ms = ms(t);

    t = now();
    await page.goto(`${ctx.baseUrl}/heavy`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('.row');
    timings.heavy_nav_ms = ms(t);

    t = now();
    await page.waitForTimeout(ctx.idleMs);
    timings.idle_ms = ms(t);

    // Stop sampling before teardown so the idle window contains only idle time.
    sampler.stop();
    const summary = sampler.summary(ctx.idleMs);

    t = now();
    await context.close();
    context = null;
    timings.close_ms = ms(t);

    return {
      adapter: options.name,
      mode: options.mode,
      ok: true,
      error: null,
      timings,
      resources: {
        peak_rss_mb: summary.peak_rss_mb,
        idle_mean_rss_mb: summary.idle_mean_rss_mb,
        idle_mean_cpu_pct: summary.idle_mean_cpu_pct,
        samples: summary.samples.length,
        processes_peak: summary.samples.reduce((max, s) => Math.max(max, s.processes), 0),
        sampler_overhead_ms: summary.overhead_ms,
        sampler_max_sample_ms: summary.max_sample_ms,
      },
      notes,
    };
  } catch (error) {
    sampler.stop();
    return {
      adapter: options.name,
      mode: options.mode,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      timings: null,
      resources: null,
      notes,
    };
  } finally {
    if (context !== null) await context.close().catch(() => undefined);
    if (browser !== null) await browser.close().catch(() => undefined);
  }
};

export const makePlaywrightAdapter = (options: PlaywrightOptions): Adapter => ({
  name: options.name,
  mode: options.mode,
  availability: async () => {
    if (options.channel === 'chrome' && process.platform === 'darwin') {
      const app = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
      if (!fs.existsSync(app)) return { available: false, reason: `missing installed Chrome at ${app}` };
    }
    return { available: true, reason: null };
  },
  run: (ctx) => measure(ctx, options),
});
