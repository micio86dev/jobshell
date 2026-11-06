#!/usr/bin/env node
/**
 * Browser sidecar for the Phase 0 spike.
 *
 * The Rust core spawns this process, hands it a dedicated profile directory and a
 * URL, and reads one JSON line back. Keeping the browser driver in a separate
 * process means a driver crash cannot take the desktop app down, and the driver
 * can be restarted without restarting the app.
 *
 * It never reads the cookie store and never copies credentials: the only thing it
 * reports is whether the page renders an authenticated view.
 */
import { chromium } from 'playwright';

const arg = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const profile = arg('profile');
const url = arg('url');
if (!profile || !url) {
  console.error('usage: browser-agent.mjs --profile <dir> --url <url>');
  process.exit(2);
}

const started = performance.now();
const report = (ok, detail) => {
  process.stdout.write(JSON.stringify({ ok, detail, elapsed_ms: Math.round(performance.now() - started) }) + '\n');
};

let context;
try {
  context = await chromium.launchPersistentContext(profile, { headless: true });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  const title = await page.title();
  const authenticated = await page.locator('#welcome').isVisible().catch(() => false);
  report(true, `loaded "${title}" from ${url}; authenticated view visible: ${authenticated}`);
} catch (error) {
  report(false, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
  process.exitCode = 1;
} finally {
  if (context) await context.close().catch(() => undefined);
}
