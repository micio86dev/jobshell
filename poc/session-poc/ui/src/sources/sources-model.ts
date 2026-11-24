/** The sources page model: what the agent prints, how each source is named and grouped, what the user may type. */

/** The policy's mode for a source, as the agent names it. */
export type Automation = 'allowed' | 'measurement_only' | 'prohibited';

/** One source as the agent's source command prints it. */
export interface SourceRow {
  id: string;
  isBoard: boolean;
  enabled: boolean;
  reachable: boolean;
  automation: Automation;
  userTenants: string[];
  verifiedTenants: number;
}

export type ParseRows = { ok: true; rows: SourceRow[] } | { ok: false; error: string };

const AUTOMATIONS: readonly string[] = ['allowed', 'measurement_only', 'prohibited'];

const isRow = (value: unknown): value is SourceRow => {
  if (typeof value !== 'object' || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row['id'] === 'string' &&
    typeof row['isBoard'] === 'boolean' &&
    typeof row['enabled'] === 'boolean' &&
    typeof row['reachable'] === 'boolean' &&
    typeof row['automation'] === 'string' &&
    AUTOMATIONS.includes(row['automation']) &&
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

const NAMES: Readonly<Record<string, string>> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  recruitee: 'Recruitee',
  personio: 'Personio',
  ashby: 'Ashby',
  himalayas: 'Himalayas',
  remoteok: 'RemoteOK',
  arbeitnow: 'Arbeitnow',
  jobicy: 'Jobicy',
  weworkremotely: 'We Work Remotely',
  workingnomads: 'Working Nomads',
  iprogrammatori: 'IProgrammatori',
  hn: 'Hacker News',
  'hn-hiring': 'Hacker News: Who is hiring',
  'hn-jobs': 'Hacker News: lavori YC',
  'techcrunch-startups': 'TechCrunch: startup',
  sifted: 'Sifted: startup europee',
  'yc-hiring': 'Y Combinator: aziende che assumono',
  remotive: 'Remotive',
  jobspresso: 'Jobspresso',
  ziprecruiter: 'ZipRecruiter',
  linkedin: 'LinkedIn',
  indeed: 'Indeed',
};

/** The name a person knows the source by. An id the page does not know is shown as it is. */
export const displayName = (id: string): string => NAMES[id] ?? id;

/** The group the page shows a source under: the reason it is there, in the user's terms. */
export type Group = 'companies' | 'feeds' | 'account' | 'extension' | 'blocked';

export const groupOf = (row: SourceRow): Group => {
  if (row.automation === 'prohibited') return 'blocked';
  if (row.automation === 'measurement_only') return 'extension';
  if (row.id === 'ziprecruiter') return 'account';
  return row.isBoard ? 'companies' : 'feeds';
};

/** The group order and the title the page gives each one. */
export const GROUPS: ReadonlyArray<{ group: Group; title: string; hint: string }> = [
  { group: 'companies', title: 'Aziende', hint: 'Board pubblici: scegli le aziende da seguire.' },
  { group: 'feeds', title: 'Feed pubblici', hint: 'Annunci da fonti aperte, nessun account richiesto.' },
  { group: 'account', title: 'Con il tuo account', hint: 'Collegate con il tuo consenso, dall\'app.' },
  { group: 'extension', title: 'Solo estensione', hint: 'Si usano dal browser, con un tuo clic.' },
  { group: 'blocked', title: 'Non disponibili', hint: 'Il criterio di sicurezza non le consente.' },
];

/** The one line the page shows for a source. The mode comes first: it says what is possible at all. */
export const sourceStatusLine = (row: SourceRow): string => {
  if (row.automation === 'measurement_only') return 'si usa solo dall\'estensione del browser, con un tuo clic';
  if (row.automation === 'prohibited' || !row.reachable) return 'non consentita: nessun accesso verificabile';
  if (!row.enabled) return 'disattivata da te';
  return 'attiva';
};

export interface Summary {
  active: number;
  off: number;
  extension: number;
  blocked: number;
}

/** The counts for the header: what runs, what you switched off, what only the extension reaches, what is blocked. */
export const summarize = (rows: readonly SourceRow[]): Summary => {
  const summary: Summary = { active: 0, off: 0, extension: 0, blocked: 0 };
  for (const row of rows) {
    const group = groupOf(row);
    if (group === 'blocked') summary.blocked += 1;
    else if (group === 'extension') summary.extension += 1;
    else if (row.enabled) summary.active += 1;
    else summary.off += 1;
  }
  return summary;
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

/** The rows whose name or id contains the text typed, ignoring case and surrounding spaces. */
export const filterRows = (rows: readonly SourceRow[], query: string): SourceRow[] => {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...rows];
  return rows.filter((row) => displayName(row.id).toLowerCase().includes(needle) || row.id.includes(needle));
};

/** The sentence the page shows for a refused employer. It never repeats what was typed. */
export const employerMessage = (problem: EmployerProblem): string =>
  problem === 'empty'
    ? 'Scrivi l\'identificativo dell\'azienda, per esempio quello che compare nell\'indirizzo della sua pagina lavoro.'
    : 'L\'identificativo deve contenere solo lettere, numeri e trattini: niente indirizzi, percorsi o chiavi.';
