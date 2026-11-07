# Security threat model

Scope: the desktop application described in `14-recommended-architecture.md`, as exercised by the Phase 0 PoC. Assets are the things a candidate would be harmed by losing.

## Assets

| Asset | Where it lives | Why it matters |
| --- | --- | --- |
| CVs and profile data | SQLite + files under the app data directory | personal data, often with contact details and employment history |
| Browser sessions (cookies, storage) | dedicated Chromium profile directory | full account takeover if exfiltrated |
| API credentials (Adzuna, Jooble, InfoJobs, SEEK) | OS keyring only | billable, attributable |
| Search history and application state | SQLite | reveals intent, salary expectations, current employer |
| The browser binary and the Node sidecar | app bundle | supply-chain surface |

## Threat model

| # | Threat | Path | Mitigation | Status in PoC |
| --- | --- | --- | --- | --- |
| T1 | Cookie/session theft from the profile directory | any local process reading `profile/Default/Cookies` | OS-level file permissions; profile inside the app data dir; no cookie export API anywhere in the codebase; never read the user's ordinary browser profile | **partially**: dedicated profile used, cookie store never read by our code; filesystem hardening not implemented |
| T2 | Debugging port exposed | app starts Chrome with `--remote-debugging-port` | never open a debugging port on a profile holding real sessions; if needed for diagnostics, bind to a `--remote-debugging-port=0` ephemeral port read from `DevToolsActivePort` and close it | **measured risk**: the endpoint answered anonymous loopback HTTP and listed targets (`evidence/summary/chrome-connect.json`) |
| T3 | Third-party binary inherits the environment | sidecar spawn with `process.env` | explicit allowlist (`PATH`, `HOME`, `TMPDIR`, `LANG`, `SHELL`) plus the specific `AGENT_BROWSER_*`/`PLAYWRIGHT_*` keys; `env_clear()` on the Rust side | **implemented** in both the benchmark adapter and the Rust sidecar spawner |
| T4 | Malicious job posting drives an AI action | scraped posting text reaches an LLM that can call tools | treat all fetched content as untrusted data, never as instructions; no tool-calling from page content; allowlist of actions; human confirmation for anything that submits | **design only** — no AI layer exists yet |
| T5 | Extension supply chain | a bundled extension with broad permissions | pin and bundle extensions; never fetch at runtime; review the manifest's permission list; prefer none | **measured**: extensions load only in Chrome for Testing, and run with whatever the manifest requests |
| T6 | Native messaging bridge | a host binary outside the sandbox | out of Phase 1 scope: the sidecar covers the same need with an auditable process boundary | **not implemented, deliberately** |
| T7 | Credential leakage through logs | API keys in log lines | keys live in the keyring and are read at call time; log only the source id, never the header value | **partially**: no logging layer yet, so nothing is logged and nothing is redacted |
| T8 | SQLite corruption or loss | crash during a write | WAL journal mode, migrations, explicit recovery of `running` tasks | **implemented and tested** across real process death |
| T11 | Automated collection against a site's wishes | probe or browser workflow ignoring `robots.txt` | fetch and parse robots per origin before any content request; skip disallowed URLs and record the skip | **implemented** for the probe; the browser workflow does not exist yet |
| T9 | Malicious or compromised ATS feed | hostile JSON from a third-party endpoint | validate at the boundary; never execute payload content; cap response size and item count | **partially**: probe parses as `unknown` and narrows; the ingestion path does not exist yet |
| T10 | GDPR exposure from CV storage | local personal data, backups, crash dumps | local-only storage, no sync by default, export/delete on request, no telemetry | **not implemented** |

## Non-goals

- Protecting the candidate from a compromised operating system. If an attacker has root, the profile is readable; the design limits blast radius, it does not defeat an administrator.
- Hiding activity from the employer's network. The app talks to the internet like any other client.
- Circumventing any platform's access controls. Where no official interface exists, the answer is a user-driven browser session or nothing (`07-linkedin-feasibility.md`, `08-indeed-feasibility.md`, `10-social-channel-feasibility.md`).

## What Phase 0 actually proved about security

Two things, both measured rather than asserted:

1. A CDP endpoint on loopback is unauthenticated. It listed four targets to a plain `fetch` (`evidence/summary/chrome-connect.json`). Any code that opens one on a profile with real sessions is handing the profile to every local process.
2. Environment inheritance is real: the first version of the benchmark adapter passed `...process.env` to a third-party binary. It was replaced with an allowlist, and the Rust sidecar spawner uses `env_clear()` plus four explicit variables.

## Open items for Phase 1

- Filesystem permissions on the profile directory, and whether to encrypt CV data at rest.
- A logging layer with redaction, since currently there is no logging at all.
- Prompt-injection containment design before any AI feature lands (T4).
- A per-source rate limiter that is enforced, not documented. `robots.txt` enforcement is done: the probe fetches robots per origin first, parses it and never requests a disallowed URL (`poc/runtime-bench/src/lib/robots.ts`, 22 tests). Rate limiting itself is still only a fixed delay between requests.
