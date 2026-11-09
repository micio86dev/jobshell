# Phase 0.5 — browser job agent

Feasibility experiment: can a background browser agent, driving the user's own logged-in
session (no OAuth per platform), read job postings from LinkedIn, Indeed and other boards
fast enough to be a product, without getting the user's account banned?

## Specs

- **S1** — "voglio un agente che navighi con un browser invisibile in background", driving
  "l'account dell'utente di ogni piattaforma" with no per-platform OAuth app and no
  per-platform API registration.
- **S2** — read postings from "Linkedin, Indeed e altre piattaforme": at minimum LinkedIn,
  Indeed, and the ATS feeds already proven in Phase 0 (Greenhouse, Lever, Ashby, Recruitee).
- **S3** — "prepariamo un modo per mettere le api_key di Qwen o Anthropic e TypeSafe Jev":
  provider selectable, keys stored in the OS keyring, never in a file, never logged.
- **S4** — the user profile holds "CV, portfolio, informazioni utili e logica (del tipo:
  lavoro solo da remoto per aziende solo italiane come freelance)"; the agent searches with
  that logic and keeps postings whose Jev match probability is at least a threshold that
  "ogni utente possa personalizzare", default 90%.
- **S5** — "che non sia una cosa lentissima": every run records per-page latency, launch
  cost, postings found and Jev throughput as evidence.
- **S6** — "senza farci bannare": per-source policy gate, human-paced request floor,
  bounded pages per run, stop at the first challenge/CAPTCHA/429 and report it. No CAPTCHA
  solving, no proxy rotation, no parallel harvesting, no cookie extraction from the user's
  ordinary browser profile.
- **S7** — "rss pubblici, api di annunci pubbliche, senza api_key" are a first-class
  discovery channel. "Senza limiti" is not a property any source offers: every probed
  feed carries terms, attribution or a crawl delay, and the runner honours what it
  publishes.
- **S8** — the session-based path is delivered as a **browser extension in the user's own
  browser**, page-scoped and user-initiated, never as a headless harvester of LinkedIn or
  Indeed. The extension reads the page the user has open, hands the postings to the local
  app, and never reads the cookie store. Bulk pagination, auto-apply and idle harvesting
  stay out: they are what turns assistance into a ban.
- **S9** — a model provider may be used as a **discovery** channel only through its own web
  search / grounding tool, which returns real cited URLs; never as a source of recalled
  postings. Every posting must carry a URL that resolves, or it is discarded.
- **S10** — cost is controlled by **where the model runs**, not by how many postings there
  are. The profile is compiled **once** into a deterministic spec (filters + saved queries +
  Jev questions). The daily loop spends no LLM call: it fetches, filters deterministically,
  then spends Jev only on the survivors.
- **S11** — quality over volume: "meglio 2 annunci al giorno con un ottimo match, che 100
  annunci fuffa". The daily output is capped at a user-set number and contains only postings
  above the user's Jev threshold; a day with nothing above the threshold reports nothing.
- **S12** — a signal is used only if the source publishes it. Freshness, language, remote
  mode and reposts are published and filterable. Applicant count is **not** published by any
  ATS feed, so it is approximated (posting age, repost detection, company size) and labelled
  as an estimate, never presented as a measurement. A missing salary is a risk flag, not a
  rejection.
- **S13** — stack is **not a gate**. "non leghiamoci troppo allo stack classico da
  sviluppatore, dipende dall'annuncio, se è richiesto espressamente o meno". A hard keyword
  filter on languages produces invisible false negatives: it silently drops the "fullstack
  developer, no stack named" posting that may be the best fit of the week. Instead every
  posting carries a **requirement modality** — explicitly required, preferred, absent, or
  mentioned as a tool — extracted semantically on the survivors, and the fit judgment weighs
  it against a capability profile (what the user can deliver, in which domains, with which
  autonomy) rather than against a list of languages. A gap between a stated requirement and
  the user's profile is **disclosed** in the match, never hidden and never scored away.
- **S14** — hard filters are reserved for facts about the posting that need no judgment:
  freshness, language, remote mode, country/contract, exclusions, and salary when published.
  Everything semantic — stack modality, seniority, domain, credibility of the fit — is a
  judgment, and judgments go to Jev with the profile as state.
- **S15** — **MCP connectors are a third acquisition surface**, alongside public feeds and
  the browser extension: Indeed and ZipRecruiter ship official MCP servers over Streamable
  HTTP with the user's own OAuth. They are called by the user's assistant, not by this app,
  so the app's role shifts to what it does best — profile, dedupe, Jev scoring, history.
  The app therefore exposes **its own MCP server** so an assistant can score what it finds.
  Whether those connectors accept a third-party client is a vendor policy question and stays
  **unverified** until probed; the public feeds remain the base, connectors the addition.
- **S16** — the catalogue covers the boards that actually carry IT work, **per language and
  region** (English, Italian, German, French, Spanish), and separates what is ingestable from
  what is only assistable. Community channels — Facebook groups, Discord, Slack — have no
  permitted read path for a third party: they are assist-only, through the extension, on a
  page the user has open.
- **S17** — a source that charges the **candidate** to apply is excluded from the catalogue.
  "Da evitare: Upwork e Workana (si pagano i 'connects' o una commissione sul lavoro),
  Freelancer.com (offerte a pagamento), Fiverr (trattiene il 20% sulle vendite)". The product
  never spends the user's money to let them look at a posting. A marketplace that pays on
  mission completion (Malt, freelance.de) is not the same thing and stays allowed as a
  link-out destination.
- **S18** — "gratis" and "leggibile da un programma" are different properties. The catalogue
  records both, and a source that answers with HTML is assist-only however free it is.

Out of scope for this phase: writing or applying to postings, storing postings in the
product database, the Vue UI, and any automated access to a source whose policy is
`prohibited`.

## Tasks

| ID | Task | Specs | Route | Commit |
| --- | --- | --- | --- | --- |
| T1 | Package skeleton, non-secret config, keyring-backed secrets, per-source policy gate with human-pace limiter | S1, S3, S6 | worker | delivered |
| T2 | Pure source extractors (LinkedIn, Indeed, Greenhouse) + challenge detection, fixture-driven tests | S2, S6 | worker | delivered |
| T3 | Headless persistent-profile browser loader, provider-agnostic LLM planner (Anthropic + Qwen), Jev scoring | S1, S3, S4 | worker | delivered |
| T4 | `run.ts` CLI: policy-gated run, threshold filter, evidence JSON, Makefile target, docs | S4, S5, S6 | worker | delivered |
| T5 | Manual LinkedIn/Indeed run on the maintainer's own session, evidence committed, verdict | S5, S6 | maintainer | **blocked: needs the maintainer's login** |
| T6 | No-key discovery: probe the public RSS/JSON feeds with robots enforcement, register them, add an adapter and evidence | S7 | inline | delivered |
| T7 | Session path as an MV3 extension: page-scoped extractors, localhost bridge, Jev scores shown on the page | S8 | inline | delivered |
| T8 | Optional discovery via a provider's web search/grounding tool, with URL resolution required | S9 | inline | delivered |
| T9 | Profile schema + compiler: questions, validation, and the deterministic spec it compiles to | S10, S11 | inline | delivered |
| T10 | Daily funnel: freshness, language, remote mode, dedupe against what was already shown, cap, Jev on survivors only | S10, S11, S12, S14 | inline | delivered |
| T11 | Requirement modality: extract required/preferred/absent/tool per stack item, seniority and domain on the survivors; disclose the gap in every match | S13 | inline | delivered |
| T12 | Expose the app as an MCP server: `profile`, `score_posting`, `already_seen`, so the user's assistant scores what its connectors find | S15 | inline | delivered |
| T13 | Probe whether the Indeed/ZipRecruiter connectors accept a third-party MCP client; record the answer either way | S15 | inline | **blocked: needs the maintainer's OAuth consent** |
| T14 | Expand the source catalogue per language/region with probe evidence, and mark each entry ingestable or assist-only | S16 | inline | delivered |
| T15 | Catalogue v2: fold in the maintainer's per-language list, apply the no-candidate-pays rule, and record the probe verdict per entry | S16, S17, S18 | inline | delivered |

## Log

- **L1** (maintainer, verbatim): "Voglio che fai lo sviluppo di tutto quanto, per provare a
  vedere se riusciamo a leggere gli annunci da Linkedin, Indeed e altre piattaforme, senza
  però usare OAuth per ogni piattaforma, non voglio creare ogni app sulle piattaforme che
  poi non permettono di fare molto con le loro API, ma voglio un agente che navighi con un
  browser invisibile in background. Usiamo quindi l'account dell'utente di ogni piattaforma,
  prepariamo un modo per mettere le api_key di Qwen o Anthropic e TypeSafe Jev per navigare
  velocemente con l'agente (esistono anche skills ed MCP server utili che possiamo
  sfruttare, così come browser appositi per fare questo lavoro). PROCEDI!"
- **L2** (maintainer, verbatim, product intent): "l'intenzione è comprovare che possiamo
  prendere le informazioni da annunci di lavoro di Linkedin, Indeed e tanti altri portali
  dove ci possono essere annunci di lavoro per informatici e che non sia una cosa
  lentissima, perchè poi l'idea è che un utente nell'app crea il suo profilo con CV,
  portfolio, informazioni utili e logica (del tipo: lavoro solo da remoto per aziende solo
  italiane come freelance) e l'algoritmo si adatta per cercare con quella logica gli annunci
  che hanno un potenziale (calcolato da TypeSafe Jev) almeno del 90% (variabile 90%, che ogni
  utente possa personalizzare). Gli agenti cercano velocemente gli annunci in base al
  profilo utente e fanno i match. Ma prima dobbiamo capire se c'è un modo (senza farci
  bannare dai portali) per prendere link e info degli annunci dai portali di annunci come
  Linkedin e Indeed".
- **L3** (orchestrator, boundary stated before any code): the agent is built; cookie
  extraction from the user's ordinary profile, CAPTCHA solving, proxy rotation and parallel
  harvesting are not, because they are what turns a measurement into an account ban and
  because `AGENTS.md` forbids unauthorised automation of LinkedIn and Indeed. LinkedIn and
  Indeed run in `measurement_only` mode: the user's own session, human pace, stop on
  challenge.
- **L4** (verified 2026-11-08, corrects `docs/phase-0/08`): Indeed ships an official MCP
  server (`docs.indeed.com/mcp/`, updated 2026-09-12) with Job Search, Job Detail, Get
  Resume and Get Company Data over Streamable HTTP with OAuth — but it is documented as
  available "only for Claude Connector", so it is not a product integration path. The
  Indeed Publisher API that used to read postings was retired in 2024.
- **L5** (maintainer, verbatim): "L'agente di ricerca annunci deve riconoscere i captcha o
  altri blocchi e risolverli, deve proprio simulare la navigazione utente senza farsi
  bannare." Answered: recognition is built; solving is not, because it is the strongest
  automation signal and makes a ban more likely, and `AGENTS.md` forbids unauthorised
  automation of LinkedIn and Indeed. The accepted alternative is the attended handoff.
- **L6** (maintainer, verbatim): "rss pubblici, api di annunci pubbliche, senza api_key,
  senza limiti... van bene se sono utili. Secondo me la cosa migliore è: se non possiamo
  proprio simulare la navigazione, chiediamo link e info direttamente alle API di AI dato
  che loro lo fanno già e hanno info utili. Avere anche gli annunci da simulazione
  navigazione ovviamente è una marcia in più non da poco, quindi non la scarterei a meno che
  non sia proprio fattibile in nessun modo, nemmeno facendo un widget per chrome."
- **L7** (orchestrator, position changed on the maintainer's argument): the Chrome
  extension is not a fallback but the best vehicle for the session path — the user's own
  browser, their real fingerprint, their real IP, their own session, and a human who sees
  the page. It is better than a headless crawler on legality posture, detectability, UX and
  engineering cost. Headless harvesting of LinkedIn/Indeed is dropped as the primary path
  and kept only as an optional measurement harness.
- **L8** (probe, 2026-11-08, read-only, self-identifying UA, 1 s apart): five no-key public
  feeds answer 200 — `remoteok.com/api` (623 KB JSON, carries its own API terms),
  `remotive.com/api/remote-jobs` (234 KB), `arbeitnow.com/api/job-board-api` (2.4 MB),
  `weworkremotely.com/categories/remote-programming-jobs.rss` (219 KB RSS),
  `jobicy.com/api/v2/remote-jobs` (45 KB). All five are remote-first boards. Not yet wired
  into `poc/api-probe`, so this is a probe result and not yet a committed artifact.
- **L9** (maintainer, verbatim): "per limitare i costi di qwen o anthropic per la ricerca
  annunci, si profila bene l'utente con CV, eventuale portfolio, altre info che dicevo come:
  cosa cerchi? Lavori solo da remoto o anche ibrido o anche in sede? Inosmma facciamo delle
  domande all'utente per profilarlo molto bene e facciamo una ricerca sugli ultimi annunci,
  non scaduti, senza troppi candidati, nelle lingue che parla l'utente... meglio 2 annunci
  al giorno con un ottimo match, che 100 annunci fuffa, sottopagati, con migliaia di
  candidati e che non valgono nulla."
- **L10** (orchestrator, on L9): the cost argument is accepted and it fixes the architecture
  — the model compiles the profile once, and the daily loop is deterministic plus Jev. Two
  of the requested signals are not published by the free feeds: applicant count (no ATS feed
  carries it) and salary (often absent). They are approximated and labelled, per S12, rather
  than filtered on a number that does not exist.
- **L11** (maintainer, verbatim): "non leghiamoci troppo allo stack classico da sviluppatore,
  dipende dall'annuncio, se è richiesto espressamente o meno. Perchè ormai con i coding agent
  e l'AI ci stiamo slegando molto dallo stack di linguaggi e frameworks. Ci serve qualcosa di
  più generico e fare il match in modo intelligente. Ci sono anche annunci dove richiedono
  Programmatore fullstack ad esempio, senza stack preciso perchè io faccio app in rust o
  python senza conoscerli, tanto ci sono gli agenti di coding che scrivono il codice ormai."
- **L12** (orchestrator, on L11): the anti-gate argument is accepted and the stack prefilter
  is removed from the funnel. The stronger claim — that stack no longer matters — is not
  accepted: most postings still name required languages and a recruiter screens on them, so
  the honest model is modality (required / preferred / absent / tool) plus a disclosed gap,
  not a binary. This moves stack from the deterministic layer to the judgment layer (S13,
  S14), which costs nothing extra because it runs on the same survivors as Jev.
- **L13** (maintainer, verbatim): "ZipRecruiter ad sempio viene usato da Claude per fare
  ricerche simili, penso sia un MCP server che Claude usa"
- **L14** (verified 2026-11-08, corrects an earlier orchestrator verdict): ZipRecruiter runs
  an official MCP server at `https://api.ziprecruiter.com/mcp`, Streamable HTTP, OAuth,
  announced 2026-06-09 with the Claude connector; tools cover search by title, company,
  location, salary, distance, work style, employment type and posting date, plus job detail.
  The earlier "no" was based on `jobs.rss` returning 403 and on the employer-side partner
  API — a partial reading. Same shape as Indeed's connector.
- **L15** (maintainer, verbatim): "ci sono vari siti di annunci che offrono anche lavori eh,
  come bakeka.it in italia, indeed, monster... ricerca le piattaforme che funzionano meglio
  per gli informatici, non tralasciare gruppi facebook, gruppi per informatici... le lingue
  più usate per i lavori informatici come: inglese, spagnolo, italiano, tedesco, francese..."
- **L16** (probe, 2026-11-08, read-only, self-identifying UA, 1 s apart): bakeka.it 403,
  monster.it 403, monster.com 403, subito.it job path 404, Arbeitsagentur Jobsuche 403 even
  with the community client id, tecnoempleo.com 200 HTML with no RSS link, stepstone.de 200
  HTML, infojobs.it 200 with a near-empty page, HN Algolia `who is hiring` 200 JSON with no
  key. Verdict: the bot-blocked classifieds are not integrable; the boards that answer serve
  HTML and need the extension, not a feed.
- **L17** (maintainer, verbatim, the normative part of a per-language list): "Da evitare:
  Upwork e Workana (si pagano i 'connects' o una commissione sul lavoro), Freelancer.com
  (offerte a pagamento), Fiverr (trattiene il 20% sulle vendite). Jobleads l'hai già escluso."
- **L18** (probe, 2026-11-08, same method): of the maintainer's list, 200 with HTML —
  reteinformaticalavoro.it, getonbrd.com, free-work.com, freelancermap.de, freelance.de,
  join.com, wellfound.com, welcometothejungle.com, infojobs.net; 403 — jobgether.com,
  malt.fr, it.jooble.org, apec.fr; infojobs.it answers with a 3.9 KB shell. RSS discovery:
  freelancermap.de advertises `application/rss+xml` at
  `/feeds/projekte/int-international.xml`, but that URL answers **404**, so the advertised
  feed is dead; reteinformaticalavoro, free-work, freelance.de and Welcome to the Jungle
  publish no feed at all. Verdict: the list is a strong assist-only catalogue, not an
  ingestion catalogue, and the one feed it promised does not exist today.
- **L19** (delivery, 2026-11-08): every task above except T5 and T13 is implemented and
  covered by tests. Final state: `make test` runs 65 TypeScript tests, 14 Rust tests and
  102 agent tests plus the wiring check; `tsc --noEmit` is clean on `poc/job-agent`. T5 is
  blocked on a manual login in a dedicated browser profile; T13 is blocked on an OAuth
  consent only the maintainer can give.
- **L20** (pre-commit review, 2026-11-08): the first commit attempt was **rejected** by the
  review hook. Findings fixed: unvalidated API strings cast into `StackStance`/`FitVerdict`;
  an MCP frame cast instead of validated, and notifications answered (which clients reject);
  `let response` without a type; `arg('config') as string` in three entry points; an unchecked
  `--port`; a default source list that included `greenhouse`, whose adapter throws without a
  tenant, outside any `try`; and an extension badge matched by URL prefix, so
  `/jobs/view/12` could receive the score of `/jobs/view/123`. Decisions taken: `--attended`
  **removed** (a flag cannot prove a human is present, so session-driven sources are reachable
  only through the extension); keys are read at the point of use instead of being held by the
  loader; the extension token moved to `chrome.storage.session`. Also fixed: `base_url` was
  validated and never used.
- **L21** (native review, 2026-11-08): `review-9b2198c0cac92c38` on the range
  `dedff3bb..HEAD` — tier high, lenses risk + resilience, 1,459 changed lines. Outcome
  **approved**; authority burned (`gentle-ai.review-acknowledged/v1`); delivery follows
  ordinary repository policy. One CRITICAL finding, **R4-001**, was real and is fixed in
  `1117d26`: `readSeen` swallowed every error on the explicit `--seen` path, so a corrupt
  file silently reset the user's dedupe state. Five non-blocking advisories remain as
  separate later work, never a reason to re-run this review: R4-002 and R4-003 on
  `src/bridge.ts:80-91`, R4-004 on `src/bridge.ts:179`, R4-005 on `extension/content.js:8`,
  R4-006 on `src/mcp-cli.ts:56`.
- **L22** (advisories, 2026-11-08): the five non-blocking findings from the approved review
  are fixed in a separate commit, never by re-running that review. R4-002/R4-003
  (`bridge.ts:80-91`): one failed judgment aborted the whole batch, so the extension got a
  400 and zero results, and the judgments ran strictly in series — now bounded concurrency
  (4) with per-posting isolation, and the response carries `errors[]` beside `results[]`.
  R4-004 (`bridge.ts:179`): `server.listen` had no `error` handler, so a busy port left the
  promise unsettled and the CLI hanging silently — now it rejects with the port named.
  R4-005 (`extension/content.js:8`): the bridge URL was hardcoded to port 8787, so a bridge
  started with `--port` failed without saying so — the popup now sends the URL with the
  click. R4-006 (`mcp-cli.ts:56`): the seen memory was snapshotted at startup, so
  `already_seen` answered "unseen" for everything scored during the session — it is now read
  at call time.
