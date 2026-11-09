/**
 * The guardrail between a measurement and a ban.
 *
 * Three rules, and every one of them can only tighten:
 *
 * 1. A source's automation mode has a floor decided here, never by the user's
 *    config: LinkedIn and Indeed are `measurement_only`, ATS feeds are `allowed`,
 *    and anything unknown is `prohibited` rather than guessed.
 * 2. The pace between requests can never drop below the configured floor, and a
 *    session-driven source has its own higher floor.
 * 3. The number of pages per run can never exceed the configured ceiling.
 *
 * The module is pure: the clock and the sleep are injected, so the policy can be
 * tested without waiting and without a browser.
 */
import type { AgentConfig, Automation } from './config.ts';

/** Human pace for a source driven by the user's own session. */
export const MEASUREMENT_PACE_MS = 15_000;

const MEASUREMENT_ONLY: readonly string[] = [
  'linkedin',
  'indeed',
  'stepstone',
  'tecnoempleo',
  'subito',
  'facebook',
];
const ALLOWED: readonly string[] = [
  // ATS board feeds.
  'greenhouse',
  'lever',
  'ashby',
  'recruitee',
  // Public feeds that answered a plain GET with no credential in the Phase 0.5 probe.
  'remoteok',
  'remotive',
  'arbeitnow',
  'jobicy',
  'weworkremotely',
  'workingnomads',
  'iprogrammatori',
  'hn',
  // Fetched by the desktop app through ZipRecruiter's MCP server, with the user's OAuth;
  // the agent only reads the file it leaves behind.
  'ziprecruiter',
];

/** Stricter wins: a source can be tightened by an override, never loosened. */
const SEVERITY: Record<Automation, number> = {
  allowed: 1,
  measurement_only: 2,
  prohibited: 3,
};

const strictest = (a: Automation, b: Automation): Automation =>
  SEVERITY[a] >= SEVERITY[b] ? a : b;

export type Policy = {
  sourceId: string;
  automation: Automation;
  paceMs: number;
  maxPages: number;
};

/** The automation floor for a source id, before any user override. */
export const baseAutomation = (sourceId: string): Automation => {
  if (MEASUREMENT_ONLY.includes(sourceId)) return 'measurement_only';
  if (ALLOWED.includes(sourceId)) return 'allowed';
  return 'prohibited';
};

export const resolvePolicy = (sourceId: string, config: AgentConfig): Policy => {
  const override = config.sources[sourceId];
  const base = baseAutomation(sourceId);
  const automation = override?.automation === undefined ? base : strictest(base, override.automation);

  // A session-driven source is paced by a human, not by the config floor.
  const minimumPace = automation === 'measurement_only'
    ? Math.max(config.pace_ms_floor, MEASUREMENT_PACE_MS)
    : config.pace_ms_floor;
  const requestedPace = override?.pace_ms ?? minimumPace;
  const paceMs = Math.max(requestedPace, minimumPace);

  const requestedPages = override?.max_pages ?? config.max_pages_per_run;
  const maxPages = Math.min(requestedPages, config.max_pages_per_run);

  return { sourceId, automation, paceMs, maxPages };
};

/**
 * Refuse a source the policy does not allow.
 *
 * `prohibited` and `measurement_only` get different errors on purpose: the first
 * is a source we will not touch, the second is a source that needs a human
 * present. Collapsing them into one message would make the second look like a bug.
 */
export const assertAutomationAllowed = (sourceId: string, policy: Policy): void => {
  if (policy.automation === 'prohibited') {
    throw new Error(
      `policy: ${sourceId || '(empty)'} is prohibited: no automation is allowed for this source`,
    );
  }
  if (policy.automation === 'measurement_only') {
    throw new Error(
      `policy: ${sourceId} is measurement_only: this mode requires an attended session — ` +
        'the run pauses at any challenge and a human resumes it',
    );
  }
};

export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Enforce a minimum interval between requests.
 *
 * The first call never waits: the interval measures the gap between requests, and
 * there is no previous request yet.
 */
export class Pacer {
  private last: number | null = null;
  private readonly paceMs: number;
  private readonly clock: Clock;
  private readonly sleep: Sleep;

  constructor(paceMs: number, clock: Clock = () => performance.now(), sleep: Sleep = realSleep) {
    this.paceMs = paceMs;
    this.clock = clock;
    this.sleep = sleep;
  }

  async next(): Promise<void> {
    const now = this.clock();
    if (this.last !== null) {
      const elapsed = now - this.last;
      if (elapsed < this.paceMs) await this.sleep(this.paceMs - elapsed);
    }
    this.last = this.clock();
  }
}
