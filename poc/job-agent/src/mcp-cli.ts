#!/usr/bin/env node
/**
 * Serve the agent over MCP on stdio, so the user's own assistant can score what its
 * connectors find.
 *
 * Usage: node src/mcp-cli.ts --profile <path> [--config <path>] [--seen <seen.json>]
 *
 * Point any MCP client at it, for example:
 *   {"mcpServers":{"openjob":{"command":"node","args":["src/mcp-cli.ts","--profile","…"]}}}
 */
import { loadRuntime, missingKeyMessage } from './bootstrap.ts';
import { defaultFetch } from './jev.ts';
import { loadSeen, serveStdio } from './mcp-server.ts';
import { readSecret } from './secrets.ts';

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const profilePath = arg('profile');
if (profilePath === undefined) {
  process.stderr.write('openjob: --profile <path> is required\n');
  process.exit(2);
}

const configPath = arg('config');
const runtime = loadRuntime({ profilePath, ...(configPath === undefined ? {} : { configPath }) });

const typesafeKey = readSecret('typesafe');
if (typesafeKey === null) {
  process.stderr.write(`openjob: ${missingKeyMessage('typesafe')}\n`);
  process.exit(2);
}

const seenPath = arg('seen') ?? null;
// Fail now if the file cannot be read, then re-read it on every question: the memory
// belongs to the file, not to this process.
try {
  loadSeen(seenPath);
} catch (error) {
  process.stderr.write(`openjob: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
}

serveStdio({
  profile: runtime.profile,
  promptContext: runtime.spec.prompt_context,
  jev: {
    apiKey: typesafeKey,
    fetchImpl: defaultFetch,
    ...(runtime.config.base_url === undefined ? {} : { baseUrl: runtime.config.base_url }),
  },
  seen: (key) => loadSeen(seenPath).has(key),
});
