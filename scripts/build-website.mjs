#!/usr/bin/env node
// Builds the download site into build/website. The app version is read from the desktop app's
// Tauri configuration, so the site always names the version it was deployed with. The source in
// website/ keeps the __VERSION__ placeholder and is never edited by hand for a release.
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'website');
const target = join(root, 'build', 'website');

const config = JSON.parse(await readFile(join(root, 'poc/session-poc/app/tauri.conf.json'), 'utf8'));
const version = String(config.version ?? '');
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  throw new Error(`the app version must be MAJOR.MINOR.PATCH, found "${version}"`);
}

await rm(target, { recursive: true, force: true });
await mkdir(dirname(target), { recursive: true });
await cp(source, target, { recursive: true });

const textFiles = (await readdir(target)).filter((name) => /\.(html|js|css)$/.test(name));
let replaced = 0;
for (const name of textFiles) {
  const path = join(target, name);
  const text = await readFile(path, 'utf8');
  const next = text.replaceAll('__VERSION__', version);
  replaced += text.split('__VERSION__').length - 1;
  if (next !== text) await writeFile(path, next);
}

for (const name of textFiles) {
  if ((await readFile(join(target, name), 'utf8')).includes('__VERSION__')) {
    throw new Error(`a version placeholder was left in ${name}`);
  }
}
console.log(`website ${version}: ${replaced} placeholders in ${textFiles.length} files -> build/website`);
