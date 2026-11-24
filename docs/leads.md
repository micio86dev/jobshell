# Client search: how the lead pipeline works

The app has two pipelines. The first matches job postings to the profile. The second, described here, looks for **companies that may buy the user's services** and shows only the few that deserve attention. It runs from the **Clienti** tab, from `make`-free commands, or by itself on a schedule.

## What happens in a run

```
collect → deduplicate → name the company → group by company → free filters → judge → pre-score
       → research (web) → score → gate → outreach draft → store → page
```

| Stage | Who decides | Notes |
|---|---|---|
| collect | code | five signal sources (`docs/lead-sources.md`) plus every allowed job board; a pasted post or public link joins here |
| name the company | a model, checked by code | only when the signal's own words name it; the name and the quote must be in the text |
| free filters | code | drops only what is wrong for any profile: unpaid, internship, junior title, on-site only, closed, stale, excluded company. **No budget, no "freelance" wording, an hourly contract or another stack are never reasons to drop** |
| judge | Jev (TypeSafe System One), one request per company | seven questions: need, B2B conversion, long term, fit, level, remote, quality. A cache avoids paying twice |
| research | Anthropic with web search and fetch, checked by code | company, size, funding, growth, legitimacy, public contacts. **Needs an Anthropic key with credit.** Without it the run says so and scores on the signals alone |
| score | code | 100 points, each line explained, with evidence ids |
| gate | code | score, evidence confidence, no hard negative, no scheme, no recruiter marketing, and a company-level signal needs a second independent source |
| outreach | a model, checked by code | a draft only: nothing in the app sends anything |

## The score

| Line | Points |
|---|---|
| technical and professional relevance | 20 |
| B2B collaboration potential | 25 |
| commercial potential and company capacity | 20 |
| long-term collaboration potential | 15 |
| remote and international compatibility | 10 |
| overall profile relevance | 10 |

Unknown is neutral: a missing fact earns 40% of the capacity line and lowers the **confidence**, never the verdict. The model's own reading earns nothing. Confidence (how sure the judge and the evidence are) and completeness (how many key facts are known) are shown next to the score and are not part of it. The default threshold is 60, set in the strategy; it was not tuned to the scenarios.

## What the guards guarantee

- A **fact** is shown as a fact only when its page was touched by the research and its quote is in that page; a figure's digits must be in its quote. "Verified" needs the company's own site or an official register; anything else is "reported". What fails is kept as the agent's reading and shown apart, never as a fact.
- A **contact** is kept only with its page and the words that show it, and an email must appear letter for letter in the page. Free-mail addresses are dropped. Names must be in the quote.
- An **outreach draft** may cite only facts that carry evidence, may state no number that is not in the evidence, contains no link, and ends with a placeholder signature. Nothing sends it; the database refuses any status other than `draft`.
- The judge's "asks for outside help" is checked against the text: the words must be there.
- Login-walled networks (LinkedIn, Facebook, Instagram, X) are blocked for the research tools and never read.

## Run it

Desktop app: open **Clienti**, press **Cerca clienti ora** (or the dry run, which buys nothing). **Diagnostica** says why each run gave what it gave. **Impostazioni → Ricerca clienti** sets the threshold, the budgets, the preferred countries and the schedule (off by default; it runs while the app is open and notifies on new clients).

Command line, from `poc/job-agent`:

```bash
node src/leads/cli.ts --profile <profile.json> [--dry-run] [--sources a,b] [--strategy leads.json]
make leads-eval PROFILE=<profile.json>      # the real judge on the ten scenarios
```

The strategy file is `~/.config/jobshell/leads.json`; see `poc/job-agent/leads.example.json`. Only the fields you set are stored; the rest follows the profile.

## Facebook, LinkedIn and anything behind a login

Paste the text of the post (or a public link) in **Aggiungi un cliente a mano**. A link behind a login is refused. The pasted post is judged first in the next run, whatever the budget.

## Privacy

Leads hold company data and public business contacts read from public pages, each with its source. "Forget this company" deletes everything held about it. Leads untouched for a number of days can be purged with the `lead_purge` command, except the ones marked contacted or converted. There is no screen for it yet, and nothing purges by itself. Keys stay in the OS keychain; the CV and the contact details of the user are never sent to the judge or to the research.

## Cost

Measured on the live run of 2026-11-24 (`evidence/leads-live/2026-11-24.json`): 60 judgments used 138,049 judge input tokens (about 2,300 each). The judge's price per token is not published to the app, so no dollar figure is given for it. **Research and drafting were not measured**: the Anthropic account had no credit. From the documented prices (US$10 per 1,000 web searches plus tokens), a researched company is expected to cost on the order of US$0.1 to 0.3 on a Sonnet-class model; that is an estimate, and the run stops researching at the `usd_cap` of the strategy (default US$5). The cost of every run and the cost per qualified lead are recorded in the run and shown in Diagnostica.

## Results and limits, honestly

- **Controlled scenarios** (ten, plus one control), real judge, real profile, no research: 9 of 11 agree, 7 of 9 relevant ones qualify, 2 are held for a second source, 0 irrelevant ones qualify (`evidence/leads-eval/2026-11-24-run3-corroboration-rule.json`). The first run missed one (8 of 9) because the profile listed no AI offering; the strategy now derives it from what the CV itself names (run 2: 9 of 9, then the second-source rule held two). Eleven fixtures written by the maintainers are a smoke test, not a benchmark.
- **Live run** on real sources: 2,269 signals, 60 judged, 8 qualified, with links that answer. Several look plausible (a contract role at a company that states it, a freelance Django and LLM role); some are only plausible (a product company hiring employees). **Not exercised live: web research, contact discovery, financial enrichment and outreach drafting**, because the Anthropic account has no credit. Their code is tested against the documented response shapes, not against the real service.
- Not opened in the desktop window by the maintainers of this change: the screens are checked by type, by tests of their rules and by a successful bundle build.
