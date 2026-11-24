# Freelance lead agent: discover, research and qualify companies that can buy the user's services

Objective: add a lead pipeline (companies, buying signals, enrichment, contacts, scored qualification, outreach drafts, feedback) beside the job pipeline. Branch: feat/lead-agent (from main). Delivery strategy: ask-on-risk; single feature branch with work-unit commits, no push. Test runners: `make agent-test` (tsc + node --test), `make test-rs`, `make ui-test`, `make test`.
Plan: ~/.claude/plans/ (approved by the maintainer in Plan Mode).

## Specs

S1. Mission: "The user should not have to search for clients. The AI should discover, investigate, evaluate and qualify potential clients autonomously. The user should only have to decide which opportunities are worth contacting."
S2. Metric: "The number of genuinely qualified commercial opportunities per hour of user time invested."
S3. Pipeline: "SOURCE DISCOVERY → COLLECTION → EXTRACTION → NORMALIZATION → DEDUPLICATION → COMPANY IDENTIFICATION → BUSINESS INTELLIGENCE ENRICHMENT → OPPORTUNITY CLASSIFICATION → USER PROFILE MATCHING → COMMERCIAL QUALIFICATION → SCORING → PERSISTENCE → DASHBOARD PRESENTATION". "Keep discovery and qualification logically separate."
S4. Scoring, transparent 100 points: technical and professional relevance 20, B2B collaboration potential 25, commercial potential and company capacity 20, long-term collaboration potential 15, remote and international compatibility 10, overall profile relevance 10. Distinguish profile relevance, company quality, buying intent, evidence confidence, data completeness. "Do not inflate scores".
S5. Not automatic rejections: "No published budget", "No explicit freelance wording", "An hourly contract", "A different programming language", "A company without public financial data". Use confidence levels and explain uncertainty.
S6. Never invent: "Never invent revenue, funding, budgets or financial information." "Do not invent names, email addresses or contact details." Distinguish verified, publicly reported, third-party estimates and AI-generated inferences.
S7. Outreach: "The system must prepare outreach, not send it automatically." Prefer English for international companies; support Italian and Spanish.
S8. Dashboard: only qualified leads in the main view; each lead shows company, website, opportunity, why external development, why the profile matches, signals, contacts, sources, confidence, score explanation, next action, outreach draft. Feedback: "Interesting. Not interesting. Already contacted. Contact later. Converted into a client." Adaptive learning only if transparent and reversible.
S9. Diagnostics: funnel metrics, rejection reasons, errors, durations, costs; "The system must be able to explain why no opportunities were found." "Never hide failures behind an empty dashboard."
S10. Sources: audit, reuse, adapters replaceable; Facebook only by authorized access or "manual assisted-import workflow"; "Do not scrape private groups", "Do not bypass CAPTCHA, authentication restrictions, anti-bot systems or platform access controls."
S11. Browser: independent headless Chromium preferred; never personal Chrome profile; no cookies, passwords or secrets to prompts, logs or telemetry. "Do not introduce browser automation simply for the sake of having it."
S12. Testing: unit, integration, e2e; ten mandatory scenarios on the real profile; "Do not artificially lower thresholds to manufacture success."
S13. Real profile is the primary dataset; repo is public so the committed fixture is redacted (decision of the maintainer: "Locale + redatto"). Live validation where permitted; "Do not fabricate live results".
S14. Cost visibility per run and per qualified lead; reserve expensive AI for semantic work.
S15. Do not send emails, submit applications or contact companies without the user's explicit authorization.

## Tasks

- [ ] T0 (S13) Branch, feature doc, baseline (job-agent 418, vitest 103), redacted fixture, eval skeleton. Route: inline.
- [ ] T1 (S12) Profile bridge fix, planner provider fix, CI runs job-agent + vitest. Risk item 5. Route: inline + verifier.
- [ ] T2 (S3) Lead domain types, company identification, dedup. Route: inline.
- [ ] T3 (S3, S8) Rust migration 0004, lead_store, Tauri commands. Route: inline.
- [ ] T4 (S10) Source probes and adapters, manual import. Route: inline.
- [ ] T5 (S4, S5) Classification, lead-mode filters, verdict cache, planner. Route: inline.
- [ ] T6 (S6) Enrichment, contacts, provenance guards. Route: inline.
- [ ] T7 (S4, S5) Scoring, explanations, gate. Route: inline.
- [ ] T8 (S7, S15) Outreach drafts. Route: inline.
- [ ] T9 (S9, S14) Orchestrator, budgets, cost, diagnostics, CLI, ingest. Route: inline.
- [ ] T10 (S8) UI. Route: inline.
- [ ] T11 (S1) Scheduler, notifications, run lock. Risk item 4. Route: inline + verifier.
- [ ] T12 (S12, S13) Eval, live validation, docs, final report. Route: inline.

## Log

L1 (2026-11-24, user, verbatim opening): "# PROJECT MISSION: BUILD AN AUTONOMOUS AI FREELANCE CLIENT ACQUISITION AGENT … transform the existing application into a highly effective AI-powered freelance client acquisition and business intelligence platform." (full text in the session; Specs above quote it.)
L2 (2026-11-24, decision): profile fixture handling chosen by the maintainer: local real profile for evaluation, redacted copy in the repo.
L3 (2026-11-24, baseline): job-agent 418/418, UI vitest 103/103. Rust baseline running.
