import fs from 'node:fs';
import path from 'node:path';

import { probeBatch } from './lib/http.ts';
import { RUNTIME_REPOS } from './lib/runtimes.ts';

const REPOS = RUNTIME_REPOS;


type Release = { tag: string | null; published_at: string | null; prerelease: boolean | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

const readReleases = (body: unknown): { releases: Release[]; error: string | null } => {
  if (!Array.isArray(body)) {
    return { releases: [], error: isRecord(body) && 'error' in body ? String(body['error']) : 'unexpected body' };
  }
  const releases = asArray(body)
    .filter(isRecord)
    .map((r) => ({
      tag: typeof r['tag_name'] === 'string' ? r['tag_name'] : null,
      published_at: typeof r['published_at'] === 'string' ? r['published_at'] : null,
      prerelease: typeof r['prerelease'] === 'boolean' ? r['prerelease'] : null,
    }));
  return { releases, error: null };
};

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node collect-github.ts <out-dir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const repoResults = await probeBatch(
  REPOS.map((slug) => `https://api.github.com/repos/${slug}`),
  { delayMs: 1200, timeoutMs: 20_000 },
);
const releaseResults = await probeBatch(
  REPOS.map((slug) => `https://api.github.com/repos/${slug}/releases?per_page=10`),
  { delayMs: 1200, timeoutMs: 20_000 },
);

const rows = REPOS.map((slug, index) => {
  const repo = repoResults[index];
  const release = releaseResults[index];
  const body = repo && isRecord(repo.body) ? repo.body : {};
  const parsed = readReleases(release?.body ?? null);
  return {
    slug,
    repo_probe: {
      status: repo?.status ?? null,
      error: repo?.error ?? null,
      elapsed_ms: repo?.elapsed_ms ?? null,
    },
    release_probe: {
      status: release?.status ?? null,
      error: release?.error ?? null,
      body_error: parsed.error,
    },
    stars: typeof body['stargazers_count'] === 'number' ? body['stargazers_count'] : null,
    forks: typeof body['forks_count'] === 'number' ? body['forks_count'] : null,
    open_issues: typeof body['open_issues_count'] === 'number' ? body['open_issues_count'] : null,
    archived: typeof body['archived'] === 'boolean' ? body['archived'] : null,
    license_spdx: isRecord(body['license']) && typeof body['license']['spdx_id'] === 'string'
      ? body['license']['spdx_id']
      : null,
    pushed_at: typeof body['pushed_at'] === 'string' ? body['pushed_at'] : null,
    created_at: typeof body['created_at'] === 'string' ? body['created_at'] : null,
    latest_releases: parsed.releases.slice(0, 5),
  };
});

fs.writeFileSync(path.join(outDir, 'runtimes-github.json'), JSON.stringify(rows, null, 2) + '\n');
for (const row of rows) {
  const latest = row.latest_releases[0];
  console.log(
    [
      row.slug.padEnd(32),
      String(row.stars ?? 'n/a').padStart(7),
      String(row.open_issues ?? 'n/a').padStart(5),
      (row.license_spdx ?? 'n/a').padEnd(12),
      row.pushed_at ?? 'n/a',
      latest ? `${latest.tag} @ ${latest.published_at}` : 'no releases',
    ].join('  '),
  );
}
