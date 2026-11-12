/**
 * The localhost bridge between the browser extension and the agent.
 *
 * The extension reads the page the user is looking at and posts the postings it
 * found here; the bridge judges them with the same profile and the same scorer the
 * daily run uses, and answers with probabilities the extension paints on the page.
 *
 * It binds to 127.0.0.1 only and accepts a score request only from a
 * `chrome-extension://` origin, so a web page cannot spend the user's tokens. It reads the
 * key from the keyring on each request; writing a key is the desktop app's job.
 *
 * The handlers are mostly pure: the judgment calls and the keyring read are injected, and the
 * HTTP server is a thin wrapper, so the behaviour is tested without opening a socket.
 */
import { parsePostings } from './posting-input.ts';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { judgePosting, type JeDeps } from './jev.ts';
import { keyStatus, readKey, type KeyringReader } from './keys.ts';
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
export type ScoreError = { key: string; message: string };
export type ScoreResponse = {
  results: ScoreResult[];
  /** Postings whose judgment failed. One failure never discards the rest of the batch. */
  errors: ScoreError[];
  threshold: number;
  input_tokens: number;
};

/** How many judgments run at once. Enough to keep the popup responsive, few enough to stay polite. */
export const DEFAULT_CONCURRENCY = 4;

/** Run an async function over items with a bounded number in flight, preserving order. */
export const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  run: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await run(item);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
};

export type ScoreLog = {
  at: string;
  postings: number;
  scored: number;
  failed: number;
  input_tokens: number;
  ms: number;
};

export type BridgeDeps = {
  jev: JeDeps;
  promptContext: string;
  threshold: number;
  /** Called once per score request, so a session leaves a record instead of an impression. */
  log?: (record: ScoreLog) => void;
  /** Where the TypeSafe key comes from. Read per request, so a key saved in the settings
   * page works without restarting the bridge. */
  resolveKey?: () => string | null;
  /** How the keyring is read. Absent means the real keychain; tests inject a stub. */
  keyring?: KeyringReader;
};

export const DEFAULT_MAX_POSTINGS = 40;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Validate what the extension sent. A malformed posting is dropped, never trusted. */
export const parseScoreRequest = (raw: unknown): Posting[] => {
  if (!isRecord(raw)) return [];
  const postings = raw['postings'];
  if (!Array.isArray(postings)) return [];
  return parsePostings(postings).slice(0, DEFAULT_MAX_POSTINGS);
};

/** Judge the postings the user is looking at. Nothing is stored; the call is reported
 * through `deps.log` when one is configured. */
export const handleScore = async (raw: unknown, deps: BridgeDeps): Promise<ScoreResponse> => {
  const started = Date.now();
  const postings = parseScoreRequest(raw);

  const outcomes = await mapWithConcurrency(postings, DEFAULT_CONCURRENCY, async (posting) => {
    const key = `${posting.source}:${posting.id}`;
    try {
      const judged = await judgePosting(posting, deps.promptContext, deps.jev);
      return { ok: true as const, key, posting, judged };
    } catch (error) {
      // One posting that cannot be judged must not cost the user the other 39.
      // Only the judge's own fixed messages (a status code, or a body that is not JSON) reach the client.
      // Anything else is a raw error text, and it stays on this side.
      const message = error instanceof Error ? error.message : '';
      const fixed = /^typesafe: (request failed with status \d{3}|response was not JSON)$/.test(message);
      return { ok: false as const, key, message: fixed ? message : 'the posting could not be judged' };
    }
  });

  const results: ScoreResult[] = [];
  const errors: ScoreError[] = [];
  let inputTokens = 0;

  for (const outcome of outcomes) {
    if (!outcome.ok) {
      errors.push({ key: outcome.key, message: outcome.message });
      continue;
    }
    const { posting, judged } = outcome;
    inputTokens += judged.usage.input_tokens;
    results.push({
      key: outcome.key,
      title: posting.title,
      url: posting.url,
      probability: judged.fit.probability,
      verdict: judged.fit.verdict,
      stack_stance: judged.stack_stance.stance,
    });
  }

  deps.log?.({
    at: new Date().toISOString(),
    postings: postings.length,
    scored: results.length,
    failed: errors.length,
    input_tokens: inputTokens,
    ms: Date.now() - started,
  });

  return { results, errors, threshold: deps.threshold, input_tokens: inputTokens };
};

export const handleHealth = (deps: BridgeDeps): { ok: true; threshold: number } => ({
  ok: true,
  threshold: deps.threshold,
});

/**
 * Only a browser extension may score, and a web page cannot pretend to be one: the
 * browser sets `Origin` itself, so a page on `https://evil.test` cannot present
 * `chrome-extension://…`. That is what replaces the token the user had to paste.
 *
 * A local program can still forge the header, but a program running as this user can
 * read the keyring directly, so the token never protected against it.
 */
/**
 * The ID of this extension, fixed by the `key` in `extension/manifest.json`.
 *
 * Accepting any `chrome-extension://` origin would let any other installed extension with
 * host permission for 127.0.0.1 spend the user's tokens. A web page cannot forge an
 * extension origin at all, so this closes the remaining hole.
 */
/** The only origin allowed to score: the openjob browser extension. */
export const EXTENSION_ID = 'afigpbinfehpdhoolpoickipbklcogoa';
export const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;

export const isExtensionOrigin = (origin: string | string[] | undefined): boolean =>
  typeof origin === 'string' && origin === EXTENSION_ORIGIN;

/** The app's own page is same-origin, so a request from it is recognised. */
export const isLocalOrigin = (origin: string | string[] | undefined, port: number): boolean =>
  typeof origin === 'string' &&
  (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`);

export const isAllowedOrigin = (origin: string | string[] | undefined, port: number): boolean =>
  isExtensionOrigin(origin) || isLocalOrigin(origin, port);

const send = (response: ServerResponse, status: number, body: unknown, origin?: string, port = 0): void => {
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (origin !== undefined && isAllowedOrigin(origin, port)) {
    headers['access-control-allow-origin'] = origin;
    headers['vary'] = 'origin';
    headers['access-control-allow-headers'] = 'content-type';
    headers['access-control-allow-methods'] = 'GET, POST, OPTIONS';
  }
  response.writeHead(status, headers);
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

export type BridgeServer = { port: number; close: () => Promise<void> };

/** The port the server is actually on, needed to recognise its own settings page. */
const boundPortFor = (server: Server): number => {
  const address = server.address();
  return typeof address === 'object' && address !== null ? address.port : 0;
};

/** Start the bridge on 127.0.0.1 and return the port it bound. */
export const startBridge = async (deps: BridgeDeps, port = 0): Promise<BridgeServer> => {
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    const origin = request.headers['origin'];

    if (request.method === 'OPTIONS') {
      send(response, 204, {}, origin);
      return;
    }

    // Health is open so the popup can say "the bridge is not running" without asking
    // the user anything; it reveals nothing but the threshold.
    if (request.method === 'GET' && url === '/health') {
      send(response, 200, handleHealth(deps), origin, boundPortFor(server));
      return;
    }

    if (request.method === 'POST' && url === '/score') {
      if (!isExtensionOrigin(origin)) {
        send(response, 403, { error: 'only a browser extension may score' }, origin, boundPortFor(server));
        return;
      }
      readBody(request)
        .then(async (body) => {
          const boundPort = boundPortFor(server);
          const key = (deps.resolveKey ?? (() => readKey('typesafe', deps.keyring)))();
          if (key === null) {
            // The bridge starts without a key on purpose: the settings page has to be
            // reachable before the first key exists.
            send(
              response,
              409,
              { error: 'no TypeSafe key: add it in the openjob app settings.' },
              origin,
              boundPort,
            );
            return;
          }
          const parsed: unknown = JSON.parse(body);
          send(
            response,
            200,
            await handleScore(parsed, { ...deps, jev: { ...deps.jev, apiKey: key } }),
            origin,
            boundPort,
          );
        })
        .catch((error: unknown) => {
          // The request body is never quoted back: a parse error can contain a fragment of it.
          send(response, 400, { error: 'bad request' }, origin, boundPortFor(server));
        });
      return;
    }

    send(response, 404, { error: 'not found' }, origin, boundPortFor(server));
  });

  await new Promise<void>((resolve, reject) => {
    // Without this handler a busy port emits 'error', the promise never settles and
    // the CLI waits forever with nothing on screen.
    const onError = (error: Error): void => {
      reject(new Error(`bridge: cannot listen on 127.0.0.1:${port}: ${error.message}`));
    };
    server.once('error', onError);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', onError);
      resolve();
    });
  });
  const address = server.address();
  const boundPort = typeof address === 'object' && address !== null ? address.port : port;

  return {
    port: boundPort,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
};
