# First-run onboarding and the versioned search profile (spec #30)

Status: implemented up to the open items at the end. Evidence is in `evidence/onboarding/`.

## What the user does

1. **CV (required to finish).** Upload the file: PDF, `.txt` or `.md`. Nothing is typed or pasted. Analysis is optional: the extractor proposes headline, capabilities, seniority, years and languages, and each proposal is applied only to a field the user has not typed. A portfolio text can be read the same way; it only adds languages.
2. **Work.** Headline, capabilities, seniority, years, contract type (employee, freelance), and how strict that preference is.
3. **Where.** Work modes (remote, hybrid, onsite). Remote needs an explicit scope: `europe`, `countries`, `residence`, or `worldwide` chosen on purpose. An unstated scope is never read as worldwide. Employee and freelance country lists are separate; an empty list means not stated.
4. **Languages.** Search only looks at postings in the languages you speak, at the level you give. Each language has a level and a usage (comfortable, limited, unwilling); one is the **primary language**, which is the language the app navigates in. The primary language defaults to the operating system language. A CV or a portfolio can pre-fill languages with their level; the usage is always yours to choose.
5. **Summary.** Every field is shown, unstated fields as "Not stated". Finish is disabled until every required field is valid.

The interface follows the primary language: Italian and English are supported, and any other language falls back to the system language, then to English.

A draft can be saved at any step and read back on the next start. Editing a saved profile reopens the wizard with the saved values; a change asks which searches it applies to: new searches only, active searches, or all future sessions.

## Where the rules live

| Concern | Location |
| --- | --- |
| Boundary schemas (CV proposal, draft, saved identity) | `poc/session-poc/ui/src/onboarding/schema.ts` |
| Step state, finish rule, profile mapping, summary, apply-scope decision | `poc/session-poc/ui/src/onboarding/wizard.ts` |
| Wizard component | `poc/session-poc/ui/src/onboarding/OnboardingWizard.vue` |
| Versioned identity, searches, drafts, apply-scope propagation | `poc/session-poc/src-tauri/src/profile_store.rs`, migrations `0002` and `0003` |
| Profile validation (single validator) | `poc/job-agent/src/profile.ts`, reached through `validate-profile-cli.ts` |
| CV and portfolio extraction | `poc/job-agent/src/extract-cv.ts`, entry `extract-cv-cli.ts` (`--kind cv|portfolio`), `intake.ts` |
| Interface language | `poc/session-poc/ui/src/i18n/locale.ts` (messages), `store.ts` (reactive language) |
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
- The CV or portfolio text leaves the machine once, when the user asks for analysis. It goes to the Anthropic API with the key read from the keychain service `dev.openjob.desktop`, which only the desktop app writes. The key is never an argument, an environment variable or a file, and never appears in output.
- The CV text is stored locally in the profile because the agent's scorer needs it. The job judge receives the structured summary, not the CV (decision L25 in the feature log).

## How to check

```sh
make ui-test                      # vitest: 49 tests on rules, boundary schemas and the interface language
cd poc/session-poc/ui && npx vue-tsc --noEmit && npx vite build
cd poc/session-poc/src-tauri && cargo test --lib           # store: versions, scopes, drafts
cd poc/session-poc/app && cargo test                        # commands and verdict mapping
make agent-test                   # job-agent tests, including the CLI entry tests
```

On macOS the Rust tests need the toolchain 1.98.1 and `RUSTFLAGS="-C link-arg=-Wl,-ld_classic"`.

## Evidence

- `evidence/onboarding/e2e-results.json` and `e2e-run.log`: 20 browser checks, 0 failed, against the Vite UI with a stubbed Tauri bridge. Scenario D runs the wizard with an Italian system and checks that the primary language defaults to Italian. Screenshots `01`–`06` are from the same run.
- `evidence/onboarding/saved-profile-A.json` and `cli-validate-wizard-profile.txt`: the profile the wizard produced in the browser passes the agent's validator (`{"ok":true}`), after the language rewrite.
- `evidence/onboarding/cli-checks.txt`: offline refusals of the CLI entries (empty CV, oversized CV, invalid profile). The first profile line in that file is a historical failure, before the CV fix.
- `evidence/onboarding/wizard-e2e.mjs`: the browser script, with its reproduction note.

## Language rules

- A posting is searched only if its language is one the user speaks. A posting whose language cannot be read is not a match.
- A level the posting states above the user's own drops the posting, whatever the setting.
- The agent refuses a language that is not a two-letter ISO 639-1 code.

## Configuration

| Variable | Effect | Default |
| --- | --- | --- |
| `OPENJOB_EXTRACT_MODEL` | model that reads a CV or portfolio | provider default (`claude-sonnet-5-5`) |
| `OPENJOB_EXTRACT_MAX_TOKENS` | token budget for the answer | 4000 |

A value that is not a positive integer for the budget is ignored; a blank model counts as unset.

## Limits and open items

- **Done live:** one extraction on the English CV (Sonnet 5.5 and Haiku 5.5), and one read-only fetch of the RemoteOK feed (98 postings, all https links).
- **Not run:** the real desktop window (`cargo tauri dev`), by hand. Extraction on the Italian and Spanish CVs needs the user's explicit approval, since it sends the CV to the provider.
- **Not decided:** removing the old `openjob-agent` keychain entries, which is irreversible and waits for the user's go-ahead.
- **Limit:** a scanned PDF with no text layer is not read (no OCR). The UI has no styling pass yet.
- **Model limit:** strength is one value per group (contract types, remote modes), not per item, because the agent schema has no per-item strength. Languages are always a hard filter.
- **Interface limit:** only the wizard and the navigation are translated (Italian, English). The results and task panels of `App.vue` keep their Italian labels.
- **Portfolio:** a public https link, checked when the user confirms it. The check is read-only: one GET per hop, a 10-second timeout, a bounded body, and redirects checked hop by hop. Private, loopback and reserved addresses are refused by their text; a public name that points at a private address is not caught (no DNS lookup).
- **Open product decision:** how seniority and minimum salary act in the funnel (hard filter or ranking). Not implemented; the feature log records it as open.
- **Open technical item:** a zod boundary for external posting fields inside the agent package.
