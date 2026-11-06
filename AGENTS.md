# openjob.dev — coding standards

Project-wide rules for this repository. Phase 0 is a feasibility experiment; product code does not exist yet.

## Language

- Code, comments, identifiers, commit messages, tests, fixtures and repository-facing documentation are written in English.
- Conversation with the maintainer is Italian.

## Evidence over claims

- Every technical claim in `docs/phase-0/` must cite an artifact under `evidence/` (log, JSON, screenshot, `path:line`).
- Unverified statements are labelled `not tested` or `blocked` with the exact error. Nothing is inferred from marketing material.
- Benchmarks report the median of repeated runs and state the sampling method and host state.

## Rust

- Edition 2021, `rustfmt` defaults, `clippy -D warnings` on changed crates.
- No `unwrap()`/`expect()` on paths reachable from user input or I/O; propagate with `thiserror` or return `Result`.
- Blocking work never runs on the async runtime: use `tokio::task::spawn_blocking` or a dedicated thread.
- Secrets are held in memory only for the duration of use and stored through the OS keyring, never in SQLite or files.

## TypeScript

- `strict: true`, `noUncheckedIndexedAccess`, no `any`, no non-null assertions without a comment justifying them.
- Vue 3 `<script setup lang="ts">` only; props and emits typed.
- Runtime input from the Rust side is validated at the boundary (zod or equivalent), not trusted.

## Tests

- Test-first for behaviour with a runnable deterministic test: observe RED, then GREEN, then refactor.
- Each test asserts every observable effect of the rule it covers, through the public interface, never internal storage.
- Fixtures are local and offline; no test depends on a third-party service being available.

## Security

- Never read, print, copy, transmit or commit credentials, `.env` files, keychains, private keys or cookies.
- Never copy or extract cookies from a user's ordinary browser profile.
- LinkedIn and Indeed are never used for unauthorised automation.
- Network probes are read-only, rate-limited and identify themselves.

## Commits

- Conventional Commits. One reviewable work unit per commit, tests and docs alongside the behaviour.
- Work-unit commits on the feature branch are part of authorized implementation; push, PR and merge remain maintainer decisions.
