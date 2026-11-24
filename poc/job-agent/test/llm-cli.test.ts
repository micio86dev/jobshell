// A subscription reached through the user's own command-line program. Offline: the program is a fake.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

import { generateReport } from '../src/report.ts';
import { wireLead } from '../src/leads/bootstrap.ts';
import { askModel } from '../src/llm-call.ts';
import { CLI_PROVIDERS, invocationFor, resolveBinary, runCli, searchDirs, type ExecLike, type ExecResult } from '../src/llm-cli.ts';
import { providerChoiceFromEnv } from '../src/provider-choice.ts';

const ok = (stdout: string): ExecResult => ({ code: 0, stdout, stderr: '', failure: null });
const fake = (result: ExecResult | ((args: string[]) => ExecResult)): { calls: Array<{ file: string; args: string[]; input: string | null; env: Record<string, string>; promptFileText: string | null }>; exec: ExecLike } => {
  const calls: Array<{ file: string; args: string[]; input: string | null; env: Record<string, string>; promptFileText: string | null }> = [];
  return {
    calls,
    exec: async (file, args, options) => {
      const fileArg = args[args.indexOf('-f') + 1];
      calls.push({ file, args, input: options.input, env: options.env, promptFileText: fileArg !== undefined && args.includes('-f') && existsSync(fileArg) ? readFileSync(fileArg, 'utf8') : null });
      return typeof result === 'function' ? result(args) : result;
    },
  };
};
const present = { exists: () => true, home: '/home/u', pathEnv: '/usr/bin' };

test('every program gets its prompt on stdin or in a private file, never in its arguments', async () => {
  const secret = 'PRIVATE PROMPT TEXT about Acme';
  for (const provider of CLI_PROVIDERS) {
    const { calls, exec } = fake(ok('{"ok":true}'));
    const result = await runCli(provider, 'default', secret, { ...present, exec });
    assert.equal(result.ok, true, provider);
    const call = calls[0];
    assert.ok(call !== undefined && !call.args.join(' ').includes(secret), `${provider} keeps the prompt out of its arguments`);
    assert.ok(call?.input === secret || call?.promptFileText === secret, `${provider} receives the prompt`);
  }
});

test('Claude Code is started with every tool refused, a model only when one is chosen, and nothing saved', () => {
  const plain = invocationFor('cli-claude', 'default', 'p', null);
  assert.deepEqual(plain.args.slice(0, 4), ['-p', '--output-format', 'text', '--no-session-persistence']);
  assert.ok(!plain.args.includes('--model'));
  const tools = plain.args.slice(plain.args.indexOf('--disallowedTools') + 1);
  for (const tool of ['Bash', 'Edit', 'Write', 'Read', 'WebFetch', 'WebSearch']) assert.ok(tools.includes(tool), tool);
  assert.deepEqual(invocationFor('cli-claude', 'sonnet', 'p', null).args.slice(4, 6), ['--model', 'sonnet']);
});

test('the other programs run read-only and with their own model flag', () => {
  const codex = invocationFor('cli-codex', 'gpt-x', 'p', null).args;
  assert.deepEqual(codex, ['exec', '--skip-git-repo-check', '--sandbox', 'read-only', '-m', 'gpt-x', '-']);
  const gemini = invocationFor('cli-gemini', 'default', 'p', null).args;
  assert.ok(gemini.includes('plan') && gemini.includes('-o') && !gemini.includes('-m'));
  const opencode = invocationFor('cli-opencode', 'default', 'p', '/tmp/x/prompt.txt').args;
  assert.deepEqual(opencode.slice(-2), ['-f', '/tmp/x/prompt.txt'], 'its file option swallows what follows, so it comes last');
  assert.ok(opencode.includes('plan'), 'a read-only agent');
});

test('the program gets a small environment: its own sign-in in HOME, and none of our keys or the shell\'s', async () => {
  process.env['ANTHROPIC_API_KEY'] = 'sk-ant-should-not-travel';
  process.env['OPENAI_API_KEY'] = 'sk-should-not-travel';
  try {
    const { calls, exec } = fake(ok('x'));
    await runCli('cli-claude', 'default', 'p', { ...present, exec, baseEnv: { USER: 'u', LOGNAME: 'u', SHELL: '/bin/zsh', LANG: 'it_IT.UTF-8', ANTHROPIC_API_KEY: 'sk-ant-should-not-travel', PATH: '/x', OTHER: 'y' } });
    const env = calls[0]?.env ?? {};
    // USER, LOGNAME and SHELL are not secrets, and on macOS the keychain holding the program's sign-in needs them.
    assert.deepEqual(Object.keys(env).sort(), ['HOME', 'LANG', 'LOGNAME', 'PATH', 'SHELL', 'TMPDIR', 'USER']);
    assert.ok(!JSON.stringify(env).includes('should-not-travel'));
    assert.equal(env['HOME'], '/home/u');
  } finally {
    delete process.env['ANTHROPIC_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  }
});

test('a missing program, a program not signed in, a limit and a hang are each a sentence that says what to do', async () => {
  const missing = await runCli('cli-codex', 'default', 'p', { exists: () => false, home: '/h', pathEnv: '' });
  assert.deepEqual(missing, { ok: false, reason: 'Codex is not installed (or not where the app can find it): install it and sign in to it in a terminal' });
  const signedOut = await runCli('cli-gemini', 'default', 'p', { ...present, exec: fake({ code: 41, stdout: '', stderr: 'Please set an Auth method in your settings.json', failure: null }).exec });
  assert.match(signedOut.ok ? '' : signedOut.reason, /Gemini CLI is not signed in/);
  const limited = await runCli('cli-codex', 'default', 'p', { ...present, exec: fake({ code: 1, stdout: '', stderr: "hook: x\nERROR: You've hit your usage limit. Try again at Dec 20th.", failure: null }).exec });
  assert.match(limited.ok ? '' : limited.reason, /Codex gave no answer: ERROR: You've hit your usage limit/);
  const hung = await runCli('cli-claude', 'default', 'p', { ...present, exec: fake({ code: null, stdout: '', stderr: '', failure: 'timeout' }).exec });
  assert.deepEqual(hung, { ok: false, reason: 'Claude Code took too long and was stopped' });
});

test('an error printed with a capital letter and colour codes is the reason shown', async () => {
  const stderr = '\u001b[0m\n> plan · m\n\u001b[91m\u001b[1mError: \u001b[0mThis API key has expired. Create a new one.\n';
  const result = await runCli('cli-opencode', 'default', 'p', { ...present, exec: fake({ code: 0, stdout: '', stderr, failure: null }).exec });
  assert.deepEqual(result, { ok: false, reason: 'OpenCode gave no answer: Error: This API key has expired. Create a new one.' });
});

test('a program that exits 0 and prints nothing did not answer, and a warning before the answer is not part of it', async () => {
  const empty = await runCli('cli-opencode', 'default', 'p', { ...present, exec: fake({ code: 0, stdout: '', stderr: 'Error: You have reached your specified API usage limits.', failure: null }).exec });
  assert.match(empty.ok ? '' : empty.reason, /OpenCode gave no answer: Error: You have reached/);
  const warned = await runCli('cli-claude', 'default', 'p', { ...present, exec: fake(ok('Warning: Code Mode (experimental) isn\'t available\n{"ok": true}\n')).exec });
  assert.deepEqual(warned.ok ? warned.text : null, '{"ok": true}');
});

test('the private prompt file of a program that reads one is gone when the request ends', async () => {
  const seen: string[] = [];
  const exec: ExecLike = async (_file, args) => {
    seen.push(args[args.indexOf('-f') + 1] ?? '');
    return ok('answer');
  };
  await runCli('cli-opencode', 'default', 'p', { ...present, exec });
  assert.ok(seen[0] !== '' && !existsSync(seen[0] ?? ''));
});

test('the program is looked for where a desktop app does not look, including every nvm version', () => {
  const dirs = searchDirs('/home/u', '/usr/bin', () => ['v22.1.0', 'v24.0.0']);
  for (const dir of ['/usr/bin', '/home/u/.local/bin', '/home/u/.bun/bin', '/opt/homebrew/bin', '/home/u/.nvm/versions/node/v24.0.0/bin']) assert.ok(dirs.includes(dir), dir);
  assert.equal(resolveBinary('cli-claude', '/home/u', '/usr/bin', (path) => path === '/home/u/.local/bin/claude'), '/home/u/.local/bin/claude');
  assert.equal(resolveBinary('cli-gemini', '/home/u', '/usr/bin', () => false), null);
});

test('askModel sends a command-line provider to its program and never makes an HTTP request', async () => {
  let http = 0;
  const { exec } = fake(ok('hello'));
  const result = await askModel('p', { apiKey: '', provider: 'cli-claude', model: 'default', maxTokens: 10, fetchImpl: async () => { http += 1; return { status: 200, text: '' }; }, cli: { ...present, exec } });
  assert.equal(result.ok && result.text, 'hello');
  assert.equal(http, 0);
});

test('a report and the lead wiring work with a subscription program and no key at all', async () => {
  const { exec } = fake(ok('## Report'));
  const report = await generateReport(
    { posting: { title: 'Senior Laravel Developer', company: 'Acme', url: 'https://x.test/1', description: 'Build our SaaS.' }, cv: 'Ten years of Laravel.', verdict: 'yes', gaps: [] },
    { apiKey: '', provider: 'cli-codex', model: 'default', fetchImpl: async () => ({ status: 500, text: '' }), cli: { ...present, exec } },
  );
  assert.deepEqual(report, { source: 'model', markdown: '## Report' });
  const wired = wireLead({ env: { JOBSHELL_LLM_PROVIDER: 'cli-claude' }, readKey: () => null, dryRun: false });
  assert.equal(wired.llm?.provider, 'cli-claude');
  assert.equal(wired.llm?.model, 'default');
  // A program of the user's own does the research too: it names the pages and our code reads them.
  assert.equal(wired.researchUnavailable, null);
  assert.equal(wired.research?.cli?.provider, 'cli-claude');
  assert.equal(wired.research?.apiKey, '');
});

test('the choice accepts a program without a model, and an unknown program is still refused', () => {
  const choice = providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'cli-gemini' });
  assert.deepEqual(choice.llm, { provider: 'cli-gemini', model: 'default' });
  assert.equal(providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'cli-codex', JOBSHELL_LLM_MODEL: 'o3' }).llm.model, 'o3');
  assert.throws(() => providerChoiceFromEnv({ JOBSHELL_LLM_PROVIDER: 'cli-vim' }), /unknown LLM provider/);
});
