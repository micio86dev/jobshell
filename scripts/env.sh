# Phase 0 environment pinning.
#
# The system volume has ~5 GiB free; the project volume has ~47 GiB. Every
# build artifact, browser binary and package store therefore lives in .cache/
# on the project volume. Nothing here is committed (.cache/ is git-ignored).
#
# Usage: `set -a; . ./scripts/env.sh; set +a`

PROJECT_ROOT="<repo>"

export CARGO_TARGET_DIR="$PROJECT_ROOT/.cache/target"
export PLAYWRIGHT_BROWSERS_PATH="$PROJECT_ROOT/.cache/pw-browsers"
export npm_config_store_dir="$PROJECT_ROOT/.cache/pnpm-store"
export PNPM_HOME="$PROJECT_ROOT/.cache/pnpm-home"
export TMPDIR="$PROJECT_ROOT/.cache/tmp"

mkdir -p "$CARGO_TARGET_DIR" "$PLAYWRIGHT_BROWSERS_PATH" "$npm_config_store_dir" "$PNPM_HOME" "$TMPDIR"
