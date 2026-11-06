# API integration matrix

Read-only probes of the documented endpoints, run on 2026-11-06 with a self-identifying user agent (`openjob-phase0-probe`), 1200 ms between requests and a 20 s timeout. No credentials, no keys, no writes.

Artifact: `evidence/summary/api-probes.json` (per-attempt URL, status, payload shape, posting counts, robots.txt status and `Disallow` lines).

## Result

| Source | Endpoint (documented) | Status observed | Postings seen | Credentials? | Verdict |
| --- | --- | --- | --- | --- | --- |
| Greenhouse | `boards-api.greenhouse.io/v1/boards/{token}/jobs?content=true` | 200 / 200 / 404 / 200 | 766, 145, 396 | none | **usable now** |
| Lever | `api.lever.co/v0/postings/{token}?mode=json` | 200 / 200 / 404 / 404 | 10, 305 | none | **usable now** |
| Ashby | `api.ashbyhq.com/posting-api/job-board/{token}` | 200 ×4 | 822, 171, 32, 84 | none | **usable now** |
| SmartRecruiters | `api.smartrecruiters.com/v1/companies/{token}/postings` | 200 ×3 | 902, 0, 0 | none | **usable now**, tenant id matters |
| Recruitee | `{tenant}.recruitee.com/api/offers/` | 404 / 200 / 404 | 12 | none | **usable now**, per-tenant origin |
| Workable | `apply.workable.com/api/v1/widget/accounts/{token}?details=true` | 200 ×3 | 0, 0, 0 | none for the widget, but empty | **requires credentials** for real data |
| Adzuna | documented app id + key | not attempted | — | app_id + app_key | **requires credentials** |
| Jooble | documented key | not attempted | — | API key | **requires credentials** |
| InfoJobs | OAuth2 client credentials | not attempted | — | client id + secret, Spain only | **requires credentials** |
| SEEK | developer portal, approval | not attempted | — | approval | **requires approval** |

`404` rows are wrong tenant tokens, not broken endpoints: the same template returned 200 for a valid token in the same batch.

## What each verdict means in practice

**Usable now** means the endpoint answered a plain GET with public data. It does **not** mean the data may be stored and redistributed. Reuse is governed by each vendor's terms, which Phase 0 recorded only as the robots.txt status and any `Disallow` lines; a licence review per source is a Phase 1 task before any posting is cached (`docs/phase-0/13-licensing-review.md`).

**Workable requires credentials** despite answering 200: every tried account returned `{"jobs":[]}`. The recorded payloads are the evidence; no authenticated endpoint was tested, and the report does not claim to know why the array is empty.

**SmartRecruiters tenant ids matter**: `Ubisoft`, `Visa` and `Bosch` returned `totalFound: 0` while `DeliveryHero` returned 902. A tenant registry must store verified ids, never guess them.

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
| SmartRecruiters | medium | pagination, tenant id verification |
| Workable | medium–high | authenticated API needed for real postings |
| Adzuna, Jooble | medium | key required, quota management, aggregator dedupe |
| InfoJobs | medium–high | OAuth2 client credentials, single-country scope |
| SEEK | high | approval, region-specific |

## The pattern that matters for the architecture

Five of the ten sources are the *same* integration shape: an unauthenticated JSON feed per employer. That is not a coincidence — it is the ATS job-board API convention, and it means one `ats_feed` adapter with a per-tenant template covers Greenhouse, Lever, Ashby, SmartRecruiters and Recruitee. The registry should model exactly that: a source kind plus a template plus a tenant list, not ten bespoke clients.

Aggregators (Adzuna, Jooble) and marketplaces (InfoJobs, SEEK) are a different shape: one credential, wide coverage, quota-bound. They belong behind a second adapter kind with credential storage in the OS keyring and per-source rate limiting.

LinkedIn and Indeed are a third shape: no candidate-side access at all (`07-linkedin-feasibility.md`, `08-indeed-feasibility.md`).
