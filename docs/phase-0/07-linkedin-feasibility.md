# LinkedIn integration feasibility

Question: can a candidate-side desktop app search LinkedIn jobs through an official interface?

Answer: **no, not today.** Every official LinkedIn hiring integration is employer- or ATS-side, the candidate-facing ones are closed to new partners, and no documented API exposes job search to a third-party candidate application.

Sources were read on 2026-11-06 from `learn.microsoft.com/en-us/linkedin/`, `developer.linkedin.com` and `business.linkedin.com`. Quotes below are from those pages; anything not directly observed is marked **unverified**.

## What exists

| Program | Who it is for | What it does | Candidate-side job search? |
| --- | --- | --- | --- |
| Job Posting API | clients, ATS systems, job distributors | post and manage jobs on LinkedIn on behalf of customers | no |
| Apply Connect | ATS partners | create Apply Connect jobs, collect applications via webhooks | no |
| Recruiter System Connect (RSC / RSC+) | ATS partners | synchronise candidate data with LinkedIn Recruiter | no |
| CRM Connect | CRM vendors | export member profiles to a CRM | no |
| Apply with LinkedIn (AWLI) | career-site partners | shorter application flow on the customer's own site | no |
| Limited Listings / Job Posting Partners | job distributors | extend the reach of customer postings | no |

Every row is a pipeline for an employer to publish jobs or for a recruiter to move candidate data between systems. None of them is a job-search endpoint a candidate application can call.

## Availability, quoted

- Job Posting API: "We are currently not accepting new partnerships for LinkedIn's Job Posting API. If you would like to gain access to LinkedIn's Job Posting APIs please request access to Apply Connect." (`learn.microsoft.com/.../talent/job-postings/api/overview`)
- Apply with LinkedIn: "we are currently not accepting any new partners for Apply with LinkedIn (AWLI). We continue to provide support to our existing partners" (`learn.microsoft.com/.../talent/apply-with-linkedin/apply-with-linkedin`)
- Apply Connect: "Access to this API is restricted to approved developers. Contact your LinkedIn Relationship Manager or Business Development representative" (`learn.microsoft.com/.../talent/apply-connect/create-configure-customer-application`)
- Partner entry point: the ATS partner application page lists the available Talent Solutions integrations and states that LinkedIn prioritises LTS partner integrations that serve its Recruiter and Jobs customers (`business.linkedin.com/talent-solutions/ats-partners/partner-application`).

## OAuth scopes

LinkedIn's consumer APIs are documented by business line. Phase 0 did not find a documented scope set granting a third-party candidate app read access to job postings; the Talent Solutions documentation is organised around partner products with per-partner configuration ("Each application has its own API key and configuration settings"). **Unverified:** the complete scope inventory for a non-partner application, because it is only visible after partner onboarding.

## Five-state verdict

| Capability | Verdict |
| --- | --- |
| Publish a job to LinkedIn from an ATS | requires commercial agreement (existing partners only; new partnerships closed) |
| Collect applications from an Apply Connect job | requires commercial agreement |
| Synchronise candidate records with LinkedIn Recruiter | requires commercial agreement |
| Shorter application flow on a customer career site (AWLI) | not currently available (closed to new partners) |
| Candidate-side job search via an official API | **not currently available** |
| Read public job postings from a signed-in browser session | technically possible (a browser can render the page) — but see below |
| Automate that browser session at scale | prohibited by LinkedIn's user agreement; not pursued |

## What this means for the product

LinkedIn cannot be a Phase 1 *source* through an API. The remaining options, in order of honesty:

1. **Exclude LinkedIn from automated search.** Treat it as a link-out destination: the app shows a LinkedIn job URL found elsewhere and opens it in the user's own browser.
2. **Let the user paste a LinkedIn job URL** and extract the visible posting text with an authorised browser workflow the user drives, one page at a time. This is browser use by a human, not crawling; it still needs a legal review before shipping.
3. **Pursue Apply Connect as a partner** — that is a commercial path with eligibility requirements, a relationship manager, and no candidate-search capability even if granted.

The requirement said LinkedIn "cannot be silently excluded". It is not excluded; it is documented as unavailable for the requested capability, with the commercial path named.

## Blockers to revisit

- Partner eligibility and contract terms are commercial decisions for the maintainer, not technical findings.
- The scope inventory is behind partner onboarding and stays **unverified** until someone applies.

## Sources (accessed 2026-11-06)

- https://business.linkedin.com/talent-solutions/ats-partners/partner-application
- https://developer.linkedin.com/content/developer/global/en_us/index/partner-programs/talent
- https://learn.microsoft.com/en-us/linkedin/
- https://learn.microsoft.com/en-us/linkedin/talent/job-postings/api/overview
- https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-apply-connect-jobs
- https://learn.microsoft.com/en-us/linkedin/talent/apply-connect/create-configure-customer-application
- https://learn.microsoft.com/en-us/linkedin/talent/apply-with-linkedin/apply-with-linkedin
- https://learn.microsoft.com/en-us/linkedin/talent/recruiter-system-connect/recruiter-system-connect
