# Global source catalogue

Scored for a candidate-side technology-job search. `verified` means Phase 0 actually called the endpoint or read the official developer page; `documented` means the vendor documents it but it was not tested here; `unknown` means no official mechanism was found.

The machine-readable version is [`sources.csv`](sources.csv), which is the seed for the `sources` table in `poc/session-poc/src-tauri/migrations/0001_init.sql`.

## Registry schema (frozen for Phase 1)

| Field | Meaning |
| --- | --- |
| `id` | stable slug, e.g. `greenhouse:stripe` |
| `label` | human name |
| `kind` | `api` \| `ats_feed` \| `browser` \| `community` |
| `regions` | ISO region tags |
| `languages` | primary content languages |
| `auth_mode` | `none` \| `api_key` \| `oauth2` \| `partner` \| `user_session` |
| `reuse_policy` | `open` \| `attribution` \| `restricted` \| `unknown` |
| `rate_limit` | documented limit, or `unknown` |
| `robots_checked_at` | date of the last robots.txt check |
| `evidence_url` | the official developer/terms page |
| `last_verified_at` | date of the last successful probe |

## Europe

| Source | Kind | Coverage / language | Relevance | API | Access / reuse | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| Adzuna | api | UK, DE, NL, FR, IT, ES, PL, AT, BE, BR, CA, AU, NZ, US, SG, IN / local | high — 16-country aggregator | documented (`developer.adzuna.com`), **requires app_id + key** | key, quota; reuse restricted | medium |
| InfoJobs | api | Spain / es | high in Spain | documented (`developer.infojobs.net`), OAuth2 client credentials | requires credentials, Spain only | medium |
| Jooble | api | 60+ countries / local | medium — aggregator | documented (`jooble.org/api/about`), **requires key** | key, quota | medium |
| Greenhouse (EU tenants) | ats_feed | per employer / en, local | high — direct employer postings | **verified** 200, 766/145/399 postings | public feed, terms apply | low |
| Lever (EU tenants) | ats_feed | per employer | high | **verified** 200, 10/305 postings | public feed, terms apply | low |
| Workable | api | global tenants | medium | widget **verified** 200 but empty; real data needs credentials | restricted | medium–high |
| Welcome to the Jungle | browser | France / fr, en | high in FR tech | none found | unknown | high |
| Honeypot | browser | Germany / de, en | medium (tech) | none found | unknown | high |
| StepStone | browser | DE, AT, BE, NL / de | high volume DE | none found (partner only) | restricted | high |
| Bundesagentur für Arbeit (Jobsuche) | api | Germany / de | high volume, public employment service | documented (`jobsuche.api.bund.dev`, community-documented official API) | **unverified** | medium |
| LinkedIn | browser | global | highest relevance, no candidate API | **not currently available** (`07-linkedin-feasibility.md`) | prohibited automation | — |

## North America

| Source | Kind | Coverage / language | Relevance | API | Access / reuse | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| Greenhouse (US tenants) | ats_feed | per employer / en | very high — the default US startup ATS | **verified** | public feed | low |
| Lever (US tenants) | ats_feed | per employer / en | high | **verified** | public feed | low |
| Ashby | ats_feed | per employer / en | high — modern startup ATS | **verified** 200, 821/172/32/84 | public feed | low |
| SmartRecruiters | ats_feed | per employer / en, local | high — enterprise ATS | **verified** 200, 901 postings, but `robots.txt` is `Disallow: /` | policy-disallowed | blocked |
| Workday | browser | per employer / en | very high — enterprise | none public | restricted | high |
| USAJOBS | api | US federal / en | medium (public sector tech) | documented (`developer.usajobs.gov`), free key | key, public domain | low–medium |
| Dice | browser | US / en | medium (tech-specific) | partner only | restricted | high |
| Indeed | browser | US, global | highest volume, no candidate API | **not currently available** (`08-indeed-feasibility.md`) | prohibited automation | — |
| Wellfound (AngelList Talent) | browser | global startups / en | medium–high | none public | restricted | high |

## Latin America

| Source | Kind | Coverage / language | Relevance | API | Access / reuse | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| Computrabajo | browser | MX, CO, AR, CL, PE, EC, PA / es | high volume | none public | restricted | high |
| Bumeran | browser | AR, MX, PE, CL, EC, PA / es | high volume | none public | restricted | high |
| InfoJobs Brasil | browser | BR / pt-BR | medium | none public | restricted | high |
| Catho | browser | BR / pt-BR | high in BR | none public | restricted | high |
| GetOnBoard | browser | LATAM remote / es, en | high for tech | none public | restricted | medium |
| Torre | browser | LATAM, global / es, en | medium | none public | restricted | medium |
| Greenhouse / Lever (LATAM tenants) | ats_feed | per employer | medium | **verified** mechanism | public feed | low |
| LinkedIn | browser | global | highest relevance | **not currently available** | prohibited automation | — |

## Asia-Pacific

| Source | Kind | Coverage / language | Relevance | API | Access / reuse | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| SEEK | api | AU, NZ / en | very high in AU/NZ | documented (`developer.seek.com.au`), **requires approval** | partner agreement | high |
| GradAustralia / Prosple | browser | AU, NZ / en | medium (graduate tech) | none public | restricted | high |
| Jobstreet (SEEK Asia) | browser | MY, SG, PH, ID, VN, TH / local | high volume | none public | restricted | high |
| JobsDB | browser | HK, TH, SG / local | medium | none public | restricted | high |
| Naukri | browser | India / en | very high volume in IN | none public | restricted | high |
| Instahyre | browser | India / en | medium (tech) | none public | restricted | high |
| Wantedly | browser | Japan / ja | medium | none public | restricted | high |
| Daijob | browser | Japan / ja, en | medium (bilingual tech) | none public | restricted | high |
| Saramin | browser | South Korea / ko | high in KR | none public | restricted | high |
| Zhaopin / 51job | browser | China / zh | high volume, heavy restrictions | none public | restricted | high |
| Greenhouse / Lever (APAC tenants) | ats_feed | per employer | medium | **verified** mechanism | public feed | low |

## Middle East

| Source | Kind | Coverage / language | Relevance | API | Access / reuse | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| Bayt | browser | Gulf-wide / en, ar | high volume | none public | restricted | high |
| NaukriGulf | browser | Gulf / en | medium | none public | restricted | high |
| GulfTalent | browser | Gulf / en | medium | none public | restricted | high |
| Dubizzle Jobs | browser | UAE / en, ar | medium | none public | restricted | high |
| Tanqeeb | browser | MENA / ar, en | medium (aggregator) | none public | restricted | high |
| Greenhouse / Lever (Gulf tenants) | ats_feed | per employer | medium — remote-first employers | **verified** mechanism | public feed | low |

## Africa

| Source | Kind | Coverage / language | Relevance | API | Access / reuse | Complexity |
| --- | --- | --- | --- | --- | --- | --- |
| PNet | browser | South Africa / en | high in ZA | none public | restricted | high |
| CareerJunction | browser | South Africa / en | high in ZA | none public | restricted | high |
| OfferZen | browser | South Africa, remote / en | high for tech | none public | restricted | medium |
| Jobberman | browser | Nigeria, Ghana, Kenya / en | high volume | none public | restricted | high |
| BrighterMonday | browser | Kenya, Uganda, Tanzania / en | high volume | none public | restricted | high |
| MyJobMag | browser | Nigeria, Kenya / en | medium | none public | restricted | high |
| Greenhouse / Lever (remote-first tenants) | ats_feed | per employer | medium — many remote roles hire across Africa | **verified** mechanism | public feed | low |

## Company career pages and ATS as a channel

The single most under-rated finding: for technology roles, the highest-quality postings are not on job boards, they are on employer ATS feeds. Five of the six probed ATS platforms answered without credentials (`11-api-integration-matrix.md`). A registry of employer tenants converts "search a job board" into "search the companies you care about", with no aggregator in between and no ToS ambiguity about the postings themselves.

## What is not in this catalogue, and why

- **Any source whose only access is scraping.** Public visibility is not permission. Where no official mechanism exists, the row says `none public` and the integration is a browser workflow the user drives, not a crawler.
- **Volume figures.** Almost no source publishes job counts. Where a number appears in `11-api-integration-matrix.md` it is a count returned by an API at a point in time, not a market figure.
- **Per-source terms text.** Each row links the official page; reading and classifying the reuse clause is a Phase 1 task per source, not something to infer here.

## Verification status

Verified by probe: Greenhouse, Lever, Ashby, SmartRecruiters (policy-disallowed), Workable (empty), Recruitee.

Documented but not tested: Adzuna, Jooble, InfoJobs, SEEK, USAJOBS, Bundesagentur für Arbeit.

Unknown: every row marked `none public`. That is an absence of evidence after checking the vendor's own developer pages, not proof that no partner programme exists.
