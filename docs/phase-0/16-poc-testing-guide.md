# PoC testing guide

Operational guide for exercising the Phase 0 proof of concept on this machine. Every command below was run here; every expected output was observed. Where something cannot be tested without an input the maintainer must supply, the guide says so instead of offering a command that would fail.

## 0. What this PoC is, and what it is not

**It is** an experimental harness that answers five questions with measurements:

1. Which browser runtime is cheapest and most capable for authenticated job pages.
2. Whether a dedicated Chromium profile keeps a login across a browser restart.
3. Whether a desktop app survives a crash mid-task and recovers its queue.
4. Whether the Tauri 2 + Rust + SQLite + keyring stack actually builds, runs and stores secrets.
5. Which job sources answer without credentials, and which forbid automated access.

**It is not a job search application.** There is no ingestion pipeline, no posting storage, no search screen and no matching engine. The SQLite `sources` table exists and is **empty**; nothing writes postings anywhere. If you expect to type "Rust developer" and get results, this PoC will disappoint you — that is Phase 1 (`15-phase-1-roadmap.md`).

Read the rest of this guide with that framing: you are testing infrastructure, not a product.

## 1. Components actually implemented

| Component | Path | State |
| --- | --- | --- |
| Benchmark harness, 4 adapters, offline fixture site | `poc/runtime-bench/src/` | works, 3 runs per adapter |
| Robots.txt parser + RFC 9309 policy | `poc/runtime-bench/src/lib/robots.ts` | works, 22 tests |
| Process-subtree RAM/CPU sampler | `poc/runtime-bench/src/lib/{procs,sampler}.ts` | works, measured against real browsers |
| Session persistence experiment (steps 1–6) | `poc/session-poc/persistence.ts` | works, 2 variants |
| Crash recovery experiment (SIGKILL) | `poc/session-poc/crash-recovery.ts` | works |
| Soak measurement (2 min idle) | `poc/session-poc/soak.ts` | works |
| Rust core: task queue, recovery, keyring, sidecar spawn | `poc/session-poc/src-tauri/src/lib.rs` | works, 8 tests |
| Node browser sidecar | `poc/session-poc/sidecar/browser-agent.mjs` | works, driven by Rust |
| Tauri 2 desktop shell + Vue 3 UI | `poc/session-poc/app/`, `poc/session-poc/ui/` | builds, launches, 6 commands, 5 wired |
| Chrome connection modes (CDP, extensions) | `poc/chrome-connect/connect.ts` | works, 4 modes |
| Public ATS API probe with robots enforcement | `poc/api-probe/probe.ts` | works, 6 sources |
| macOS `.app` + `.dmg` packaging | `make desktop`, `make dmg` | works |
| CI matrix | `.github/workflows/ci.yml` | **never executed** — no git remote |

## 2. Install and run

### 2.1 Prerequisites

Already present on this machine: Node 24.18.0, pnpm 11.22, Rust toolchain 1.98.1 (via `scripts/cargo.sh`), tauri-cli 2.10.1, Xcode Command Line Tools, Google Chrome, and a seeded Playwright browser cache (`chromium-1248`, Chrome for Testing 156.0.8078.4).

### 2.2 Environment (required)

Every target depends on `scripts/env.sh`, which redirects build artifacts to the project volume. Without it, builds fill a 5.3 GiB system disk.

```bash
cd "<repo>"
set -a; . ./scripts/env.sh; set +a
```

`make` targets source it themselves; you need it only for direct `node`/`cargo` invocations.

### 2.3 Install dependencies

```bash
# benchmark harness (also provides the shared libs the other PoCs import)
cd poc/runtime-bench && pnpm install --frozen-lockfile && cd ../..

# session PoC (Playwright) and its UI
cd poc/session-poc && pnpm install --frozen-lockfile && cd ../..
cd poc/session-poc/ui && pnpm install --frozen-lockfile && cd ../../..

# API probe, Chrome-connect probe, agent-browser probe
cd poc/api-probe && pnpm install --frozen-lockfile && cd ../..
cd poc/chrome-connect && pnpm install --frozen-lockfile && cd ../..
cd poc/agent-browser-probe && pnpm install && cd ../..
```

Notes, all observed:
- The UI must be installed with **pnpm**, not npm. `npm install` fails here twice over: an `ERESOLVE` on a peer conflict inside the `vue-tsc` tree, and then an npm-internal `Cannot read properties of null (reading 'matches')` even with `--legacy-peer-deps`. pnpm resolves the same tree without complaint. The UI carries a `pnpm-workspace.yaml` whose only job is `allowBuilds: esbuild: true` — without it pnpm skips esbuild's postinstall and `vite build` fails.
- `poc/agent-browser-probe` ships prebuilt binaries inside the npm package; pnpm skips the postinstall, so the binary can arrive without its executable bit. The adapter fixes this itself at startup (`chmod 755` when `X_OK` is missing).

### 2.4 The full run

```bash
make phase0          # ~8 minutes: test, bench, probe, persistence, crash, soak, chrome, spike, desktop
make dmg             # optional: ~1 minute, needs the release build from `make desktop`
```

Both write into **one** directory: `evidence/run/<UTC timestamp>/`. Override with `OUT=/some/dir make phase0`.

Observed result of `make phase0`: exit code 0, seven subdirectories (`api`, `bench`, `chrome`, `crash`, `persistence`, `soak`, `spike`) plus the desktop build, and the line `Phase 0 evidence written to …`.

### 2.5 Individual targets

| Command | Duration | What it produces |
| --- | --- | --- |
| `make test` | ~1 min | 65 TS tests, 8 Rust tests, 5 typechecks, the wiring check |
| `make wiring` | ~2 s | fails if the UI calls a command `generate_handler!` does not register |
| `make bench` | ~5 min | `bench/bench.json` |
| `make probe` | ~1 min | `api/api-probes.json` |
| `make persistence` | ~1 min | `persistence/persistence.json` |
| `make crash` | ~30 s | `crash/crash-recovery.json` |
| `make soak` | ~2.5 min | `soak/soak.json` |
| `make chrome` | ~1.5 min | `chrome/chrome-connect.json` |
| `make spike` | ~1 min | `spike/phase1.json`, `spike/phase2.json` |
| `make desktop` | ~2 min warm | `.app` bundle in `$CARGO_TARGET_DIR/release/bundle/macos/` |
| `make dmg` | ~1 min | verified `.dmg` in `$(OUT)` |
| `make clean` | not measured | deletes build outputs only: `$CARGO_TARGET_DIR` and the UI `dist/` |
| `make clean-deps` | not measured | deletes `node_modules` only; restores from the lockfiles |

Both `clean` targets are destructive by design and were added without a timed run, so no duration is claimed for them. `clean` never touches `evidence/`: measured run directories and the committed summaries survive it on purpose.

Options are not passed through `make`. For a single adapter or a shorter run, call the harness directly:

```bash
cd poc/runtime-bench && set -a; . ../../scripts/env.sh; set +a
node src/harness.ts --runs 1 --idle-ms 3000 --only playwright-headless --out /tmp/bench-one
```

`--only` accepts `playwright-headless`, `playwright-headed`, `playwright-chrome-headed`, `agent-browser-headed`.

## 3. Environment variables and API keys

**There is no `.env` file and no dotenv loader anywhere in this repository.** No API key is read by any code path. The matrix in `11-api-integration-matrix.md` marks Adzuna, Jooble, InfoJobs and SEEK as `requires credentials` precisely because no client for them was written.

Only three environment variables exist:

| Variable | Read by | Effect when unset |
| --- | --- | --- |
| `OPENJOB_REAL_LOGIN_URL` | `poc/session-poc/persistence.ts` | the real-service login variant is skipped and recorded as skipped |
| `OPENJOB_REAL_LOGGED_IN_SELECTOR` | same | same; both are required together |
| `OPENJOB_AGENT_BROWSER_BIN` | `poc/runtime-bench/src/adapters/agent-browser.ts` | defaults to the binary inside `poc/agent-browser-probe` |

If you later want to exercise an aggregator, you would first have to write the client: nothing exists to consume an Adzuna `app_id`, a Jooble key, an InfoJobs OAuth pair or a SEEK approval. Inventing a key would change nothing.

## 4. Manual login and session persistence

Two paths exist, and only the first runs without your input.

### 4.1 Deterministic (no account, no third party)

```bash
make persistence
```

A local fixture site on `127.0.0.1` presents a login form. The script signs in, closes the browser, relaunches the same profile, and checks whether the authenticated page still renders. It runs twice:

- **persistent-cookie variant** (`Max-Age` set): step 6 **PASS** — the session survives.
- **session-cookie variant** (no expiry): step 6 **FAIL** — the browser discards it on close.

Exit code 0 means *every observation matched the expectation stated before the run*, including that expected failure. Read `persistence/persistence.json` and look at `deterministic_variants[].matches_expectation`.

The script never reads the browser cookie store: session presence is judged by the rendered page and the server-side `/session` probe.

### 4.2 Real service (needs your account)

```bash
cd poc/session-poc && set -a; . ../../scripts/env.sh; set +a
OPENJOB_REAL_LOGIN_URL="https://example-service.test/login" \
OPENJOB_REAL_LOGGED_IN_SELECTOR="#account-menu" \
node persistence.ts /tmp/persistence-real
```

A **headed** browser opens on a fresh profile under `/tmp/persistence-real/profile-real`. You sign in by hand. The script waits up to 5 minutes for your selector, closes the browser, relaunches it headless, navigates back to the same URL, and checks whether the selector appears within 30 s. The profile is deleted in a `finally` block — it holds live session material.

This path has **never been executed here**: no account was available. Treat its result as unverified until you run it.

Use a service that permits a human logging in with a browser and does not forbid automation. Do not point it at LinkedIn or Indeed.

### 4.3 Manual inspection of a dedicated profile

The desktop app has **no login UI**. To look at a profile by hand, use Playwright's own launcher or Chrome directly — both against a profile directory inside the project, never your everyday Chrome profile:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --user-data-dir="$PWD/.cache/manual-profile" \
  --no-first-run --no-default-browser-check \
  about:blank
```

Close it, reopen with the same `--user-data-dir`, and the profile is back. That is the mechanism the product depends on; `04-browser-persistence-results.md` records what it does and does not preserve.

## 5. Portals you can test, and what is allowed

Only **public ATS job-board feeds** are exercised. `make probe` performs read-only GETs with a self-identifying user agent, 1200 ms between requests, a 20 s timeout, and `robots.txt` fetched and applied *before* any content request.

| Source | Endpoint shape | Observed | Allowed? |
| --- | --- | --- | --- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{tenant}/jobs?content=true` | 200 with postings | yes, public feed |
| Lever | `api.lever.co/v0/postings/{tenant}?mode=json` | 200 with postings | yes, public feed |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{tenant}` | 200 with postings | yes, public feed |
| Recruitee | `{tenant}.recruitee.com/api/offers/` | 200 with offers | yes, public feed |
| Workable | `apply.workable.com/api/v1/widget/accounts/{tenant}?details=true` | 200, empty `jobs` | endpoint reachable, real data needs credentials |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{tenant}/postings` | 200, but `robots.txt` is `Disallow: /` | **no** — skipped and recorded in `skipped_by_robots` |

Permitted operations: reading those feeds, counting and inspecting the payloads, recording status and `robots.txt` outcome. Nothing is written to any third-party service, and no credential is sent.

Explicitly **not** permitted and not implemented: automating LinkedIn or Indeed, scraping any board whose terms forbid it, copying cookies out of a profile, or bulk redistributing posting text.

## 6. How to verify results, and where they are saved

Everything lands in `evidence/run/<timestamp>/`. The committed copies the documents cite live in `evidence/summary/`.

| Question | File | What to look at |
| --- | --- | --- |
| Which runtime won on speed and memory? | `bench/bench.json` | `aggregate[]`: `launch_ms`, `idle_mean_rss_mb`, `idle_mean_cpu_pct`, `peak_rss_mb`, each with `.median` and `.n` |
| Does a login survive a restart? | `persistence/persistence.json` | `deterministic_variants[].observed_persist`, `.matches_expectation` |
| Does the app recover a task after a crash? | `spike/phase1.json`, `spike/phase2.json` | `state: "running"` then `recovered_task_ids`, `recovered_task_state` |
| Does the keyring work? | `spike/phase2.json` | `keyring.ok` |
| Does Rust really drive the browser? | `spike/phase2.json` | `sidecar.ok`, `sidecar.reported_ms` |
| Which sources answered? | `api/api-probes.json` | `results[].attempts[]`, `usable_without_credentials`, `skipped_by_robots` |
| Was robots.txt respected? | same | `results[].robots[]`: `status`, `origin_allowed`, `policy_reason`, `disallow` |
| Did the browser leak? | `soak/soak.json` | `drift_pct`, `processes_after_close` |
| Did the extension load? | `chrome/chrome-connect.json` | `modes[].ok` per mode |

The SQLite database written by `make spike` is at `evidence/run/<ts>/spike/data/spike.sqlite`:

```bash
sqlite3 "evidence/run/<ts>/spike/data/spike.sqlite" ".tables"
# _sqlx_migrations  sources  task_events  tasks

sqlite3 "evidence/run/<ts>/spike/data/spike.sqlite" "select id,kind,state,attempts from tasks;"
# 1|browser_probe|queued|0

sqlite3 "evidence/run/<ts>/spike/data/spike.sqlite" "select task_id,from_state,to_state,note from task_events order by id;"
# 1||queued|enqueued
# 1|running|interrupted|recovered after process restart

sqlite3 "evidence/run/<ts>/spike/data/spike.sqlite" "select count(*) from sources;"
# 0   <- the registry table exists and nothing fills it yet
```

**No job postings are stored anywhere.** If you want to inspect postings, read the JSON in `api/api-probes.json`, which contains only payload *shape* and counts, not the postings themselves.

## 7. Tests to run

### 7.1 Automated

```bash
make test
```

Expected: `ℹ tests 65` / `ℹ pass 65` / `ℹ fail 0` from Node, then `test result: ok. 8 passed; 0 failed; 1 ignored` from cargo, and last:

```
wiring: UI calls 5, Rust registers 6
  note: task_detail is registered but not called by the UI
  every command the UI calls is registered
```

The `note:` line is expected: `task_detail` is registered for the Phase 1 detail view and the spike UI does not call it yet. The check fails only when the UI calls a name that is missing from `generate_handler!` — a rename on either side is otherwise a green build and a runtime error.

The one ignored Rust test is the keyring round trip, because a CI runner has no unlocked keychain; `make spike` exercises the same path explicitly.

Run it with `set -o pipefail` if you pipe it anywhere: `make test | grep …` returns grep's exit code, which hides a failure. That mistake was made here and corrected.

### 7.2 Manual checks worth doing

1. **Watch the desktop app.** `make desktop`, then `open "$CARGO_TARGET_DIR/release/bundle/macos/openjob-phase0.app"`. It opens a window and stays up (measured: alive after 12 s at 114 MB RSS). **The UI wiring is verified statically only**: `make wiring` proves that every command name the UI passes to `invoke()` exists in `generate_handler!`, and `finish_task` now reaches the same audited `complete_task` path as the core, but nobody has clicked the buttons in an automated or observed way. Confirm the table and the keyring line yourself before ticking them.
2. **Kill it mid-task.** Force-quit with a task in `running` and relaunch: the equivalent recovery is proven at the library level by `make spike` (`phase1.json` → `phase2.json`), but the button path is the same unverified UI wiring as above.
3. **Mount the DMG.** `hdiutil attach <dmg>` shows `openjob-phase0.app` and an `Applications` symlink.
4. **Read one evidence file end to end** and check that every number in the document you are reading appears there. That is the whole point of the phase.

### 7.3 Known operational failure and its recovery

The agent-browser adapter can fail with:

```
✗ Failed to read: Resource temporarily unavailable (os error 35)
  (the command reached the daemon but no response came back)
```

That is a wedged daemon, not a broken endpoint. Observed cause: a session name reused after an interrupted run. Recovery:

```bash
pkill -f "agent-browser@0.41.2"
```

The harness now uses a session name unique to each process, so a new run starts clean; this was reproduced and fixed here.

## 8. What is still incomplete

| Area | State |
| --- | --- |
| Job ingestion, storage, search, matching | **not implemented** — `sources` table empty, no posting storage |
| Aggregator clients (Adzuna, Jooble, InfoJobs, SEEK) | **not implemented** — no code, no keys |
| LinkedIn / Indeed integration | **not available** — no candidate-side API exists |
| Browser supervisor in the app | not implemented; the sidecar is spawned once by the self-test |
| Login UI in the desktop app | not implemented; login is a script-driven flow |
| Notifications | plugin wired, never exercised |
| Windows / Linux builds | **never built**; CI written, never run |
| Code signing / notarisation | not done |
| UI click path | **statically checked only** — `make wiring` covers the command names, nothing presses a button |
| Real-service session persistence | **never executed** (needs an account) |
| Native messaging | documented only |
| Native (RDD) code review | **runs per candidate**: readability and reliability reviewed the T17 candidate (7 files, 177 lines), raised two CRITICAL findings, and approved the one bounded correction. Reviewing the whole Phase 0 diff in one transaction still exceeds the lens context budget |

## 9. Acceptance checklist

Tick only what you observed. Each line names the command and the observable result.

- [ ] `make test` exits 0 with `65 pass`, `8 passed; 1 ignored`, and `every command the UI calls is registered`.
- [ ] `make phase0` exits 0 and prints one `evidence/run/<ts>` path containing `api`, `bench`, `chrome`, `crash`, `persistence`, `soak`, `spike`.
- [ ] `bench/bench.json` contains four adapters, each with `runs_ok: 3`.
- [ ] The headless adapter's `idle_mean_rss_mb.median` is roughly a third of the headed one.
- [ ] `persistence/persistence.json` shows the persistent-cookie variant passing step 6 and the session-cookie variant failing it, with both `matches_expectation: true`.
- [ ] `crash/crash-recovery.json` shows `isConnected` false after SIGKILL and the same profile reusable.
- [ ] `soak/soak.json` shows `processes_after_close: 0` and a `drift_pct` that is not a large positive number.
- [ ] `spike/phase1.json` shows a task left in `running`; `spike/phase2.json` shows it recovered to `interrupted` and re-queued, plus `keyring.ok: true` and `sidecar.ok: true`.
- [ ] `api/api-probes.json` lists SmartRecruiters under `skipped_by_robots` with `origin_allowed: false`.
- [ ] `chrome/chrome-connect.json` shows branded Chrome failing the extension mode and Chrome for Testing passing it.
- [ ] `make desktop` produces `openjob-phase0.app`; `open` launches it and it stays up.
- [ ] `make dmg` produces an image that `hdiutil verify` calls VALID and that mounts with the app and an `Applications` link.
- [ ] The SQLite database has the four tables and `sources` is empty — confirming that search is not implemented.
- [ ] You read at least one document and matched its numbers to an artifact.

If every box is ticked, Phase 0 is verified on this machine and on macOS arm64 only. Nothing in this guide is evidence for Windows or Linux.
