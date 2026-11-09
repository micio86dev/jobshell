#!/usr/bin/env node
/**
 * Start the localhost bridge the browser extension talks to.
 *
 * Usage: node src/bridge-cli.ts --profile <path> [--config <path>] [--port 8787]
 *
 * It prints the token once. Paste it into the extension; it is stored in the
 * browser profile, not in this repository.
 */
import { appendFileSync } from 'node:fs';

import { loadRuntime } from './bootstrap.ts';
import { startBridge } from './bridge.ts';
import { defaultFetch } from './jev.ts';

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


const rawPort = arg('port') ?? '8787';
const logPath = arg('log');

const port = Number.parseInt(rawPort, 10);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write(`openjob: --port must be an integer between 0 and 65535 (got ${rawPort})\n`);
  process.exit(2);
}

const server = await startBridge(
  {
    // The key is read per request, so pasting it in the settings page takes effect at
    // once and the bridge can start before any key exists.
    jev: {
      apiKey: '',
      fetchImpl: defaultFetch,
      ...(runtime.config.base_url === undefined ? {} : { baseUrl: runtime.config.base_url }),
    },
    promptContext: runtime.spec.prompt_context,
    threshold: runtime.spec.threshold,
    ...(logPath === undefined
      ? {}
      : { log: (record: unknown) => appendFileSync(logPath, `${JSON.stringify(record)}\n`, 'utf8') }),
  },
  port,
);

process.stdout.write(
  [
    `openjob bridge listening on http://127.0.0.1:${server.port}`,
    `  profile:   ${runtime.profile.headline}`,
    `  threshold: ${Math.round(runtime.spec.threshold * 100)}%`,
    '',
    '  settings:  the openjob app, tab Impostazioni  ← the keys live there',
    '',
    'The extension finds this bridge on its own: open a job page and press "Score this page".',
    'This process reads the page only when the extension asks it to. Ctrl+C to stop.',
    '',
  ].join('\n'),
);

const shutdown = async (): Promise<void> => {
  await server.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
