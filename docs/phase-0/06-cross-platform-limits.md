# Cross-platform limitations

The requirement is Windows, macOS and Linux. Only macOS arm64 was built and run in Phase 0. Everything else on this page is either a documented constraint of a dependency or an explicit unknown.

## Verified here

| Claim | Evidence |
| --- | --- |
| macOS arm64 release `.app` bundle builds, 17 MB, identifier `dev.openjob.phase0` | `evidence/summary/bundle.json` |
| Desktop shell launches and stays alive | `evidence/summary/desktop-launch.json` |
| SQLite via sqlx, migrations, crash recovery | `evidence/summary/phase1.json`, `evidence/summary/phase2.json` |
| macOS Keychain round trip through `keyring` | `evidence/summary/phase2.json` |
| Playwright + Chrome for Testing 156 headless and headed | `evidence/summary/bench.json` |
| Installed Chrome via `channel: "chrome"` | `evidence/summary/chrome-connect.json` |
| `.app` bundle builds via `make desktop` | `evidence/summary/bundle.json` |
| `.dmg` builds and verifies via `make dmg` (hdiutil, no Finder automation) | `evidence/summary/dmg.json` |

## Not verified — no claim is made

- Windows build, Windows installer, WebView2 behaviour, DPAPI credential storage.
- Linux build, WebKitGTK rendering, `libsecret` availability, AppImage/deb packaging.
- Whether the measured RAM and launch figures transfer to either platform.
- CI. `.github/workflows/ci.yml` exists and encodes the matrix (typescript and rust-core jobs on macOS/Windows/Linux, plus a Tauri shell build on ubuntu), but it has **never run**: the repository has no remote. It is intent, not evidence.

## Per-platform constraints the code must handle

These are properties of the chosen stack, and each one is a place where a macOS-only implementation would break.

**Rust toolchain.** Tauri 2.10+ requires rustc ≥ 1.90; the host's default "stable" was 1.89.0. `scripts/cargo.sh` pins 1.98.1 by putting the toolchain's own `bin` first on `PATH`, because the Homebrew rustup does not act as a proxy. Any CI image must pin the same way.

**Credential storage.** `keyring` 3 maps to Keychain on macOS, DPAPI on Windows and `libsecret`/Secret Service on Linux. The macOS round trip succeeded. On Linux, `libsecret` needs a running secret service; a headless CI container will fail, so the keyring test is `#[ignore]`d and the self-test takes `--skip-keyring`.

**Data directory.** `session_poc_core::default_data_dir` resolves to `~/Library/Application Support/<app>` on macOS, `%LOCALAPPDATA%` on Windows and `$XDG_DATA_HOME` on Linux. Verified only on macOS.

**WebView.** Tauri uses WKWebView on macOS, WebView2 on Windows and WebKitGTK on Linux. The spike's CSP (`default-src 'self'`, no inline script) was written to be portable, but only WKWebView executed it.

**Browser binary.** Playwright ships per-platform Chromium builds. The macOS cache was reused (`chromium-1248`); Windows and Linux need `playwright install` at build time, which means the installer must either bundle the browser or download it on first run — a decision Phase 1 has to make explicitly, because an offline install is otherwise broken.

**Extension loading.** Branded Chrome 156 ignores `--load-extension` (`evidence/summary/chrome-connect.json`). This is a Chrome behaviour, not a macOS one, so it will reproduce on every platform and reinforces the decision to ship Chrome for Testing.

**Path handling.** The project itself lives on a path containing a space (`<external-disk>/...`). Everything worked, but it surfaced one real bug during Phase 0: the process-subtree sampler matched on a *relative* profile path and found nothing. Any path comparison in Phase 1 must resolve to absolute first.

**Disk.** Build artifacts are multi-gigabyte. `CARGO_TARGET_DIR`, `PLAYWRIGHT_BROWSERS_PATH` and the package store are redirected to the project volume; a Windows or Linux developer with a small system partition needs the same redirection.

## What Phase 1 must produce before any cross-platform claim

1. A CI matrix that actually builds `macos-latest`, `windows-latest`, `ubuntu-latest` and runs the Rust tests on each.
2. A Windows run of the ten-step session protocol, because Keychain and DPAPI behave differently under a locked session.
3. A Linux run with `libsecret` present and absent, to confirm graceful degradation of credential storage.
4. Installer artifacts per platform, including the browser-binary strategy.

Until those exist, the honest statement is: the architecture is designed to be portable, and one platform is proven.
