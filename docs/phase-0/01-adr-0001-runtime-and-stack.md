# ADR 0001 — Browser runtime and application stack

Status: accepted for Phase 1 planning. Date: 2026-11-06. Deciders: Phase 0 experiments.

## Context

The product must run as an installable desktop app on Windows, macOS and Linux, keep candidate profiles, CVs and browser sessions local, search global job sources through APIs, public ATS feeds and authorised browser workflows, and run permitted background tasks without opening the user's ordinary browser.

Phase 0 had to answer two questions with evidence rather than preference:

1. Which browser runtime drives authenticated pages?
2. Does a Tauri 2 + Vue 3 + Rust + SQLite stack actually support persistent profiles, background execution and crash recovery?

## Decision 1 — Browser driver: Playwright, in a Node sidecar process

Playwright 1.64.1 drives Chrome for Testing 156, launched by a Node process that the Rust core spawns and supervises.

Why, from measurement:

| Evidence | Number | Artifact |
| --- | --- | --- |
| Launch, headless, two sessions | 3184 ms cold-cache / 599 ms warm-cache (median of 3 each) | `bench.json`, `bench-run2.json` |
| Launch spread within a session | 872–4203 ms | `bench.json` |
| Idle RSS | 271 MB / 315 MB across two sessions | `bench.json`, `bench-run2.json` |
| Idle CPU | 0.3 % / 1.9 % | `bench.json`, `bench-run2.json` |
| Accessibility-tree snapshot | 22 ms, 1270 chars | `evidence/summary/bench.json` |
| Protocol steps completed | all: login, form, iframe, download, upload, heavy DOM | `evidence/summary/bench.json` |
| Licence | Apache-2.0 | `evidence/summary/runtimes-raw.json` |

It is the only candidate that completed every protocol step with a usable accessibility tree, real download and upload handling, iframe access, and clean teardown.

### Rejected: agent-browser as the driver

Measured, not assumed: 13452 ms median launch, 794 MB idle RSS, 3.8 % idle CPU, 1090 MB peak, 256 ms snapshot (`evidence/summary/bench.json`). Its login sequence costs four separate CLI invocations (128/121/143/201 ms in one run) because every action is a new process talking to a resident daemon.

It is nonetheless the strongest *Rust* candidate and stays in scope as a reference implementation: Apache-2.0, native Rust, CDP over `tokio-tungstenite`, a daemon that keeps the browser alive between commands, and `--profile`/`--cdp`/`--auto-connect` connection modes. It ships as a **binary crate with no library target** (`evidence/summary/runtimes-raw.json`: `cli/Cargo.toml`, no `[lib]`), so embedding it means spawning a CLI, not linking a crate.

### Rejected: Browser Harness

Python, MIT, drives *the user's real Chrome* over CDP after the human ticks remote debugging in `chrome://inspect` (Chrome 144+). That model is the opposite of the isolation this product needs: the whole browser, with every logged-in session, becomes the automation target. Recorded in `docs/phase-0/02-browser-runtime-comparison.md`.

### Rejected: Jev Ultrafast

Python, MIT, and it depends on `browser-harness==0.1.13` plus the TypeSafe model service (`evidence/summary/runtimes-raw.json`). Its value is the model-driven action space, which is a Phase 3 concern, not a browser runtime.

### Rejected: Stagehand

TypeScript and Python SDKs over Playwright, MIT, `node >= 22.18.0` (`evidence/summary/runtimes-raw.json`). Its differentiator (`act`/`extract`/`observe`) requires an LLM provider; the deterministic layer underneath is Playwright, which we already drive directly. Reconsider in Phase 3 as a layer above Playwright, not instead of it.

### Deferred, not rejected: Rust-native CDP (`chromiumoxide` or similar)

Not measured in Phase 0. It removes the Node dependency, which is worth something for installer size and crash surface, but it also means rebuilding the CDP plumbing that agent-browser needed roughly twenty source modules for. The honest position: no measured advantage, so no decision. Revisit only if the sidecar proves operationally fragile in Phase 1.

## Decision 2 — Application stack: Tauri 2 + Vue 3 (TS strict) + Rust/Tokio + SQLite/SQLx + OS keyring

Verified in the spike, not asserted:

| Capability | Result | Artifact |
| --- | --- | --- |
| Tauri 2.12.5 compiles with Rust 1.98.1 | 4 m 18 s cold, then incremental | `docs/phase-0/03-reproducible-poc.md` |
| Release `.app` bundle | 17 MB, correct identifier | `evidence/summary/bundle.json` |
| Desktop shell launches and stays alive | 114 MB RSS after 12 s | `evidence/summary/desktop-launch.json` |
| Vue 3 + TS strict frontend | `vue-tsc --noEmit` and `vite build` clean | `docs/phase-0/03-reproducible-poc.md` |
| SQLite migrations via sqlx | 5 unit tests pass | `poc/session-poc/src-tauri/src/lib.rs` |
| Crash recovery across processes | task recovered, event audited | `evidence/summary/phase1.json`, `evidence/summary/phase2.json` |
| OS keyring round trip | macOS Keychain, ok | `evidence/summary/phase2.json` |
| Rust spawns the browser sidecar | JSON report in 6.7 s | `evidence/summary/phase2.json` |

The `.dmg` step fails in `bundle_dmg.sh` on this host (`evidence/summary/bundle.json`). The `.app` is installable; DMG packaging is an open item, not a claimed capability.

## Decision 3 — The browser binary the product ships

Ship Chrome for Testing, not the user's installed Chrome.

Measured: branded Google Chrome 156 ignores `--load-extension`, so no MV3 extension starts; the bundled Chrome for Testing 156 loads the same unpacked extension and starts its service worker (`evidence/summary/chrome-connect.json`). Any capability that depends on an extension therefore requires a browser the product controls.

Connecting to an installed Chrome remains possible — `channel: "chrome"` rendered correctly in a dedicated profile, and `connectOverCDP` attached to a browser on a `--remote-debugging-port=0` port read from `DevToolsActivePort` — but the DevTools endpoint answered an anonymous HTTP request on loopback and listed targets, which is exactly why it must never be opened on a profile holding real sessions.

## Consequences

Positive: one browser driver with measured behaviour, a process boundary that contains driver crashes, a Rust core whose recovery path is tested across real process death, and a desktop bundle that builds.

Negative, accepted: a Node runtime ships with the app (installer size, one more update surface); session persistence depends on the site issuing a persistent cookie or on keeping the browser resident (see `04-browser-persistence-results.md`); DMG packaging is unresolved.

Follow-up: measure Rust-native CDP before Phase 2 ends, so the Node dependency is a decision rather than an inheritance.
