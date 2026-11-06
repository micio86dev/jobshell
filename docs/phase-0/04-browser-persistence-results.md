# Browser persistence results

The ten-step protocol from the request, run against a deterministic local fixture and, for the last four steps, against the Rust core that a desktop app would use.

Artifacts: `evidence/summary/persistence.json`, `evidence/summary/phase1.json`, `evidence/summary/phase2.json`, `evidence/summary/desktop-launch.json`.

## Result summary

| Step | Persistent-cookie variant | Session-cookie variant |
| --- | --- | --- |
| 1. Launch a dedicated Chromium profile | PASS | PASS |
| 2. Open a login page | PASS | PASS |
| 3. Authenticate on a permitted service | PASS | PASS |
| 4. Close the browser | PASS | PASS |
| 5. Restart the browser | PASS | PASS |
| 6. Verify the session persists | **PASS** | **FAIL** |
| 7. Execute a permitted background task | PASS (sidecar, 6.7 s) | n/a |
| 8. Close the application | PASS (process exits with a running task) | n/a |
| 9. Restart the application | PASS (new OS process) | n/a |
| 10. Verify session and task recovery | PASS (task recovered and re-queued) | n/a |

## The finding that matters

**A persistent authenticated profile is not one thing.** Whether a login survives closing the browser depends on the cookie the site issues, and the app cannot change that:

- A cookie with `Max-Age`/`Expires` is written to the profile and survives a restart. Measured: the app page rendered without re-login and the server reported `authenticated=true` after relaunch.
- A plain session cookie is discarded by the browser on close, by design. Measured: after relaunch the app page redirected to the login form and the server reported `authenticated=false`.

The expectation was stated before each run, so the session-cookie failure is a recorded finding, not a red test.

Consequence for the architecture, and the reason this experiment was worth running: for sites that only issue session cookies, "persistent profile" only works if the browser process is kept resident. That is exactly the model agent-browser uses (a daemon that holds the browser between commands, `docs/phase-0/02-browser-runtime-comparison.md`). Phase 1 therefore needs a resident browser supervisor with an explicit idle policy, not a launch-per-task model.

## How session presence was observed

Behaviourally only. The script asserts that the authenticated view renders and that the server-side `/session` endpoint agrees. The browser cookie store is never read, copied or exported — the first version of the script did read it, and that was removed, because an experiment that must not inspect a mechanism should not depend on it.

## Steps 7–10: background task and application restart

Run against the Rust core, not against the browser script, because these steps are about application state rather than page state.

1. Phase 1 (`--phase crash`) enqueues a `browser_probe` task, moves it to `running`, prints `{"phase":"crash","state":"running","task_id":1}` and exits without cleanup — a faithful crash.
2. Phase 2 runs in a **new OS process**, opens the same SQLite database, finds the orphaned `running` row, marks it `interrupted`, appends a `task_events` record ("recovered after process restart"), and re-queues it.
3. The same process stores and reads a secret through the macOS Keychain (`{"keyring":{"ok":true}}`) and spawns the Node sidecar, which drives Playwright in a dedicated profile and returns `{"ok":true,"detail":"loaded \"Example Domain\" ...","reported_ms":6672}`.

The desktop shell itself launches and is still alive after 12 s at 114 MB RSS (`evidence/summary/desktop-launch.json`).

## Crash recovery, measured separately

`poc/session-poc/crash-recovery.ts` kills the browser's process subtree with `SIGKILL` mid-task and records what happens (`evidence/summary/crash-recovery.json`):

| Step | Result |
| --- | --- |
| Task running before the crash | PASS — authenticated page rendered |
| The automation handle notices the crash | PASS — `browser.isConnected()` is `false` after `SIGKILL` |
| The in-flight action fails instead of hanging | PASS — rejected in 1 ms (single sample, not a benchmark) |
| The same profile is reusable after a hard crash | PASS — relaunch on the same directory rendered a page |
| Session state after a hard crash matches the stated expectation | PASS — the expectation (session lost) was stated before the run; this login does not tick "stay signed in", so the fixture issues a session cookie |

So a browser crash is detectable and recoverable at the process level without corrupting the profile. What a crash costs is the in-flight task, which is exactly why the queue records `interrupted` rather than pretending the task never ran.

## Not tested, and why

- **Session persistence on a real third-party service.** Requires a maintainer-provided account, URL and logged-in selector. The script supports it (`OPENJOB_REAL_LOGIN_URL`, `OPENJOB_REAL_LOGGED_IN_SELECTOR`) and deletes the resulting profile in a `finally` block, but no such account was used in this phase.
- **Restoring a session cookie after a crash rather than a clean close.** Not attempted: it depends on Chrome's session-restore behaviour and on flags the product would have to ship deliberately.
- **Multi-profile isolation.** Only one profile at a time was exercised.

## Reproduction

```bash
set -a; . ./scripts/env.sh; set +a
node poc/session-poc/persistence.ts
```

Exit code 0 means every observation matched the expectation stated before the run, including the expected session-cookie failure.
