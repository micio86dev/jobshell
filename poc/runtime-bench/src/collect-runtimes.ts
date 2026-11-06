import fs from 'node:fs';
import path from 'node:path';

import { findFilesNamed, parseJsonUnknown, run } from './lib/fs-scan.ts';
import { classifyLicense, firstMeaningfulLine } from './lib/licenses.ts';
import { RUNTIME_REPOS, repoName } from './lib/runtimes.ts';
import {
  parsePyDependencies,
  parseRequiresPython,
  readNodePackage,
  type NodePackageFacts,
} from './lib/manifests.ts';

const REPOS = RUNTIME_REPOS;

const REPO_ROOT = path.resolve(import.meta.dirname, '../../..');
const CACHE = path.join(REPO_ROOT, '.cache/repos');

type RepoFacts = {
  slug: string;
  dir: string;
  last_commit_date: string | null;
  last_commit_subject: string | null;
  git_error: string | null;
  shallow_clone: boolean;
  license: { file: string | null; spdx_guess: string | null; first_line: string | null };
  has_rust_manifest: boolean;
  cargo_manifests: string[];
  has_python_manifest: boolean;
  python_requires: string | null;
  python_dependencies: string | null;
  node_package: NodePackageFacts | null;
  top_level_entries: string[];
};

const licenseInfo = (dir: string): RepoFacts['license'] => {
  for (const candidate of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING']) {
    const file = path.join(dir, candidate);
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, 'utf8');
    return { file: candidate, spdx_guess: classifyLicense(text), first_line: firstMeaningfulLine(text) };
  }
  return { file: null, spdx_guess: null, first_line: null };
};

const collect = (slug: string): RepoFacts => {
  const name = repoName(slug);
  const dir = path.join(CACHE, name);
  if (!fs.existsSync(dir)) {
    throw new Error(`missing clone: ${dir} (run: git clone --depth 1 https://github.com/${slug}.git)`);
  }

  const log = run(dir, 'git', ['log', '-1', '--format=%cI%n%s']);
  const lines = log.stdout.split('\n');
  const pyprojectFile = path.join(dir, 'pyproject.toml');
  const pyproject = fs.existsSync(pyprojectFile) ? fs.readFileSync(pyprojectFile, 'utf8') : null;
  const pkgFile = path.join(dir, 'package.json');
  const pkgRaw = fs.existsSync(pkgFile) ? parseJsonUnknown(fs.readFileSync(pkgFile, 'utf8')) : null;
  const cargoManifests = findFilesNamed(dir, CACHE, 'Cargo.toml', 3);

  return {
    slug,
    dir: path.relative(REPO_ROOT, dir),
    last_commit_date: log.ok ? (lines[0] ?? null) : null,
    last_commit_subject: log.ok ? (lines[1] ?? null) : null,
    git_error: log.ok ? null : `${log.exit_code}: ${log.stderr}`,
    shallow_clone: fs.existsSync(path.join(dir, '.git/shallow')),
    license: licenseInfo(dir),
    has_rust_manifest: cargoManifests.length > 0,
    cargo_manifests: cargoManifests,
    has_python_manifest: pyproject !== null,
    python_requires: pyproject ? parseRequiresPython(pyproject) : null,
    python_dependencies: pyproject ? parsePyDependencies(pyproject) : null,
    node_package: readNodePackage(pkgRaw),
    top_level_entries: fs
      .readdirSync(dir)
      .filter((entry) => !entry.startsWith('.'))
      .sort(),
  };
};

const outDir = process.argv[2];
if (!outDir) {
  console.error('usage: node collect-runtimes.ts <out-dir>');
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });

const results = REPOS.map(collect);
fs.writeFileSync(path.join(outDir, 'runtimes-raw.json'), JSON.stringify(results, null, 2) + '\n');
for (const row of results) {
  console.log(
    [
      row.slug.padEnd(32),
      (row.license.spdx_guess ?? 'unknown').padEnd(12),
      row.has_rust_manifest ? 'rust' : '----',
      row.has_python_manifest ? 'python' : '------',
      row.node_package ? 'node' : '----',
      row.last_commit_date ?? row.git_error,
    ].join('  '),
  );
}
