# Changelog

All notable changes to the app are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.1] - 2026-11-13

### Added
- Spanish interface, next to English and Italian. The app follows the system language, or the primary language set in the profile.
- Release builds for macOS, Windows and Linux, attached as a draft GitHub release.

### Fixed
- Release workflow: the UI is built before the desktop app is packaged. The 0.1.0 tag failed on Windows for this reason and never produced a release.

### Notes
- The builds are not code-signed. macOS needs a one-time confirmation on first launch; see the install guide on the website.

## [0.1.0] - 2026-11-13

### Added
- Desktop app for macOS: CV upload (PDF, .txt, .md), a profile filled in by AI, and ranked job postings with the reasons for each match.
- First-run wizard in English, Italian and Spanish, with the missing fields flagged in red.
- Keys in the operating system keychain, read only by the agent.
- Release workflow: a version tag builds the installers for macOS, Windows and Linux.
