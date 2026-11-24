# Lead sources: access, limits and verdicts

Every verdict here cites an artifact. A source is added only after a read-only probe: robots.txt read first, one GET per URL, a self-identifying user agent (`jobshell-job-agent/0.1 (read-only source probe)`), one request every 1.2 seconds, no redirect followed, no credential, no cookie, no browser. The probe is `poc/job-agent/src/leads/source-probe-cli.ts`; its output for these sources is `evidence/source-probe/2026-11-24-leads.json`. The job boards and ATS feeds the agent already read were re-probed the same day: 102 of 102 URLs answered (`evidence/source-probe/2026-11-24.json`).

## Signal sources added for the lead pipeline

| Source | What it gives | Access | Auth | robots.txt | Cost | Pagination | Freshness | Coverage | Signal quality |
|---|---|---|---|---|---|---|---|---|---|
| `hn-hiring` | Companies that wrote a "Who is hiring" line; contract wording marks a request | HN Algolia JSON API: the thread list, then the comment pages of the newest thread | none | `hn.algolia.com` has none (404 = no policy) | free | 200 comments per page, 3 pages at most | the thread of the month, ignored after 40 days | English, worldwide, strong on US and EU startups | high: a company states the need itself. Probe: 92 signals on the first page |
| `hn-jobs` | "X (YC S13) is hiring" posts | same API, `tags=job` | none | same | free | one page of 30 | days | YC companies | medium: names the company, says little else. Probe: 30 signals |
| `techcrunch-startups` | Funding and launch news | public RSS | none | `*` allows the feed (only `/wp-json/`, `/search/` are refused) | free | one feed, about 20 items | hours | global | medium: names the company in the headline about half the time; the rest is named by a model from the text, or left out. Probe: 11 signals |
| `sifted` | European funding news | public RSS | none | `*` refuses only `/inorganic`, `/members/connect` | free | one feed | hours | Europe | medium, same. Probe: 8 signals |
| `yc-hiring` | Y Combinator companies that are hiring, with size and stage | public JSON mirror of the YC directory (`yc-oss.github.io`), refreshed daily | none | github.io: none checked beyond the probe; the YC site itself disallows `/companies?*` and renders by script, so it is not read | free | one 2.5 MB file | daily | global | low alone: a hiring flag is not a request for outside help, so it needs a second source (see below). Probe: 1,414 signals after the filters |

Rate limits are not published in the responses. The runner keeps its own floor: one request per source every 8 seconds, at most 20 pages per source per run (`poc/job-agent/src/policy.ts`), and fewer than ten requests per run for these five sources. Reliability is one probe, one day; it says nothing about next month.

The YC mirror is third-party. Facts taken from it are marked "reported", never "verified".

## Investigated and not added

| Source | Verdict | Evidence |
|---|---|---|
| "Ask HN: Freelancer? Seeking freelancer?" | the thread has not been posted since October 2025, so the newest one is more than a year old | Algolia query in the session log; `poc/job-agent/src/leads/sources.ts` ignores any thread older than 40 days |
| Facebook groups | **manual import only.** Its robots.txt states that "collection of data on Facebook through automated means is prohibited" without written permission | `https://www.facebook.com/robots.txt`, read 2026-11-24. The user pastes the post; the agent does the rest |
| LinkedIn, Indeed | no candidate-side API; session-driven, used only through the browser extension where the user clicks | `docs/phase-0/07-linkedin-feasibility.md`, `08-indeed-feasibility.md` |
| Reddit | public-content policy; automated use needs approval | `docs/phase-0/10-social-channel-feasibility.md`; its robots.txt links the policy. Not implemented |
| Mastodon hashtags (`#hiring`) | reachable (`/api/v1/timelines/tag/hiring` answered 200, robots allows the API), but the posts are personal accounts with rarely a company named. Not implemented: low value for the privacy cost | probe in the session, 2026-11-24 |
| Tech.eu | robots.txt disallows `/feed/` | `https://tech.eu/robots.txt` |
| EU-Startups | 403 to the probe | `evidence/source-probe/`, career-ops catalogue triage |
| Wellfound | robots.txt disallows several job paths; no public feed. Not probed further | `https://wellfound.com/robots.txt` |
| Upwork, Fiverr, Freelancer.com | the freelancer pays to bid: excluded by product rule | `odd/tasks/browser-job-agent.md` S17 |
| Crunchbase and other paid company databases | not tested: a paid API and an account | not tested |
| Search engines, company sites, blogs, filings | reached by the model's own web search and fetch tools during research, with login-walled sites blocked. **Not exercised live:** the Anthropic account has no credit | `poc/job-agent/src/leads/research.ts` |

## Browser automation

No new browser automation was added. The agent reads public feeds with plain GETs, and the research stage uses the provider's server-side search and fetch. The only browser in the product is the one the user opens, with its own profile, to read pages while logged in (the extension). Playwright remains in the Phase 0 experiments only (`docs/phase-0/01-adr-0001-runtime-and-stack.md`).
