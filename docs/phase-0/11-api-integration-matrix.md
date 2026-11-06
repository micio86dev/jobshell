# API integration matrix

Read-only probes of the documented endpoints, run on 2026-11-06 with a self-identifying user agent (`openjob-phase0-probe`), 1200 ms between requests and a 20 s timeout. No credentials, no keys, no writes.

`robots.txt` is fetched per origin **before** any content request, parsed (user-agent groups, `Allow`/`Disallow`, `*` and `$`, longest match wins), and a disallowed URL is never requested. The parser has 15 unit tests (`poc/runtime-bench/test/robots.test.ts`).

Artifact: `evidence/summary/api-probes.json` (per-attempt URL, status, payload shape, posting counts, robots.txt status and `Disallow` lines).

## Result

| Source | Endpoint (documented) | Status observed | Postings seen | Credentials? | Verdict |
| --- | --- | --- | --- | --- | --- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | 200 / 200 / 404 / 200 | 766, 145, 399 | none | **usable now** |
| Lever | `api.lever.co/v0/postings/{token}?mode=json` | 200 / 200 / 404 / 404 | 10, 305 | none | **usable now** |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{token}` | 200 ×4 | 821, 172, 32, 84 | none | **usable now** |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{token}/postings` | skipped (robots) | 0 requested | none | **policy-disallowed**: answers 200, but `robots.txt` is `Disallow: /` |
| Recruitee | `{tenant}.recruitee.com/api/offers/` | 404 / 200 / 404 | 12 | none | **usable now**, per-tenant origin |
| Workable | `apply.workable.com/api/v1/widget/accounts/{token}?details=true` | 200 ×3 | 0, 0, 0 | none for the widget, but empty | **requires credentials** for real data |
| Adzuna | documented app id + key | not attempted | — | app_id + app_key | **requires credentials** |
| Jooble | documented key | not attempted | — | API key | **requires credentials** |
| InfoJobs | OAuth2 client credentials | not attempted | — | client id + secret, Spain only | **requires credentials** |
| SEEK | developer portal, approval | not attempted | — | approval | **requires approval** |

`404` rows are wrong tenant tokens, not broken endpoints: the same template returned 200 for a valid token in the same batch, and Lever's 404 body carries an explicit `{ok, error}` payload.

**Posting counts are a point-in-time sample, not a market figure.** They move between runs — an earlier run saw 765 for the same Greenhouse board, and a Lever tenant aborted at the 20 s timeout in two runs and answered 305 postings in this one. The artifact is authoritative; the table is illustrative.

**Crawl-delay is honoured.** When a source publishes one, the delay is `max(1200 ms, crawl_delay)` both between robots fetches and between content requests. RFC 9309 availability rules are applied: a 4xx `robots.txt` (Ashby returns 401) means no published policy and access is allowed; a 5xx or an unreachable `robots.txt` means the origin is treated as fully disallowed, never as permission by default.

## What each verdict means in practice

**Usable now** means the endpoint answered a plain GET with public data. It does **not** mean the data may be stored and redistributed. Reuse is governed by each vendor's terms, which Phase 0 recorded only as the robots.txt status and any `Disallow` lines; a licence review per source is a Phase 1 task before any posting is cached (`docs/phase-0/13-licensing-review.md`).

**Workable requires credentials** despite answering 200: every tried account returned `{"jobs":[]}`. The recorded payloads are the evidence; no authenticated endpoint was tested, and the report does not claim to know why the array is empty.

**SmartRecruiters is the counter-example that proves the rule.** The endpoint answers 200 with 901 postings and needs no credentials — and its `robots.txt` is `Disallow: /` for the whole API host. After robots enforcement was added, the probe skips all three URLs and records them under `skipped_by_robots`. Technically reachable, policy-disallowed: exactly the gap between "public" and "permitted" that this phase had to measure rather than assume.

**SmartRecruiters tenant ids also matter**: `Ubisoft`, `Visa` and `Bosch` returned `totalFound: 0` while `DeliveryHero` returned 901. A tenant registry must store verified ids, never guess them.

**Recruitee gives every tenant its own origin**, so `robots.txt` must be fetched per tenant; the probe does this and records each result.

## Shape of the payloads

- Greenhouse: `{ jobs: [...] }` with full content when `?content=true`.
- Lever: a bare array of postings.
- Ashby: `{ jobs: [...] }`.
- SmartRecruiters: `{ offset, limit, totalFound, content: [...] }` — paginated, so a full sync is a loop.
- Recruitee: `{ offers: [...] }`.
- Workable: `{ name, description, jobs: [...] }`.

## Integration complexity

| Source | Complexity | Reason |
| --- | --- | --- |
| Lever, Ashby | low | one GET, bare array, stable schema |
| Greenhouse | low | one GET, `content=true` gives the description |
| Recruitee | low–medium | per-tenant subdomain, tenant discovery needed |
| SmartRecruiters | blocked by policy | `robots.txt` disallows the API host; would need a written permission |
| Workable | medium–high | authenticated API needed for real postings |
| Adzuna, Jooble | medium | key required, quota management, aggregator dedupe |
| InfoJobs | medium–high | OAuth2 client credentials, single-country scope |
| SEEK | high | approval, region-specific |

## The pattern that matters for the architecture

Five of the ten sources are the *same* integration shape: an unauthenticated JSON feed per employer. That is not a coincidence — it is the ATS job-board API convention, and it means one `ats_feed` adapter with a per-tenant template covers Greenhouse, Lever, Ashby, SmartRecruiters and Recruitee. The registry should model exactly that: a source kind plus a template plus a tenant list, not ten bespoke clients.

Aggregators (Adzuna, Jooble) and marketplaces (InfoJobs, SEEK) are a different shape: one credential, wide coverage, quota-bound. They belong behind a second adapter kind with credential storage in the OS keyring and per-source rate limiting.

LinkedIn and Indeed are a third shape: no candidate-side access at all (`07-linkedin-feasibility.md`, `08-indeed-feasibility.md`).
