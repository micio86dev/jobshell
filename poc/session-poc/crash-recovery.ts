/**
 * Browser crash recovery: kill the browser mid-task and measure what survives.
 *
 * The task queue survives a process death (proved by the Rust two-phase
 * self-test). This measures the other half: what a killed browser does to an
 * in-flight automation, and whether the same dedicated profile is reusable
 * afterwards.
 *
 * The browser is killed with SIGKILL, which is what an out-of-memory event or a
 * hard crash looks like. Nothing here reads cookies or credentials.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type BrowserContext } from 'playwright';

import { startFixtureServer } from '../runtime-bench/src/fixtures/server.ts';
import { findRootPids, snapshotProcesses } from '../runtime-bench/src/lib/procs.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const outDir = path.resolve(
  process.argv[2] ?? path.join(REPO_ROOT, 'evidence/run', new Date().toISOString().replace(/[:.]/g, '-')),
);
fs.mkdirSync(outDir, { recursive: true });

const profileDir = path.join(outDir, 'profile-crash');
fs.rmSync(profileDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true });

const server = await startFixtureServer();
const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string): void => {
  steps.push({ step, ok, detail });
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${step} — ${detail}`);
};

const launch = (): Promise<BrowserContext> =>
  chromium.launchPersistentContext(profileDir, { headless: true, args: ['--no-first-run'] });

// Stated before the run: this login does not tick "stay signed in", so the
// fixture issues a session cookie and a hard crash is expected to lose it.
const EXPECTED_SESSION_SURVIVES = false;

let context: BrowserContext | null = null;
let recovered: BrowserContext | null = null;
try {
  // 1. Start a task: sign in, then sit on the authenticated page.
  context = await launch();
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(`${server.baseUrl}/login`, { waitUntil: 'domcontentloaded' });
  await page.fill('#email', 'candidate@example.test');
  await page.fill('#password', 'fixture-password');
  await Promise.all([page.waitForURL('**/app'), page.click('#submit')]);
  const readyBefore = await page.locator('#welcome').isVisible();
  record('task running before the crash', readyBefore, 'authenticated page rendered');

  // 2. Kill the browser's whole process subtree with SIGKILL.
  const rows = snapshotProcesses();
  const roots = findRootPids(rows, profileDir);
  if (roots.length === 0) throw new Error('could not identify the browser process for the profile');
  const rootPid = roots[0];
  if (rootPid === undefined) throw new Error('no browser pid');
  execFileSync('kill', ['-9', String(rootPid)]);
  await new Promise((resolve) => setTimeout(resolve, 1500));

  const stillConnected = context.browser()?.isConnected() ?? false;
  record('the automation handle notices the crash', !stillConnected, `browser.isConnected() after SIGKILL: ${stillConnected}`);

  // 3. The next action on the dead page must fail, not hang.
  const started = performance.now();
  const nextActionFailed = await page
    .locator('#welcome')
    .isVisible({ timeout: 5000 })
    .then(() => false)
    .catch(() => true);
  record(
    'the in-flight action fails instead of hanging',
    nextActionFailed,
    `action rejected after ${Math.round(performance.now() - started)} ms`,
  );

  // 4. Recover: relaunch on the same profile and check the session state.
  recovered = await launch();
  const recoveredPage = recovered.pages()[0] ?? (await recovered.newPage());
  await recoveredPage.goto(`${server.baseUrl}/app`, { waitUntil: 'domcontentloaded' });
  const sessionSurvived = await recoveredPage.locator('#welcome').isVisible().catch(() => false);
  const recoveredPageWorks = await recoveredPage.evaluate(() => 1 + 1).then((v) => v === 2);
  record(
    'the same profile is reusable after a hard crash',
    recoveredPageWorks,
    `relaunch on the same directory rendered a page: ${recoveredPageWorks}`,
  );
  record(
    'session state after a hard crash matches the stated expectation',
    sessionSurvived === EXPECTED_SESSION_SURVIVES,
    `expected session to survive: ${EXPECTED_SESSION_SURVIVES}; observed: ${sessionSurvived} (the login in this script does not tick "stay signed in")`,
  );
} finally {
  await recovered?.close().catch(() => undefined);
  await context?.close().catch(() => undefined);
  await server.close();
}

const report = {
  generated_at: new Date().toISOString(),
  protocol: 'kill -9 the browser mid-task, then relaunch on the same profile',
  profile_dir: path.relative(REPO_ROOT, profileDir),
  expected_session_survives: EXPECTED_SESSION_SURVIVES,
  steps,
  passed: steps.filter((step) => step.ok).length,
  failed: steps.filter((step) => !step.ok).length,
};
fs.writeFileSync(path.join(outDir, 'crash-recovery.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nwrote ${path.join(outDir, 'crash-recovery.json')}`);
process.exit(report.failed === 0 ? 0 : 1);
