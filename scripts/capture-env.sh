#!/usr/bin/env bash
# Capture the host state that all Phase 0 measurements depend on.
# Output: evidence/run/<ts>/env.json  (git-ignored, reproducible)
set -euo pipefail
ROOT="${OPENJOB_ROOT:-$(git rev-parse --show-toplevel)}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$ROOT/evidence/run/$TS"
mkdir -p "$OUT"
export TS OUT
cd "$ROOT"

node -e '
const { execSync } = require("node:child_process");
const fs = require("node:fs");
const out = process.env.OUT;
const sh = (c) => { try { return execSync(c, { encoding: "utf8", stdio: ["ignore","pipe","ignore"] }).trim(); } catch { return null; } };
const data = {
  captured_at: new Date().toISOString(),
  ts: process.env.TS,
  host: {
    os: sh("sw_vers -productName"),
    os_version: sh("sw_vers -productVersion"),
    kernel: sh("uname -r"),
    arch: sh("uname -m"),
    model: sh("sysctl -n hw.model"),
    cpu: sh("sysctl -n machdep.cpu.brand_string"),
    cores: Number(sh("sysctl -n hw.ncpu")),
    memory_bytes: Number(sh("sysctl -n hw.memsize")),
  },
  disk: sh("df -h \"$ROOT\""),
  toolchain: {
    node: sh("node --version"),
    pnpm: sh("pnpm --version"),
    rustc_homebrew: sh("rustc --version"),
    cargo_pinned: sh("\"$ROOT/scripts/cargo.sh\" --version"),
    rustc_pinned: sh("\"$ROOT/scripts/cargo.sh\" -V"),
    tauri_cli: sh("~/.cargo/bin/cargo-tauri --version"),
    go: sh("go version"),
    python: sh("python3 --version"),
    sqlite: sh("sqlite3 --version"),
    git: sh("git --version"),
  },
  paths: {
    project_root: ROOT,
    cargo_target_dir: process.env.CARGO_TARGET_DIR || null,
    playwright_browsers_path: process.env.PLAYWRIGHT_BROWSERS_PATH || null,
    system_playwright_cache: sh("ls ~/Library/Caches/ms-playwright 2>/dev/null"),
    chrome: sh("ls -d \"/Applications/Google Chrome.app\" 2>/dev/null"),
  },
};
fs.writeFileSync(out + "/env.json", JSON.stringify(data, null, 2) + "\n");
console.log(out + "/env.json");
console.log(JSON.stringify(data.host));
'
