# openjob.dev

A local-first desktop application for global AI-assisted job discovery is the eventual
product. **This repository is Phase 0: a feasibility proof of concept, not the product.**
It exists to eliminate architectural uncertainty with reproducible evidence before any
product code is written.

Everything here was measured on one machine and one platform — macOS arm64. Nothing in
this repository is evidence for Windows or Linux. Where an experiment could not run, the
document says so and names the blocker.

The detailed guide is [`docs/phase-0/16-poc-testing-guide.md`](docs/phase-0/16-poc-testing-guide.md).
The claim-to-artifact map is [`evidence/INDEX.md`](evidence/INDEX.md). This file is only
the first run.

## First run

### 1. Requirements

- **macOS on Apple silicon.** The only platform this was built and verified on.
- **Node 24** and **pnpm 11** (`node -v`, `pnpm -v`).
- **Xcode Command Line Tools** (`xcode-select -p`).
- **Rust**: nothing to install manually — `scripts/cargo.sh` pins the toolchain. The
  Homebrew `rustup` exposes a real `cargo` binary rather than a proxy, so
  `rust-toolchain.toml` and `cargo +toolchain` are both ignored; the wrapper is the only
  reliable way to get the version Tauri 2.10+ needs.
- **tauri-cli 2.10.1**, only for `make desktop` and `make dmg`. `cargo tauri` resolves
  `~/.cargo/bin/cargo-tauri`, which this machine already had; `make desktop` puts
  `$HOME/.cargo/bin` on `PATH` itself, so no shell setup is needed.
- **A Playwright browser cache.** This machine had it seeded already. On a fresh machine
  you must provide one; the expected revision is `chromium-1248`, and
  `pnpm exec playwright install chromium` inside `poc/runtime-bench`, **with
  `scripts/env.sh` sourced** so the browser lands in `.cache/pw-browsers`, is the usual
  way to get it. *That step was not executed here* — the cache was pre-seeded — so treat
  it as the documented path, not a verified one.
- **`sqlite3` CLI**, only if you want to inspect the database by hand.

### 2. Point the toolchain at the project volume

The system volume on this machine has ~5.3 GiB free and the project volume ~47 GiB, so
every build artifact, browser binary, package store and temp file is redirected into
`.cache/` on the project volume. Without this, builds fill the system disk.

```bash
cd "<repo>"
set -a; . ./scripts/env.sh; set +a
```

`make` targets source it themselves; you need it only for direct `node` or `cargo`
invocations. `scripts/env.sh` hard-codes `PROJECT_ROOT` — if you move the repository,
that one line is the thing to edit.

### 3. Install dependencies

```bash
cd poc/runtime-bench && pnpm install --frozen-lockfile && cd ../..
cd poc/session-poc && pnpm install --frozen-lockfile && cd ../..
cd poc/session-poc/ui && pnpm install --frozen-lockfile && cd ../../..
cd poc/api-probe && pnpm install --frozen-lockfile && cd ../..
cd poc/chrome-connect && pnpm install --frozen-lockfile && cd ../..
cd poc/agent-browser-probe && pnpm install && cd ../..
```

The UI **must** be installed with pnpm: `npm install` fails twice over there, on a
`vue-tsc` peer conflict and then on an npm-internal error even with `--legacy-peer-deps`.

### 4. Prove the machine works

The first `make test` is slower than the 65-test count suggests: it compiles the Rust core
and its dependencies from crates.io, so give it minutes rather than seconds. Later runs
are seconds.

```bash
make test
```

Exit code 0 means all of this passed:

```
ℹ tests 65 / ℹ pass 65 / ℹ fail 0                                     (TypeScript)
test result: ok. 8 passed; 0 failed; 1 ignored                        (Rust core)
wiring: UI calls 5, Rust registers 6                                  (UI ↔ Rust names)
  every command the UI calls is registered
```

The one ignored Rust test is the keyring round trip: a CI runner has no unlocked
keychain. `make spike` exercises the same path explicitly.

### 5. Run the whole phase

```bash
make phase0        # ~8 minutes: test, bench, probe, persistence, crash, soak, chrome, spike, desktop
```

Every artifact of one run lands in **one** directory, `evidence/run/<UTC timestamp>/`,
with `api`, `bench`, `chrome`, `crash`, `persistence`, `soak` and `spike` inside. The
run ends with `Phase 0 evidence written to <that path>`. Override the destination with
`OUT=/some/dir make phase0`.

Then check the numbers yourself rather than trusting this file — `docs/phase-0/16-poc-testing-guide.md`
§6 maps each question to the file and field that answers it, and §9 is an acceptance
checklist you tick only against output you observed.

## Environment variables

**There is no `.env` file and no dotenv loader anywhere in this repository, and no API key
is read by any code path.** Credential-gated sources are recorded as blockers instead of
being faked.

Only four project variables exist, and every one of them is optional:

| Variable | Read by | Effect when unset |
| --- | --- | --- |
| `OPENJOB_REAL_LOGIN_URL` | `poc/session-poc/persistence.ts` | the real-service login variant is skipped and recorded as skipped |
| `OPENJOB_REAL_LOGGED_IN_SELECTOR` | same | same; both are required together |
| `OPENJOB_AGENT_BROWSER_BIN` | `poc/runtime-bench/src/adapters/agent-browser.ts` | defaults to the binary inside `poc/agent-browser-probe` |
| `OPENJOB_RUST_TOOLCHAIN` | `scripts/cargo.sh` | defaults to `1.98.1-aarch64-apple-darwin` |

The variables `scripts/env.sh` exports (`CARGO_TARGET_DIR`, `PLAYWRIGHT_BROWSERS_PATH`,
`npm_config_store_dir`, `PNPM_HOME`, `TMPDIR`) are artifact placement, not configuration.

## Commands

| Command | What it does |
| --- | --- |
| `make test` | 65 TypeScript tests, 8 Rust tests, 5 typechecks, and the UI↔Rust wiring check |
| `make wiring` | fails if the Vue UI calls a command `generate_handler!` does not register |
| `make bench` | the four browser-runtime adapters, 3 runs each, RAM and CPU |
| `make probe` | read-only GETs to six public ATS job feeds, with `robots.txt` enforced first |
| `make persistence` | the login-survives-restart protocol, two cookie-lifetime variants |
| `make crash` | SIGKILL recovery: is the profile still usable afterwards |
| `make soak` | two minutes idle, watching for drift and leaked processes |
| `make chrome` | the Chrome connection modes, including extension loading |
| `make spike` | the two-process crash-recovery self-test and the Rust↔Node sidecar |
| `make desktop` | builds the macOS `.app` bundle |
| `make dmg` | builds and verifies the `.dmg` |
| `make phase0` | everything above except `dmg` |
| `make clean` | deletes build outputs only; `evidence/` is never touched |
| `make clean-deps` | deletes `node_modules` only; restores from the lockfiles |

`make dmg` stays out of `make phase0` because it re-runs the release build. It uses
`scripts/make-dmg.sh` and `hdiutil` rather than Tauri's bundler, because `create-dmg`
shells out to AppleScript and that call times out on any machine without Automation
permission — including every CI runner.

## What this is not

- Not the product: no job ingestion, no storage of postings, no search, no matching. The
  `sources` table in the PoC database is empty on purpose.
- No LinkedIn or Indeed integration. Both were researched and neither offers a
  candidate-side job-search API; see `docs/phase-0/07` and `08`.
- No aggregator clients, because Adzuna, Jooble, InfoJobs and SEEK need credentials that
  were never supplied.
- No cookie or credential extraction from any browser profile, ever.
- No Windows or Linux build. The CI matrix is written and **never executed** — this
  repository has no git remote.

## Layout

| Path | What lives there |
| --- | --- |
| `poc/runtime-bench/` | benchmark harness, four adapters, offline fixture site, robots parser |
| `poc/session-poc/` | session protocol, crash recovery, soak, Rust core, Tauri shell, Vue UI |
| `poc/chrome-connect/`, `poc/api-probe/`, `poc/agent-browser-probe/` | the smaller probes |
| `scripts/` | `env.sh`, `cargo.sh`, `make-dmg.sh`, the checks, env capture |
| `docs/phase-0/` | the fifteen feasibility reports `01`–`15`, the testing guide `16`, and the index `00`, in reading order |
| `evidence/` | measured artifacts: `run/<timestamp>/` per run, `summary/` committed excerpts, `INDEX.md` the claim map |
| `odd/tasks/` | the Phase 0 feature document: specs, tasks, and the log with every blocker |

Code, comments, commits and repository-facing documentation are English. Conversation
with the maintainer is Italian.
