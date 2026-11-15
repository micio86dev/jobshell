/**
 * The user's choices over the sources: switch a source on or off, add or remove an employer on a
 * board source. Every change returns a new configuration, validated by the same schema the runner
 * reads, so a choice the runner would refuse is never written.
 *
 * Verified registry data (tenants.ts) is read, never edited: the user only adds their own tenants.
 */
import { parseConfig, type AgentConfig, type SourceOverride } from './config.ts';
import { baseAutomation } from './policy.ts';
import { listSources } from './sources/registry.ts';
import { tenantsFor } from './sources/tenants.ts';

/** The sources that take an employer id: one request per employer. */
export const BOARD_SOURCES: readonly string[] = ['greenhouse', 'lever', 'ashby', 'recruitee', 'personio'];

/** Every source the user may switch: each adapter, plus ZipRecruiter, which the desktop app fetches. */
const knownSources = (): string[] => [...new Set([...listSources(), 'ziprecruiter'])];

export type Change = { ok: true; config: AgentConfig } | { ok: false; error: string };

const withOverride = (config: AgentConfig, id: string, change: Partial<SourceOverride>): Change => {
  const current = config.sources[id] ?? {};
  const candidate = { ...config, sources: { ...config.sources, [id]: { ...current, ...change } } };
  const parsed = parseConfig(candidate);
  return parsed.ok ? { ok: true, config: parsed.config } : { ok: false, error: parsed.error };
};

/** Switch a known source on or off. Unknown ids are refused: a switch cannot create a source. */
export const setEnabled = (config: AgentConfig, id: string, enabled: boolean): Change => {
  if (!knownSources().includes(id)) return { ok: false, error: `${id} is not a known source` };
  return withOverride(config, id, { enabled });
};

/** Add an employer to a board source. The value is checked by the schema and never echoed. */
export const addTenant = (config: AgentConfig, id: string, tenant: string): Change => {
  if (!BOARD_SOURCES.includes(id)) return { ok: false, error: `${id} is not a board source` };
  const current = config.sources[id]?.tenants ?? [];
  if (current.includes(tenant)) return { ok: true, config };
  return withOverride(config, id, { tenants: [...current, tenant] });
};

/** Remove one of the employers the user added. Verified registry entries cannot be removed here. */
export const removeTenant = (config: AgentConfig, id: string, tenant: string): Change => {
  if (!BOARD_SOURCES.includes(id)) return { ok: false, error: `${id} is not a board source` };
  const current = config.sources[id]?.tenants ?? [];
  return withOverride(config, id, { tenants: current.filter((value) => value !== tenant) });
};

/** What the page shows for one source. Absent `enabled` means on, as the runner reads it. */
export const sourceStatus = (
  config: AgentConfig,
  id: string,
): { enabled: boolean; reachable: boolean; userTenants: string[]; verifiedTenants: number } => ({
  enabled: config.sources[id]?.enabled !== false,
  // The policy decides what the runner may ever run. A source it refuses shows as unreachable, whatever the switch says.
  // ZipRecruiter is not in the policy's HTTP list: the desktop app fetches it, so it is reachable when allowed there.
  reachable: baseAutomation(id) === 'allowed' || id === 'ziprecruiter',
  userTenants: [...(config.sources[id]?.tenants ?? [])],
  verifiedTenants: tenantsFor(id).length,
});
