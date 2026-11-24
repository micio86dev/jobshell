/**
 * A model reached through a command-line program the user installed and signed in to themselves:
 * Claude Code, Codex, Gemini CLI or OpenCode.
 *
 * This lets a subscription do the plain text work (naming companies, outreach drafts, reports, the
 * tailored CV) without an API key. Three rules keep it honest:
 *
 * - The app never reads, stores or sends the user's login. It starts the unmodified program, hands it
 *   a prompt, and reads what it prints. The program's own sign-in does the rest.
 * - No key of ours reaches the program: it gets a small environment (PATH, HOME, locale), so it uses
 *   the subscription it is signed in to, not an API key that happens to be exported in a shell.
 * - The program is started with its tools off or read-only, because the prompt contains text from the
 *   web and a program with a shell must never obey it.
 *
 * Web research is not offered here: the research checks need the pages the provider actually read,
 * and a command-line program prints only its final text.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

export const CLI_PROVIDERS = ['cli-claude', 'cli-codex', 'cli-gemini', 'cli-opencode'] as const;
export type CliProvider = (typeof CLI_PROVIDERS)[number];

export const isCliProvider = (value: string): value is CliProvider => (CLI_PROVIDERS as readonly string[]).includes(value);

export const CLI_LABEL: Record<CliProvider, string> = {
  'cli-claude': 'Claude Code',
  'cli-codex': 'Codex',
  'cli-gemini': 'Gemini CLI',
  'cli-opencode': 'OpenCode',
};

const BINARY: Record<CliProvider, string> = { 'cli-claude': 'claude', 'cli-codex': 'codex', 'cli-gemini': 'gemini', 'cli-opencode': 'opencode' };

/** The model name that means "whatever the program is set to use". */
export const CLI_DEFAULT_MODEL = 'default';

/** Where these programs usually live. A desktop app starts with a short PATH that has none of them. */
export const searchDirs = (home: string, pathEnv: string, list: (dir: string) => string[] = (dir) => (existsSync(dir) ? readdirSync(dir) : [])): string[] => {
  const nvm = list(join(home, '.nvm', 'versions', 'node')).map((version) => join(home, '.nvm', 'versions', 'node', version, 'bin'));
  return [...new Set([...pathEnv.split(':').filter((dir) => dir !== ''), join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.npm-global', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', ...nvm])];
};

/** The full path of the program, or null when it is not installed. */
export const resolveBinary = (
  provider: CliProvider,
  home: string = homedir(),
  pathEnv: string = process.env['PATH'] ?? '',
  exists: (path: string) => boolean = existsSync,
): string | null => {
  for (const dir of searchDirs(home, pathEnv)) {
    const candidate = join(dir, BINARY[provider]);
    if (exists(candidate)) return candidate;
  }
  return null;
};

export type Invocation = { args: string[]; stdin: string | null; promptFile: string | null };

const withModel = (flag: string, model: string): string[] => (model === CLI_DEFAULT_MODEL || model.trim() === '' ? [] : [flag, model]);

/** The command line for one plain-text request. The prompt travels on stdin or in a private file, never in the arguments of a process other users can list. */
export const invocationFor = (provider: CliProvider, model: string, prompt: string, promptFile: string | null): Invocation => {
  switch (provider) {
    case 'cli-claude':
      // Every tool is refused: this is a text request, and its prompt holds text from the web.
      return {
        args: ['-p', '--output-format', 'text', '--no-session-persistence', ...withModel('--model', model), '--disallowedTools', 'Bash', 'Edit', 'Write', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit', 'Task'],
        stdin: prompt,
        promptFile: null,
      };
    case 'cli-codex':
      return { args: ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', ...withModel('-m', model), '-'], stdin: prompt, promptFile: null };
    case 'cli-gemini':
      return { args: ['-p', 'Follow the instructions given on standard input.', '-o', 'text', '--approval-mode', 'plan', ...withModel('-m', model)], stdin: prompt, promptFile: null };
    case 'cli-opencode':
      // Its message is an argument and its file option swallows what follows, so the file comes last.
      return { args: ['run', 'Follow the instructions in the attached file.', '--agent', 'plan', ...withModel('-m', model), '-f', promptFile ?? ''], stdin: null, promptFile: prompt };
  }
};

export type ExecResult = { code: number | null; stdout: string; stderr: string; failure: 'missing' | 'timeout' | null };
export type ExecLike = (file: string, args: string[], options: { input: string | null; cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<ExecResult>;

const MAX_BUFFER = 8 * 1024 * 1024;

export const defaultExec: ExecLike = (file, args, options) =>
  new Promise((resolve) => {
    const child = execFile(file, args, { cwd: options.cwd, env: options.env, timeout: options.timeoutMs, maxBuffer: MAX_BUFFER }, (error, stdout, stderr) => {
      const failure = error === null ? null : (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : (error as { killed?: boolean }).killed === true ? 'timeout' : null;
      const code = error === null ? 0 : typeof (error as { code?: unknown }).code === 'number' ? ((error as { code: number }).code) : null;
      resolve({ code, stdout: String(stdout), stderr: String(stderr), failure });
    });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(options.input ?? '');
  });

export type CliResult = { ok: true; text: string; usage: { input_tokens: number; output_tokens: number } } | { ok: false; reason: string };

/** The error line a program printed, when it printed one: the part that tells the user what to do. */
const errorLine = (stderr: string, stdout: string): string | null => {
  const line = `${stderr}\n${stdout}`.split('\n').map((entry) => entry.trim()).find((entry) => /^(\x1b\[[0-9;]*m)*\s*(error|ERROR)\b/.test(entry) || /usage limit|rate limit|quota/i.test(entry));
  return line === undefined ? null : line.replace(/\x1b\[[0-9;]*m/g, '').slice(0, 200);
};

/** A warning some programs print before the answer is not part of it. */
const answerOf = (stdout: string): string =>
  stdout
    .split('\n')
    .filter((line, index) => !(index < 3 && /^Warning:/i.test(line)))
    .join('\n')
    .trim();

export type CliDeps = {
  exec?: ExecLike;
  home?: string;
  pathEnv?: string;
  timeoutMs?: number;
  exists?: (path: string) => boolean;
  /** The environment the few allowed variables are read from; absent means the process's own. */
  baseEnv?: Record<string, string | undefined>;
};

/** The only variables a program is given besides PATH, HOME and TMPDIR. USER, LOGNAME and SHELL are not secrets, and on macOS the keychain that holds the program's sign-in is not reachable without them. */
const PASSED = ['USER', 'LOGNAME', 'SHELL', 'LANG'] as const;

/** One plain-text request through the program. A failure is a sentence that says what to do, never a raw dump. */
export const runCli = async (provider: CliProvider, model: string, prompt: string, deps: CliDeps = {}): Promise<CliResult> => {
  const label = CLI_LABEL[provider];
  const home = deps.home ?? homedir();
  const pathEnv = deps.pathEnv ?? process.env['PATH'] ?? '';
  const binary = resolveBinary(provider, home, pathEnv, deps.exists);
  if (binary === null) return { ok: false, reason: `${label} is not installed (or not where the app can find it): install it and sign in to it in a terminal` };

  let directory: string | null = null;
  try {
    directory = mkdtempSync(join(tmpdir(), 'jobshell-cli-'));
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    let file: string | null = null;
    const plan = invocationFor(provider, model, prompt, null);
    if (plan.promptFile !== null) {
      file = join(directory, 'prompt.txt');
      writeFileSync(file, plan.promptFile, { mode: 0o600 });
    }
    const invocation = invocationFor(provider, model, prompt, file);
    // A small environment: the program's own sign-in is in HOME and the keychain, and no key of ours is passed on.
    const base = deps.baseEnv ?? process.env;
    const env: Record<string, string> = { PATH: searchDirs(home, pathEnv).join(':'), HOME: home, TMPDIR: tmpdir() };
    for (const name of PASSED) {
      const value = base[name];
      if (value !== undefined && value !== '') env[name] = value;
    }
    if (env['LANG'] === undefined) env['LANG'] = 'en_US.UTF-8';
    const run = await (deps.exec ?? defaultExec)(binary, invocation.args, { input: invocation.stdin, cwd: directory, env, timeoutMs: deps.timeoutMs ?? 180_000 });
    if (run.failure === 'missing') return { ok: false, reason: `${label} is not installed (or not where the app can find it)` };
    if (run.failure === 'timeout') return { ok: false, reason: `${label} took too long and was stopped` };
    const text = answerOf(run.stdout);
    if (run.code === 0 && text !== '') return { ok: true, text, usage: { input_tokens: 0, output_tokens: 0 } };
    const combined = `${run.stderr}\n${run.stdout}`;
    if (/not logged in|\/login|auth method|sign in|log in|unauthori[sz]ed/i.test(combined)) {
      return { ok: false, reason: `${label} is not signed in: open a terminal, run it once and sign in` };
    }
    const detail = errorLine(run.stderr, run.stdout);
    return { ok: false, reason: `${label} gave no answer${detail === null ? '' : `: ${detail}`}` };
  } catch {
    return { ok: false, reason: `${label} could not be started` };
  } finally {
    if (directory !== null) rmSync(directory, { recursive: true, force: true });
  }
};
