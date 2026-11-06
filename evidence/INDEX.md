# Evidence index

Every claim in `docs/phase-0/` maps to an artifact here. `evidence/summary/` is committed; `evidence/run/` holds the full raw runs (profiles, screenshots, per-run logs) and is git-ignored because it is large and reproducible.

Regenerate with the commands in [`docs/phase-0/03-reproducible-poc.md`](../docs/phase-0/03-reproducible-poc.md).

## Committed artifacts

| Artifact | Produced by | Backs |
| --- | --- | --- |
| `summary/env.json` | `scripts/capture-env.sh` | host, toolchain and disk facts in `00-README.md`, `06-cross-platform-limits.md` |
| `summary/runtimes-raw.json` | `poc/runtime-bench/src/collect-runtimes.ts` | licences, last commits, manifest kinds and integration seams in `02`, `13` |
| `summary/runtimes-github.json` | `poc/runtime-bench/src/collect-github.ts` | stars, open issues, push dates and releases in `02`, `13` |
| `summary/bench.json` | `poc/runtime-bench/src/harness.ts` | every timing and resource figure in `01`, `02`, `05`, `14` |
| `summary/persistence.json` | `poc/session-poc/persistence.ts` | steps 1–6 and the cookie-lifetime finding in `04` |
| `summary/phase1.json` | `session-poc-selftest --phase crash` | the crash that leaves a task `running`, in `04` |
| `summary/phase2.json` | `session-poc-selftest --phase recover` | recovery, keyring round trip and sidecar spawn, in `01`, `04`, `14` |
| `summary/desktop-launch.json` | `scripts/check-desktop-launch.sh` | the shell staying alive at 114 MB, in `01`, `06`, `14` |
| `summary/chrome-connect.json` | `poc/chrome-connect/connect.ts` | the three connection modes, the anonymous CDP endpoint and the extension finding, in `01`, `02`, `06`, `12` |
| `summary/bundle.json` | `cargo tauri build` + capture | the 17 MB `.app` and the failing `.dmg`, in `01`, `06`, `14`, `15` |
| `summary/dmg.json` | `scripts/make-dmg.sh` | the verified DMG in `03`, `06`, `14` |
| `summary/crash-recovery.json` | `poc/session-poc/crash-recovery.ts` | the SIGKILL recovery table in `04` and the crash-recovery row in `02` |
| `summary/api-probes.json` | `poc/api-probe/probe.ts` | every status, posting count and robots result in `09`, `11` |

## Claim → artifact

| Claim | Artifact | Field |
| --- | --- | --- |
| Playwright headless launch 3184 ms, idle 271 MB, 0.3 % CPU | `bench.json` | `aggregate[adapter=playwright-headless]` |
| agent-browser launch 13452 ms, idle 794 MB, peak 1090 MB | `bench.json` | `aggregate[adapter=agent-browser-headed]` |
| Login costs four CLI invocations in agent-browser | `bench.json` | `aggregate[...].notes` |
| The sampler's own cost is 1.2–1.9 s per run | `bench.json` | `aggregate[...].sampler_overhead_ms` |
| agent-browser is a Rust binary crate with no lib target | `runtimes-raw.json` | `cargo_manifests`, absence of `[lib]` |
| Browser Harness and Jev are Python and depend on CDP/TypeSafe | `runtimes-raw.json` | `python_dependencies` |
| Licences: Playwright Apache-2.0, Harness/Jev/Stagehand MIT | `runtimes-raw.json`, `runtimes-github.json` | `license.spdx_guess`, `license_spdx` |
| A persistent cookie survives a browser restart | `persistence.json` | `deterministic_variants[variant=persistent-cookie].observed_persist` |
| A session cookie does not survive | `persistence.json` | `deterministic_variants[variant=session-cookie].observed_persist` |
| A crashed process leaves a `running` task | `phase1.json` | `state` |
| A new process recovers and re-queues it | `phase2.json` | `recovered_task_ids`, `recovered_task_state`, `resumed_task_id` |
| The macOS keyring round trip works | `phase2.json` | `keyring.ok` |
| Rust spawns the Node sidecar and parses its JSON | `phase2.json` | `sidecar.ok`, `sidecar.reported_ms` |
| The desktop shell stays alive | `desktop-launch.json` | `state_after_12s` |
| Branded Chrome ignores `--load-extension` | `chrome-connect.json` | `modes[unpacked-mv3-extension-branded-chrome].ok` |
| Chrome for Testing loads the MV3 extension | `chrome-connect.json` | `modes[unpacked-mv3-extension-chrome-for-testing].ok` |
| The CDP endpoint answers anonymous loopback HTTP | `chrome-connect.json` | `modes[connect-over-cdp].detail` |
| A 17 MB `.app` bundle is produced | `bundle.json` | `size_bytes`, `contents` |
| Tauri's DMG bundler fails without Finder Automation; hdiutil succeeds | `bundle.json` | `dmg.tauri_bundler_error`, `dmg.method` |
| The DMG verifies and contains the app plus an Applications link | `dmg.json` | `verified`, `bytes` |
| Greenhouse/Lever/Ashby/SmartRecruiters/Recruitee answer without credentials | `api-probes.json` | `results[].usable_without_credentials` |
| Workable answers 200 with an empty jobs array | `api-probes.json` | `results[id=workable].attempts` |
| SmartRecruiters is reachable but robots-disallowed | `api-probes.json` | `results[id=smartrecruiters].robots[0].disallow`, `skipped_by_robots` |
| A 4xx robots.txt allows access, a 5xx or unreachable one does not | `poc/runtime-bench/test/robots.test.ts` | `robotsPolicyFor` cases |
| Crawl-delay is honoured, never below the 1200 ms floor | `poc/api-probe/probe.ts` | `Math.max(1200, publishedDelayMs)` |
| SmartRecruiters needs a verified tenant id | `api-probes.json` | `results[id=smartrecruiters].attempts` |
| Recruitee robots.txt is per tenant origin | `api-probes.json` | `results[id=recruitee].robots` |
| A SIGKILL'd browser is detected and its profile is reusable | `crash-recovery.json` | `steps` |

## Claims with no artifact, stated as unverified

These appear in the documents as **unverified**, **documented** or **not tested**, and are not counted as findings:

- LinkedIn OAuth scope inventory for a non-partner application (`07`).
- Indeed regional API coverage and any "Permitted AI Connectors" programme (`08`).
- Windows and Linux builds, keyring backends and WebView behaviour (`06`).
- Per-source terms text beyond the recorded `robots.txt` result (`13`).
- X per-endpoint pricing and Reddit's current commercial fee schedule (`10`).
- Rust-native CDP performance, which was not measured at all (`01`).
