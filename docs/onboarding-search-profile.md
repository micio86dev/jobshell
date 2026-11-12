# First-run onboarding and the versioned search profile (spec #30)

Status: implemented up to the open items at the end. Evidence is in `evidence/onboarding/`.

## What the user does

1. **CV (required to finish).** Paste the text or load a `.txt` or `.md` file. Analysis is optional: the extractor proposes headline, capabilities, seniority and years, and each proposal is applied only to a field the user has not typed.
2. **Work.** Headline, capabilities, seniority, years, contract type (employee, freelance), and how strict that preference is.
3. **Where.** Work modes (remote, hybrid, onsite). Remote needs an explicit scope: `europe`, `countries`, `residence`, or `worldwide` chosen on purpose. An unstated scope is never read as worldwide. Employee and freelance country lists are separate; an empty list means not stated.
4. **Languages.** At least one language, each with a level and a usage (comfortable, limited, unwilling). The language requirement must be mandatory.
5. **Summary.** Every field is shown, unstated fields as "Not stated". Finish is disabled until every required field is valid.

A draft can be saved at any step and read back on the next start. Editing a saved profile reopens the wizard with the saved values; a change asks which searches it applies to: new searches only, active searches, or all future sessions.

## Where the rules live

| Concern | Location |
| --- | --- |
| Boundary schemas (CV proposal, draft, saved identity) | `poc/session-poc/ui/src/onboarding/schema.ts` |
| Step state, finish rule, profile mapping, summary, apply-scope decision | `poc/session-poc/ui/src/onboarding/wizard.ts` |
| Wizard component | `poc/session-poc/ui/src/onboarding/OnboardingWizard.vue` |
| Versioned identity, searches, drafts, apply-scope propagation | `poc/session-poc/src-tauri/src/profile_store.rs`, migrations `0002` and `0003` |
| Profile validation (single validator) | `poc/job-agent/src/profile.ts`, reached through `validate-profile-cli.ts` |
| CV extraction | `poc/job-agent/src/extract-cv.ts`, entry `extract-cv-cli.ts`, `intake.ts` |
| Tauri commands | `poc/session-poc/app/src/profile.rs` (`cv_extract`, `profile_validate`, `identity_save`, `draft_save`, `draft_get`) |

## Storage and versions

- Every identity change and every search edit appends a version. Nothing is updated in place, so a past run keeps the version it ran with.
- A search's stored payload is the profile the agent reads. An identity change writes its keys over the same keys in each reached search profile and keeps the search's own keys.
- Apply scope:
  - `new_only`: no existing search is touched.
  - `active_searches`: every active search gets a new version.
  - `all_future`: active and paused searches get a new version, so a resumed search uses the new identity. Deleted searches are never touched.

## Validation and privacy

- `identity_save` asks the agent's validator first. An invalid profile is never stored, whatever the caller.
- The CV leaves the machine once, when the user asks for analysis. It goes to the Anthropic API with the key read from the keychain under the agent's own service name `openjob-agent`. The key is never an argument, an environment variable or a file, and never appears in output.
- The CV text is stored locally in the profile because the agent's scorer needs it. The job judge receives the structured summary, not the CV (decision L25 in the feature log).

## How to check

```sh
make ui-test                      # vitest: 32 tests on rules and boundary schemas
cd poc/session-poc/ui && npx vue-tsc --noEmit && npx vite build
cd poc/session-poc/src-tauri && cargo test --lib           # store: versions, scopes, drafts
cd poc/session-poc/app && cargo test                        # commands and verdict mapping
make agent-test                   # job-agent tests, including the CLI entry tests
```

On macOS the Rust tests need the toolchain 1.98.1 and `RUSTFLAGS="-C link-arg=-Wl,-ld_classic"`.

## Evidence

- `evidence/onboarding/e2e-results.json` and `e2e-run.log`: 17 browser checks, 0 failed, against the Vite UI with a stubbed Tauri bridge. Screenshots `01`–`05` are from the same run.
- `evidence/onboarding/saved-profile-A.json` and `cli-validate-wizard-profile.txt`: the profile the wizard produced in the browser passes the agent's validator (`{"ok":true}`).
- `evidence/onboarding/cli-checks.txt`: offline refusals of the CLI entries (empty CV, oversized CV, invalid profile). The first profile line in that file is a historical failure, before the CV fix.
- `evidence/onboarding/wizard-e2e.mjs`: the browser script, with its reproduction note.

## Limits and open items

- **Not run:** the real desktop window (`cargo tauri dev`) and a live extraction on a real CV. The live call sends a CV to the provider and needs explicit approval.
- **Not done:** PDF CV intake (only text and `.md`/`.txt`); the UI has no styling pass yet.
- **Model limit:** strength is one value per group (contract types, remote modes, languages), not per item, because the agent schema has no per-item strength.
- **Open product decision:** how seniority and minimum salary act in the funnel (hard filter or ranking). Not implemented; the feature log records it as open.
- **Open technical item:** a zod boundary for external posting fields inside the agent package.
