import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

import { SubtreeSampler } from '../lib/sampler.ts';
import type { Adapter, AdapterContext, AdapterRun, StepTimings } from './types.ts';

const execFileAsync = promisify(execFile);

const now = (): number => performance.now();
const ms = (from: number): number => Math.round(now() - from);

const DEFAULT_BIN = path.resolve(
  import.meta.dirname,
  '../../../agent-browser-probe/node_modules/agent-browser/bin/agent-browser-darwin-arm64',
);
const BIN = process.env['OPENJOB_AGENT_BROWSER_BIN'] ?? DEFAULT_BIN;

export type AgentBrowserOptions = {
  name: string;
  mode: 'headless' | 'headed';
  executablePath: string;
  session: string;
};

type CliResult = { stdout: string; stderr: string; code: number; elapsed_ms: number };

const cli = async (options: AgentBrowserOptions, ctx: AdapterContext, args: string[]): Promise<CliResult> => {
  const started = now();
  // Explicit allowlist: a third-party binary never inherits the developer's
  // whole environment, which may hold tokens or keys.
  const inherited = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'SHELL'] as const;
  const env: NodeJS.ProcessEnv = {};
  for (const key of inherited) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  env['AGENT_BROWSER_PROFILE'] = ctx.userDataDir;
  env['AGENT_BROWSER_SESSION_NAME'] = options.session;
  env['AGENT_BROWSER_DOWNLOAD_PATH'] = ctx.downloadDir;
  env['AGENT_BROWSER_EXECUTABLE_PATH'] = options.executablePath;
  // Keep the daemon from being reaped mid-measurement.
  env['AGENT_BROWSER_IDLE_TIMEOUT_MS'] = '600000';
  try {
    const { stdout, stderr } = await execFileAsync(BIN, args, { env, timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
    return { stdout, stderr, code: 0, elapsed_ms: ms(started) };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; code?: number; message?: string };
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      code: typeof err.code === 'number' ? err.code : 1,
      elapsed_ms: ms(started),
    };
  }
};

const runProtocol = async (options: AgentBrowserOptions, ctx: AdapterContext): Promise<AdapterRun> => {
  const notes: string[] = [];
  const sampler = new SubtreeSampler(ctx.userDataDir, 500);
  const timings: StepTimings = {
    launch_ms: null,
    login_nav_ms: null,
    form_submit_ms: null,
    app_ready_ms: null,
    snapshot_ms: null,
    snapshot_chars: null,
    iframe_ms: null,
    iframe_text: null,
    download_ms: null,
    download_bytes: null,
    upload_ms: null,
    heavy_nav_ms: null,
    idle_ms: null,
    close_ms: null,
  };
  const commandLog: Array<{ args: string[]; elapsed_ms: number; code: number }> = [];

  const step = async (args: string[]): Promise<CliResult> => {
    const result = await cli(options, ctx, args);
    commandLog.push({ args, elapsed_ms: result.elapsed_ms, code: result.code });
    return result;
  };

  try {
    sampler.start();

    // A first `close --all` guarantees the measurement starts from no daemon.
    await step(['--session', options.session, 'close', '--all']).catch(() => undefined);

    let t = now();
    const open = await step(['open', `${ctx.baseUrl}/login`]);
    timings.launch_ms = ms(t);
    if (open.code !== 0) throw new Error(`open failed: ${open.stderr.slice(0, 400)}`);

    t = now();
    const fillEmail = await step(['fill', '#email', 'candidate@example.test']);
    const fillPassword = await step(['fill', '#password', 'fixture-password']);
    const click = await step(['click', '#submit']);
    const waitApp = await step(['wait', '#welcome']);
    const loginSteps = [fillEmail, fillPassword, click, waitApp];
    timings.form_submit_ms = ms(t);
    if (loginSteps.some((r) => r.code !== 0)) {
      const failed = loginSteps.find((r) => r.code !== 0);
      throw new Error(`login sequence failed at step ${loginSteps.indexOf(failed ?? click) + 1}: ${(failed ?? click).stderr.slice(0, 300)}`);
    }
    timings.app_ready_ms = waitApp.elapsed_ms;
    notes.push(
      `login sequence is ${loginSteps.length} separate CLI invocations: ${loginSteps.map((r) => `${r.elapsed_ms}ms`).join(', ')}`,
    );

    t = now();
    const snapshot = await step(['snapshot']);
    if (snapshot.code === 0) {
      timings.snapshot_ms = ms(t);
      timings.snapshot_chars = snapshot.stdout.length;
    } else {
      notes.push(`snapshot failed, so snapshot timing is not recorded: ${snapshot.stderr.slice(0, 200)}`);
    }

    t = now();
    const frameEval = await step([
      'eval',
      "document.querySelector('#frame').contentDocument.querySelector('#frame-text').textContent",
    ]);
    if (frameEval.code === 0) {
      timings.iframe_ms = ms(t);
      timings.iframe_text = frameEval.stdout.trim();
    } else {
      notes.push(`iframe read failed: ${frameEval.stderr.slice(0, 200)}`);
    }

    t = now();
    const downloadTarget = path.join(ctx.downloadDir, 'offer.txt');
    const download = await step(['download', '#download', downloadTarget]);
    if (download.code === 0 && fs.existsSync(downloadTarget)) {
      timings.download_ms = ms(t);
      timings.download_bytes = fs.statSync(downloadTarget).size;
    } else {
      notes.push(`download failed, so no download measurement is recorded: ${download.stderr.slice(0, 200)}`);
    }

    t = now();
    const upload = await step(['upload', '#upload', ctx.uploadFile]);
    if (upload.code === 0) timings.upload_ms = ms(t);
    else notes.push(`upload failed: ${upload.stderr.slice(0, 200)}`);

    t = now();
    const heavy = await step(['open', `${ctx.baseUrl}/heavy`]);
    const heavyWait = await step(['wait', '.row']);
    if (heavy.code === 0 && heavyWait.code === 0) timings.heavy_nav_ms = ms(t);
    else notes.push(`heavy navigation failed: ${(heavy.code !== 0 ? heavy : heavyWait).stderr.slice(0, 200)}`);

    t = now();
    await new Promise((resolve) => setTimeout(resolve, ctx.idleMs));
    timings.idle_ms = ms(t);

    // Stop sampling before teardown so the idle window contains only idle time.
    sampler.stop();
    const summary = sampler.summary(ctx.idleMs);

    t = now();
    await step(['--session', options.session, 'close', '--all']);
    timings.close_ms = ms(t);
    const totalCliMs = commandLog.reduce((sum, entry) => sum + entry.elapsed_ms, 0);
    notes.push(`${commandLog.length} CLI invocations, ${totalCliMs}ms of CLI wall time in total`);
    return {
      adapter: options.name,
      mode: options.mode,
      ok: true,
      error: null,
      timings,
      resources: {
        peak_rss_mb: summary.peak_rss_mb,
        idle_mean_rss_mb: summary.idle_mean_rss_mb,
        idle_mean_cpu_pct: summary.idle_mean_cpu_pct,
        samples: summary.samples.length,
        processes_peak: summary.samples.reduce((max, s) => Math.max(max, s.processes), 0),
        sampler_overhead_ms: summary.overhead_ms,
        sampler_max_sample_ms: summary.max_sample_ms,
      },
      notes,
    };
  } catch (error) {
    sampler.stop();
    await step(['--session', options.session, 'close', '--all']).catch(() => undefined);
    return {
      adapter: options.name,
      mode: options.mode,
      ok: false,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      timings: null,
      resources: null,
      notes: [...notes, `${commandLog.length} CLI invocations before the failure`],
    };
  }
};

export const makeAgentBrowserAdapter = (options: AgentBrowserOptions): Adapter => ({
  name: options.name,
  mode: options.mode,
  availability: async () => {
    if (!fs.existsSync(BIN)) return { available: false, reason: `agent-browser binary missing at ${BIN}` };
    if (!fs.existsSync(options.executablePath)) {
      return { available: false, reason: `browser executable missing at ${options.executablePath}` };
    }
    return { available: true, reason: null };
  },
  run: (ctx) => runProtocol(options, ctx),
});
