/**
 * robots.txt parsing and matching, enough to gate a read-only probe.
 *
 * Implements the parts of RFC 9309 that matter for politeness: group selection by
 * user-agent token, `Allow`/`Disallow` rules, `*` wildcards and a `$` end anchor,
 * with the longest matching pattern winning and `Allow` breaking a tie.
 *
 * It is deliberately a small, pure module: the probe must be able to decide
 * whether a URL is permitted without a network call, and that decision must be
 * testable against fixtures.
 */

export type RobotsRule = { allow: boolean; pattern: string };

export type RobotsRules = {
  /** Rules from the most specific group that matched our user agent. */
  rules: RobotsRule[];
  crawl_delay_seconds: number | null;
  /** Which group produced the rules, for the evidence record. */
  matched_group: string | null;
  /**
   * True when the rules could not be used safely (oversized or over-wildcarded
   * patterns), in which case the caller must treat the whole origin as disallowed.
   */
  unusable: boolean;
};

/** A pattern longer than this, or with more wildcards, is not compiled. */
const MAX_PATTERN_LENGTH = 512;
const MAX_WILDCARDS = 16;

type Group = { agents: string[]; rules: RobotsRule[]; crawlDelay: number | null };

const stripComment = (line: string): string => {
  const hash = line.indexOf('#');
  return (hash === -1 ? line : line.slice(0, hash)).trim();
};

const parseGroups = (text: string): Group[] => {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastLineWasAgent = false;

  for (const rawLine of text.split('\n')) {
    const line = stripComment(rawLine);
    if (line.length === 0) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (field === 'user-agent') {
      // Consecutive user-agent lines share one group; a new agent after a rule starts another.
      if (current === null || !lastLineWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastLineWasAgent = true;
      continue;
    }

    lastLineWasAgent = false;
    if (current === null) continue;

    if (field === 'disallow') {
      // An empty Disallow means "allow everything" and must not become a rule.
      if (value.length > 0) current.rules.push({ allow: false, pattern: value });
    } else if (field === 'allow') {
      if (value.length > 0) current.rules.push({ allow: true, pattern: value });
    } else if (field === 'crawl-delay') {
      const parsed = Number.parseFloat(value);
      if (Number.isFinite(parsed) && parsed >= 0) current.crawlDelay = parsed;
    }
  }

  return groups;
};

/**
 * Select the group for `userAgent`.
 *
 * A token matches when it is a case-insensitive substring of the user agent, which
 * is how real crawlers identify themselves ("openjob-phase0-probe/1.0" matches a
 * `openjob` group). The longest matching token wins; `*` applies only when nothing
 * more specific matched.
 */
export const parseRobots = (text: string, userAgent: string): RobotsRules => {
  const groups = parseGroups(text);
  const ua = userAgent.toLowerCase();

  let bestTokenLength = -1;
  let matchedToken: string | null = null;
  for (const group of groups) {
    for (const agent of group.agents) {
      if (agent === '*') continue;
      if (ua.includes(agent) && agent.length > bestTokenLength) {
        bestTokenLength = agent.length;
        matchedToken = agent;
      }
    }
  }

  const selected: Group[] = [];
  if (matchedToken !== null) {
    for (const group of groups) {
      if (group.agents.includes(matchedToken)) selected.push(group);
    }
  } else {
    for (const group of groups) {
      if (group.agents.includes('*')) selected.push(group);
    }
  }

  const crawlDelays = selected
    .map((group) => group.crawlDelay)
    .filter((value): value is number => value !== null);

  const rules = selected.flatMap((group) => group.rules);
  const unusable = rules.some(
    (rule) => rule.pattern.length > MAX_PATTERN_LENGTH || (rule.pattern.match(/\*/g)?.length ?? 0) > MAX_WILDCARDS,
  );

  return {
    rules: unusable ? [] : rules,
    crawl_delay_seconds: crawlDelays.length > 0 ? Math.max(...crawlDelays) : null,
    matched_group: matchedToken ?? (selected.length > 0 ? '*' : null),
    unusable,
  };
};

export type RobotsPolicy = {
  rules: RobotsRules;
  /** False when the whole origin must be left alone. */
  origin_allowed: boolean;
  reason: string;
};

/**
 * Apply RFC 9309 availability rules to a robots.txt fetch.
 *
 * - 2xx: the rules govern.
 * - 4xx (including 401 and 404): the origin has no usable policy, so access is allowed.
 * - 5xx or no response at all: the origin is unreachable, and the spec requires
 *   treating it as fully disallowed rather than assuming permission.
 */
export const robotsPolicyFor = (status: number | null, body: string, userAgent: string): RobotsPolicy => {
  if (status === null) {
    return {
      rules: { rules: [], crawl_delay_seconds: null, matched_group: null, unusable: false },
      origin_allowed: false,
      reason: 'robots.txt unreachable: treated as fully disallowed (RFC 9309)',
    };
  }
  if (status >= 500) {
    return {
      rules: { rules: [], crawl_delay_seconds: null, matched_group: null, unusable: false },
      origin_allowed: false,
      reason: `robots.txt returned ${status}: treated as fully disallowed (RFC 9309)`,
    };
  }
  if (status >= 400) {
    return {
      rules: { rules: [], crawl_delay_seconds: null, matched_group: null, unusable: false },
      origin_allowed: true,
      reason: `robots.txt returned ${status}: no policy published, access allowed`,
    };
  }

  const rules = parseRobots(body, userAgent);
  if (rules.unusable) {
    return {
      rules,
      origin_allowed: false,
      reason: 'robots.txt patterns exceeded the safe size: origin treated as disallowed',
    };
  }
  return { rules, origin_allowed: true, reason: `robots.txt returned ${status}` };
};

const patternToRegExp = (pattern: string): RegExp => {
  let body = pattern;
  let anchored = false;
  if (body.endsWith('$')) {
    anchored = true;
    body = body.slice(0, -1);
  }
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}${anchored ? '$' : ''}`);
};

/** Path plus query, which is what robots.txt patterns are matched against. */
export const robotsPathOf = (url: string): string => {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
};

/**
 * Decide whether a URL may be fetched.
 *
 * The longest matching pattern wins; on an exact-length tie, `Allow` wins. No
 * matching rule means allowed.
 */
export const isAllowed = (url: string, rules: RobotsRules): boolean => {
  const path = robotsPathOf(url);
  let winner: { rule: RobotsRule; length: number } | null = null;

  for (const rule of rules.rules) {
    if (!patternToRegExp(rule.pattern).test(path)) continue;
    const length = rule.pattern.length;
    if (winner === null || length > winner.length || (length === winner.length && rule.allow)) {
      winner = { rule, length };
    }
  }

  return winner === null ? true : winner.rule.allow;
};
