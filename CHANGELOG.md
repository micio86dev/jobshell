# Changelog

All notable changes to the app are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-15

### Added
- Sources page in Settings: every source with an on/off switch, grouped by what it is (companies, public feeds, own account, extension only, not available), with a search and a summary.
- Company boards: add your own employer to Greenhouse, Lever, Recruitee or Personio, and remove it again. Employer ids are checked before they are saved.
- Board sources: Greenhouse (16 verified boards), Lever, Recruitee and Personio, plus the public feed Himalayas. Each one is probed live before it is allowed.

### Changed
- Local data folders now use the name Jobshell: `~/.config/jobshell/agent.json`, `~/Library/Application Support/jobshell/` (agent profile, desktop data) and `~/.local/share/jobshell/evidence`. Data in the old `openjob` folders is no longer read: move it once.
- The keychain service `dev.openjob.desktop` and the bundle identifier `dev.openjob.phase0` keep their names, so saved keys and updates still work.

### Fixed
- Greenhouse boards were never fetched: the runner did not pass the employer to the board adapter.
- Remotive is no longer fetched: its robots.txt disallows the API path the agent reads.

## [Unreleased]

### Added
- Clienti tab: the app looks for companies that may need outside engineers, researches them, scores them out of 100 with every line explained, and shows only the ones worth your time, each with its evidence, its public contacts, a next step and an outreach draft. Nothing is sent: the drafts are for you to copy.
- Decisions on each lead: interesting, not interesting, already contacted, later, became a client. They are kept as a log, so any of them can be undone.
- Diagnostica tab: for every search, the sources that answered or failed, the funnel, why companies were not shown, the errors and the cost. An empty result always says why.
- Five signal sources, each probed first: Hacker News "Who is hiring" and the YC jobs, funding news from TechCrunch and Sifted, and Y Combinator companies that are hiring.
- Paste a post or a public link to add a lead by hand (for Facebook groups and other places the agent never logs in to).
- Automatic search on a schedule you choose (off by default), one search at a time, with a notification when there are new clients.
- Settings: minimum score, evidence floor, budgets, spending cap and preferred countries for the client search.
- `make leads-eval`: the real judge on ten controlled scenarios.

- Use your own subscription instead of an API key for everything: Claude Code, Codex, Gemini CLI or OpenCode, chosen once in the first step of the wizard (and changeable in Settings). The CV reader, the job planner, reports, the judge, the company research and the drafts all run on it. The app starts the program you already signed in to and never touches your login. Check your plan's terms (see docs/leads.md).
- The judge can be "the same as the AI service": the chosen model answers the seven questions, so no TypeSafe key is needed.
- The sources of the client search appear on the Sources page and can be switched off one by one.
- Learn from your decisions (off by default): sources whose leads you usually want are judged first when the budget is short. Nothing is hidden, and the page shows every number; turn it off and the order is back.
- Diagnostica shows your time: minutes spent on leads, the ones you decided on and wanted, and wanted opportunities per hour of your time.
- Settings: delete the leads you never acted on that are older than a number of days.
- A program with no web search (Gemini CLI, OpenCode) is asked, without tools, for the company's site when it is not known.
- The cost of a run is also shown per qualified lead, and opening a lead's evidence scrolls to it.

### Fixed
- Saving the search settings failed on a fresh install, before the first search.
- "Forget this company" and "Delete old leads" did nothing in the desktop window: the native confirm dialog does not appear there. They now ask inside the page.
- A search could spend 20 minutes naming companies with a subscription program: signals the free filters drop are no longer sent for naming, and the number is bounded.
- A search that was stopped from outside now says so instead of showing an empty reason, and a run on a subscription no longer says "nothing was bought".

### Changed
- "Search now" and the reports now use the profile you saved in the wizard, not the starter profile the app wrote on first launch.
- The query planner follows the provider and model chosen in Settings.
- CI runs the job agent and the UI tests.

### Needs
- Company research, contact discovery and outreach drafting need an Anthropic key with credit (Settings, or the keychain account `anthropic`). They were run live once: 8 companies, 7 founders named with their page, 10 drafts, about US$0.15 per qualified lead.

## [0.2.1] - 2026-11-14

### Added
- Settings: choose the match threshold as a percentage, from 1% to 100%. It defaults to 70%, and it applies to the next search.

## [0.2.0] - 2026-11-14

### Added
- Choose the AI provider for reading CVs and searching: Anthropic, OpenAI, Gemini or Qwen, and the model for it. The model list comes from the provider with your key.
- Choose the judgment service: TypeSafe Jev, Ollama on this machine, or Laya at an address you name.
- Verifica checks each key with its provider without spending tokens: valid, rejected (wrong, expired or revoked), or not verified.
- Keys for OpenAI and Gemini in Settings, next to the others. Keys stay in the OS keychain, and an address is only used when it is HTTPS on an approved host or on this machine.

### Fixed
- A refused key says so and names the provider, instead of "provider answered 401".
- A network failure while planning a search falls back instead of stopping the run.

## [0.1.9] - 2026-11-14

### Added
- Settings: a Verifica button next to each API key checks it with its provider, without spending tokens. It tells whether the key is valid, rejected (wrong, expired or revoked) or could not be verified. The answer is validated before it is shown.

## [0.1.8] - 2026-11-14

### Added
- Settings: a Verifica button next to each API key checks it with its provider, without spending tokens. It tells whether the key is valid, rejected (wrong, expired or revoked) or could not be verified.

## [0.1.7] - 2026-11-14

### Changed
- Lint and strict checks run on every change: ESLint covers every TypeScript and Vue file, clippy runs with warnings as errors, and `make test` runs them with the typecheck and the UI tests.
- The project no longer tracks its local harness state.

## [0.1.6] - 2026-11-14

### Changed
- The app and the website are renamed Jobshell (formerly openjob). The keychain service, the bundle identifier and the local data folders keep their names, so saved keys and data still work.

## [0.1.5] - 2026-11-13

### Fixed
- PDF CVs fail no more with "undefined is not a function": the PDF is read by the agent, outside the webview.
- Checking a portfolio link and saving the profile failed with "starting an agent script" when the app was opened from Finder: the Node binary is now looked up in the usual places (Homebrew, nvm).
- The competences field, the country picker and the language rows: selects have the same height as the text fields, the countries stack, and the remove button is a red bin icon on the right.

## [0.1.4] - 2026-11-13

### Changed
- The download site is published automatically when a release is published, and shows the version of that release. The app itself has no changes since 0.1.3.

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
