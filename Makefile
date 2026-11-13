# Phase 0 entry points. Every target is reproducible from a clean checkout.
#
#   make test    unit tests for both languages, typechecks, UI command wiring
#   make bench   runtime benchmark (4 adapters x 3 runs)
#   make probe   read-only API probes
#   make phase0  everything above plus persistence and the crash-recovery self-test

SHELL := /bin/bash
ROOT  := $(shell pwd)
# Immediate expansion: a recursive variable would call date once per target and
# scatter one run across several timestamped directories.
OUT   := $(ROOT)/evidence/run/$(shell date -u +%Y%m%dT%H%M%SZ)

.PHONY: test test-ts test-rs typecheck wiring agent-test ui-test agent agent-bridge agent-mcp bench probe persistence crash soak chrome spike desktop dmg phase0 clean clean-deps

test: test-ts test-rs typecheck wiring agent-test ui-test

test-ts:
	cd poc/runtime-bench && set -a && . ../../scripts/env.sh && set +a && \
		./node_modules/.bin/tsc --noEmit && node --test "test/*.test.ts"

test-rs:
	cd poc/session-poc/src-tauri && set -a && . ../../../scripts/env.sh && set +a && \
		../../../scripts/cargo.sh test
	# The desktop crate embeds the built UI, so its tests need that directory to exist.
	@test -f poc/session-poc/ui/dist/index.html || (cd poc/session-poc/ui && \
		set -a && . ../../../scripts/env.sh && set +a && pnpm run build)
	cd poc/session-poc/app && set -a && . ../../../scripts/env.sh && set +a && \
		../../../scripts/cargo.sh test

typecheck:
	cd poc/api-probe && set -a && . ../../scripts/env.sh && set +a && \
		../runtime-bench/node_modules/.bin/tsc --noEmit
	cd poc/session-poc && set -a && . ../../scripts/env.sh && set +a && \
		../runtime-bench/node_modules/.bin/tsc --noEmit
	cd poc/chrome-connect && set -a && . ../../scripts/env.sh && set +a && \
		../runtime-bench/node_modules/.bin/tsc --noEmit
	cd poc/session-poc/ui && set -a && . ../../../scripts/env.sh && set +a && \
		npm run typecheck

# Every name the Vue UI passes to invoke() must exist in generate_handler!.
wiring:
	./scripts/check-tauri-wiring.sh

# The onboarding wizard's pure rules and boundary schemas: offline vitest.
ui-test:
	cd poc/session-poc/ui && set -a && . ../../../scripts/env.sh && set +a && \
		npx vitest run

# The Phase 0.5 browser job agent: offline tests, then the three entry points.
agent-test:
	cd poc/job-agent && set -a && . ../../scripts/env.sh && set +a && \
		./node_modules/.bin/tsc --noEmit && node --test "test/*.test.ts"

# PROFILE=/path/to/profile.json [DRY=1]
agent:
	@test -n "$(PROFILE)" || (echo "openjob: PROFILE is required."; echo "  make $@ PROFILE=./profile.json"; echo "  a real profile is personal data: copy poc/job-agent/profile.example.json"; exit 2)
	cd poc/job-agent && set -a && . ../../scripts/env.sh && set +a && \
		node src/cli.ts --profile "$(abspath $(PROFILE))" $(if $(DRY),--dry-run,)

# PROFILE=/path/to/profile.json [PORT=8787] [LOG=path.jsonl] — writes the token to a 0600 file.
agent-bridge:
	@test -n "$(PROFILE)" || (echo "openjob: PROFILE is required."; echo "  make $@ PROFILE=./profile.json"; echo "  a real profile is personal data: copy poc/job-agent/profile.example.json"; exit 2)
	cd poc/job-agent && set -a && . ../../scripts/env.sh && set +a && \
		node src/bridge-cli.ts --profile "$(abspath $(PROFILE))" --port $(or $(PORT),8787) $(if $(LOG),--log "$(abspath $(LOG))",)

# PROFILE=/path/to/profile.json — MCP over stdio for the user's own assistant.
agent-mcp:
	@test -n "$(PROFILE)" || (echo "openjob: PROFILE is required."; echo "  make $@ PROFILE=./profile.json"; echo "  a real profile is personal data: copy poc/job-agent/profile.example.json"; exit 2)
	cd poc/job-agent && set -a && . ../../scripts/env.sh && set +a && \
		node src/mcp-cli.ts --profile "$(abspath $(PROFILE))"

bench:
	cd poc/runtime-bench && set -a && . ../../scripts/env.sh && set +a && \
		node src/harness.ts --runs 3 --idle-ms 10000 --out "$(OUT)/bench"

probe:
	cd poc/api-probe && set -a && . ../../scripts/env.sh && set +a && \
		node probe.ts "$(OUT)/api"

crash:
	cd poc/session-poc && set -a && . ../../scripts/env.sh && set +a && \
		node crash-recovery.ts "$(OUT)/crash"

soak:
	cd poc/session-poc && set -a && . ../../scripts/env.sh && set +a && \
		node soak.ts "$(OUT)/soak" --soak-ms 120000

persistence:
	cd poc/session-poc && set -a && . ../../scripts/env.sh && set +a && \
		node persistence.ts "$(OUT)/persistence"

chrome:
	cd poc/chrome-connect && set -a && . ../../scripts/env.sh && set +a && \
		node connect.ts "$(OUT)/chrome"

spike:
	cd poc/session-poc/src-tauri && set -a && . ../../../scripts/env.sh && set +a && \
		../../../scripts/cargo.sh build
	mkdir -p "$(OUT)/spike"
	set -a && . ./scripts/env.sh && set +a && \
		"$$CARGO_TARGET_DIR/debug/session-poc-selftest" --phase crash --data-dir "$(OUT)/spike/data" > "$(OUT)/spike/phase1.json"
	set -a && . ./scripts/env.sh && set +a && \
		"$$CARGO_TARGET_DIR/debug/session-poc-selftest" --phase recover --data-dir "$(OUT)/spike/data" \
			--node "$$(which node)" --sidecar "$(ROOT)/poc/session-poc/sidecar/browser-agent.mjs" \
			--url https://example.com > "$(OUT)/spike/phase2.json"

# Desktop app with hot reload: Tauri starts the Vite dev server (ui/) and opens the window on it.
dev:
	cd poc/session-poc/app && set -a && . ../../../scripts/env.sh && set +a && \
		export PATH="$$HOME/.cargo/bin:$$PATH" && ../../../scripts/cargo.sh tauri dev

# The .app bundle builds. Tauri's own dmg step fails in bundle_dmg.sh on this host
# (evidence/summary/bundle.json), because create-dmg needs Finder Automation permission
# and times out with -1712. `dmg` therefore builds the image with hdiutil alone and is
# green on its own; it stays out of phase0 only because it re-runs the release build.
desktop:
	cd poc/session-poc/ui && set -a && . ../../../scripts/env.sh && set +a && \
		pnpm install --frozen-lockfile && pnpm run build
	cd poc/session-poc/app && set -a && . ../../../scripts/env.sh && set +a && \
		export PATH="$$HOME/.cargo/bin:$$PATH" && ../../../scripts/cargo.sh tauri build --bundles app

# Tauri's own dmg bundler runs create-dmg, which needs Finder Automation
# permission and fails with an AppleEvent timeout (-1712) on this host and on CI.
# scripts/make-dmg.sh builds the same read-only image with hdiutil alone.
dmg: desktop
	mkdir -p "$(OUT)"
	set -a && . ./scripts/env.sh && set +a && \
		./scripts/make-dmg.sh "$$CARGO_TARGET_DIR/release/bundle/macos/openjob-phase0.app" \
			"$(OUT)/openjob-phase0_0.0.0_aarch64.dmg" | tee "$(OUT)/dmg.json"

phase0: test bench probe persistence crash soak chrome spike desktop
	@echo "Phase 0 evidence written to $(OUT)"

# Build outputs only. Evidence under evidence/run/ and the committed summaries are
# never removed, and dependencies are left in place (see clean-deps).
clean:
	set -a && . ./scripts/env.sh && set +a && \
		rm -rf "$$CARGO_TARGET_DIR" poc/session-poc/ui/dist

# Dependencies only: they are reproducible from the lockfiles.
clean-deps:
	rm -rf poc/runtime-bench/node_modules poc/api-probe/node_modules \
		poc/session-poc/node_modules poc/session-poc/ui/node_modules \
		poc/chrome-connect/node_modules poc/agent-browser-probe/node_modules
