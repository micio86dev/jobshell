/**
 * Read-only HTTP probes that identify themselves, carry a timeout, and pace
 * themselves. Phase 0 never writes to a third-party service.
 */

export type ProbeResult = {
  url: string;
  status: number | null;
  ok: boolean;
  body: unknown;
  error: string | null;
  elapsed_ms: number;
};

export type ProbeOptions = {
  /** Milliseconds between consecutive requests in a batch, regardless of host. */
  delayMs?: number;
  timeoutMs?: number;
  userAgent?: string;
  /** Extra headers, e.g. an Accept type. Never credentials. */
  headers?: Record<string, string>;
};

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const probeJson = async (url: string, options: ProbeOptions = {}): Promise<ProbeResult> => {
  const { timeoutMs = 15_000, userAgent = 'openjob-phase0-probe', headers = {} } = options;
  const started = performance.now();
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': userAgent, accept: 'application/json', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let body: unknown = text.slice(0, 400);
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      /* keep the text snippet: the body was not JSON */
    }
    return {
      url,
      status: res.status,
      ok: res.ok,
      body,
      error: null,
      elapsed_ms: Math.round(performance.now() - started),
    };
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      body: null,
      error: error instanceof Error ? error.message : String(error),
      elapsed_ms: Math.round(performance.now() - started),
    };
  }
};

/** Sequential probes with a fixed delay so a batch cannot become a burst. */
export const probeBatch = async (
  urls: string[],
  options: ProbeOptions = {},
): Promise<ProbeResult[]> => {
  const { delayMs = 1000 } = options;
  const results: ProbeResult[] = [];
  for (const [index, url] of urls.entries()) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    results.push(await probeJson(url, options));
  }
  return results;
};
