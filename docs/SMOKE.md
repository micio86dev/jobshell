# Smoke test in locale

Two levels: an offline check that needs no network and no keys, then a live check in the app.

## 1. Offline (no network, no keys)

From the repository root:

```bash
make smoke
```

It runs the agent tests (`tsc` plus `node --test`), the UI tests (`vitest`) and the desktop core tests (`cargo test`). Expected output ends with all suites passing: agent 353, UI 94, Rust 63, zero failures.

## 2. Live, in the app

Run the desktop app with hot reload:

```bash
make dev
```

The window opens when the Vite dev server answers on port 1420.

1. **Fonti (Settings tab, sources page):** the sources are listed by group. Companies on public boards (Greenhouse, Lever, Ashby, Recruitee) and public feeds are listed with their switch. LinkedIn and Indeed appear under "Solo estensione": the app never fetches them.
2. **Dry run:** press **Dry run** in the Results tab. It fetches and filters postings and spends no tokens. Afterwards the summary shows how many postings were fetched, kept, and dropped, and why.
3. **Search now:** press **Search now** to judge the kept postings with Jev. This needs the judgment key saved in Settings; without it the run fails with a readable message.
4. **Reading the results:** each selected posting shows its title, company, source, the fit verdict (`fit`, `fit con gap`, `gap non accettato`), the stack stance, and the gaps. Postings above the threshold appear as selected; the rest are counted as below threshold.

What to expect on a quiet day: "Nothing above the threshold" is a valid outcome, not an error. The threshold comes from your profile.

## Where the evidence goes

Each run writes a JSON file under `~/.local/share/jobshell/evidence/`. The Results tab reads the latest one. The file name carries the run timestamp.
