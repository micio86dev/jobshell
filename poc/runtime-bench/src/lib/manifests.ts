/**
 * Minimal, pure readers for the two manifest kinds that appear in the candidate
 * runtime repositories. They intentionally understand one shape each and return
 * `null` instead of guessing, so an unexpected manifest shows up as "unknown"
 * in the evidence rather than as a wrong fact.
 */

export const parseRequiresPython = (pyproject: string): string | null => {
  const match = /requires-python\s*=\s*"([^"]+)"/.exec(pyproject);
  return match?.[1] ?? null;
};

/**
 * Read a TOML string array assigned to `dependencies`.
 *
 * A quote-aware scanner walks from the opening bracket to the first `]` that is
 * outside a string, so an extras bracket inside an element
 * (`"uvicorn[standard]>=0.30"`) never ends the array early, and a closing bracket
 * that shares a line with the last element is still honoured. Returns the
 * collapsed, single-line body for evidence output.
 */
export const parsePyDependencies = (pyproject: string): string | null => {
  const match = /^dependencies\s*=\s*\[/m.exec(pyproject);
  if (!match) return null;

  const start = (match.index ?? 0) + match[0].length;
  const collected: string[] = [];
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = start; i < pyproject.length; i += 1) {
    const ch = pyproject[i];
    if (ch === undefined) break;

    if (quote !== null) {
      collected.push(ch);
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }

    if (ch === '"' || ch === "'") {
      quote = ch;
      collected.push(ch);
      continue;
    }
    if (ch === ']') break;
    collected.push(ch);
  }

  const joined = collected.join('').replace(/\s+/g, ' ').trim();
  return joined.length > 0 ? joined : null;
};

export type NodePackageFacts = {
  name: string | null;
  version: string | null;
  engines: Record<string, string> | null;
  bin: Record<string, string> | null;
  dependencies: string[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringRecord = (value: unknown): Record<string, string> | null => {
  if (!isRecord(value)) return null;
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') return null;
    out[key] = entry;
  }
  return out;
};

/** Narrow an arbitrary parsed JSON value into the package.json facts we report. */
export const readNodePackage = (raw: unknown): NodePackageFacts | null => {
  if (!isRecord(raw)) return null;
  const deps = isRecord(raw['dependencies']) ? Object.keys(raw['dependencies']) : [];
  const name = typeof raw['name'] === 'string' ? raw['name'] : null;
  const version = typeof raw['version'] === 'string' ? raw['version'] : null;
  return {
    name,
    version,
    engines: stringRecord(raw['engines']),
    bin: stringRecord(raw['bin']),
    dependencies: deps.sort(),
  };
};
