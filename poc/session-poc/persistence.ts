/**
 * Step 7 of the browser-session experiment: protocol steps 1-6.
 *
 *   1. Launch a dedicated Chromium profile.
 *   2. Open a login page.
 *   3. Authenticate manually using a test account on a permitted service.
 *   4. Close the browser.
 *   5. Restart the browser.
 *   6. Verify that the session persists.
 *
 * The deterministic variant runs against the local fixture site, whose login form
 * sets an HttpOnly session cookie. It uses no real account and no third-party
 * service, so it is reproducible on any machine.
 *
 * Session presence is observed BEHAVIOURALLY: the authenticated app page renders
 * and the server-side /session probe agrees. The browser cookie store is never
 * read, copied or exported, because the experiment must not depend on the
 * mechanism it is not allowed to inspect.
 *
 * The real-service variant runs only when the maintainer sets both
 * OPENJOB_REAL_LOGIN_URL and OPENJOB_REAL_LOGGED_IN_SELECTOR; it opens a headed
 * browser, waits for the human to sign in, and asserts that selector after a
 * restart.
 */
import fs from 'node:fs';
import path from 'node:path';

import { chromium } from 'playwright';

import { startFixtureServer } from '../runtime-bench/src/fixtures/server.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const outDir = path.resolve(
  process.argv[2] ?? path.join(REPO_ROOT, 'evidence/run', new Date().toISOString().replace(/[:.]/g, '-')),
);
fs.mkdirSync(outDir, { recursive: true });

type StepResult = { step: number; name: string; ok: boolean; detail: string; elapsed_ms: number | null };

type VariantSpec = {
  variant: 'persistent-cookie' | 'session-cookie';
  remember: boolean;
  /** What the browser is expected to do, stated before the run. */
  expected_persist: boolean;
};

type VariantResult = {
  variant: string;
  remember: boolean;
  profile: string;
  steps: StepResult[];
};

const server = await startFixtureServer();
const loginUrl = `${server.baseUrl}/login`;
const appUrl = `${server.baseUrl}/app`;

const launch = (profileDir: string) =>
  chromium.launchPersistentContext(profileDir, {
    headless: true,
    // A dedicated profile: nothing from the user's ordinary browser is read.
    args: ['--no-first-run', '--no-default-browser-check'],
  });

const runVariant = async (spec: VariantSpec): Promise<VariantResult> => {
  const steps: StepResult[] = [];
  const push = (step: number, name: string, ok: boolean, detail: string, elapsed: number | null = null): void => {
    steps.push({ step, name, ok, detail, elapsed_ms: elapsed });
    console.log(`[${ok ? 'PASS' : 'FAIL'}] ${spec.variant} ${step}. ${name} — ${detail}`);
  };

  const profileDir = path.join(outDir, `profile-${spec.variant}`);
  fs.rmSync(profileDir, { recursive: true, force: true });
  fs.mkdirSync(profileDir, { recursive: true });

  // --- 1. Launch a dedicated Chromium profile -------------------------------
  let t = performance.now();
  const first = await launch(profileDir);
  const firstPage = first.pages()[0] ?? (await first.newPage());
  // A launched context is only useful if it can render: prove it with a round trip.
  const launchedOk = await firstPage.evaluate(() => 1 + 1).then((value) => value === 2).catch(() => false);
  const profileWritten = fs.existsSync(path.join(profileDir, 'Default'));
  push(
    1,
    'launch dedicated profile',
    launchedOk && profileWritten,
    `page evaluates in the new context: ${launchedOk}; browser created its profile: ${profileWritten}; profile at ${path.relative(REPO_ROOT, profileDir)}`,
    Math.round(performance.now() - t),
  );

  // --- 2. Open the login page ----------------------------------------------
  t = performance.now();
  await firstPage.goto(loginUrl, { waitUntil: 'domcontentloaded' });
  const hasForm = await firstPage.locator('#email').isVisible();
  push(2, 'open login page', hasForm, `form visible at ${loginUrl}`, Math.round(performance.now() - t));

  // --- 3. Authenticate (deterministic fixture account) ---------------------
  t = performance.now();
  await firstPage.fill('#email', 'candidate@example.test');
  await firstPage.fill('#password', 'fixture-password');
  if (spec.remember) await firstPage.check('#remember');
  await Promise.all([firstPage.waitForURL('**/app'), firstPage.click('#submit')]);
  const authenticatedBeforeClose = await firstPage.locator('#welcome').isVisible();
  push(
    3,
    'authenticate on the permitted fixture service',
    authenticatedBeforeClose,
    `authenticated app page rendered; login requested a persistent cookie: ${spec.remember}`,
    Math.round(performance.now() - t),
  );

  // --- 4. Close the browser ------------------------------------------------
  t = performance.now();
  await first.close();
  const profileOnDisk = fs.existsSync(path.join(profileDir, 'Default'));
  push(4, 'close the browser', profileOnDisk, `profile directory survives close: ${profileOnDisk}`, Math.round(performance.now() - t));

  // --- 5. Restart the browser ----------------------------------------------
  t = performance.now();
  const second = await launch(profileDir);
  const secondPage = second.pages()[0] ?? (await second.newPage());
  const restartedOk = await secondPage.evaluate(() => 1 + 1).then((value) => value === 2).catch(() => false);
  push(5, 'restart the browser', restartedOk, 'relaunched with the same user data directory and rendered a page', Math.round(performance.now() - t));

  // --- 6. Verify the session persists --------------------------------------
  t = performance.now();
  await secondPage.goto(appUrl, { waitUntil: 'domcontentloaded' });
  const stillLoggedIn = await secondPage.locator('#welcome').isVisible().catch(() => false);
  const sessionProbe = await secondPage.evaluate(async () => {
    const res = await fetch('/session');
    return (await res.json()) as { authenticated: boolean };
  });
  push(
    6,
    'verify the session persists',
    stillLoggedIn && sessionProbe.authenticated,
    `app page rendered without re-login: ${stillLoggedIn}; server reports authenticated=${sessionProbe.authenticated}`,
    Math.round(performance.now() - t),
  );

  await second.close();
  return { variant: spec.variant, remember: spec.remember, profile: path.relative(REPO_ROOT, profileDir), steps };
};

const variants: VariantSpec[] = [
  { variant: 'persistent-cookie', remember: true, expected_persist: true },
  { variant: 'session-cookie', remember: false, expected_persist: false },
];

const variantResults: VariantResult[] = [];
try {
  for (const spec of variants) {
    variantResults.push(await runVariant(spec));
  }
} finally {
  await server.close();
}

// --- Optional real-service variant (human in the loop, behaviour-only) -------
const realLoginUrl = process.env['OPENJOB_REAL_LOGIN_URL'];
const realLoggedInSelector = process.env['OPENJOB_REAL_LOGGED_IN_SELECTOR'];
const realService: { ran: boolean; reason: string; result: string | null } = {
  ran: false,
  reason:
    'skipped: OPENJOB_REAL_LOGIN_URL and OPENJOB_REAL_LOGGED_IN_SELECTOR are not both set, so no third-party account was used',
  result: null,
};
if (realLoginUrl !== undefined && realLoginUrl.length > 0 && realLoggedInSelector !== undefined) {
  // A real account's profile holds live session material: it is deleted in a
  // finally block and never kept on disk after the run.
  const realProfile = path.join(outDir, 'profile-real');
  try {
  const context = await chromium.launchPersistentContext(realProfile, { headless: false });
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(realLoginUrl);
  console.log('Sign in in the opened window; waiting up to 5 minutes for the logged-in selector.');
  const signedIn = await page
    .waitForSelector(realLoggedInSelector, { timeout: 5 * 60 * 1000 })
    .then(() => true)
    .catch(() => false);
  await context.close();

  const reopened = await chromium.launchPersistentContext(realProfile, { headless: true });
  const reopenedPage = reopened.pages()[0] ?? (await reopened.newPage());
  await reopenedPage.goto(realLoginUrl, { waitUntil: 'domcontentloaded' });
  const persisted = await reopenedPage
    .waitForSelector(realLoggedInSelector, { timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  await reopened.close();

  realService.ran = true;
  realService.reason = 'maintainer-provided URL and selector';
  realService.result = `signed in during the run: ${signedIn}; logged-in selector present after restart: ${persisted}`;
  } finally {
    fs.rmSync(realProfile, { recursive: true, force: true });
  }
}

const deterministicVariants = variantResults.map((row) => {
  const persistStep = row.steps.find((step) => step.step === 6);
  const expected = variants.find((spec) => spec.variant === row.variant)?.expected_persist ?? false;
  return {
    variant: row.variant,
    login_sets_persistent_cookie: row.remember,
    profile_dir: row.profile,
    steps: row.steps,
    passed: row.steps.filter((step) => step.ok).length,
    failed: row.steps.filter((step) => !step.ok).length,
    expected_persist: expected,
    observed_persist: persistStep?.ok ?? false,
    matches_expectation: (persistStep?.ok ?? false) === expected,
  };
});

const report = {
  generated_at: new Date().toISOString(),
  protocol: 'browser-session experiment steps 1-6',
  deterministic_variants: deterministicVariants,
  summary: {
    persistent_cookie_persists: deterministicVariants
      .filter((row) => row.login_sets_persistent_cookie)
      .every((row) => row.observed_persist),
    session_cookie_persists: deterministicVariants
      .filter((row) => !row.login_sets_persistent_cookie)
      .every((row) => row.observed_persist),
  },
  real_service_variant: realService,
  not_tested: [
    'session persistence on a third-party service with a real account (requires a maintainer-provided account, URL and logged-in selector)',
    'the browser cookie store is never read, copied or exported — by design, so cookie-level assertions do not exist',
  ],
};

fs.writeFileSync(path.join(outDir, 'persistence.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nwrote ${path.join(outDir, 'persistence.json')}`);

// The experiment passes when every observation matches the expectation stated
// before the run: a session cookie is expected NOT to survive a browser restart.
const stepsBeforeSix = variantResults.flatMap((row) => row.steps.filter((step) => step.step !== 6));
const matches =
  deterministicVariants.every((row) => row.matches_expectation) && stepsBeforeSix.every((step) => step.ok);
console.log(`\nexpectation check: ${matches ? 'PASS' : 'FAIL'}`);
process.exit(matches ? 0 : 1);
