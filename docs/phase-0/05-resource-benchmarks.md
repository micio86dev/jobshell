# RAM and CPU benchmark

Method first, because the numbers are meaningless without it.

**Host.** macOS 26.5.2, Apple M1 (8 cores), 8 GiB RAM, external SSD for build artifacts. Background applications were not quiesced: this is a laptop in normal use, which is the honest condition for a desktop app.

**Protocol.** launch → local login page → fill + submit → authenticated page → accessibility snapshot → iframe read → download → upload → 1500-row page → 10 s idle → close. Three runs per adapter; the median is reported with the sample count.

**Resource sampling.** Every 500 ms, one `ps -axo pid,ppid,rss,time,command` snapshot. The browser is identified by the unique profile path passed to that run, and its whole process subtree is summed through the ppid graph. CPU is derived from the growth of cumulative CPU seconds between samples, not from `ps`' lifetime average, so a burst is visible. The sampler's own event-loop cost is measured and reported (`sampler_overhead_ms`), because `ps` is synchronous and runs in the same process that times the protocol.

Artifact: `evidence/summary/bench.json`.

## Results (median of 3)

| Adapter | Launch | Form submit | Snapshot | Iframe | Download | Upload | 1500 rows | Close | Peak RSS | Idle RSS | Idle CPU |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| playwright-headless | 3184 ms | 378 ms | 22 ms | 14 ms | 69 ms | 10 ms | 42 ms | 371 ms | **308 MB** | **271 MB** | **0.3 %** |
| playwright-headed | 8886 ms | 1647 ms | 90 ms | 53 ms | 191 ms | 98 ms | 62 ms | 2867 ms | 832 MB | 509 MB | 2.2 % |
| playwright-chrome-headed | **1477 ms** | 251 ms | 18 ms | 14 ms | 148 ms | 20 ms | 36 ms | 1178 ms | 856 MB | 732 MB | 2.8 % |
| agent-browser-headed | 13452 ms | 593 ms | 256 ms | 9 ms | 152 ms | 27 ms | 66 ms | 2235 ms | 1090 MB | 794 MB | 3.8 % |

## What the numbers say

**Headless is not a detail, it is a different product.** Headless costs 308 MB peak against 832 MB headed, and 0.3 % idle CPU against 2.2 %. On an 8 GiB laptop, a background job that opens a headed window for every source is not viable; a headless worker is.

**The installed Chrome launches fastest but is the heaviest idle.** 1477 ms against 3184 ms for bundled Chromium, yet 732 MB idle against 271 MB. Chrome's own background services (update, sync, extensions) run whether or not the profile uses them. Fast to start is not the same as cheap to keep.

**agent-browser is the most expensive resident.** 794 MB idle, 3.8 % idle CPU, 1090 MB peak. Its daemon-plus-browser model is what makes per-command latency low (60–240 ms warm), but the floor is high: a background poller on this runtime costs about three quarters of a gigabyte to sit still.

**Spread is large and must be reported.** Playwright headless launch ranged 872–4352 ms across the three runs. The first run on a fresh profile is the slow one — a new browser profile on an external volume pays OS-level verification. A single-run benchmark would have been misleading in either direction, which is why every figure here is a median with its sample count.

**Sampler overhead is disclosed, not hidden.** Total sampler cost was 1.2–1.9 s across a run of roughly 20–40 s, i.e. under 5 % of wall time, spent in short synchronous `ps` calls. It affects the idle window least because sampling there has nothing else to contend with.

## Interaction cost is where the runtimes really differ

Same login, four different prices: 378 ms in Playwright headless (two `fill` calls and a click through one connection), 251 ms in Playwright on installed Chrome, 593 ms through agent-browser — whose login is four separate CLI invocations measured at 128/121/143/201 ms in one run. For a form with ten fields, that difference compounds.

## Limits of this benchmark

- One host, one OS. Windows and Linux numbers do not exist yet (`docs/phase-0/06-cross-platform-limits.md`).
- The fixture is local and deliberately small. A real job board page with third-party scripts will raise both RSS and CPU; the ratios between runtimes are more transferable than the absolute values.
- Headed runs were measured with a window visible on a laptop screen. A minimised or off-screen window may change the compositor's cost, which was not tested.
- No long-soak measurement: a two-hour idle browser may settle lower than a 10 s idle window shows.
