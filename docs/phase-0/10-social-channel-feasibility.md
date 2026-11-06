# Social channel feasibility

Job discovery leaks into social platforms: hiring threads, community boards, Discord job channels, Telegram groups. Each platform has an official access mechanism, and each one restricts automated collection differently. Public visibility is not permission.

The relevant question for this product is narrow: **can the app read posts from an official interface, under terms that allow a desktop client used by one candidate?**

| Platform | Official mechanism | What it permits | What it forbids / costs | Verdict for Phase 1 |
| --- | --- | --- | --- | --- |
| **Reddit** | OAuth Data API (`oauth.reddit.com`) | reading subreddit listings for a registered client; User-Agent must identify the app | approval required; "You cannot use any Reddit developer tools and services for commercial purposes without first getting our permission"; commercial use or use beyond rate limits needs "a separate agreement with Reddit" | **requires approval** — viable later, not Phase 1 |
| **X** | X API, pay-per-use credits | reading posts within purchased quota; per-endpoint pricing | since Feb 2026 new developers default to pay-per-use with no free tier, post reads capped at 2M/month; legacy Basic/Pro only for existing subscribers | **requires commercial agreement** (paid, per-read) |
| **Mastodon** | ActivityPub + `/api/v1/timelines/public` and streaming API | public timelines readable with an app token; `read:statuses` needed where the instance disables public preview | per-instance policy; some instances disable public preview entirely; no central gatekeeper | **usable now** — the only platform where a small client can read public job posts without a commercial contract |
| **Telegram** | Bot API / MTProto client API | a bot reads only channels it was added to; a user client can read what the user is subscribed to | scraping public channels via a bot is not permitted; bot cannot read channels it was not added to | **requires user session** — read-only via the user's own account, per channel opt-in |
| **Discord** | Bot API + Developer Terms | a bot reads messages in guilds it was invited to, with the `message content` intent | needs the guild owner's consent; Developer Terms govern storage and retention | **requires user session** — opt-in per server |
| **GitHub** | REST/GraphQL API with a token | reading public repositories and issues; "Who is Hiring" style repos and issues are ordinary content | rate limits per token; search API has stricter limits | **usable now** |
| **Facebook groups** | Graph API for groups | only for apps with `groups_access_member_info` and an admin-authorized app; group content is otherwise closed | groups are private by design; no general read access for a third-party client | **not currently available** |

## Why Mastodon and GitHub are the only Phase 1 candidates

Both expose public content through a documented API without a commercial contract:

- Mastodon's public timeline endpoint is documented, requires an app token in some configurations, and is governed per instance rather than by a global agreement. A job-search client can follow a curated set of instances and hashtags (`#hiring`, `#job`), which is a legitimate, low-volume discovery channel.
- GitHub's API is the standard interface for repositories that publish job posts as issues. Reading issues from a small set of known repositories is well within documented limits.

Everything else is either a paid contract (X), an approval process (Reddit), a consent-bound private space (Discord, Telegram, Facebook groups), or a platform whose terms prohibit automated collection outright.

## The distinction that keeps this honest

There are three different things a "social channel" could mean:

1. **Reading public posts through a documented API.** Legitimate, rate-limited, attributable. This is what the table above scores.
2. **Reading content the user is already entitled to see, through the user's own authenticated session.** Legitimate as a *user-driven* feature: the app acts as the user's client, one page at a time, with the user watching. It is not a crawler and must not become one.
3. **Scraping public pages at scale without an API.** Not legitimate here regardless of technical ease. Phase 0 did none of it, and the product should not either.

## Recommended Phase 1 scope

- Implement `community` sources for **Mastodon** (curated instances, hashtag timelines) and **GitHub** (a small registry of job-post repositories and issue labels).
- Model Reddit and X as `requires approval` / `requires commercial agreement` in the registry, with the credential slot present and empty.
- Do not implement Discord, Telegram or Facebook groups in Phase 1. If they appear later, they appear as a user-session feature the user enables per channel, never as a background crawler.

## Sources (accessed 2026-11-06)

- https://redditinc.com/policies/data-api-terms
- https://support.reddithelp.com/hc/en-us/articles/14945211791892-Developer-Platform-Accessing-Reddit-Data
- https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy
- https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki
- https://docs.x.com/x-api/getting-started/pricing
- https://docs.joinmastodon.org/methods/timelines/
- https://docs.joinmastodon.org/client/public/
- https://support-dev.discord.com/hc/en-us/articles/8562894815383-Discord-Developer-Terms-of-Service
- https://docs.github.com/en/rest

**Unverified:** exact X per-endpoint prices, current Reddit commercial fee schedule, Telegram's precise stance on bot access to public channels (its terms are enforced by the Bot API's own limits), and Facebook's current group-permission requirements. These are recorded as policy directions, not as numbers.
