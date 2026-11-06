import { chromium } from 'playwright';

const t0 = performance.now();
const browser = await chromium.launch({ headless: true });
try {
  const t1 = performance.now();
  const version = browser.version();
  const page = await browser.newPage();
  await page.goto('data:text/html,<h1>smoke</h1>');
  const title = await page.locator('h1').innerText();
  console.log(
    JSON.stringify(
      {
        ok: true,
        browser_version: version,
        launch_ms: Math.round(t1 - t0),
        title,
        browsers_path: process.env.PLAYWRIGHT_BROWSERS_PATH ?? null,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
