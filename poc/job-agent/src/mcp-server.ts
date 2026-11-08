/**
 * The agent exposed as an MCP server, so the user's own assistant can use it.
 *
 * Indeed and ZipRecruiter ship MCP connectors that only their assistants may call.
 * Rather than fight that, this server exposes the part that is ours and that no
 * connector has: the profile, the calibrated Jev score, and the memory of what the
 * user has already seen. An assistant that finds a posting through a connector can
 * hand it here and get a probability back.
 *
 * Transport: stdio, one JSON-RPC object per line. The handlers are pure functions so
 * they are tested without spawning a process.
 */
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

import { judgePosting, type JeDeps } from './jev.ts';
import type { UserProfile } from './profile.ts';
import type { Posting } from './sources/types.ts';

/**
 * Load the "already shown" memory.
 *
 * `null` means the caller did not ask for a file, which is a legitimate first run. A
 * path that was asked for and cannot be read is an error: starting silently from an
 * empty set would make `already_seen` answer "unseen" for everything and discard the
 * user's dedupe state without saying so.
 */
export const loadSeen = (path: string | null): Set<string> => {
  if (path === null) return new Set();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`seen file ${path} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!Array.isArray(parsed)) throw new Error(`seen file ${path} is not a JSON array of keys`);
  return new Set(parsed.filter((value): value is string => typeof value === 'string'));
};

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_INFO = { name: 'openjob-agent', version: '0.1.0' };

export type McpDeps = {
  profile: UserProfile;
  promptContext: string;
  jev: JeDeps;
  seen: Set<string>;
};

export type McpRequest = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: unknown };

export type McpResponse = {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Validate an incoming JSON-RPC frame at the boundary.
 *
 * Returns null for a frame that is not a request, and marks a frame without an `id`
 * as a notification: JSON-RPC forbids answering one, and clients reject a response
 * to `notifications/initialized`.
 */
export const parseMcpRequest = (raw: unknown): { request: McpRequest; notification: boolean } | null => {
  if (!isRecord(raw)) return null;
  const method = raw['method'];
  if (typeof method !== 'string' || method.length === 0) return null;
  const id = raw['id'];
  const notification = id === undefined;
  if (!notification && id !== null && typeof id !== 'string' && typeof id !== 'number') return null;
  return { request: { jsonrpc: '2.0', method, id: notification ? null : id, params: raw['params'] }, notification };
};

const TOOLS = [
  {
    name: 'profile',
    description:
      'The candidate profile this agent scores against: capabilities, domains, seniority, working modes, languages, threshold and daily cap.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'score_posting',
    description:
      'Score one job posting against the profile. Returns the probability of an acceptable fit, the verdict, and how the posting treats stack. Use this on any posting found through another connector.',
    inputSchema: {
      type: 'object',
      properties: {
        posting: {
          type: 'object',
          properties: {
            source: { type: 'string' },
            id: { type: 'string' },
            title: { type: 'string' },
            url: { type: 'string' },
            company: { type: 'string' },
            location: { type: 'string' },
            description: { type: 'string' },
            salary: { type: 'string' },
            published_at: { type: 'string' },
          },
          required: ['source', 'id', 'title', 'url'],
        },
      },
      required: ['posting'],
    },
  },
  {
    name: 'already_seen',
    description: 'Whether a posting key (source:id) was already shown to the user by an earlier run.',
    inputSchema: {
      type: 'object',
      properties: { key: { type: 'string' } },
      required: ['key'],
    },
  },
];

const asPosting = (raw: unknown): Posting | null => {
  if (!isRecord(raw)) return null;
  const { source, id, title, url } = raw;
  if (typeof source !== 'string' || typeof id !== 'string') return null;
  if (typeof title !== 'string' || typeof url !== 'string') return null;
  return {
    source,
    id,
    title,
    url,
    company: typeof raw['company'] === 'string' ? raw['company'] : null,
    location: typeof raw['location'] === 'string' ? raw['location'] : null,
    remote_hint: typeof raw['remote_hint'] === 'boolean' ? raw['remote_hint'] : null,
    description: typeof raw['description'] === 'string' ? raw['description'].slice(0, 4000) : null,
    published_at: typeof raw['published_at'] === 'string' ? raw['published_at'] : null,
    salary: typeof raw['salary'] === 'string' ? raw['salary'] : null,
  };
};

const toolResult = (value: unknown): { content: Array<{ type: 'text'; text: string }> } => ({
  content: [{ type: 'text', text: JSON.stringify(value) }],
});

/** Handle one JSON-RPC request. Unknown methods and bad arguments are errors, not crashes. */
export const handleMcpRequest = async (request: McpRequest, deps: McpDeps): Promise<McpResponse> => {
  const id = request.id ?? null;

  switch (request.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        },
      };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: TOOLS } };

    case 'tools/call': {
      const params = isRecord(request.params) ? request.params : {};
      const name = params['name'];
      const args = isRecord(params['arguments']) ? params['arguments'] : {};

      if (name === 'profile') {
        return {
          jsonrpc: '2.0',
          id,
          result: toolResult({
            headline: deps.profile.headline,
            capabilities: deps.profile.capabilities,
            domains: deps.profile.domains,
            seniority: deps.profile.seniority,
            remote_modes: deps.profile.remote_modes,
            languages: deps.profile.languages,
            accepted_gaps: deps.profile.accepted_gaps,
            threshold: deps.profile.threshold,
            daily_cap: deps.profile.daily_cap,
          }),
        };
      }

      if (name === 'score_posting') {
        const posting = asPosting(args['posting']);
        if (posting === null) {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'posting needs source, id, title and url' } };
        }
        const judged = await judgePosting(posting, deps.promptContext, deps.jev);
        return {
          jsonrpc: '2.0',
          id,
          result: toolResult({
            key: `${posting.source}:${posting.id}`,
            probability: judged.fit.probability,
            verdict: judged.fit.verdict,
            stack_stance: judged.stack_stance.stance,
            threshold: deps.profile.threshold,
            above_threshold: judged.fit.probability >= deps.profile.threshold,
            input_tokens: judged.usage.input_tokens,
          }),
        };
      }

      if (name === 'already_seen') {
        const key = args['key'];
        if (typeof key !== 'string') {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: 'key must be a string' } };
        }
        return { jsonrpc: '2.0', id, result: toolResult({ key, seen: deps.seen.has(key) }) };
      }

      return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown tool ${String(name)}` } };
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${request.method}` } };
  }
};

/** Serve MCP over stdio, one JSON-RPC object per line. */
export const serveStdio = (deps: McpDeps): void => {
  const lines = createInterface({ input: process.stdin });
  lines.on('line', (line: string) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      return;
    }
    const frame = parseMcpRequest(parsed);
    if (frame === null) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } })}\n`);
      return;
    }
    if (frame.notification) {
      // A notification is handled for its side effects and never answered. The
      // rejection is swallowed on purpose: an unhandled rejection exits Node, which
      // would kill the MCP server on a network error in a notification.
      handleMcpRequest(frame.request, deps).catch(() => undefined);
      return;
    }
    const request = frame.request;
    handleMcpRequest(request, deps)
      .then((response) => process.stdout.write(`${JSON.stringify(response)}\n`))
      .catch((error: unknown) => {
        process.stdout.write(
          `${JSON.stringify({
            jsonrpc: '2.0',
            id: request.id ?? null,
            error: { code: -32603, message: error instanceof Error ? error.message : 'internal error' },
          })}\n`,
        );
      });
  });
};
