/**
 * The localhost bridge between the browser extension and the agent.
 *
 * The extension reads the page the user is looking at and posts the postings it
 * found here; the bridge judges them with the same profile and the same scorer the
 * daily run uses, and answers with probabilities the extension paints on the page.
 *
 * It binds to 127.0.0.1 only and requires a per-session token, because a localhost
 * port is reachable by every other program on the machine. The token is printed at
 * startup and pasted into the extension once.
 *
 * The handlers are pure functions; the HTTP server is a thin wrapper, so the
 * behaviour is tested without opening a socket.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';

import { judgePosting, type JeDeps } from './jev.ts';
import type { Posting } from './sources/types.ts';

export type ScoreRequest = { postings: Posting[] };
export type ScoreResult = {
  key: string;
  title: string;
  url: string;
  probability: number;
  verdict: string;
  stack_stance: string;
};
export type ScoreResponse = { results: ScoreResult[]; threshold: number; input_tokens: number };

export type BridgeDeps = {
  jev: JeDeps;
  promptContext: string;
  threshold: number;
  token: string;
  maxPostings?: number;
};

export const DEFAULT_MAX_POSTINGS = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate what the extension sent. A malformed posting is dropped, never trusted. */
export const parseScoreRequest = (raw: unknown): Posting[] => {
  if (!isRecord(raw)) return [];
  const postings = raw['postings'];
  if (!Array.isArray(postings)) return [];
  const out: Posting[] = [];
  for (const item of postings) {
    if (!isRecord(item)) continue;
    const { source, id, title, url } = item;
    if (typeof source !== 'string' || source.length === 0) continue;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (typeof title !== 'string' || title.length === 0) continue;
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) continue;
    out.push({
      source,
      id,
      title,
      url,
      company: typeof item['company'] === 'string' ? item['company'] : null,
      location: typeof item['location'] === 'string' ? item['location'] : null,
      remote_hint: typeof item['remote_hint'] === 'boolean' ? item['remote_hint'] : null,
      description: typeof item['description'] === 'string' ? item['description'].slice(0, 4000) : null,
      published_at: typeof item['published_at'] === 'string' ? item['published_at'] : null,
      salary: typeof item['salary'] === 'string' ? item['salary'] : null,
    });
  }
  return out.slice(0, DEFAULT_MAX_POSTINGS);
};

/** Judge the postings the user is looking at. No storage, no side effects. */
export const handleScore = async (raw: unknown, deps: BridgeDeps): Promise<ScoreResponse> => {
  const postings = parseScoreRequest(raw);
  const results: ScoreResult[] = [];
  let inputTokens = 0;

  for (const posting of postings) {
    const judged = await judgePosting(posting, deps.promptContext, deps.jev);
    inputTokens += judged.usage.input_tokens;
    results.push({
      key: `${posting.source}:${posting.id}`,
      title: posting.title,
      url: posting.url,
      probability: judged.fit.probability,
      verdict: judged.fit.verdict,
      stack_stance: judged.stack_stance.stance,
    });
  }

  return { results, threshold: deps.threshold, input_tokens: inputTokens };
};

export const handleHealth = (deps: BridgeDeps): { ok: true; threshold: number } => ({
  ok: true,
  threshold: deps.threshold,
});

/** Constant-time comparison, with the length check first because it throws on a mismatch. */
const tokenMatches = (presented: string | string[] | undefined, expected: string): boolean => {
  if (typeof presented !== 'string') return false;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

const send = (response: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json',
    // The extension origin is chrome-extension://…, so the preflight must be allowed.
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, x-openjob-token',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
  });
  response.end(payload);
};

const readBody = (request: IncomingMessage, limit = 1_000_000): Promise<string> =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });

export type BridgeServer = { port: number; token: string; close: () => Promise<void> };

/** Start the bridge on 127.0.0.1 and return its port and token. */
export const startBridge = async (deps: BridgeDeps, port = 0): Promise<BridgeServer> => {
  const token = deps.token.length > 0 ? deps.token : randomBytes(24).toString('hex');
  const withToken: BridgeDeps = { ...deps, token };

  const server = createServer((request, response) => {
    const url = request.url ?? '/';

    if (request.method === 'OPTIONS') {
      send(response, 204, {});
      return;
    }

    if (!tokenMatches(request.headers['x-openjob-token'], withToken.token)) {
      send(response, 401, { error: 'missing or invalid x-openjob-token' });
      return;
    }

    if (request.method === 'GET' && url === '/health') {
      send(response, 200, handleHealth(withToken));
      return;
    }

    if (request.method === 'POST' && url === '/score') {
      readBody(request)
        .then(async (body) => {
          const parsed: unknown = JSON.parse(body);
          send(response, 200, await handleScore(parsed, withToken));
        })
        .catch((error: unknown) => {
          send(response, 400, { error: error instanceof Error ? error.message : 'bad request' });
        });
      return;
    }

    send(response, 404, { error: 'not found' });
  });

  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: boundPort,
    token: withToken.token,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};
