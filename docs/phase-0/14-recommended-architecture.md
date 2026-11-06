# Recommended implementation architecture

This is the shape Phase 1 implements. Every element below was exercised in Phase 0; nothing is aspirational without being labelled.

## Shape

```
┌──────────────────────────────────────────────────────────────┐
│ Tauri 2 desktop shell (Rust)                                 │
│                                                              │
│  ┌────────────────┐   commands   ┌────────────────────────┐  │
│  │ Vue 3 + TS     │◄────────────►│ core (session-poc-core)│  │
│  │ strict UI      │              │  • task queue          │  │
│  └────────────────┘              │  • source registry     │  │
│                                  │  • scheduler (Tokio)   │  │
│                                  │  • keyring secrets     │  │
│                                  └───────┬────────┬───────┘  │
│                                          │        │          │
│                        SQLite (sqlx, WAL)│        │spawn     │
│                                          ▼        ▼          │
│                              ┌───────────────┐ ┌───────────┐ │
│                              │ spike.sqlite  │ │ Node      │ │
│                              │ tasks/events  │ │ sidecar   │ │
│                              │ sources       │ │ Playwright│ │
│                              └───────────────┘ └─────┬─────┘ │
└──────────────────────────────────────────────────────┼───────┘
                                                       ▼
                                        Chrome for Testing, dedicated
                                        profile per source identity
```

## Components and what proves each one

| Component | Choice | Evidence |
| --- | --- | --- |
| Desktop shell | Tauri 2.12.5 | builds, bundles a 17 MB `.app`, launches at 114 MB RSS (`evidence/summary/bundle.json`, `evidence/summary/desktop-launch.json`) |
| UI | Vue 3 + TypeScript strict, Vite | `vue-tsc --noEmit` and `vite build` clean |
| Core logic | Rust, `session-poc-core` | 5 unit tests over the task queue and recovery |
| Async runtime | Tokio | scheduler and sidecar supervision in the core |
| Persistence | SQLite via sqlx, WAL, migrations | migrations run, recovery audited across process death (`evidence/summary/phase2.json`) |
| Secrets | OS keyring via `keyring` 3 | macOS Keychain round trip ok (`evidence/summary/phase2.json`) |
| Browser driver | Playwright 1.64.1 in a Node sidecar | 308 MB peak, 271 MB idle, 0.3 % CPU, every protocol step (`evidence/summary/bench.json`) |
| Browser binary | Chrome for Testing (shipped) | extensions load only here (`evidence/summary/chrome-connect.json`) |
| Notifications | `tauri-plugin-notification` | wired in the shell, not yet exercised |

## The five decisions that matter

**1. The browser lives in a separate process, always.** A driver crash must not take the app down, and a driver restart must not lose the queue. Measured: the Rust core spawned the sidecar, got JSON back in 6.7 s, and the task row survived a hard process death.

**2. A resident browser supervisor, not launch-per-task.** The session experiment showed that a plain session cookie is discarded when the browser closes (`04-browser-persistence-results.md`). For sites that issue only session cookies, keeping the browser alive is the only way to stay logged in. So the supervisor owns a browser per profile identity, with an idle timeout, and the queue talks to it.

**3. The source registry is data, not code.** Five of the six probed ATS platforms share one shape: an unauthenticated JSON feed per employer (`11-api-integration-matrix.md`). The `sources` table in `migrations/0001_init.sql` models `kind`, `auth_mode`, `reuse_policy` and `evidence_url`; adding a Greenhouse tenant is a row, not a release.

**4. Recovery is explicit and audited.** A task left in `running` becomes `interrupted` with a `task_events` row, then is re-queued. The user can see that the app was closed mid-task. Silent retries would hide a real condition.

**5. Everything untrusted is data.** Job postings, page text and feed payloads are never instructions. There is no AI layer in Phase 1; when one lands it must not be able to call tools from page content (`12-security-threat-model.md`, T4).

## Requirement coverage

| Requirement | Supported? | Basis |
| --- | --- | --- |
| Installable desktop app | macOS yes, others unverified | `.app` bundle and verified DMG built (`evidence/summary/bundle.json`, `evidence/summary/dmg.json`) |
| Windows, macOS, Linux | designed, one platform proven | `06-cross-platform-limits.md` |
| Local profiles, CVs, sessions | yes | SQLite + app data dir + dedicated profile |
| Global job sources | yes for ATS feeds; aggregators need keys | `11-api-integration-matrix.md` |
| Persistent authenticated profiles | conditional | persistent cookie: yes; session cookie: only with a resident browser (`04-browser-persistence-results.md`) |
| Background tasks without the user's browser | yes | sidecar + dedicated profile, no interaction with the user's Chrome |
| Global source registry | yes | `sources` table + `sources.csv` |
| APIs, ATS feeds, approved integrations, authorised browser workflows | yes | matrix + threat model |
| Future application automation | designed for, not built | separate phase, and the sidecar boundary is the seam |

## What is deliberately absent

- **No cloud backend.** Everything is local; there is no account, no sync, no telemetry.
- **No LLM in Phase 1.** Matching is deterministic (filters, keywords, structured fields). An LLM layer arrives with its own containment design.
- **No scraper.** Browser-driven sources are user-authorised sessions, one page at a time.
- **No native messaging host.** The sidecar covers the same need with an auditable boundary.

## Risks carried into Phase 1

| Risk | Why it is real | Mitigation |
| --- | --- | --- |
| Node sidecar as an extra runtime | installer size, update surface | measure Rust-native CDP before Phase 2 ends |
| Session-cookie sites need a resident browser | RAM floor of ~271 MB headless per profile | one browser per identity, aggressive idle timeout |
| Aggregator credentials | product is unusable for wide search without them | ATS-first launch, aggregators as opt-in |
| Code signing and notarisation | an unsigned `.app` is blocked by Gatekeeper on another machine | decide the signing identity before any external distribution; the DMG itself now builds (`scripts/make-dmg.sh`) |
| Per-source terms | a wrong assumption is a legal problem, not a bug | `reuse_policy` gate before persisting anything |
