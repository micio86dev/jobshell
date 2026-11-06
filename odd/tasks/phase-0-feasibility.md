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
| T1 | S3 | inline: scaffold, tracking, artifact placement | pending |
| T2 | S2, S13 | inline: runtime evidence collection | pending |
| T3 | S2, S5 | inline: benchmark harness + baseline | pending |
| T4 | S2, S5, S3 | inline: competitor measurement | pending |
| T5 | S4, S17 | inline: persistent session + restart recovery | pending |
| T6 | S12 | inline: Chrome connection modes and their security implications | pending |
| T7 | S11, S16 | inline: API probes batch A | pending |
| T8 | S11, S19 | inline: API probes batch B (credential-gated) | pending |
| T9 | S7 | inline: LinkedIn research | pending |
| T10 | S8 | inline: Indeed research | pending |
| T11 | S9 | inline: global source catalogue + registry schema | pending |
| T12 | S10 | inline: social channel feasibility | pending |
| T13 | S14 | inline: architecture spike | pending |
| T14 | S6, S18 | inline: cross-platform constraints | pending |
| T15 | S12, S13, S1, S14, S15 | inline: threat model, licensing, ADR, roadmap | pending |
| T16 | S16-S20 | inline: evidence index and clean re-run | pending |

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
