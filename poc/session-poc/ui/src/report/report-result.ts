/**
 * Reads the report command's answer: one JSON line from the agent's report CLI, either the
 * Markdown report or a fixed reason. Anything else is refused, never shown as a report.
 */
export type ReportView = { ok: true; markdown: string } | { ok: false; reason: string };

const UNREADABLE = 'the report answer could not be read';

export const parseReportResult = (raw: string): ReportView => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: UNREADABLE };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { ok: false, reason: UNREADABLE };
  const record = parsed as Record<string, unknown>;
  if (record['source'] === 'model') {
    const markdown = record['markdown'];
    if (typeof markdown === 'string' && markdown.trim().length > 0) return { ok: true, markdown };
    return { ok: false, reason: UNREADABLE };
  }
  if (record['source'] === 'fallback' && typeof record['reason'] === 'string') {
    return { ok: false, reason: record['reason'] };
  }
  return { ok: false, reason: UNREADABLE };
};
