# Phase 0 entry points. Every target is reproducible from a clean checkout.
#
#   make test    unit tests for both languages
#   make bench   runtime benchmark (4 adapters x 3 runs)
#   make probe   read-only API probes
#   make phase0  everything above plus persistence and the crash-recovery self-test

SHELL := /bin/bash
ROOT  := $(shell pwd)
OUT   ?= $(ROOT)/evidence/run/$(shell date -u +%Y%m%dT%H%M%SZ)

.PHONY: test test-ts test-rs typecheck bench probe persistence chrome spike desktop phase0 clean

test: test-ts test-rs typecheck

test-ts:
	cd poc/runtime-bench && set -a && . ../../scripts/env.sh && set +a && \
		./node_modules/.bin/tsc --noEmit && node --test "test/*.test.ts"

test-rs:
	cd poc/session-poc/src-tauri && set -a && . ../../../scripts/env.sh && set +a && \
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

bench:
	cd poc/runtime-bench && set -a && . ../../scripts/env.sh && set +a && \
		node src/harness.ts --runs 3 --idle-ms 10000 --out "$(OUT)/bench"

probe:
	cd poc/api-probe && set -a && . ../../scripts/env.sh && set +a && \
		node probe.ts "$(OUT)/api"

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

desktop:
	cd poc/session-poc/ui && set -a && . ../../../scripts/env.sh && set +a && npm run build
	cd poc/session-poc/app && set -a && . ../../../scripts/env.sh && set +a && \
		export PATH="$$HOME/.cargo/bin:$$PATH" && ../../../scripts/cargo.sh tauri build

phase0: test bench probe persistence chrome spike desktop
	@echo "Phase 0 evidence written to $(OUT)"
