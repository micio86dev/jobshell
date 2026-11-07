# Phase 0 — Global job discovery feasibility

Experimental proof of concept for a local-first desktop application that searches global job sources, keeps candidate data on the machine, and drives authenticated browser profiles in the background.

Every claim in these documents is backed by an artifact under `evidence/`. Where an experiment could not run, the document says so and names the blocker. Nothing here is inferred from marketing material.

## Read in this order

| # | Document | Answers |
| --- | --- | --- |
| 01 | [ADR 0001 — runtime and stack](01-adr-0001-runtime-and-stack.md) | What we build on, and what measurement rejected |
| 02 | [Browser runtime comparison](02-browser-runtime-comparison.md) | The five candidate runtimes, capability by capability |
| 03 | [Reproducible PoC](03-reproducible-poc.md) | How to re-run everything from a clean checkout |
| 04 | [Browser persistence results](04-browser-persistence-results.md) | The ten-step session protocol, with pass/fail per step |
| 05 | [Resource benchmarks](05-resource-benchmarks.md) | Launch time, RAM and CPU, method and spread |
| 06 | [Cross-platform limits](06-cross-platform-limits.md) | What is verified, and what is only documented |
| 07 | [LinkedIn feasibility](07-linkedin-feasibility.md) | Why candidate-side LinkedIn search is not available |
| 08 | [Indeed feasibility](08-indeed-feasibility.md) | Why Indeed's APIs are employer-side only |
| 09 | [Global source catalogue](09-global-source-catalogue.md) | Six regions, scored, with the registry schema |
| 10 | [Social channel feasibility](10-social-channel-feasibility.md) | Official access mechanism per platform |
| 11 | [API integration matrix](11-api-integration-matrix.md) | What answered without credentials, and what did not |
| 12 | [Security threat model](12-security-threat-model.md) | Assets, threats, mitigations, non-goals |
| 13 | [Licensing review](13-licensing-review.md) | Runtime licences and data-reuse restrictions |
| 14 | [Recommended architecture](14-recommended-architecture.md) | The shape Phase 1 implements |
| 15 | [Phase 1 roadmap](15-phase-1-roadmap.md) | Ordered work, each item with an acceptance test |
| 16 | [PoC testing guide](16-poc-testing-guide.md) | Exact commands, what is testable, and an acceptance checklist |

The claim-to-artifact map is [`../evidence/INDEX.md`](../evidence/INDEX.md).

## What was actually built and run

- A benchmark harness with four adapters (Playwright headless, Playwright headed, Playwright on installed Chrome, agent-browser), an offline fixture site, and process-subtree RAM/CPU sampling.
- A ten-step session protocol across two cookie-lifetime variants, with the browser cookie store never read.
- A Rust core (SQLite via sqlx, keyring secrets, Node sidecar) with a two-process crash-recovery self-test.
- A Tauri 2 desktop shell with a Vue 3 + TypeScript strict frontend, built and bundled as a macOS `.app` and a verified `.dmg`.
- Live read-only probes of six public ATS job feeds with robots.txt enforced before every content request, plus three Chrome connection modes.
- A two-minute soak measurement and a SIGKILL crash-recovery experiment.

## What was deliberately not done

- No LinkedIn or Indeed automation, and no scraping of either platform.
- No cookie or credential extraction from any browser profile.
- No invented API keys: credential-gated sources are recorded as blocked.
- No claim of Windows or Linux support: only macOS arm64 was built here.

## Environment

macOS 26.5.2, Apple M1, 8 cores, 8 GiB RAM. Node 24.18.0, Rust 1.98.1 (pinned by `scripts/cargo.sh`), tauri-cli 2.10.1, Playwright 1.64.1 with Chrome for Testing 156.0.8078.4 and installed Google Chrome 156.0.8078.81.

The system volume has 5.3 GiB free and the project volume 47 GiB, so every build artifact, browser binary and package store lives in `.cache/` (`scripts/env.sh`).
