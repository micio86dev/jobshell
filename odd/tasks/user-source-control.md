# User source control: enable, disable and add sources from one page

Objective: the user decides which sources the agent uses, can add free-key sources and their own ATS boards, and gets a guide to generate each key.
Branch: feat/user-source-control (from main). Delivery strategy: ask-on-risk. Test runners: `node --test` and `tsc --noEmit` in poc/job-agent; `npx vitest run` in poc/session-poc/ui.

## Specs

S1. User request, verbatim: "Non voglio creare app su portali, sarebbe una perdita di tempo per gli utenti, voglio che sia semplice: fai io wizard, metti le chiavi api AI e ricerca automatica."
S2. User request, verbatim: "Al massimo per le api e RSS che richiedono una chiave api ma sono gratuite, puoi aggiungere fonti, guida alla generazione apikey e fare gestire tutte le fonti in una pagina apposita così un utente che vuole aggiungere alcune fonti così può farlo."
S3. User request, verbatim: "Inoltre nella stessa nuova pagina deve poter disattivare qualsiasi fonte così ognuno ha autonomia e non perde tempo a valutare link di annunci di portali che per un utente non sono di suo interesse"
S4. Every source can be disabled by the user, from the sources page. A disabled source is never fetched and is reported as skipped with the reason "disabled by the user".
S5. The user can add a board tenant (ATS employer id) to a board source. A user tenant is kept in the configuration file as a plain slug, is refused if it looks like a key or a URL, and is shown as "not verified" until a live probe succeeds.
S6. Free-key sources (Adzuna, Jooble, InfoJobs, USAJOBS and similar) are listed with a guide to generating the key. Their keys go to the OS keyring only, never to a file or to chat (AGENTS.md). Adapters for them are a separate unit, after live verification with a real key.
S7. Automatic search is a separate unit (S10), decided with the maintainer before it starts.
S8. Verified tenants from the registry are never removed by the user. The user may disable a source, not edit the verified data.
S9. Config format change is additive: the existing config files keep working without any field.
S10. The "automatic search" mechanism (in-app timer or macOS launch agent) is an open decision for the maintainer. Not implemented in this document's first units.

## Tasks

T1. Config accepts `enabled` (boolean) and `tenants` (list of plain slugs) per source; both optional (S5, S9). Route: inline. Status: pending.
T2. Runner skips disabled sources and appends user tenants after the verified ones, without duplicates (S4, S5, S8). Route: inline. Status: pending.
T3. Sources page in the desktop UI: list every source with a toggle, and a form to add a tenant to a board source (S3, S5). Route: inline. Status: pending.
T4. Guide to generate each free key, shown on the page for key-based sources (S2, S6). Route: inline. Status: pending.
T5. Keyring accounts for free-key sources, written by the app, read by the agent (S6). Needs an AGENTS.md update (the agent reads only typesafe, anthropic, qwen today). Status: pending decision.
T6. Automatic search mechanism (S7, S10). Status: pending decision with the maintainer.

## Log

L1. Original requests, verbatim: see S1, S2, S3.

L2. Exploration before any source write (read-only):
- The desktop app already has a first-run and an edit wizard for the profile (poc/session-poc/ui/src/onboarding/OnboardingWizard.vue), AI provider and judgment settings, key storage through the keyring (`agent_save_key`), and the ZipRecruiter connection, all in the Settings tab (poc/session-poc/ui/src/App.vue, around line 469).
- There is no sources page and no way to disable a source. The source list is hard-coded in the policy and the registry.
- The config file (`~/.config/jobshell/agent.json`) already accepts per-source overrides (`automation`, `pace_ms`, `max_pages`), validated with a strict schema (poc/job-agent/src/config.ts, `sourceOverride`). Unknown fields are refused, so the new fields need to be added to that schema.
- The runner (poc/job-agent/src/run.ts) builds URLs from the verified registry (src/sources/tenants.ts) and does not read any user tenant.

L3. Done on feat/user-source-control:
- T1, T2 (b4fe9fd): config accepts `enabled` and `tenants`; the runner skips a switched-off source before any network call and fetches user employers after the verified ones, once each. 342 tests.
- Source choices command (f5aa966, c4f962f): `source-settings-cli.ts` lists, switches, adds and removes employers. It validates the whole file with the runner's schema before writing, atomically. Tested against a temporary file, the real configuration was not touched. The policy's refusal shows as unreachable, whatever the switch says. 351 tests.
- Desktop commands (116e036): `sources_list`, `source_switch`, `source_employer`. Arguments are checked in Rust before the process starts. clippy -D warnings passes.
- Sources page (UI commit): a section in Settings with a switch per source and an employers list per board source. vue-tsc, 89 UI tests and the production build pass.

Still open:
- T4 guide to free keys: needs the adapter of each free-key source, and a real key to verify it live. Candidates: Adzuna, Jooble, USAJOBS. Not started.
- T5 keyring accounts for those keys: needs an AGENTS.md update, because the agent reads only typesafe, anthropic and qwen today.
- T6 automatic search: the maintainer decides between a timer that runs while the app is open, and a macOS launch agent that runs daily even when the app is closed.
