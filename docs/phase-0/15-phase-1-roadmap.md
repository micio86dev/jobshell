# Phase 1 roadmap

Only capabilities demonstrated in Phase 0 appear here. Each milestone has an acceptance test that a reviewer can run, and each names the Phase 0 evidence it builds on.

Ordering rule: nothing that needs a credential starts before the ATS path works end to end, because the ATS path is the only one proven to be free of approval gates.

## M0 — Repository and CI baseline (1 week)

Ship the PoC as the project skeleton.

- Move `poc/session-poc/src-tauri` to `apps/desktop/src-tauri`, `poc/session-poc/app` to `apps/desktop/shell`, `poc/session-poc/ui` to `apps/desktop/ui`.
- Keep `scripts/env.sh` and `scripts/cargo.sh`; add `Makefile` targets `test`, `bench`, `probe`, `phase0`.
- Add `.github/workflows/ci.yml` with `macos-latest`, `windows-latest`, `ubuntu-latest`: `cargo test`, `tsc --noEmit`, `node --test`.

**Acceptance:** CI is green on all three platforms, and the Rust tests run on Windows and Linux for the first time. Until this is green, no cross-platform claim is made (`06-cross-platform-limits.md`).

## M1 — Source registry and ATS ingestion (2 weeks)

Turn `sources.csv` into the runtime registry and ingest five ATS platforms.

- Load `sources.csv` into the `sources` table on first run; validate `kind` and `auth_mode`.
- One `ats_feed` adapter with a per-platform payload mapper (Greenhouse, Lever, Ashby, SmartRecruiters, Recruitee).
- Tenant registry: verified ids only. `DeliveryHero` returned 902 postings while `Ubisoft` returned 0 — a guessed id must fail loudly, not silently return nothing.
- Persist only when `reuse_policy` is not `unknown`; otherwise show transiently with a link-out.
- Enforce a per-source rate limit and honour `robots.txt` `Disallow` for browser sources.

**Acceptance:** with a fixture tenant list of 5 employers across 5 platforms, one run stores ≥ 100 postings, every row carries `source_id`, `evidence_url` and `fetched_at`; a run against a source with `reuse_policy = unknown` stores zero rows; a bad tenant id produces a recorded error, not an empty success.

## M2 — Browser supervisor and session persistence (3 weeks)

The part Phase 0 proved is conditional.

- A supervisor owning one Chrome for Testing process per profile identity, with an idle timeout and a restart policy.
- Explicit session state per source: `authenticated`, `expired`, `never_authenticated`, derived behaviourally (never by reading the cookie store).
- Keep the browser resident for sources that issue session cookies; allow full teardown for sources with persistent cookies.
- A first-run flow that opens a headed window for the user to sign in, then hands the profile to the headless supervisor.

**Acceptance:** the ten-step protocol from `04-browser-persistence-results.md` passes against a real permitted service, in both cookie-lifetime variants, with the browser killed by `SIGKILL` between steps 6 and 7. The supervisor restarts it and the task completes.

## M3 — Task queue, scheduling and notifications (2 weeks)

- Tokio scheduler with cron-like intervals per source; queue persisted in SQLite.
- Recovery of `running` tasks to `interrupted` on startup, surfaced in the UI.
- Notification when a run completes or a task needs the user (expired session).
- A per-source failure budget with backoff; no silent retry loops.

**Acceptance:** kill the app mid-run three times in a row; each restart recovers, re-queues, and completes; the UI shows three `interrupted` events; a source that returns 500 five times is backed off and reported, not retried forever.

## M4 — Search, filtering and matching (2 weeks)

- Multilingual normalisation (locale-aware lowercasing, accent folding) for the languages in `sources.csv`.
- Deterministic matching against a candidate profile: role, seniority, location/remote, language, stack keywords.
- Ranking that explains itself: every result shows why it matched.

**Acceptance:** a fixture corpus of 200 postings in 5 languages produces stable, explainable rankings; changing one profile field changes exactly the expected results; a posting with no language metadata does not silently rank last.

## M5 — Local data lifecycle (1 week)

- Export everything (SQLite + profiles) to a single archive; delete everything on request.
- Filesystem permissions on the profile directory; decide on at-rest encryption for CVs.
- A logging layer with redaction, since Phase 0 has none.

**Acceptance:** export → wipe → import restores identical state; no credential appears in any log line; the profile directory is not world-readable.

## M6 — Packaging and distribution (2 weeks)

- Fix the `.dmg` failure (`evidence/summary/bundle.json`) or ship a signed `.app` zip.
- Bundle Chrome for Testing with its licence tree, or implement first-run download with a clear offline error.
- Third-party notices covering Playwright (Apache-2.0 + NOTICE), Chromium, Node and the Rust/Vue tree.
- Windows and Linux installers, once M0 is green.

**Acceptance:** a clean machine installs, launches, completes one ATS sync offline for cached tenants, and shows the notices; the installed app contains no credential and no telemetry endpoint.

## M7 — Opt-in aggregators (1 week, needs credentials)

- Adzuna and Jooble behind the `api_key` auth mode, keys in the keyring, per-source quota.
- InfoJobs and SEEK stay `requires credentials` / `requires approval` until the maintainer obtains access (`11-api-integration-matrix.md`).

**Acceptance:** with keys present, one query returns results from both aggregators; with keys absent, the sources are visibly disabled with the reason, not silently skipped.

## Explicitly out of Phase 1

- LinkedIn and Indeed integration of any kind (`07`, `08`).
- Application automation. It is a separate phase, and the sidecar boundary is where it attaches.
- Any LLM-driven matching or agentic browsing. When it lands it needs the prompt-injection containment design from `12-security-threat-model.md` T4.
- Discord, Telegram and Facebook groups (`10-social-channel-feasibility.md`).

## What could invalidate this plan

| Assumption | If wrong |
| --- | --- |
| A resident browser per profile is affordable | at 271 MB idle per profile, five profiles is 1.4 GB; the plan needs a strict single-active-profile policy |
| ATS feeds stay unauthenticated | if Greenhouse or Lever gated their boards, M1 loses five sources at once |
| Node sidecar stays maintainable | otherwise M0 grows a Rust-native CDP spike, and M2 slips |
| Per-source terms allow local caching | otherwise the product becomes a live proxy with no offline value |

## Effort summary

14 weeks for one engineer at the stated scope, with M7 gated on credentials the maintainer must obtain. M0 and M1 are the only milestones that can start immediately without a decision from the maintainer.
