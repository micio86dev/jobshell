# Indeed integration feasibility

Question: can a candidate-side desktop app search Indeed jobs through an official interface?

Answer: **no.** Indeed's partner APIs are an employer/ATS pipeline. The request explicitly warned against assuming otherwise; the documentation confirms the warning.

Sources read 2026-11-06 from `docs.indeed.com`. Quotes are from those pages; anything not directly observed is marked **unverified**.

## What the API surface actually is

From `docs.indeed.com/api-guides/`:

| API | Direction | Purpose |
| --- | --- | --- |
| Job Sync API | employer → Indeed | create and manage job postings |
| Job Update API | employer → Indeed | list and update postings, clear updates |
| Candidate Sync / Send Candidates | employer → Indeed | send applications and candidate data |
| Retrieve Candidates | Indeed → employer | get candidate information for employers |
| Disposition Sync | employer → Indeed | send application disposition data |
| Hiring Lab API | Indeed → anyone approved | labour-market data for analysis and research |

"Get candidate information from Indeed for employers" is the Retrieve Candidates API's own summary. It is the closest thing to a candidate-data endpoint, and it is scoped to employers receiving applications, not to a candidate searching jobs.

## Onboarding and authentication

- You must be an Indeed partner; Indeed then creates an app in the Partner Console with OAuth credentials ("client ID, secret, and a 3-legged OAuth authorization code") — `docs.indeed.com/getstarted/integrate-and-call-apis`.
- The Job Sync integration guide states that, "based on work with hundreds of partners, this integration usually takes about six weeks", including setup, testing, review with Indeed and deployment.
- All APIs sit under Indeed's "Additional API Terms and Guidelines", accepted by building an integration.

## Five-state verdict

| Capability | Verdict |
| --- | --- |
| Post jobs to Indeed from an ATS | requires approval + commercial agreement |
| Send applications and candidate data to Indeed | requires approval + commercial agreement |
| Retrieve candidate data as an employer | requires approval + commercial agreement |
| Read Indeed's labour-market data (Hiring Lab) | requires approval |
| Candidate-side job search via an official API | **not currently available** |
| Read public job pages from a signed-in browser session | technically possible (a browser renders them) — subject to Indeed's terms |
| Automate that session at scale | not permitted; not pursued |

## "Permitted AI Connectors"

The request names this specifically. Phase 0 found **no** documented Indeed program under that name that grants a candidate-side job-search capability. What exists is a partner programme with employer-side GraphQL APIs and an explicit Additional API Terms document. Anything beyond that is **unverified**, and the honest statement is: no evidence of a candidate-facing AI connector was found on `docs.indeed.com` on 2026-11-06.

## Regional availability

Indeed operates country sites, and the partner documentation describes job sync per country/board. Phase 0 did not verify per-country API coverage; treat regional availability as **unverified** and confirm it during partner onboarding.

## What this means for the product

Same shape as LinkedIn: Indeed cannot be a Phase 1 API source for candidate search. The workable options are:

1. Link-out only: show an Indeed URL found through another channel and let the user open it.
2. A user-driven browser workflow on a single page, with a legal review before shipping.
3. Nothing automated. Indeed's terms are enforced technically as well as contractually, and a blocked account is a real product risk for the user.

## Blockers

- Partner approval and the commercial agreement are maintainer decisions.
- Per-country coverage and any "AI connector" naming stay unverified until someone is inside the partner programme.

## Sources (accessed 2026-11-06)

- https://docs.indeed.com/
- https://docs.indeed.com/getstarted/integrate-and-call-apis
- https://docs.indeed.com/api-guides/
- https://docs.indeed.com/job-sync-api/integrate-with-job-sync-api
- https://docs.indeed.com/retrieve-candidates-api/retrieve-candidates-api-guide
- https://docs.indeed.com/send-candidates-api/send-candidates-api-guide
- https://docs.indeed.com/job-update-api/
