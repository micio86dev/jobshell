#!/usr/bin/env bash
# Publishes the download site to Cloudflare Pages (project "jobshell") with the app version of
# the current desktop app. Run it after each app release, once the GitHub release is published,
# so the download links it writes point at files that exist.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

node scripts/build-website.mjs
wrangler pages deploy build/website --project-name jobshell --branch main --commit-dirty=true
