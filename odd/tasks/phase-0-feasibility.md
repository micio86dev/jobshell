# Phase 0 — Global job discovery technical feasibility

Experimental proof of concept: eliminate architectural uncertainty with reproducible evidence before any product code.
Read this document up to `## Log` before starting any task; every claim in a deliverable must cite an artifact under `evidence/`.

## Specs

S1 — Architecture decision record: a single ADR naming the chosen browser runtime, the chosen integration seam (Node sidecar vs Rust-native CDP), the rejected alternatives, and the measurement that rejected each one.

S2 — Browser runtime comparison: "agent-browser", "Browser Harness", "Jev Ultrafast", "Stagehand", "Playwright" compared on "Rust integration, Installation complexity, Browser startup, Persistent profile support, Authentication persistence, Headless operation, Background operation, Accessibility-tree support, Dynamic page interaction, File download/upload capabilities, Iframe support, Recovery after crashes, RAM and CPU usage, Licensing, Maintenance activity, Cross-platform support", each cell backed by a command output or a `path:line` citation, never by marketing claims.

S3 — Reproducible PoC: a runnable proof of concept, invoked by `make phase0`, that any reviewer can re-run from a clean checkout and obtain the same verdicts.

S4 — Browser persistence results: the ten-step sequence "1. Launch a dedicated Chromium profile. 2. Open a login page. 3. Authenticate manually using a test account on a permitted service. 4. Close the browser. 5. Restart the browser. 6. Verify that the session persists. 7. Execute a permitted background task. 8. Close the application. 9. Restart the application. 10. Verify session and task recovery." with a pass/fail result per step.

S5 — RAM/CPU benchmark: measured resident memory and CPU for each viable runtime, with the sampling method and host state stated, reported as median of repeated runs.

S6 — Cross-platform limitations: Windows, macOS and Linux build and runtime constraints, distinguishing what was verified from what is only documented.

S7 — LinkedIn integration feasibility report, starting from https://business.linkedin.com/hire/ats-partners/partner-application, covering "Official partner programs, Talent Solutions integrations, Candidate-facing APIs, Job search APIs, Partner eligibility, Commercial approval, Available OAuth scopes, Data access and reuse restrictions".

S8 — Indeed integration feasibility report, starting from https://docs.indeed.com/, covering "Official APIs, Candidate-facing integrations, Permitted AI Connectors, Partner programs, Authentication requirements, Regional availability, Commercial restrictions", and explicitly testing the assumption that an employer API provides candidate job-search functionality.

S9 — Global source catalogue for "Europe, North America, Latin America, Asia-Pacific, Middle East, Africa" covering global job boards, national job boards, technology-specific boards, company career pages, ATS platforms, professional communities and social networks, evaluated on "Market relevance, Language, Country coverage, Job volume, API availability, Access permissions, Terms of use, Commercial reuse, Integration complexity".

S10 — Social channel feasibility report for "Facebook groups, Reddit, Telegram, Discord, X, Mastodon and GitHub", stating each platform's official access mechanism and never assuming that public visibility means unrestricted automated collection.

S11 — API integration matrix for "InfoJobs Developer API, Adzuna API, Greenhouse Job Board API, Lever Postings API, Ashby Job Postings API, SmartRecruiters, Workable, Recruitee, SEEK API, Jooble API", identifying which sources can be used immediately and which require approval or credentials.

S12 — Security threat model covering dedicated browser profiles, Chrome extensions, native messaging, CDP, remote debugging, stored credentials and CV data.

S13 — Licensing review of every runtime, browser binary and data source, including commercial reuse restrictions.

S14 — Recommended implementation architecture covering "Tauri 2, Vue 3, TypeScript strict, Rust, Tokio, SQLite, SQLx, Secure operating-system credential storage" and its support for "Global source registry, Multilingual search, Multiple professional categories, Persistent local browser profiles, Background execution, Scheduling, Notifications, AI-assisted matching".

S15 — Exact implementation roadmap for Phase 1, containing only capabilities demonstrated in Phase 0, each with an acceptance test.

S16 — Completion criterion: "Do not declare an integration available without evidence."

S17 — Completion criterion: "Do not claim a browser session persists unless tested."

S18 — Completion criterion: "Do not claim cross-platform support without verifying the relevant build constraints."

S19 — Completion criterion: "Do not hide blockers."

S20 — Constraint: "Do not copy cookies or extract browser credentials." and "Do not use LinkedIn or Indeed for unauthorised automation experiments." and "Never invent API keys."

## Tasks

| ID | Spec | Route | Commit |
| --- | --- | --- | --- |
| T1 | S3 | inline: scaffold, tracking, artifact placement | 139278e, d22df3f |
| T2 | S2, S13 | inline: runtime evidence collection | b9bc9d5 |
| T3 | S2, S5 | inline: benchmark harness + baseline | 5f6f9e1 |
| T4 | S2, S5, S3 | inline: competitor measurement | 5f6f9e1 |
| T5 | S4, S17 | inline: persistent session + restart recovery | 5f6f9e1, 02e3f9e |
| T6 | S12 | inline: Chrome connection modes and their security implications | d5888d0 |
| T7 | S11, S16 | inline: API probes batch A | b9bc9d5, d5888d0 |
| T8 | S11, S19 | inline: API probes batch B (credential-gated) | blocked: docs/phase-0/11 |
| T9 | S7 | inline: LinkedIn research | docs commit |
| T10 | S8 | inline: Indeed research | docs commit |
| T11 | S9 | inline: global source catalogue + registry schema | docs commit |
| T12 | S10 | inline: social channel feasibility | docs commit |
| T13 | S14 | inline: architecture spike | 02e3f9e, d5888d0 |
| T14 | S6, S18 | inline: cross-platform constraints | docs commit |
| T15 | S12, S13, S1, S14, S15 | inline: threat model, licensing, ADR, roadmap | docs commit |
| T16 | S16-S20 | inline: evidence index and clean re-run | docs commit |
| T17 | S16, S19 | inline: static UI wiring check and shared completion path | 7e70dbe, bbf36e9 |

## Log

L1 — Original request, verbatim:

> # PHASE 0 — GLOBAL JOB DISCOVERY TECHNICAL FEASIBILITY
>
> You are acting as a principal software architect, browser automation specialist, Rust engineer, security engineer and API integration researcher.
>
> Your task is to validate the technical feasibility of a local-first desktop application for global AI-assisted job discovery.
>
> This phase is an experimental proof of concept.
>
> Do not build the complete application yet.
>
> Do not stop at theoretical research. Perform reproducible technical experiments wherever access and permissions allow.
>
> ## 1. Product requirements
>
> The eventual product must:
>
> - Run as an installable desktop application.
> - Support Windows, macOS and Linux.
> - Keep candidate profiles, CVs and browser sessions locally.
> - Search global job sources.
> - Support persistent authenticated browser profiles.
> - Run permitted background tasks without requiring the user to open their ordinary browser.
> - Provide a global source registry.
> - Support APIs, public ATS feeds, approved integrations and authorised browser workflows.
> - Support future application automation as a separate phase.
>
> ## 2. Browser runtime experiment
>
> Evaluate:
>
> - agent-browser: https://github.com/vercel-labs/agent-browser
> - Browser Harness: https://github.com/browser-use/browser-harness
> - Jev Ultrafast: https://github.com/browser-use/jev-ultrafast
> - Stagehand: https://github.com/browserbase/stagehand
> - Playwright: https://playwright.dev/
>
> Compare:
>
> - Rust integration.
> - Installation complexity.
> - Browser startup.
> - Persistent profile support.
> - Authentication persistence.
> - Headless operation.
> - Background operation.
> - Accessibility-tree support.
> - Dynamic page interaction.
> - File download/upload capabilities.
> - Iframe support.
> - Recovery after crashes.
> - RAM and CPU usage.
> - Licensing.
> - Maintenance activity.
> - Cross-platform support.
>
> Do not select a runtime based on marketing claims.
>
> Use reproducible tests.
>
> ## 3. Browser session experiment
>
> Build a minimal desktop/browser PoC.
>
> Test:
>
> 1. Launch a dedicated Chromium profile.
> 2. Open a login page.
> 3. Authenticate manually using a test account on a permitted service.
> 4. Close the browser.
> 5. Restart the browser.
> 6. Verify that the session persists.
> 7. Execute a permitted background task.
> 8. Close the application.
> 9. Restart the application.
> 10. Verify session and task recovery.
>
> Investigate optional connection to an existing Chrome installation.
>
> Determine the exact requirements and security implications of:
>
> - Chrome extensions.
> - Native messaging.
> - Chrome DevTools Protocol.
> - Remote debugging.
> - Dedicated browser profiles.
>
> Do not copy cookies or extract browser credentials.
>
> Do not use LinkedIn or Indeed for unauthorised automation experiments.
>
> ## 4. LinkedIn and Indeed feasibility
>
> These are strategic integrations and cannot be silently excluded.
>
> Research:
>
> ### LinkedIn
>
> - Official partner programs.
> - Talent Solutions integrations.
> - Candidate-facing APIs.
> - Job search APIs.
> - Partner eligibility.
> - Commercial approval.
> - Available OAuth scopes.
> - Data access and reuse restrictions.
>
> Official starting point:
> https://business.linkedin.com/hire/ats-partners/partner-application
>
> ### Indeed
>
> - Official APIs.
> - Candidate-facing integrations.
> - Permitted AI Connectors.
> - Partner programs.
> - Authentication requirements.
> - Regional availability.
> - Commercial restrictions.
>
> Official documentation:
> https://docs.indeed.com/
>
> Do not assume an employer API provides candidate job-search functionality.
>
> Do not bypass platform restrictions.
>
> Produce an integration feasibility matrix.
>
> Clearly distinguish:
> - Technically possible.
> - Officially documented.
> - Requires approval.
> - Requires commercial agreement.
> - Not currently available.
>
> ## 5. Global source research
>
> Research the most important sources for technology jobs in:
>
> - Europe.
> - North America.
> - Latin America.
> - Asia-Pacific.
> - Middle East.
> - Africa.
>
> Include:
>
> - Global job boards.
> - National job boards.
> - Technology-specific job boards.
> - Company career pages.
> - ATS platforms.
> - Professional communities.
> - Social networks.
>
> Evaluate:
> - Market relevance.
> - Language.
> - Country coverage.
> - Job volume.
> - API availability.
> - Access permissions.
> - Terms of use.
> - Commercial reuse.
> - Integration complexity.
>
> Include Facebook groups, Reddit, Telegram, Discord, X, Mastodon and GitHub as potential discovery channels.
>
> Investigate each platform's official access mechanisms.
>
> Do not assume that public visibility means unrestricted automated collection.
>
> ## 6. API experiments
>
> Investigate and, where possible, test:
>
> - InfoJobs Developer API.
> - Adzuna API.
> - Greenhouse Job Board API.
> - Lever Postings API.
> - Ashby Job Postings API.
> - SmartRecruiters.
> - Workable.
> - Recruitee.
> - SEEK API.
> - Jooble API.
>
> Identify which sources can be used immediately and which require approval or credentials.
>
> Never invent API keys.
>
> ## 7. Architecture experiment
>
> Evaluate:
>
> - Tauri 2.
> - Vue 3.
> - TypeScript strict.
> - Rust.
> - Tokio.
> - SQLite.
> - SQLx.
> - Secure operating-system credential storage.
>
> Assess whether the architecture can support:
>
> - Global source registry.
> - Multilingual search.
> - Multiple professional categories.
> - Persistent local browser profiles.
> - Background execution.
> - Scheduling.
> - Notifications.
> - AI-assisted matching.
>
> ## 8. Deliverables
>
> Produce:
>
> 1. Architecture decision record.
> 2. Browser runtime comparison.
> 3. Reproducible PoC.
> 4. Browser persistence results.
> 5. RAM/CPU benchmark.
> 6. Cross-platform limitations.
> 7. LinkedIn integration feasibility report.
> 8. Indeed integration feasibility report.
> 9. Global source catalogue.
> 10. Social channel feasibility report.
> 11. API integration matrix.
> 12. Security threat model.
> 13. Licensing review.
> 14. Recommended implementation architecture.
> 15. Exact implementation roadmap for Phase 1.
>
> ## 9. Completion criteria
>
> Do not declare an integration available without evidence.
>
> Do not claim a browser session persists unless tested.
>
> Do not claim cross-platform support without verifying the relevant build constraints.
>
> Do not hide blockers.
>
> The purpose of this phase is to eliminate architectural uncertainty before implementing the complete desktop application.
>
> Start immediately and complete the experiments.

L2 — Execution mode note: the plan was produced in plan mode (read-only), so no experiment ran before build mode. Environment probe findings (macOS arm64, Xcode CLT present, Node 24.18.0, cargo 1.89.0 + tauri-cli 2.10.1, Playwright browsers already cached, Google Chrome installed, system volume 5.3 GiB free vs project volume 47 GiB free) are recorded in `evidence/run/<ts>/env.json` and constrain artifact placement to `.cache/` on the project volume.

L3 — Findings that changed the architecture, each backed by `evidence/summary/`:

- A persistent cookie survives a browser restart; a plain session cookie does not. "Persistent authenticated profile" therefore requires a resident browser supervisor for sites that issue session cookies.
- Branded Google Chrome 156 ignores `--load-extension`; the bundled Chrome for Testing 156 loads the same MV3 extension. The product must ship its own browser if it needs extensions.
- A CDP endpoint on loopback is unauthenticated and lists every target to any local process.
- Playwright headless costs 308 MB peak and 0.3 % idle CPU; agent-browser costs 1090 MB peak and 3.8 % idle CPU on the same protocol.
- Five of six ATS job-board APIs answer without credentials; Workable answers 200 with an empty array; SmartRecruiters needs a verified tenant id.

L4 — Blockers recorded, not hidden: LinkedIn and Indeed have no candidate-side job-search API; Adzuna, Jooble, InfoJobs and SEEK need credentials the maintainer has not supplied; Windows and Linux were not built; the `.dmg` bundle step fails; native messaging and real-service session persistence were deliberately not executed.

L5 — Environment incident during closure: `diskutil verifyVolume` on the project volume failed ("sm_free_count is not valid", space verification failed, exit 8) and one `node_modules` file (`@types/node/util/types.d.ts`) was found NUL-filled, which broke `tsc` with bogus TS1127 errors. All 339 tracked and untracked text files were scanned for NUL bytes: none affected, and `git fsck` is clean. Dependencies are reproducible, so the repair was a reinstall. The heavy benchmark re-run was deferred until the volume is checked by the maintainer; every other experiment was re-run and re-verified afterwards.

L6 — T17, from a defect the testing guide itself recorded: it said "The UI wiring is not verified", and `finish_task` bypassed the core with its own `UPDATE`. Both are now measured claims. `finish_task` calls `complete_task`, which reuses `transition`, writes the `task_events` row, and refuses to rewrite an already-done task; `transition` takes `counts_as_attempt` because finishing is the outcome of an attempt. `scripts/check-tauri-wiring.sh` (`make wiring`, part of `make test`) fails when the UI calls a name `generate_handler!` does not register. Observed: `make test` exit 0 with 65 TS tests, 7 Rust tests (1 ignored, keyring), five typechecks and the wiring check; `clippy -D warnings` clean on `session-poc-core`; the wiring check itself measured at 1.58 s. The UI click path remains unverified and stays in the guide's incomplete table.

L7 — Blocker recorded for T17, not hidden (S19): the native review of candidate `sha256:8fed41a3…c711` (lineage `review-9f033231beade43f`, tier high, lenses readability + reliability) could not run. `gentle_review_capture_group` failed at the Pi host relay with `no model is configured for review-readability; assign it a model in the agent model routing config`; the same holds for `review-reliability`. Nothing was submitted and no reviewer ran. The candidate was committed as `7e70dbe` anyway, because delivery policy is the maintainer's and the commit was already authorized; the review can be started again over the committed range once a model is routed to those lens configs.

L8 — The blocker in L7 was a missing routing entry, not a missing capability. The Pi host relay reads `~/.pi/gentle-ai/models.json`, keyed by routing key (`review-<lens>`, `review-refuter`, `review-validator`); `~/.pi/agent/subagents.json` carries a different, unrelated `model_profiles` shape and does not feed the relay. The maintainer authorized the model choice, so every review role was routed to the model the other gentle-ai agents already use (`opencode-go/deepseek-v4.1-flash`) and the review was re-run over the committed range (`baseRef` `e978c36`, committed-only) as lineage `review-f7b314d0a7c73485` (7 files, 177 lines, tier high).

The review paid for itself: two candidate-caused CRITICAL findings, both mine, both accepted.

- R2-001 (readability, inferential): `complete_task`'s “already done” guard was a read-check-write across two `await`s, so two concurrent `finish_task` callers could both pass it and both write a done event. Fixed by putting the observed state in the `UPDATE`'s `WHERE` clause (compare-and-swap) and returning whether it applied.
- R3-001 (reliability, deterministic): that guard also broke `finish_task` idempotency — a repeated finish became a visible error where the baseline returned `Ok`, a contract change the request never asked for. Fixed by returning `Ok` without writing when the task is already done or another caller won the race.

The correction stayed inside the frozen budget (73 diff lines planned at 85, budget 89) and touched only `lib.rs`. The targeted validator approved it, the acknowledgement burned the authority, and the correction is `bbf36e9`. Tests went from 7 to 8 Rust tests: the stale-state transition is not applied, and a repeated completion rewrites nothing and records exactly one done event.

R3-002 (WARNING, informational, `poc/session-poc/src-tauri/src/lib.rs:199-203`) came back from the same ledger as a non-blocking advisory with no claim text attached. It is recorded here as an open follow-up on that region, not interpreted, and it must not reopen this candidate's review.

L9 — Two closing steps, both after the review was burned. First, the orphaned lineage `review-9f033231beade43f` (the L7 attempt, whose workspace target stopped existing once the work was committed) was abandoned on the maintainer's explicit instruction: `operator_disposition`, result `review-reclaim-record/v1` committed, source quarantined under `.git/gentle-ai/review-transactions/quarantine/review-9f033231beade43f-2773019636`, residue `review-state.json`, and `discarded_work` empty — no lens result and no finding was lost. A following inspect reports 0 lineages, 0 events, 0 candidates. All six review roles (`review-risk`, `review-resilience`, `review-readability`, `review-reliability`, `review-refuter`, `review-validator`) are now routed in `~/.pi/gentle-ai/models.json`, so no lens can hit the L7 wall again.

Second, R3-002 was inspected in place. The region is the `complete_task` guard body, and the advisory ledger supplied no claim, so there is nothing evidence-backed left to change: the two findings it would otherwise restate (non-atomicity, idempotency) are the corrected ones. Recorded as a known follow-up with no action; a future review of that region is where it can be re-raised with an actual claim.

Still open by design, not by omission: no git remote exists, so push, PR and merge are not executable here; Windows and Linux were never built; and the UI click path is statically checked only.
