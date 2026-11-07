#!/usr/bin/env bash
# Static wiring check between the Vue UI and the Rust command registry.
#
# The UI calls commands by name through `invoke`. Nothing in the type system
# connects those strings to `generate_handler!`, so a rename on either side is a
# runtime error and a green build. This check fails the build instead.
#
# Read-only. Exit 0 means every name the UI calls is registered.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

python3 - <<'PY'
import pathlib
import re
import sys

ui_dir = pathlib.Path('poc/session-poc/ui/src')
main_rs = pathlib.Path('poc/session-poc/app/src/main.rs')

if not ui_dir.is_dir() or not main_rs.is_file():
    print(f'wiring: expected {ui_dir} and {main_rs}')
    sys.exit(1)

# invoke<T>('name', ...) and invoke('name', ...)
call_pattern = re.compile(r"invoke(?:<[^>]*>)?\(\s*['\"]([A-Za-z0-9_]+)['\"]")
called: set[str] = set()
for path in sorted(ui_dir.rglob('*')):
    if path.suffix not in {'.ts', '.vue'}:
        continue
    called.update(call_pattern.findall(path.read_text()))

source = main_rs.read_text()
block = re.search(r'generate_handler!\s*\[(.*?)\]', source, re.S)
if block is None:
    print('wiring: could not find generate_handler![ ... ] in main.rs')
    sys.exit(1)
registered = {name.strip() for name in block.group(1).split(',') if name.strip()}

missing = sorted(called - registered)
unused = sorted(registered - called)

print(f'wiring: UI calls {len(called)}, Rust registers {len(registered)}')
for name in unused:
    print(f'  note: {name} is registered but not called by the UI')
if missing:
    for name in missing:
        print(f'  ERROR: the UI calls {name}, which is not in generate_handler!')
    sys.exit(1)
print('  every command the UI calls is registered')
PY
