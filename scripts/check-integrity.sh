#!/usr/bin/env bash
# Read-only integrity check for the workspace.
#
# Motivated by a real incident: the project volume failed `diskutil verifyVolume`
# and one dependency file arrived NUL-filled, which broke `tsc` with bogus syntax
# errors. This script answers one question without touching anything: is the
# content still what it should be?
#
# It never writes to the volume, never mounts or unmounts anything, and never
# repairs. Exit 0 means every check passed.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0

echo "== 1. NUL bytes in text files (source, docs, evidence summaries) =="
python3 - <<'PY' || fail=1
import os, pathlib, sys
TEXT = {
    '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.rs', '.toml', '.sh',
    '.yml', '.yaml', '.csv', '.sql', '.html', '.vue', '.txt', '.lock',
}
SKIP = {'.cache', 'node_modules', '.git', 'dist', 'target'}
scanned = 0
bad = []
for dirpath, dirnames, filenames in os.walk('.'):
    dirnames[:] = [d for d in dirnames if d not in SKIP]
    for name in filenames:
        path = pathlib.Path(dirpath) / name
        if path.suffix not in TEXT and path.name not in {'.gitignore', '.npmrc'}:
            continue
        scanned += 1
        try:
            data = path.read_bytes()
        except OSError as exc:
            bad.append((str(path), f'read error: {exc}'))
            continue
        if b'\x00' in data:
            bad.append((str(path), f'{data.count(0)} NUL in {len(data)} bytes'))
print(f'   scanned {scanned} text files, corrupted {len(bad)}')
for path, why in bad[:20]:
    print(f'   CORRUPT {path}: {why}')
sys.exit(1 if bad else 0)
PY

echo "== 2. Git object database =="
if git fsck --full --no-dangling >/tmp/openjob-fsck.log 2>&1; then
  echo "   git fsck: clean"
else
  echo "   git fsck: FAILED"
  sed -n '1,10p' /tmp/openjob-fsck.log
  fail=1
fi

echo "== 3. Working tree matches HEAD =="
if git diff --quiet && git diff --cached --quiet; then
  echo "   tracked files match HEAD"
else
  echo "   tracked files differ from HEAD (uncommitted work, or damage)"
  git status --short | head -10
  fail=1
fi

echo "== 4. Committed evidence parses =="
python3 - <<'PY' || fail=1
import json, pathlib, sys
bad = []
for path in sorted(pathlib.Path('evidence/summary').glob('*.json')):
    try:
        json.loads(path.read_text())
    except Exception as exc:
        bad.append((path.name, str(exc)))
print(f'   {len(list(pathlib.Path("evidence/summary").glob("*.json")))} artifacts, {len(bad)} unreadable')
for name, why in bad:
    print(f'   CORRUPT {name}: {why}')
sys.exit(1 if bad else 0)
PY

echo "== 5. Dependency trees typecheck =="
set -a; . ./scripts/env.sh; set +a
for project in runtime-bench api-probe session-poc chrome-connect; do
  if [ -x "poc/runtime-bench/node_modules/.bin/tsc" ]; then
    if (cd "poc/$project" && ../runtime-bench/node_modules/.bin/tsc --noEmit >/tmp/openjob-tsc.log 2>&1); then
      echo "   $project: ok"
    else
      echo "   $project: FAILED"
      sed -n '1,5p' /tmp/openjob-tsc.log
      fail=1
    fi
  fi
done

# The desktop UI uses its own toolchain (vue-tsc) and its own node_modules.
if [ -x "poc/session-poc/ui/node_modules/.bin/vue-tsc" ]; then
  if (cd poc/session-poc/ui && ./node_modules/.bin/vue-tsc --noEmit >/tmp/openjob-vuetsc.log 2>&1); then
    echo "   desktop ui: ok"
  else
    echo "   desktop ui: FAILED"
    sed -n '1,5p' /tmp/openjob-vuetsc.log
    fail=1
  fi
fi

echo
if [ "$fail" -eq 0 ]; then
  echo "RESULT: every check passed. Nothing was written, mounted or repaired."
else
  echo "RESULT: at least one check failed — see above."
fi
exit "$fail"
