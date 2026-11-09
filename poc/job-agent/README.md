# job-agent — Phase 0.5

A background agent that finds job postings for one person, scores them with TypeSafe
Jev, and shows only what clears the user's own threshold. It is a feasibility
experiment with tests, not a product: there is no UI beyond the Tauri spike and no
database yet.

Read `odd/tasks/browser-job-agent.md` for the specs, the tasks and the log.

## What it does, in one paragraph

Once, it turns a profile into a deterministic spec. Every day it fetches the public
feeds, drops what the spec rejects with a reason, and pays for a Jev judgment only on
the survivors. Two postings above 90% is a good day; nothing above 90% is reported as
such. It never solves a CAPTCHA, never rotates a proxy, never reads a cookie, and never
touches a source whose policy forbids automation.

## Setup

Keys live in the macOS keyring, never in a file:

```bash
security add-generic-password -a typesafe -s openjob-agent -w     # required to score
security add-generic-password -a anthropic -s openjob-agent -w    # optional: query planner
security add-generic-password -a qwen -s openjob-agent -w         # or this one
```

`-w` with no value prompts, so the secret never enters argv or shell history.

Configuration is non-secret and optional; a missing file means the documented defaults
(`~/.config/openjob/agent.json`):

```json
{
  "provider": "anthropic",
  "model": "claude-sonnet-4-5",
  "threshold": 0.9,
  "pace_ms_floor": 8000,
  "max_pages_per_run": 5,
  "sources": { "linkedin": { "pace_ms": 20000 } }
}
```

A source override can only **tighten** the guardrail: `{"linkedin": {"automation":
"allowed"}}` is ignored, `{"greenhouse": {"automation": "prohibited"}}` is honoured. A
key that looks like a credential is rejected with a message pointing at the keyring.

## Profile

`profile.json` describes capability, not a list of languages:

```json
{
  "headline": "Backend and desktop developer",
  "capabilities": ["desktop app", "API", "data pipeline"],
  "domains": ["SaaS B2B"],
  "seniority": "senior",
  "years_experience": 12,
  "remote_modes": ["remote", "hybrid"],
  "onsite_cities": ["Milano"],
  "countries": ["IT"],
  "contract_types": ["freelance"],
  "languages": ["it", "en"],
  "min_salary": { "amount": 600, "currency": "EUR", "period": "day" },
  "timezone_overlap_hours": 4,
  "exclude_companies": [],
  "exclude_terms": ["gambling"],
  "accepted_gaps": ["willing to learn Go"],
  "cv": "Twelve years building things. Rust and Python apps with coding agents.",
  "portfolio": "https://example.test/portfolio",
  "threshold": 0.9,
  "daily_cap": 2,
  "scoring_budget": 120
}
```

`accepted_gaps` is the field that lets a posting requiring an unknown language still
score high. The app never decides that for you; you declare it.

`scoring_budget` is the cost ceiling: how many survivors one run may judge. It defaults to
120, and the app always reports "X judged out of Y kept" so a ceiling can never look like
an empty day.

## Running it

```bash
cd "<repo>"

make agent PROFILE=./profile.json DRY=1     # fetch and filter, buy no judgment
make agent PROFILE=./profile.json           # the real daily run
```

A run writes `run-<timestamp>.json` into `evidence_dir` and appends the selected keys
to `seen.json`, so tomorrow does not repeat today. The summary it prints is the same
information.

`DRY=1` is the honest way to measure a source's speed: it records per-source status,
posting count and milliseconds without spending a token.

## The browser extension (session-driven sources)

For LinkedIn, Indeed, StepStone, Tecnoempleo, Subito, Bakeca, the French and German
freelance boards and Facebook groups, there is no permitted feed. The extension is the
only honest path: it reads the page **you** have open, when **you** click.

```bash
make agent-bridge PROFILE=./profile.json     # prints http://127.0.0.1:8787 and a token
```

Then load `poc/job-agent/extension/` as an unpacked extension. On this machine branded
Chrome ignores `--load-extension`, while Chrome for Testing accepts it — that finding is
in `evidence/summary/chrome-connect.json`. Paste the token into the popup once, open a
job page, press **Score this page**: each posting gets a percentage badge and the
popup reports how many were scored.

What it does not do: paginate, navigate, apply, run in the background, or read cookies.

## The agent as an MCP server

Indeed and ZipRecruiter ship MCP connectors that only their own assistant may call. So
the app exposes the part that is ours:

```bash
make agent-mcp PROFILE=./profile.json
```

Tools: `profile`, `score_posting`, `already_seen`. Point any MCP client at it and let
its connectors find postings while this server judges them.

## Policy, and why some sources are skipped

| Mode | Sources | Behaviour |
| --- | --- | --- |
| `allowed` | Greenhouse, Lever, Ashby, Recruitee, RemoteOK, Remotive, Arbeitnow, Jobicy, We Work Remotely, Working Nomads, IProgrammatori, Hacker News | fetched with a human pace floor |
| `measurement_only` | LinkedIn, Indeed, StepStone, Tecnoempleo, Subito, Facebook | **never fetched by the runner**: a command-line flag cannot prove a human is present. Reachable only through the browser extension, where the human clicked |
| `prohibited` | anything else | never fetched |

A challenge (`authwall`, `captcha`, `rate_limited`) stops that source and is recorded.
It is never solved, never retried, never routed around.

## Two decisions the pre-commit review asked for

- **Session-driven sources and `--attended`.** An earlier version let `--attended` unlock
  LinkedIn and Indeed from the CLI. A flag cannot prove a human is present, so the flag is
  gone: those sources are reachable only through the extension. The conservative choice, and
  the one that matches the policy the docs describe.
- **Keys in memory.** `loadRuntime` no longer returns the keys; each entry point reads the one
  it needs at the moment it builds the client, so a long-lived bridge does not hold a secret
  it is not using. The keychain read itself is the mechanism `AGENTS.md` prescribes ("stored
  through the OS keyring"), not a violation of it. The extension keeps its bridge token in
  `chrome.storage.session`, which dies with the browser, instead of `storage.local`.

## Not done

- No posting storage: the funnel keeps nothing across runs except `seen.json`.
- No UI in the Tauri app: the agent is a CLI, a bridge and an MCP server.
- The MCP connectors of Indeed and ZipRecruiter have **not** been probed with a
  third-party client. That is their policy, not a technical question, and it needs the
  maintainer's own account to answer.

## ZipRecruiter (MCP, OAuth with the user's account)

ZipRecruiter publishes a standard MCP endpoint behind OAuth 2.0 with PKCE. Its discovery
metadata advertises `client_id_metadata_document_supported` and **no dynamic registration
endpoint**, so a third-party client identifies itself with a JSON document hosted at a
public HTTPS URL — that URL *is* the client id.

1. Publish `ziprecruiter-client.example.json` at a URL you control, replacing `client_id`
   with that exact URL. The redirect is fixed at `http://127.0.0.1:8788/callback`.
2. In the app, tab **Impostazioni → ZipRecruiter**, paste the URL and press **Collega**.
3. The app opens the consent page, receives the code on the loopback redirect, exchanges it
   with PKCE, and keeps the token in the OS keyring as `ziprecruiter`.

No client secret exists: `token_endpoint_auth_method` is `none`, which is what a desktop app
can honestly use. The token is never written to a file.
