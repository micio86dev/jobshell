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
- Login-walled networks (LinkedIn, Facebook, Instagram, X) are blocked for the research tools and never read. A pasted link must be a public https name: addresses in any notation, local suffixes, names that stand for an address and a trailing dot on a blocked host are refused, and a redirect is never followed. (A public name that a resolver points at a private address is not detected.)
- The company website is accepted only when a page of that site was read in full, names the company, and the domain looks like the company's name; a news site or a directory is never "the company site". A contact must be on that site, at that domain, in words that name the person and a role the search is for; a profile on someone else's page must tie the person to the company in the quoted words.
- A failed automatic search leaves its reason on the settings page, and the file the identity replaces is kept beside it once as `profile.json.bak`.

## Run it

Desktop app: open **Clienti**, press **Cerca clienti ora** (or the dry run, which buys nothing). **Diagnostica** says why each run gave what it gave. **Impostazioni → Ricerca clienti** sets the threshold, the budgets, the preferred countries and the schedule (off by default; it runs while the app is open and notifies on new clients).

Command line, from `poc/job-agent`:

```bash
node src/leads/cli.ts --profile <profile.json> [--dry-run] [--sources a,b] [--strategy leads.json]
make leads-eval PROFILE=<profile.json>      # the real judge on the ten scenarios
```

The strategy file is `~/.config/jobshell/leads.json`; see `poc/job-agent/leads.example.json`. Only the fields you set are stored; the rest follows the profile.

## Your subscription instead of an API key

In **Impostazioni → Servizio AI** the provider list has a second group: the programs you already use with a subscription (Claude Code, Codex, Gemini CLI, OpenCode). Choosing one makes Jobshell start that program for the text steps and read what it prints. It needs no key from you in this app, and the app never reads, stores or sends your login: the program signs in by itself, from its own place on your computer. It is started with a small environment (no API keys of yours, only what the program needs to find its login), with its tools off or read-only, because the prompt holds text from the web.

| Step | With a subscription program | Needs an API key |
|---|---|---|
| naming companies, outreach drafts, search queries, reports, tailored CV | yes | |
| web research on a company (facts, contacts) | no | Anthropic: the checks need the pages the provider read, and a program prints only its final text |
| reading the CV in the wizard, the job planner | no (the job planner falls back to the profile) | any API provider |
| the judge (Jev) | unchanged: its own key | |

**Terms, from the providers' own pages (read 2026-11-24):**
- **Anthropic** (code.claude.com, "Legal and compliance"): subscription sign-in is for Claude Code and Anthropic's own apps; developers who build products or services, the Agent SDK included, "should use API key authentication", and may not route requests through Free, Pro, Max or Ultra credentials on behalf of users or collect their credentials. The same page says it does not stop a user from signing in to the unmodified Claude Code program with their own subscription. Running `claude -p` from an app sits between the two readings. It is your account and your decision: it is off by default, it is meant for your own use on your own computer, and a build you give to other people should use API keys.
- **Google** (Gemini CLI terms): using "third-party software, tools, or services (for example, using OpenClaw with Gemini CLI OAuth)" to reach the services behind Gemini CLI is a violation. Jobshell starts the program itself and never touches the OAuth login; read the page before you choose it.
- **OpenAI (Codex) and OpenCode:** not verified here; read your plan's terms.

**Verified live on this computer (2026-11-24):** Claude Code on a claude.ai subscription wrote a real report and, in a lead run, planned queries, named 33 companies and drafted 7 outreach messages with no API key and no per-token cost. Codex answered with its usage-limit error and OpenCode with its API-limit error (both are shown to the user as a sentence), and Gemini CLI was not signed in (the app says so). So only Claude Code was seen producing answers.

## Facebook, LinkedIn and anything behind a login

Paste the text of the post (or a public link) in **Aggiungi un cliente a mano**. A link behind a login is refused. The pasted post is judged first in the next run, whatever the budget.

## Privacy

Leads hold company data and public business contacts read from public pages, each with its source. "Forget this company" deletes everything held about it. Leads untouched for a number of days can be purged with the `lead_purge` command, except the ones marked contacted or converted. There is no screen for it yet, and nothing purges by itself. Keys stay in the OS keychain; the CV and the contact details of the user are never sent to the judge or to the research.

## Cost

Measured on the live run of 2026-11-24 (`evidence/leads-live/2026-11-24.json`): 60 judgments used 138,049 judge input tokens (about 2,300 each). The judge's price per token is not published to the app, so no dollar figure is given for it. **Research and drafting were not measured**: the Anthropic account had no credit. From the documented prices (US$10 per 1,000 web searches plus tokens), a researched company is expected to cost on the order of US$0.1 to 0.3 on a Sonnet-class model; that is an estimate, and the run stops researching at the `usd_cap` of the strategy (default US$5). The cost of every run and the cost per qualified lead are recorded in the run and shown in Diagnostica.

## Results and limits, honestly

- **Controlled scenarios** (ten, plus one control), real judge, real profile, no research: 9 of 11 agree, 7 of 9 relevant ones qualify, 2 are held for a second source (research gives it), 0 irrelevant ones qualify (`evidence/leads-eval/2026-11-24-run3-corroboration-rule.json`). The first run missed one (8 of 9) because the profile listed no AI offering; the strategy now derives it from what the CV itself names. Eleven fixtures written by the maintainers are a smoke test, not a benchmark.
- **Live run, signals only** (`evidence/leads-live/2026-11-24.json`): 2,269 signals, 60 judged, 8 qualified, links that answer.
- **Live run with research** (`evidence/leads-live/2026-11-24-with-research.json`, funded Anthropic key): 8 companies researched, 59 facts kept with their page, 32 downgraded to the agent's reading, 7 public contacts kept (founders named on a company page), 10 of 10 outreach drafts accepted, 12 qualified of 60 judged. Total Anthropic cost of the run US$1.83 (631,905 input and 45,228 output tokens, 11 searches), about US$0.15 per qualified lead; the judgment verdicts came from the cache, so the judge cost nothing in that run (the first run of the same 60 used 136,781 judge tokens, unpriced).
- **What the live run taught, and what changed:** a sentence over its limit or a country written in full had cost whole answers (5 of 8): prose is now clipped and a bad item skipped alone. Founders on a directory page were all dropped: a person there now counts when the quoted words name the person, a founder or executive role and the company. Drafts that said "a 20 minute call" were refused: the prompt now forbids durations. Quotes taken from search snippets cannot be checked (the provider returns them encrypted), so about a third of the facts stay as the agent's reading.
- **Limits that remain:** the AI judge is generous with funded product companies that hire employees (the YC ones at 75 points); a second source is required, but "hiring and funded" is not proof they would use a freelancer. No email address was found for any company: the contacts are named founders with the page that names them. Outreach drafts are model text: read one before sending it (every claim of the one checked by hand traced to a stored fact or to the research text).
- Not opened in the desktop window by the maintainers of this change: the screens are checked by type, by tests of their rules, by a successful bundle build, and by starting the desktop binary on a fresh data directory.
