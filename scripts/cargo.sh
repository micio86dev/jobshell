#!/usr/bin/env bash
# Cargo wrapper.
#
# The Homebrew rustup install exposes a real cargo binary (not a rustup proxy)
# and `rustup run` does not rewrite PATH, so `cargo +toolchain`, rust-toolchain.toml
# and `rustup run` are all ineffective here. The active "stable" toolchain is
# 1.89.0, while tauri 2.10 requires >= 1.90. This wrapper puts a pinned toolchain
# first on PATH and runs its cargo, so cargo resolves the matching rustc.
set -euo pipefail
TOOLCHAIN="${OPENJOB_RUST_TOOLCHAIN:-1.98.1-aarch64-apple-darwin}"
BIN="$HOME/.rustup/toolchains/$TOOLCHAIN/bin"
if [ ! -x "$BIN/cargo" ]; then
  echo "cargo wrapper: toolchain not found: $BIN" >&2
  exit 1
fi
export PATH="$BIN:$PATH"
export RUSTUP_TOOLCHAIN="$TOOLCHAIN"
exec "$BIN/cargo" "$@"
