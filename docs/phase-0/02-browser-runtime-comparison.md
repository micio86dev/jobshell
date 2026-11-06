# Browser runtime comparison

Five candidates, evaluated against one protocol and one host. Cells marked **measured** come from `evidence/summary/bench.json`; cells marked **inspected** come from reading the cloned repository at the pinned commit in `evidence/summary/runtimes-raw.json`; cells marked **blocked** name the blocker instead of guessing.

Host: macOS 26.5.2, Apple M1, 8 GiB. Protocol: launch → local login page → fill and submit → authenticated app page → accessibility snapshot → iframe read → download → upload → 1500-row page → 10 s idle → close. Three runs per adapter, median reported.

## Headline table

| | Playwright (Chromium, headless) | Playwright (Chromium, headed) | Playwright (installed Chrome, headed) | agent-browser | Browser Harness | Jev Ultrafast | Stagehand |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Version inspected | 1.64.1 / repo 1.66.0-next | same | same | 0.41.2 | 0.1.13 | py `>=3.12` | 4.0.0 workspace |
| Licence | Apache-2.0 | Apache-2.0 | Apache-2.0 | Apache-2.0 | MIT | MIT | MIT |
| Stars / open issues | 99 452 / 52 | — | — | 46 268 / 494 | 18 900 / 440 | 24 235 / 210 | 25 964 / 418 |
| Last push | 2026-11-06 | — | — | 2026-11-06 | 2026-11-06 | 2026-11-03 | 2026-11-06 |
| Rust integration | none (Node/Python/Java/.NET) | none | none | **native Rust binary crate, no lib target** | none (Python) | none (Python) | none (TS/Python) |
| Installation | `pnpm add playwright`, browsers already cached | same | uses installed Chrome | npm package ships prebuilt binaries | `uv tool install` | `uv` + browser-harness + TypeSafe | pnpm workspace |
| Launch (median) | 3184 ms | 8886 ms | **1477 ms** | 13452 ms | blocked | blocked | blocked |
| Accessibility tree | **22 ms**, `ariaSnapshot`, 1270 chars | 90 ms | 18 ms | 256 ms, compact text with `@ref` | blocked | blocked | blocked |
| Persistent profile | yes, `launchPersistentContext` | yes | yes, dedicated profile | yes, `--profile` | uses the user's real Chrome | via browser-harness | yes (Playwright) |
| Auth persistence | **tested**: persistent cookie survives, session cookie does not | — | — | not tested | not tested | not tested | not tested |
| Headless | yes | n/a | yes (headless tested separately) | yes | no (drives a real Chrome window) | no | yes |
| Background operation | sidecar process | sidecar process | sidecar process | resident daemon | needs a running Chrome | needs Chrome | sidecar process |
| Dynamic interaction | full DOM + frames | full | full | ref-based snapshot loop | agent-written helpers | model-driven action space | Playwright + LLM |
| Download / upload | **69 ms / 10 ms** | 191 / 98 ms | 148 / 20 ms | 152 / 27 ms | blocked | blocked | blocked |
| Iframe | **14 ms** via `frameLocator` | 53 ms | 14 ms | 9 ms via `eval` | blocked | blocked | blocked |
| Crash recovery | **measured**: SIGKILL detected, action rejects in 0 ms, same profile reusable | same | same | daemon re-attach, not measured | not measured | not measured | not measured |
| Peak RSS | **308 MB** | 832 MB | 856 MB | 1090 MB | blocked | blocked | blocked |
| Idle RSS / CPU | **270 MB / 0.3 %** | 508 MB / 2.2 % | 731 MB / 2.8 % | 794 MB / 3.8 % | blocked | blocked | blocked |
| Cross-platform | macOS verified here; Windows/Linux documented only | same | same | ships win/linux/mac binaries | Python 3.11+ | Python 3.12+ | Node 22.18+ |

## Why the three Python/TS candidates are blocked

They are not "worse"; they are not measurable against this protocol on this host without the preconditions below. Each blocker is a fact about the runtime, not a preference.

- **Browser Harness** — drives the maintainer's real Chrome over CDP, after a human ticks "Allow remote debugging" in `chrome://inspect` (Chrome 144+). Measuring it means automating the user's everyday profile, which Phase 0 explicitly refuses. Its own comparison table documents the model: "Your running Chrome, logged in as you".
- **Jev Ultrafast** — `dependencies = "browser-harness==0.1.13", "httpx[http2"`, so it inherits Browser Harness's connection model, and its decision loop calls the TypeSafe Jev model service. Without an account for that service there is no agent loop to measure.
- **Stagehand** — its Playwright layer could be measured, but that is measuring Playwright again. Its differentiator needs an LLM provider key, which Phase 0 does not hold.

## Capability findings that are independent of the numbers

**Extensions.** Branded Google Chrome 156 ignores `--load-extension`; the bundled Chrome for Testing 156 loads the same unpacked MV3 extension and starts its service worker (`evidence/summary/chrome-connect.json`). Any extension-based capability requires shipping the browser.

**Connecting to an existing Chrome.** `channel: "chrome"` works with a dedicated profile. `connectOverCDP` works against a browser started with `--remote-debugging-port=0`, with the port read from the profile's `DevToolsActivePort` file so the endpoint is provably the one this process spawned. The endpoint answers anonymous loopback HTTP and lists targets: it has no authentication.

**Accessibility trees are not equal.** Playwright returns a YAML `ariaSnapshot` of 1270 characters for the fixture app page in 22 ms. agent-browser returns a compact ref-annotated tree in 256 ms that an agent can act on directly (`@e1`). Both are usable; the ref model removes a selector-derivation step, which matters for an LLM loop and not for a deterministic script.

## Verdict

Playwright drives the browser. agent-browser stays as the reference Rust implementation and as a fallback driver if the Node sidecar proves operationally fragile. The Python and TS agent frameworks are Phase 3 evaluation targets, not Phase 1 dependencies.
