#!/usr/bin/env bash
# Build a distributable DMG without Finder automation.
#
# Tauri's own DMG bundler runs create-dmg, which shells out to AppleScript to
# arrange the Finder window. That step fails with "AppleEvent timeout (-1712)" on
# any machine that has not granted Automation permission to the calling process,
# which includes this shell and every CI runner. The image itself is fine; only
# the cosmetic window layout needs Finder.
#
# This script builds the same read-only compressed image with hdiutil alone:
# no AppleScript, no Finder, no interactive permission grant, and it verifies.
#
# Usage: scripts/make-dmg.sh <app-bundle> <output.dmg>
set -euo pipefail

APP="${1:?usage: make-dmg.sh <app-bundle> <output.dmg>}"
OUT="${2:?usage: make-dmg.sh <app-bundle> <output.dmg>}"

if [ ! -d "$APP" ]; then
  echo "make-dmg: app bundle not found: $APP" >&2
  exit 1
fi

APP_NAME="$(basename "$APP" .app)"
VOL_NAME="${DMG_VOLUME_NAME:-$APP_NAME}"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/openjob-dmg.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT

mkdir -p "$(dirname "$OUT")"
ditto "$APP" "$STAGE/$APP_NAME.app"
ln -s /Applications "$STAGE/Applications"

rm -f "$OUT"
hdiutil create \
  -volname "$VOL_NAME" \
  -srcfolder "$STAGE" \
  -ov \
  -format UDZO \
  -fs HFS+ \
  "$OUT" >/dev/null

hdiutil verify "$OUT" >/dev/null

BYTES="$(stat -f%z "$OUT" 2>/dev/null || stat -c%s "$OUT")"
printf '{"dmg":"%s","volume":"%s","bytes":%s,"verified":true,"method":"hdiutil UDZO, no Finder automation"}\n' \
  "$OUT" "$VOL_NAME" "$BYTES"
