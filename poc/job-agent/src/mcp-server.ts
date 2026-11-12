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
import { z } from 'zod';
import { createInterface } from 'node:readline';

import { judgePosting, type JeDeps } from './jev.ts';
import { parsePosting } from './posting-input.ts';
import type { UserProfile } from './profile.ts';
import { loadSeen } from './seen.ts';
import type { Posting } from './sources/types.ts';

export { loadSeen };

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_INFO = { name: 'openjob-agent', version: '0.1.0' };

export type McpDeps = {
  profile: UserProfile;
  promptContext: string;
  jev: JeDeps;
  /**
   * Asked at call time, not captured at startup: a set loaded once would answer
   * "unseen" for everything scored during this session and ignore what a later
   * `make agent` run added.
   */
  seen: (key: string) => boolean;
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

/** A tools/call request: the tool name, and its arguments as an object when present. */
const toolCall = z.object({
  name: z.string({ error: 'name must be text' }).min(1),
  arguments: z.record(z.string(), z.unknown()).optional(),
});

/** The JSON-RPC envelope. An absent id is a notification; a null, text or numeric id is a request. */
const envelope = z.object({
  jsonrpc: z.literal('2.0', { error: 'only the JSON-RPC 2.0 protocol is spoken' }),
  method: z.string({ error: 'method must be text' }).min(1, { error: 'method must be text' }),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  params: z.unknown().optional(),
});

/**
 * Validate an incoming JSON-RPC frame at the boundary.
 *
 * Returns null for a frame that is not a request, and marks a frame without an `id`
 * as a notification: JSON-RPC forbids answering one, and clients reject a response
 * to `notifications/initialized`.
 */
export const parseMcpRequest = (raw: unknown): { request: McpRequest; notification: boolean } | null => {
  const parsed = envelope.safeParse(raw);
  if (!parsed.success) return null;
  const id = parsed.data.id;
  return {
    request: { jsonrpc: '2.0', method: parsed.data.method, id: id ?? null, params: parsed.data.params },
    notification: id === undefined,
  };
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
      // The call is a zod shape: a tool name that is text, and arguments that are an object.
      const call = toolCall.safeParse(request.params);
      if (!call.success) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'invalid params: a tool call needs a name' } };
      }
      const name = call.data.name;
      const args = call.data.arguments ?? {};

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
        const posting = parsePosting(args['posting']);
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
        return { jsonrpc: '2.0', id, result: toolResult({ key, seen: deps.seen(key) }) };
      }

      // The name the caller sent is not echoed back: it may carry anything.
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'unknown tool' } };
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `unknown method ${request.method}` } };
  }
};

/**
 * The answer to a request that failed inside the agent. The client gets a fixed message: a provider
 * or a path can be in the error text, and the protocol channel is not where that belongs.
 */
export const internalErrorResponse = (id: string | number | null | undefined, _error: unknown): McpResponse => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code: -32603, message: 'internal error' },
});

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
      handleMcpRequest(frame.request, deps).catch((error: unknown) => {
        process.stderr.write(`openjob-agent: notification failed: ${error instanceof Error ? error.message : String(error)}\n`);
      });
      return;
    }
    const request = frame.request;
    handleMcpRequest(request, deps)
      .then((response) => process.stdout.write(`${JSON.stringify(response)}\n`))
      .catch((error: unknown) => {
        process.stderr.write(`openjob-agent: request failed: ${error instanceof Error ? error.message : String(error)}\n`);
        process.stdout.write(
          `${JSON.stringify(internalErrorResponse(request.id, error))}\n`,
        );
      });
  });
};
