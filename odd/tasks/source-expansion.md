# Source expansion: add every feasible job source, prove each one live

Objective: add job sources to the agent, test each one against the live endpoint, and report what was added and what was discarded (with reasons).
Branch: feat/source-expansion (from main). Delivery strategy: ask-on-risk. Test runner: `node --test` plus `tsc --noEmit` in poc/job-agent.

## Specs

S1. User request, verbatim: "Aggiungiamo tutte le fonti però per ognuna dobbiamo fare un test per capire se funzionano davvero e poi a fine sviluppo mi fai un report di quelle che hai aggiunto e quelle che hai scartato. Più sono meglio è, sempre per il mercato mondiale con preferenza per Italia, spagna e Europa. Procedi in ODD"
S2. Every source in the catalogue (docs/phase-0/sources.csv) gets one verdict in the final report: added, discarded (with the observed reason), or pending credentials.
S3. Every added source has: an adapter, offline tests on synthetic fixtures, and one live probe result recorded in evidence. A source that fails its live probe is not added.
S4. No automation of sites with no public feed or API (browser-only catalogue entries), no anti-bot bypass (403/429 are recorded, never routed around), no undocumented keys, no robots.txt violation (AGENTS.md: "Network probes are read-only, rate-limited and identify themselves"; "LinkedIn and Indeed are never used for unauthorised automation").
S5. Sources that need credentials are not implemented in this pass; they are reported as pending credentials. The agent never asks for a key in chat.
S6. Preference order for ATS tenants and feeds: Italy, Spain, then Europe, then worldwide.
S7. Fix the existing defect: the runner calls `buildSearchUrl(query, {})` without a tenant, so board feeds (Greenhouse today) can never be fetched. Board tenants must reach the URL builder.
S8. Tenant ids are verified live and stored with their verification date, never guessed (Phase 0 rule: docs/phase-0/11-api-integration-matrix.md).
S9. Policy: a new source enters the `allowed` list only after its live probe succeeds. A probe result that changes later updates the registry, it does not silently keep an entry.

## Tasks

T1. Runner passes ATS tenants to board adapters from a verified registry (S7, S8). Route: inline. Status: done. RED: 2 new run tests failed (0 URLs fetched). GREEN: run suite passes. Files: src/sources/tenants.ts, src/run.ts, test/run.test.ts.
T2. Lever adapter, tenants from the registry (S3, S6). Route: inline. Status: done. RED: test/boards.test.ts failed on import. GREEN: 9/9 boards tests. File: src/sources/boards.ts.
T3. Ashby adapter, tenants from the registry (S3, S6). Route: inline. Status: done (same commit unit as T2).
T4. Greenhouse tenant list expanded with live-verified boards (S3, S6, S8). Route: inline. Status: done, 15 tenants in src/sources/tenants.ts, verified 2026-11-14 or 2026-11-06 (Phase 0).
T5. Recruitee adapter, per-tenant origin, tenants from the registry (S3, S8). Route: inline. Status: done (same unit as T2). Only one verified tenant (channable).
T6. Himalayas public JSON feed adapter (S3). Route: inline. Status: done. RED: test/public-feeds.test.ts failed on import. GREEN: 33/33 across feed suites. File: src/sources/feeds.ts.
T7. Jobspresso RSS adapter (S3). Route: inline. Status: done, but the live feed had zero items on 2026-11-14 (see L5).
T8. Personio XML adapter, per-tenant feed (S3, S6). Route: inline. Status: done. Only one verified tenant (personio).
T9. Live probe harness: one read-only run over every added source, result written to evidence (S3, S9). Route: inline. Status: harness done (src/source-probe.ts, src/source-probe-cli.ts, test/source-probe.test.ts 10/10); live run in progress.
T10. Policy allowlist, registry and README source table updated to match what passed T9 (S9). Route: inline. Status: done, commit 2ee5789 (see L10).
T11. Final report to the maintainer: added, discarded, pending credentials (S2). Route: inline. Status: done, in chat and recorded in the Log (see L10).

## Log

L1. Original request, verbatim: "Aggiungiamo tutte le fonti però per ognuna dobbiamo fare un test per capire se funzionano davvero e poi a fine sviluppo mi fai un report di quelle che hai aggiunto e quelle che hai scartato. Più sono meglio è, sempre per il mercato mondiale con preferenza per Italia, spagna e Europa. Procedi in ODD"

L2. Exploration done before this document (no source write yet). Findings:
- Runner bug confirmed: poc/job-agent/src/run.ts calls `adapter.buildSearchUrl(query, {})`, so the Greenhouse board URL throws "needs a tenant token" and the source is skipped on every run. No test catches it because run.test.ts uses a fake fetch with no board source.
- Policy lists Lever, Ashby and Recruitee as `allowed` in src/policy.ts, but registry.ts has no adapter for them.
- Live probes today (2026-11-14, read-only GET, self-identifying UA, one request per second):
  - Greenhouse, 200: cloudflare 479, gitlab 251, mongodb 390, datadog 384, contentful 46, n26 34, wise 19, celonis 265, sumup 328, adyen 247, elastic 400, typeform 6, cabify 48. 404: hashicorp, mollie, bendingspoons, satispay.
  - Lever, 200: spotify 87, qonto 0 (valid, empty), jobandtalent 32. 404: sumup, pennylane, alan, lemonade.
  - Ashby, 200: openai 839, ramp 180, linear 33, notion 166, vanta 80, replit 30, deel 0, satispay 81, docebo 29.
  - Recruitee, Phase 0 evidence: channable 200 (12 offers).
  - Himalayas `/jobs/api`, 200 JSON, robots allows the path.
  - Jobspresso `/feed/`, 200 RSS, robots allows it.
  - Personio `personio.jobs.personio.de/xml`, 200 XML (its own board, 1 entry at the time).
- Discarded on live probe (reason recorded, not routed around):
  - SmartRecruiters: robots.txt `Disallow: /` (Phase 0 evidence).
  - The Muse: 403 anti-bot page.
  - Startup.jobs, EU-Startups, Jobrapido, Bakeca, Jobware, Jooble.org, Adzuna.it, Personio.com: 403 or 429.
  - Trovalavoro, Remote.co: no answer (000) from this host.
  - EURES: no answer (000) from this host.
  - Justremote, AI-Jobs.net, Jobtome, Bebee, Welcome to the Jungle, Workable.com, Pinpoint, Teamtailor, BambooHR, Cliclavoro, Careerjet.it: HTML pages, no feed.
  - Tecnoempleo `/rss`, Nodesk JSON, RealWorkFromAnywhere: 404.
  - Remotive `/rss`, RemoteOK `/remote-jobs.rss`: 404 or 410 (the JSON API is already implemented).
- Needs credentials (pending, not implemented): Adzuna API, Jooble, InfoJobs (Spain), USAJOBS, Careerjet API, SEEK, Workable with real data.
- Browser-only catalogue entries (StepStone, Computrabajo, Bumeran, Catho, GetOnBoard, Torre, Workday, Dice, Wellfound, Jobstreet, JobsDB, Naukri, Instahyre, Wantedly, Daijob, Saramin, Zhaopin, Bayt, GulfTalent, Dubizzle, Tanqeeb, PNet, CareerJunction, Honeypot, Welcome to the Jungle): no public feed. Automating them is out of scope by S4.
- Verified tenants of Italian/Spanish companies found in this exploration: Satispay (Ashby), Docebo (Ashby), Jobandtalent (Lever), Typeform (Greenhouse), Cabify (Greenhouse).

L3. Route decision: all tasks inline. Each adapter is about 80 lines and the parent holds the whole context; no unit has parallel independence worth a worker.

T10. Policy allowlist, registry and README updated to what passed the probe (S9). Status: done. Commit 2ee5789 (policy), README table in the same commit. Ashby, Remotive and Jobspresso removed from `allowed` (test: test/policy.test.ts, "a source leaves the allowlist...").
T11. Final report to the maintainer (S2). Status: done in chat; this section is its record.

L4. Commits on feat/source-expansion (Conventional, no AI attribution, per the maintainer's CLAUDE.md):
- d7c2fde fix(agent): fetch ATS boards per verified tenant (T1)
- e2292f9 feat(agent): add Lever, Ashby, Recruitee, Personio, Himalayas and Jobspresso adapters (T2, T3, T5, T6, T7, T8)
- 2ee5789 feat(agent): gate the allowlist on a live source probe (T9, T10)
- 8f26a8f fix(agent): follow robots.txt redirects and never follow data redirects (review fix)
Bugs found and fixed on the way, each with a test: the rss guid kept `&amp;` (shared fix for iProgrammatori and We Work Remotely); salaryRange required a currency; Personio's description was read from the whole file, which would have given every position the first one's text; the probe followed data redirects.

L5. Live probe, final run, 2026-11-14, evidence/source-probe/2026-11-14.json (method recorded in the file). 29 URLs probed, 29 `ok`.
- Added (live postings): Greenhouse 16 boards / 3826 postings; Lever 3 boards / 421; Personio 1 / 2; Recruitee 1 / 11 (channable, robots.txt redirects to its own domain, followed per RFC 9309); Himalayas 1 / 20 (the API returns 20 per page); plus the pre-existing public feeds, re-verified: Arbeitnow 300, IProgrammatori 418, Jobicy 50, RemoteOK 97, We Work Remotely 25, Working Nomads 34, Hacker News 20.
- Skipped by the probe because policy is not allowed: Ashby, Remotive, Jobspresso (prohibited now), LinkedIn, Indeed (measurement_only).
- Results of the first run on the same day, for those three, were overwritten by the final run and are recorded here: Ashby, 8 boards: robots.txt of api.ashbyhq.com answers 401, so policy cannot be read, not probed. Remotive: robots.txt `Disallow: /api/*`, the path the adapter reads, blocked_by_robots. Jobspresso: 200 with zero items, verdict empty.
- Rule applied (S9): a source is added only when its probe returns postings. Jobspresso is kept in the code, not in the allowlist.

L6. Known limitation, not fixed in this pass: the runner's page ceiling (`max_pages_per_run`, default 5) caps board tenants too. Greenhouse has 16 verified boards, so one run reaches only the first 5 unless the ceiling is raised. Raising it is a policy decision for the maintainer.
L7. Engram mirror of this document is pending: the Engram write returned `ambiguous_project` (available: jobshell, openjob.dev). Not guessed; the maintainer must choose.
L8. Discarded from the catalogue (reasons in the report): see the final chat report, section "Scartate".

L9. Maintainer decisions, 2026-11-15:
- Page ceiling raised from 5 to 20 (commit a55ddb3). Resolves L6: one run now reaches all 16 verified Greenhouse boards. Pinned by a test in test/run.test.ts.
- Engram project chosen: `jobshell`. The mirror is saved (observation 3926). Resolves L7.
- Maintainer note: the project name `openjob` must no longer appear. Still open: the default paths in src/config.ts (`~/.config/openjob/agent.json`, `openjob-phase0`, `~/.local/share/openjob/evidence`). Changing them moves existing users' config, profile and evidence, so it needs the maintainer's decision. The keyring service `dev.openjob.desktop` stays, as AGENTS.md prescribes.

L10. Integration, 2026-11-15. `feat/source-expansion` merged with `main` on branch `feat/source-expansion-integration` (no conflicts). Evidence on the merged tree:
- poc/job-agent: `tsc --noEmit` clean; `node --test` 353 pass, 0 fail.
- poc/session-poc/ui: `vitest run` 94 pass, 0 fail; `vue-tsc --noEmit` clean.
- poc/session-poc/app (Rust): `cargo test` 63 pass, 0 fail.
Stale status in T10/T11 corrected above. No push. Remaining open item unchanged: the `openjob` default paths (L9).
