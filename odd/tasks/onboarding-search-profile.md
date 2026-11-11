Feature: first-run onboarding wizard and structured, versioned search profile (spec #30).
Branch: feat/browser-job-agent. Delivery: ask-on-risk (default). Test runner: `make agent-test` (tsc + node --test), `make test-rs`, `make typecheck`.

## Specs
S1. Spec #30 OBJECTIVE, verbatim: "Implement an intuitive, structured onboarding wizard for first-time users." / "Do not rely exclusively on free-text prompts to configure job searches." / "The structured preferences must become deterministic search constraints wherever applicable." / "AI-generated interpretations and free-text instructions must never silently override explicit user selections."
S2. Spec #30 STEP 1 Employment type, verbatim: "Allow users to specify whether each preference is: Mandatory. Preferred. Acceptable."
S3. Spec #30 Work location, verbatim: "If remote is selected, ask for the desired remote scope" / "Do not assume that remote means worldwide."
S4. Spec #30 DETERMINISTIC FILTERING, verbatim: "Soft preferences should influence ranking rather than automatically exclude opportunities." / "If a listing lacks information required to evaluate a constraint, classify it as UNKNOWN and route it to verification when appropriate." / "Never treat UNKNOWN as TRUE."
S5. Spec #30 Languages, verbatim: "A job advertisement written in English must not automatically be rejected because the candidate does not speak fluent English." / "Mandatory language requirements must be respected."
S6. Spec #30 SEARCH PROFILE MODEL, verbatim: "Create a reusable, versioned search profile." / "Changes must be versioned or otherwise traceable so that existing searches and historical results remain understandable." / "Do not silently rewrite historical search results."
S7. Spec #30 Free-text, verbatim: "Never silently convert ambiguous free-text instructions into mandatory constraints."
S8. Spec #30 UX, verbatim: "Make optional fields genuinely optional." / "Use sensible defaults without inventing user preferences."
S9. Spec #30 Editable profile, verbatim: "When a user changes a preference, provide a clear option to apply it to: New searches only. Existing active searches. All future discovery sessions."
S10. Spec #30 Geographic eligibility, verbatim: "Keep employee eligibility separate from contractor eligibility." / "Do not assume that a candidate can legally work for every company offering remote positions."
S11 (planned, not yet implemented): wizard UI, SQLite storage, CV intake, AI interpretation review. See the plan at ~/.claude/plans/pasted-content-id-36f2-30-optimized-toucan.md.

## Tasks
U1 | S1, S2, S4, S8 | inline | done | commit: pending (see Log)  Profile strength (mandatory/preferred/acceptable) with default mandatory; hard/soft split in compileProfile.
U2 | S4 | inline | partial | Done: unknown facts tracked per posting (`needs_verification`), unknown_country/city/contract now in RunEvidence.funnel. Pending: graded language check, employee vs contractor eligibility, remote scope (never defaults to worldwide), soft-preference rank bonus in rankAndCap, salary/seniority checks.
U3 | S6, S9 | pending | pending | SQLite migration 0002, append-only search versions, Rust commands, apply scope.
U4 | S7 | pending | pending | CV/intent interpretation with proposed-only items.
U5 | S1, S8 | pending | pending | Vue wizard, zod boundary, vitest.
U6 | all | pending | pending | Docs and end-to-end evidence.

## Log
L1 (user request, verbatim): "Pasted spec #30: FIRST-RUN ONBOARDING AND STRUCTURED SEARCH PROFILE WIZARD" followed by the full pasted spec (see S1-S10 above for the quoted parts). Plan approved after one decision: storage in SQLite with append-only versions and the TypeScript agent as the single validator.
L2 (process note): this document was created after U1 source edits had started. Those edits were the RED tests in test/profile.test.ts and the GREEN changes in src/profile.ts; the protocol asks for this document before the first source write, so the order was not followed.
L3 U1 evidence: RED observed, 6 new tests failing and 9 passing before the change (TAP output). GREEN: `tsc --noEmit` exit 0; `node --test test/*.test.ts` 144 pass, 0 fail.
L4 U1 differential: profile.example.json compiled with the base commit (git archive HEAD into a mktemp -d scratch) and with the change yields identical Spec.hard, queries, threshold, daily_cap, scoring_budget and prompt_context (32 lines each, exit 0).
L5 U1 scope actually delivered: strengths field and parsing, DEFAULT_STRENGTHS, Spec.soft, prompt-context labels for soft fields. NOT delivered in U1: schema_version, Identity/Eligibility/Compensation split, remote_scope, migrate-on-read adapter. Those stay in U1 follow-up or move to U3.
L7 U2 evidence (partial): RED 3 failing (needs_verification undefined) before change; GREEN `tsc` exit 0, 148 pass, 0 fail. Existing funnel tests unchanged. Diff of funnel.ts only adds tracking; the rewritten one-line counters keep the same control flow.
L8 U2 scope decision: the "route to verification" step is recorded (needs_verification in the evidence); kept postings still go to the judge, unchanged. No verifier consumes the list yet.
L6 Risk U1: item 3 (shared profile parser and Spec shape consumed by mcp-server and bridge). Mitigated by: additive optional field, default preserving behaviour, the differential check above. Not yet run: the mcp/bridge tests were run inside the full suite (pass).
