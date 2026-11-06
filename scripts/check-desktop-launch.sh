#!/usr/bin/env bash
# Launch the built Tauri spike, prove it stays alive, then stop it.
# Usage: scripts/check-desktop-launch.sh <path-to-binary> <out-dir>
set -euo pipefail
BIN="${1:?binary path required}"
OUT="${2:?output dir required}"
mkdir -p "$OUT"
LOG="$OUT/desktop-launch.log"

"$BIN" > "$LOG" 2>&1 &
PID=$!
sleep 12

if kill -0 "$PID" 2>/dev/null; then
  RSS_KB="$(ps -o rss= -p "$PID" | tr -d ' ')"
  STATE=alive
else
  RSS_KB=0
  STATE=exited
fi

CHILDREN="$(ps -axo pid=,ppid= | awk -v p="$PID" '$2 == p' | wc -l | tr -d ' ')"
kill "$PID" 2>/dev/null || true
wait "$PID" 2>/dev/null || true

printf '{"binary":"%s","state_after_12s":"%s","rss_mb":%s,"child_processes":%s,"log":"%s"}\n' \
  "$BIN" "$STATE" "$(awk -v kb="$RSS_KB" 'BEGIN { printf "%.1f", kb/1024 }')" "$CHILDREN" "$LOG" | tee "$OUT/desktop-launch.json"

[ "$STATE" = "alive" ]
