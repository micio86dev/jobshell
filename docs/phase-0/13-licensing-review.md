# Licensing review

Two separate questions: what licence each runtime and dependency carries, and what each data source allows us to do with the postings we read.

## Runtimes and libraries

Verified from the cloned repository's `LICENSE` file at the pinned commit (`evidence/summary/runtimes-raw.json`, `evidence/summary/runtimes-github.json`).

| Component | Version inspected | Licence | Obligations | Notes |
| --- | --- | --- | --- | --- |
| Playwright | 1.64.1 (repo 1.66.0-next) | Apache-2.0 | keep `LICENSE` and `NOTICE`; state changes | ships a `NOTICE` file — must be carried into the bundle |
| Chrome for Testing / Chromium | 156.0.8078.4 | Chromium's BSD-3-Clause plus third-party notices | redistribute the licence files with the browser | a bundled browser means bundling its licence tree |
| agent-browser | 0.41.2 | Apache-2.0 | keep `LICENSE`, `NOTICE` if present | only relevant if used as a fallback driver |
| Browser Harness | 0.1.13 | MIT | keep copyright + permission notice | not a dependency |
| Jev Ultrafast | py `>=3.12` | MIT | keep notice | not a dependency |
| Stagehand | 4.0.0 workspace | MIT | keep notice | not a dependency |
| Tauri | 2.12.5 | MIT or Apache-2.0 (dual) | choose one, keep its notice | Rust crates resolved from crates.io |
| `keyring` | 3.6.3 | MIT or Apache-2.0 | dual-licensed, choose one | |
| `sqlx` | 0.8.6 | MIT or Apache-2.0 | dual-licensed | |
| `tokio` | 1.x | MIT | keep notice | |
| Vue 3 | 3.5.x | MIT | keep notice | |
| Node.js runtime | 24.x | MIT plus third-party notices | bundle the licence tree | a Node sidecar means redistributing Node |

**Practical consequence:** the installer must ship a third-party notices file covering Playwright (Apache-2.0 + NOTICE), Chromium, Node and the Rust/Vue dependency tree. That is a Phase 1 build step, not a legal question.

**Copyleft exposure:** none observed in the selected stack. No GPL/AGPL component was chosen. The Python candidates are MIT, so they remain options.

## Data sources

This is the part that constrains the product, and it is not settled by a licence file. Every source below returned data without credentials, but "readable" is not "redistributable".

| Source | Posting ownership | What we may do with it | Open question |
| --- | --- | --- | --- |
| Greenhouse / Lever / Ashby / SmartRecruiters / Recruitee | the employer's | the feed exists to distribute the employer's own postings publicly, which implies displaying them and linking back | may we cache them locally, and for how long? |
| Workable | the employer's | same intent, but real data needs credentials | which plan grants API access |
| Adzuna | aggregator, licensed from origin | the API terms govern storage, display, attribution and retention | quota and attribution rules per plan |
| Jooble | aggregator | same | same |
| InfoJobs | marketplace | OAuth client terms; Spain only | redistribution of listing text |
| SEEK | marketplace | partner agreement | none before approval |
| Mastodon | the author's | public timeline is public content; each instance sets policy | per-instance rules, attribution |
| GitHub | the repository's | issues are repository content under the repo's licence | none for reading |
| LinkedIn, Indeed | the platform's | no candidate-side access; automation prohibited | none — do not collect |

## Rules Phase 1 must enforce in code

1. **Store a `reuse_policy` per source** and refuse to persist postings from a source whose policy is `unknown` — display them transiently with a link-out instead.
2. **Record `evidence_url` and `last_verified_at` per source**, so a policy change can be traced to the moment it was checked.
3. **Honour `robots.txt`** for any browser-driven source; the probe records `Disallow` lines but does not yet act on them.
4. **Never redistribute posting text in bulk.** The product is a client for one candidate, not a job-data feed.
5. **Attribute and link back** on every displayed posting, for every source that requires it.

## Personal data

CVs and profiles are personal data under GDPR when the user is in the EU. Phase 0's position: everything stays local, no telemetry, no sync, export and delete available. None of that is implemented yet — it is a Phase 1 requirement, listed in `15-phase-1-roadmap.md`.

## Not reviewed here

- Per-source terms text was not read clause by clause; the catalogue links the official page for each and marks the policy as `restricted` or `unknown` until someone does.
- Commercial terms of Adzuna, Jooble, InfoJobs and SEEK depend on a plan the maintainer has not selected.
- Chromium's full third-party licence tree was not enumerated; the bundler will produce it.
