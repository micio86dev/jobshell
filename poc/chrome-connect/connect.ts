/**
 * Step 9: connecting to an existing Chrome installation.
 *
 * Three connection modes are tested against a dedicated profile, never against
 * the maintainer's ordinary browser:
 *
 *   A. Playwright `channel: "chrome"` — the installed Google Chrome binary.
 *   B. `connectOverCDP` to a Chrome started with `--remote-debugging-port=0`,
 *      where the port is read back from the profile's `DevToolsActivePort` file,
 *      so the attached endpoint is provably the browser this script launched.
 *   C. An unpacked MV3 extension, in branded Chrome and in Chrome for Testing.
 *
 * Native messaging is documented, not executed: registering a host writes into
 * the user's real Chrome installation and needs a published extension id.
 *
 * Only measured values go into `modes`. Security observations are analysis and
 * live in `security_analysis`, where they cannot be mistaken for measurements.
 */
import fs from 'node:fs';
import path from 'node:path';

import { chromium, type BrowserContext } from 'playwright';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');
const outDir = path.resolve(
  process.argv[2] ?? path.join(REPO_ROOT, 'evidence/run', new Date().toISOString().replace(/[:.]/g, '-')),
);
fs.mkdirSync(outDir, { recursive: true });

const BRANDED_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CHROME_FOR_TESTING = path.join(
  process.env['PLAYWRIGHT_BROWSERS_PATH'] ?? path.join(REPO_ROOT, '.cache/pw-browsers'),
  'chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

type ModeResult = {
  mode: string;
  ok: boolean;
  detail: string;
  elapsed_ms: number;
};

const results: ModeResult[] = [];
const record = (entry: ModeResult): void => {
  results.push(entry);
  console.log(`[${entry.ok ? 'PASS' : 'FAIL'}] ${entry.mode} — ${entry.detail}`);
};

const message = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

// --- A. Playwright channel: chrome, dedicated profile -----------------------
{
  const started = performance.now();
  const profile = path.join(outDir, 'profile-channel-chrome');
  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(profile, {
      channel: 'chrome',
      headless: true,
      args: ['--no-first-run', '--no-default-browser-check'],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('data:text/html,<h1>channel-chrome</h1>');
    const text = await page.locator('h1').innerText();
    const version = context.browser()?.version() ?? 'unknown';
    record({
      mode: 'playwright-channel-chrome',
      ok: text === 'channel-chrome',
      detail: `rendered in installed Chrome ${version} with a dedicated profile`,
      elapsed_ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    record({
      mode: 'playwright-channel-chrome',
      ok: false,
      detail: message(error),
      elapsed_ms: Math.round(performance.now() - started),
    });
  } finally {
    await context?.close().catch(() => undefined);
  }
}

// --- B. connectOverCDP, port read from DevToolsActivePort ------------------
{
  const started = performance.now();
  const profile = path.join(outDir, 'profile-cdp');
  fs.rmSync(profile, { recursive: true, force: true });
  fs.mkdirSync(profile, { recursive: true });

  let child: import('node:child_process').ChildProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
  try {
    const { spawn } = await import('node:child_process');
    child = spawn(
      BRANDED_CHROME,
      [
        // Port 0 means "choose a free port and write it to DevToolsActivePort",
        // so this run cannot attach to a browser somebody else started.
        '--remote-debugging-port=0',
        `--user-data-dir=${profile}`,
        '--no-first-run',
        '--no-default-browser-check',
        'about:blank',
      ],
      { stdio: 'ignore' },
    );
    child.on('error', () => undefined);

    const activePortFile = path.join(profile, 'DevToolsActivePort');
    let port: number | null = null;
    for (let attempt = 0; attempt < 120 && port === null; attempt += 1) {
      if (fs.existsSync(activePortFile)) {
        const first = fs.readFileSync(activePortFile, 'utf8').split('\n')[0]?.trim();
        const parsed = Number.parseInt(first ?? '', 10);
        if (Number.isInteger(parsed) && parsed > 0) port = parsed;
      }
      if (port === null) await new Promise((resolve) => setTimeout(resolve, 250));
    }
    if (port === null) throw new Error(`DevToolsActivePort never appeared in ${profile}`);

    browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto('data:text/html,<h1>cdp-attach</h1>');
    const text = await page.locator('h1').innerText();

    // The same endpoint answers an anonymous HTTP client: that is the boundary.
    const probe = await fetch(`http://127.0.0.1:${port}/json/list`, {
      headers: { 'user-agent': 'openjob-phase0-probe' },
      signal: AbortSignal.timeout(2000),
    });
    const listed = await probe.json();
    const targetCount = Array.isArray(listed) ? listed.length : -1;

    record({
      mode: 'connect-over-cdp',
      ok: text === 'cdp-attach' && targetCount > 0,
      detail: `attached to the Chrome this run spawned on port ${port} (from DevToolsActivePort); ${targetCount} target(s) listed anonymously on that port`,
      elapsed_ms: Math.round(performance.now() - started),
    });
  } catch (error) {
    record({
      mode: 'connect-over-cdp',
      ok: false,
      detail: message(error),
      elapsed_ms: Math.round(performance.now() - started),
    });
  } finally {
    await browser?.close().catch(() => undefined);
    if (child !== null) {
      child.kill('SIGTERM');
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    }
  }
}

// --- C. Unpacked MV3 extension, branded Chrome vs Chrome for Testing -------
{
  const extensionDir = path.join(outDir, 'mv3-extension');
  fs.mkdirSync(extensionDir, { recursive: true });
  fs.writeFileSync(
    path.join(extensionDir, 'manifest.json'),
    JSON.stringify(
      {
        manifest_version: 3,
        name: 'openjob phase0 probe',
        version: '0.0.1',
        description: 'Load test for the Phase 0 extension experiment.',
        background: { service_worker: 'background.js' },
        permissions: ['storage'],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(extensionDir, 'background.js'), "chrome.storage.local.set({ probe: 'loaded' });\n");

  const targets: Array<{ name: string; binary: { channel: string } | { executablePath: string } }> = [
    { name: 'unpacked-mv3-extension-branded-chrome', binary: { channel: 'chrome' } },
    { name: 'unpacked-mv3-extension-chrome-for-testing', binary: { executablePath: CHROME_FOR_TESTING } },
  ];

  for (const target of targets) {
    const started = performance.now();
    const profile = path.join(outDir, `profile-${target.name}`);
    let context: BrowserContext | null = null;
    try {
      context = await chromium.launchPersistentContext(profile, {
        ...target.binary,
        // Loading an extension needs a headed browser: headless ignores the flag.
        headless: false,
        args: [
          `--disable-extensions-except=${extensionDir}`,
          `--load-extension=${extensionDir}`,
          '--no-first-run',
          '--no-default-browser-check',
          '--disable-features=DisableLoadExtensionCommandLineSwitch',
        ],
      });
      let worker = context.serviceWorkers()[0];
      if (!worker) {
        worker = await context.waitForEvent('serviceworker', { timeout: 15_000 }).catch(() => undefined);
      }
      const workerUrl = worker?.url() ?? null;
      record({
        mode: target.name,
        ok: workerUrl !== null && workerUrl.endsWith('background.js'),
        detail:
          workerUrl === null
            ? 'no MV3 service worker started: this browser ignores --load-extension'
            : `MV3 service worker running: ${workerUrl}`,
        elapsed_ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      record({
        mode: target.name,
        ok: false,
        detail: message(error),
        elapsed_ms: Math.round(performance.now() - started),
      });
    } finally {
      await context?.close().catch(() => undefined);
    }
  }
}

// --- D. Native messaging: requirements, not executed -----------------------
const nativeMessaging = {
  executed: false,
  reason:
    'registering a native messaging host writes into the user’s real Chrome installation and needs the published extension id, so it is documented rather than executed',
  unverified_requirements: [
    'a host manifest JSON with name, description, path, type "stdio" and allowed_origins listing chrome-extension://<id>/',
    'macOS location: ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json (user scope)',
    'Linux location: ~/.config/google-chrome/NativeMessagingHosts/<name>.json',
    'Windows: a registry key under HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\<name> pointing at the manifest',
    'the host binary must speak length-prefixed JSON on stdin/stdout and must not write anything else to stdout',
  ],
  note: 'these requirements come from platform documentation, not from a run; they are unverified in this phase',
};

const securityAnalysis = {
  label: 'analysis, not measurement',
  observations: [
    {
      mode: 'connect-over-cdp',
      finding:
        'the DevTools endpoint answered an anonymous HTTP request on loopback and listed targets, so any local process can control that profile',
      consequence: 'a debugging port must never be opened on a profile that holds real sessions',
    },
    {
      mode: 'playwright-channel-chrome',
      finding: 'the installed binary runs with its own update channel and enterprise policies, while the profile is separate',
      consequence: 'sessions stay isolated, but browser updates are outside the app’s control',
    },
    {
      mode: 'unpacked-mv3-extension-*',
      finding: 'an extension runs with whatever its manifest requests and can read or modify every page in the profile',
      consequence: 'extensions are a supply-chain surface: bundle and pin them, never fetch at runtime',
    },
    {
      mode: 'native-messaging',
      finding: 'a host bridges browser JavaScript to a native binary outside the sandbox, restricted only by allowed_origins',
      consequence: 'privilege-escalation boundary; out of Phase 1 scope because the sidecar covers the same need with an auditable boundary',
    },
  ],
};

const report = {
  generated_at: new Date().toISOString(),
  chrome_binary: BRANDED_CHROME,
  chrome_for_testing_binary: CHROME_FOR_TESTING,
  modes: results,
  native_messaging: nativeMessaging,
  security_analysis: securityAnalysis,
  not_tested: [
    'connecting to the maintainer’s everyday Chrome profile (deliberately excluded: it would expose real sessions)',
    'native messaging host registration (needs a published extension id and writes into the real Chrome installation)',
  ],
};
fs.writeFileSync(path.join(outDir, 'chrome-connect.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nwrote ${path.join(outDir, 'chrome-connect.json')}`);

// The expectation is stated here, before the verdict: branded Chrome 137+ ignores
// --load-extension, while Chrome for Testing still honours it.
const branded = results.find((entry) => entry.mode === 'unpacked-mv3-extension-branded-chrome');
const testing = results.find((entry) => entry.mode === 'unpacked-mv3-extension-chrome-for-testing');
const others = results.filter((entry) => !entry.mode.startsWith('unpacked-mv3-extension'));
const matches = branded?.ok === false && testing?.ok === true && others.every((entry) => entry.ok);
console.log(
  `\nexpectation check: ${matches ? 'PASS' : 'FAIL'} (branded Chrome ignores --load-extension: ${branded?.ok === false}; Chrome for Testing loads it: ${testing?.ok === true})`,
);
process.exit(matches ? 0 : 1);
