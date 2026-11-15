/** The sources page model: what the agent's source command prints, what the user may type, and the status line. */

/** One source as the agent's source command prints it. */
export interface SourceRow {
  id: string;
  isBoard: boolean;
  enabled: boolean;
  reachable: boolean;
  userTenants: string[];
  verifiedTenants: number;
}

export type ParseRows = { ok: true; rows: SourceRow[] } | { ok: false; error: string };

const isRow = (value: unknown): value is SourceRow => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['isBoard'] === 'boolean' &&
    typeof row['enabled'] === 'boolean' &&
    typeof row['reachable'] === 'boolean' &&
    Array.isArray(row['userTenants']) &&
    row['userTenants'].every((tenant) => typeof tenant === 'string') &&
    typeof row['verifiedTenants'] === 'number'
  );
};

/** The rows, or an error that names the problem without echoing the data it found. */
export const parseRows = (raw: unknown): ParseRows => {
  if (!Array.isArray(raw)) return { ok: false, error: 'the sources list is not a list' };
  if (!raw.every(isRow)) return { ok: false, error: 'a source row has a field of the wrong type' };
  return { ok: true, rows: raw };
};

/** Why an employer the user typed cannot be added. The same rules as the agent and the desktop command. */
export type EmployerProblem = 'empty' | 'invalid';

const EMPLOYER = /^[a-z0-9][a-z0-9-]{0,62}$/i;
/** A key prefix never makes a valid employer id, whatever else it looks like. */
const KEY_PREFIX = /(^|[-_])(sk|pk|ghp|xox[bp])[-_]/i;

export const validateEmployer = (value: string): EmployerProblem | null => {
  const trimmed = value.trim();
  if (trimmed === '') return 'empty';
  if (!EMPLOYER.test(trimmed) || KEY_PREFIX.test(trimmed)) return 'invalid';
  return null;
};

/** The one line the page shows for a source. The policy's refusal comes before the user's switch. */
export const sourceStatusLine = (row: SourceRow): string => {
  if (!row.reachable) return 'il criterio di sicurezza non la consente';
  if (!row.enabled) return 'disattivata da te';
  return 'attiva';
};
