# Reproducible PoC

Everything Phase 0 measured can be re-run. This document is the map: what each entry point does, what it writes, and what a pass looks like.

## Prerequisites

macOS arm64 (verified), Node 24, Rust toolchain 1.98.1 through `scripts/cargo.sh`, `pnpm`, `sqlite3`.

```bash
set -a; . ./scripts/env.sh; set +a
```

`scripts/env.sh` points `CARGO_TARGET_DIR`, `PLAYWRIGHT_BROWSERS_PATH` and the pnpm store at `.cache/` on the project volume. Without it the builds fill a 5.3 GiB system volume.

Two host quirks are handled by wrappers, and both are real findings:

- `scripts/cargo.sh` pins Rust 1.98.1. The Homebrew `rustup` exposes a real `cargo` binary rather than a proxy, so `rust-toolchain.toml` and `cargo +toolchain` are both ignored; the active "stable" is 1.89.0 and tauri 2.10+ requires 1.90.
- The Playwright browser cache was seeded from the existing system cache, so no browser download is needed. `pnpm exec playwright install --dry-run` confirms the expected revision is `chromium-1248`.

## Entry points

| Command | Produces | Pass condition |
| --- | --- | --- |
| `./scripts/capture-env.sh` | `evidence/run/<ts>/env.json` | host facts recorded |
| `node poc/runtime-bench/src/harness.ts --runs 3 --idle-ms 10000` | `bench.json` | every adapter `ok` |
| `node poc/session-poc/persistence.ts` | `persistence.json` | observations match the expectations stated before the run |
| `make soak` | `soak.json` | two-minute idle, no drift, zero processes after close |
| `node poc/chrome-connect/connect.ts` | `chrome-connect.json` | branded Chrome refuses the extension, Chrome for Testing accepts it |
| `node poc/api-probe/probe.ts` | `api-probes.json` | six sources probed, statuses recorded |
| `cargo build` then `session-poc-selftest --phase crash` / `--phase recover` | `phase1.json`, `phase2.json` | task recovered and audited |
| `scripts/check-desktop-launch.sh <binary> <dir>` | `desktop-launch.json` | shell alive after 12 s |
| `make wiring` | nothing; the exit status is the artifact | every command name the UI passes to `invoke()` exists in `generate_handler!` |
| `make clean` / `make clean-deps` | nothing; frees build outputs or dependencies | build outputs and `node_modules` removed, `evidence/` untouched |
| `make desktop` | `.app` bundle | bundle created |
| `make dmg` | verified `.dmg` (4.8 MB, `hdiutil verify` VALID) | DMG produced, verified and mounted |
| `make phase0` | all of the above except `dmg` | every target green |

## Tests

```bash
cd poc/runtime-bench && ./node_modules/.bin/tsc --noEmit && node --test "test/*.test.ts"
cd poc/session-poc/src-tauri && ../../../scripts/cargo.sh test
./scripts/check-tauri-wiring.sh
```

65 TypeScript tests and 7 Rust tests. They cover the pure logic that the evidence depends on: licence classification, pyproject parsing, package.json narrowing, the depth-limited file walk, HTTP probe pacing, CPU-time parsing, subtree summation, the median/aggregate path, robots.txt parsing and RFC 9309 availability policy, task-state recovery, and the completion path the desktop shell and the core share.

The terminal `check-tauri-wiring.sh` is not a test of behaviour: it fails the build when a command name the Vue UI calls is missing from `generate_handler!`, a rename that TypeScript and Rust both accept and that only breaks at runtime.

The Rust keyring test is `#[ignore]`d because a CI runner has no unlocked keychain; the self-test exercises the same path explicitly.

## Two-process crash recovery

The recovery claim is only meaningful if the process really dies, so the self-test is two invocations:

```bash
BIN="$CARGO_TARGET_DIR/debug/session-poc-selftest"
DATA=/tmp/spike-data
"$BIN" --phase crash   --data-dir "$DATA"   # leaves a task in 'running', then exits
"$BIN" --phase recover --data-dir "$DATA" \
  --node "$(which node)" \
  --sidecar poc/session-poc/sidecar/browser-agent.mjs \
  --url https://example.com
```

Phase 1 output: `{"phase":"crash","state":"running","task_id":1}`. Phase 2 output includes `recovered_task_ids:[1]`, `recovered_task_state:"interrupted"`, `resumed_task_id:1`, `keyring:{ok:true}` and a sidecar report.

## Fixtures

`poc/runtime-bench/src/fixtures/server.ts` serves a deterministic site on `127.0.0.1`: a login form that sets an HttpOnly cookie (`?remember=1` adds `Max-Age`), an authenticated page with an iframe, a dynamic region, a download link, a file input, and a 1500-row page. No test and no benchmark touches a third-party service.

## One run, one directory

`make phase0` writes every artifact under a single `evidence/run/<timestamp>/` directory. That required a fix during Phase 0: the `OUT` variable was recursive (`?=`), so `$(shell date …)` was re-evaluated for every target and one run scattered across five timestamped directories. It is now immediate (`:=`).

`dmg` stays out of `phase0` only because it re-runs the release build; it is green on its own. It uses `scripts/make-dmg.sh` rather than Tauri's bundler, because `create-dmg` shells out to AppleScript to arrange the Finder window and that call times out with `-1712` on any machine without Automation permission — including every CI runner. The image itself never needed Finder; only the cosmetic layout did.

## What a re-run will not reproduce exactly

Timings vary with thermal state and with the external SSD's page cache. The recorded spread is wide on purpose — for example Playwright headless launch ranged 872–4352 ms across runs — which is why every reported figure is a median of three with the sample count beside it.
