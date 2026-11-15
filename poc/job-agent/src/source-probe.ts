/**
 * The pure rules of the live source probe.
 *
 * The probe answers one question per source: does it return postings to a plain, read-only,
 * self-identifying GET, and does its robots.txt allow that request? Two rules live here so they
 * can be tested without the network: the robots.txt decision for one path, and the verdict for
 * one probed URL. The network part is in source-probe-cli.ts.
 */
import type { Challenge } from './sources/types.ts';

type RobotsRule = { allow: boolean; path: string };

/** The rules of the group that applies to every agent (`User-agent: *`), in file order. */
const wildcardRules = (robots: string): RobotsRule[] => {
  const groups: Array<{ agents: string[]; rules: RobotsRule[] }> = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;
  let inAgentLines = false;

  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (line.length === 0) {
      current = null;
      inAgentLines = false;
      continue;
    }
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (match === null) continue;
    const key = (match[1] ?? '').toLowerCase();
    const value = (match[2] ?? '').trim();

    if (key === 'user-agent') {
      // Consecutive user-agent lines share one group; a rule line starts the next one.
      if (current === null || !inAgentLines) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      inAgentLines = true;
      continue;
    }

    inAgentLines = false;
    // An empty Disallow means "allow everything" and is not a rule to match.
    if (current === null || value.length === 0 || (key !== 'allow' && key !== 'disallow')) continue;
    current.rules.push({ allow: key === 'allow', path: value });
  }

  return groups.find((group) => group.agents.includes('*'))?.rules ?? [];
};

/** A robots path pattern as a regular expression: `*` matches any run, a trailing `$` anchors the end. */
const patternOf = (path: string): RegExp => {
  const anchored = path.endsWith('$');
  const body = anchored ? path.slice(0, -1) : path;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
};

/**
 * Whether robots.txt allows this path for an agent that is not named. The longest matching rule
 * decides; on a tie the allow wins. With no matching rule, the path is allowed.
 */
export const robotsAllows = (robots: string, path: string): boolean => {
  let best: { allow: boolean; length: number } | null = null;
  for (const rule of wildcardRules(robots)) {
    if (!patternOf(rule.path).test(path)) continue;
    const length = rule.path.length;
    if (best === null || length > best.length || (length === best.length && rule.allow)) {
      best = { allow: rule.allow, length };
    }
  }
  return best === null ? true : best.allow;
};

export type ProbeFacts = {
  status: number;
  challenge: Challenge;
  postings: number;
  robotsAllowed: boolean;
};

export type ProbeVerdict =
  | 'ok'
  | 'empty'
  | 'blocked_by_robots'
  | 'blocked_by_publisher'
  | 'http_error'
  | 'challenge';

/**
 * One verdict per probed URL, in the order the facts are decided: a refusal by robots comes
 * first, then the publisher's own refusal, then the other HTTP errors, then a challenge, and
 * only then whether postings came back.
 */
export const verdictOf = (facts: ProbeFacts): ProbeVerdict => {
  if (!facts.robotsAllowed) return 'blocked_by_robots';
  if (facts.status === 403 || facts.status === 429) return 'blocked_by_publisher';
  if (facts.status !== 200) return 'http_error';
  if (facts.challenge !== 'none') return 'challenge';
  return facts.postings > 0 ? 'ok' : 'empty';
};
