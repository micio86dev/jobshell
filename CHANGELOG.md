# Changelog

All notable changes to the app are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.1.3] - 2026-11-13

### Added
- Country picker in the Where step: type a country and pick it from the list. Countries that IT and tech employers hire in come first. An empty list means you work everywhere.
- Competences from the CV and from the portfolio are merged, each kept once.
- The CV is analysed as soon as it is uploaded, and the fields it can fill are filled.
- Pointer cursor and a visible hover on everything clickable, in the app and on the website.
- Favicon for the website.

### Changed
- The Where step lists are compact, with the employee and freelance countries side by side. Language rows show their level and usage on one line.
- The headline field is called "professional title (headline)".
- The portfolio check shows its result next to its button.

### Fixed
- PDF CVs failed to read on some systems: the PDF reader needs hex and base64 conversions the webview may lack. They are now provided where missing.
- A CV file with no readable text is refused with a message next to the upload button, instead of leaving the CV empty.
- The competences field lost the comma as soon as it was typed, so only one competence could be entered.
- The upload button shows the app's own label instead of the system's "Choose File".

## [0.1.2] - 2026-11-13

### Fixed
- Windows and macOS bundles include the `.ico` and `.icns` icons. The 0.1.1 release build failed on Windows without them, so 0.1.1 did not publish a complete release.

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
