// Reproduce: start the UI with `cd poc/session-poc/ui && npx vite --port 5174 --strictPort`,
// install playwright-core outside the repo (`npm i playwright-core@1` in a scratch folder), then run
//   E2E_OUT=evidence/onboarding node wizard-e2e.mjs
// from that scratch folder with NODE_PATH pointing at it. Exit 0 means every check passed.
// E2E for the onboarding wizard in a real browser, against the Vite UI with a stubbed Tauri bridge.
// The bridge records every command and its arguments, so the test asserts what the backend would receive.
import { chromium } from 'playwright-core';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = process.env.E2E_OUT;
const URL = 'http://127.0.0.1:5174/';
const CHROME =
  '<repo>/.cache/pw-browsers/chromium-1248/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const CV_TEXT = 'Twelve years building desktop apps with Rust and Python. Led a team of four.';

const bridge = `
window.__calls = [];
const sc = window.__SCENARIO__ || {};
const store = { onboarding: !!sc.onboarding, draft: sc.draft ?? null, identity: sc.identity ?? null };
window.__TAURI_INTERNALS__ = {
  invoke: async (cmd, args) => {
    window.__calls.push({ cmd, args: args ?? null });
    switch (cmd) {
      case 'onboarding_status': return store.onboarding;
      case 'onboarding_complete': store.onboarding = true; return null;
      case 'draft_get': return store.draft;
      case 'draft_save': store.draft = { version: 1, payload: args.payload }; return 1;
      case 'identity_get': return store.identity;
      case 'identity_save': store.identity = { version: 2, payload: args.payload }; return 2;
      case 'profile_validate': return null;
      case 'cv_extract': return JSON.stringify({ source: 'model', reason: null, fields: {
        headline: 'Desktop engineer', capabilities: ['Rust', 'Python'], domains: [],
        seniority: 'senior', years_experience: 12, languages: ['English'] } });
      case 'agent_key_status': return { typesafe: false, anthropic: false, qwen: false };
      default: return null;
    }
  },
  transformCallback: () => 0,
  metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
};`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });

const open = async (scenario) => {
  const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
  await context.addInitScript(`window.__SCENARIO__ = ${JSON.stringify(scenario)};` + bridge);
  const page = await context.newPage();
  await page.goto(URL);
  return { context, page };
};
const callsOf = (page, cmd) => page.evaluate((c) => window.__calls.filter((x) => x.cmd === c), cmd);
const shot = (page, name) => page.screenshot({ path: `${OUT}/${name}`, fullPage: true });

// Scenario A: first run, CV proposal, full path to a saved profile.
{
  const { context, page } = await open({ onboarding: false });
  await page.getByText('Set up your profile').waitFor({ timeout: 15000 });
  check('A1 first run shows the wizard on the CV step', await page.getByText('Upload or paste your CV').isVisible());
  await page.getByLabel('Paste the CV text here').fill(CV_TEXT).catch(async () => {
    await page.locator('textarea').fill(CV_TEXT);
  });
  await page.getByRole('button', { name: 'Analyse the CV' }).click();
  await page.getByText('CV proposal: choose what to apply').waitFor({ timeout: 10000 });
  await shot(page, '01-cv-proposal.png');
  await page.getByRole('button', { name: 'Apply the chosen fields' }).click();
  const headline = await page.getByLabel('Headline', { exact: false }).first().inputValue();
  check('A2 CV proposal fills the empty headline', headline === 'Desktop engineer', `headline="${headline}"`);

  // Work step: employee contract chosen, the rest as the CV suggested
  await page.getByLabel('Employee', { exact: true }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  // Location step: remote selected but no scope, must not be finishable
  await page.getByLabel('Remote', { exact: true }).check();
  await page.getByRole('button', { name: 'Next' }).click();

  // Languages: adding an empty row is refused; a complete row is kept
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check('A3 an empty language row is refused', await page.getByText('To add a language').isVisible());
  await page.getByLabel('Language', { exact: true }).selectOption('en');
  await page.getByLabel('Level', { exact: true }).selectOption('fluent');
  await page.getByLabel('Usage', { exact: true }).selectOption('comfortable');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  check('A4 a complete language row is listed', await page.getByText('English · fluent · comfortable').isVisible());

  // Summary: remote without a scope blocks the finish button
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  const finish = page.getByRole('button', { name: 'Complete and save' });
  check('A5 finish is disabled while the remote scope is unstated', await finish.isDisabled());
  await shot(page, '02-summary-blocked.png');

  // Back to location, choose a scope, then finish
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.locator('select').filter({ has: page.locator('option', { hasText: 'Choose a scope' }) }).selectOption('europe');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  check('A6 finish is enabled once the scope is chosen', await finish.isEnabled());
  await shot(page, '03-summary-ready.png');
  await finish.click();
  await page.getByRole('button', { name: 'Risultati' }).waitFor({ timeout: 10000 });
  check('A7 after saving, the main app is shown', await page.getByRole('button', { name: 'Risultati' }).isVisible());

  const saves = await callsOf(page, 'identity_save');
  check('A8 one identity_save with the new_only scope', saves.length === 1 && saves[0].args.applyScope === 'new_only', `calls=${saves.length}`);
  const profile = saves.length ? JSON.parse(saves[0].args.payload) : {};
  check('A9 the saved profile is the agent shape with the chosen values',
    profile.headline === 'Desktop engineer' &&
      profile.remote_scope === 'europe' &&
      JSON.stringify(profile.languages) === '["en"]' &&
      profile.strengths?.languages === 'mandatory' &&
      profile.eligibility?.residence === null &&
      profile.threshold === 0.9,
    `scope=${profile.remote_scope} languages=${JSON.stringify(profile.languages)}`);
  const completed = await callsOf(page, 'onboarding_complete');
  check('A10 onboarding is marked complete once', completed.length === 1);
  writeFileSync(`${OUT}/saved-profile-A.json`, JSON.stringify(profile, null, 2));
  globalThis.savedA = saves.length ? saves[0].args.payload : null;
  await context.close();
}

// Scenario B: a partial draft is kept and read back on the next start.
{
  const { context, page } = await open({ onboarding: false });
  await page.getByText('Set up your profile').waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByLabel('Headline', { exact: false }).first().fill('Backend developer');
  await page.getByRole('button', { name: 'Save and continue later' }).first().click();
  await page.getByText('Draft saved').waitFor({ timeout: 10000 });
  const drafts = await callsOf(page, 'draft_save');
  check('B1 a partial draft is saved without a finish', drafts.length === 1 && JSON.parse(drafts[0].args.payload).headline === 'Backend developer');
  const savedDraft = drafts.length ? drafts[0].args.payload : '{}';
  check('B2 no profile is saved from a partial draft', (await callsOf(page, 'identity_save')).length === 0);
  await context.close();

  const second = await open({ onboarding: false, draft: { version: 1, payload: savedDraft } });
  await second.page.getByText('You have a saved draft').waitFor({ timeout: 15000 });
  await second.page.getByRole('button', { name: '2. Work' }).click();
  const restored = await second.page.getByLabel('Headline', { exact: false }).first().inputValue();
  check('B3 the draft is read back on the next start', restored === 'Backend developer', `headline="${restored}"`);
  await shot(second.page, '04-draft-restored.png');
  await second.context.close();
}

// Scenario C: later edit, the change asks which searches it applies to.
{
  const identity = { version: 2, payload: globalThis.savedA };
  const { context, page } = await open({ onboarding: true, identity });
  await page.getByRole('button', { name: 'Impostazioni' }).click();
  await page.getByRole('button', { name: 'Edit profile' }).click();
  await page.getByText('Edit profile', { exact: true }).first().waitFor({ timeout: 10000 });
  const headline = await page.getByLabel('Headline', { exact: false }).first().inputValue();
  check('C1 edit opens with the saved profile', headline === 'Desktop engineer', `headline="${headline}"`);

  await page.getByLabel('Headline', { exact: false }).first().fill('Lead engineer');
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Summary', exact: true }).click();
  await page.getByRole('button', { name: 'Save the change' }).click();
  await page.getByText('Choose which searches the change applies to.').waitFor({ timeout: 10000 });
  check('C2 a changed profile without a scope is refused', (await callsOf(page, 'identity_save')).length === 0);
  await shot(page, '05-edit-needs-scope.png');

  await page.getByRole('radio', { name: /Active searches/ }).check();
  await page.getByRole('button', { name: 'Save the change' }).click();
  await page.getByRole('button', { name: 'Risultati' }).waitFor({ timeout: 10000 });
  const saves = await callsOf(page, 'identity_save');
  check('C3 the change is saved with the active_searches scope', saves.length === 1 && saves[0].args.applyScope === 'active_searches', `calls=${saves.length}`);
  check('C4 the new headline reaches the saved profile', saves.length === 1 && JSON.parse(saves[0].args.payload).headline === 'Lead engineer');
  await context.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
writeFileSync(`${OUT}/e2e-results.json`, JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
console.log(`TOTAL ${results.length} FAILED ${failed.length}`);
process.exit(failed.length === 0 ? 0 : 1);
