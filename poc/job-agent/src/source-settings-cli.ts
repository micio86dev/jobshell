/**
 * Command line for the user's source choices. The desktop page calls this same program.
 *
 *   node src/source-settings-cli.ts list
 *   node src/source-settings-cli.ts enable <source>
 *   node src/source-settings-cli.ts disable <source>
 *   node src/source-settings-cli.ts add-tenant <source> <employer-id>
 *   node src/source-settings-cli.ts remove-tenant <source> <employer-id>
 *
 * It reads the configuration file (a missing one means the defaults), applies one change, checks
 * the whole result with the schema the runner reads, and only then writes the file. Every other
 * field of the file is kept as it is. The path is the default one, or AGENT_CONFIG when it is set.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { defaultConfig, defaultConfigPath, loadConfig, parseConfig, type AgentConfig } from './config.ts';
import { addTenant, BOARD_SOURCES, removeTenant, setEnabled, sourceStatus, type Change } from './source-settings.ts';

const usage = `usage:
  list
  enable <source>            disable <source>
  add-tenant <source> <id>   remove-tenant <source> <id>
boards: ${BOARD_SOURCES.join(', ')}`;

const configPath = (): string => process.env['AGENT_CONFIG'] ?? defaultConfigPath();

/** Write the file atomically: a temporary sibling, then a rename, so a crash never leaves half a file. */
const writeConfig = (path: string, config: AgentConfig): void => {
  const raw: Record<string, unknown> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const next = { ...raw, sources: config.sources };
  const checked = parseConfig({ ...defaultConfig(), ...next });
  if (!checked.ok) throw new Error(checked.error);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`);
  renameSync(temporary, path);
};

const apply = (change: (config: AgentConfig) => Change): void => {
  const path = configPath();
  const current = loadConfig({ path });
  const result = change(current);
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  writeConfig(path, result.config);
  console.log('saved');
};

const list = (): void => {
  const config = loadConfig({ path: configPath() });
  const ids = [...new Set([...Object.keys(config.sources), ...BOARD_SOURCES])].sort();
  for (const id of ids) {
    const status = sourceStatus(config, id);
    const board = BOARD_SOURCES.includes(id) ? ` employers: ${status.verifiedTenants} verified, ${status.userTenants.length} yours` : '';
    const state = !status.reachable ? 'policy refuses it' : status.enabled ? 'on' : 'off';
    console.log(`${state.padEnd(18)} ${id}${board}`);
  }
};

const [command, source, employer] = process.argv.slice(2);

switch (command) {
  case 'list':
    list();
    break;
  case 'enable':
  case 'disable':
    if (source === undefined) {
      console.error(usage);
      process.exitCode = 2;
      break;
    }
    apply((config) => setEnabled(config, source, command === 'enable'));
    break;
  case 'add-tenant':
    if (source === undefined || employer === undefined) {
      console.error(usage);
      process.exitCode = 2;
      break;
    }
    apply((config) => addTenant(config, source, employer));
    break;
  case 'remove-tenant':
    if (source === undefined || employer === undefined) {
      console.error(usage);
      process.exitCode = 2;
      break;
    }
    apply((config) => removeTenant(config, source, employer));
    break;
  default:
    console.error(usage);
    process.exitCode = 2;
}
