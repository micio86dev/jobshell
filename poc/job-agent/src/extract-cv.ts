/**
 * The CV extraction entry: CV text in, one JSON verdict out.
 *
 * The key is read through an injected reader, so it comes from the agent's own keyring
 * account in production and from a fake in tests. Output carries only the proposal or a
 * fixed reason: never the key, never the CV text, never a raw provider or network error.
 */
import { extractCandidateFields, type IntakeResult } from './intake.ts';
import type { FetchLike } from './jev.ts';

export const MAX_CV_CHARS = 60_000;

export type ExtractDeps = {
  /** Returns the stored Anthropic key, or null when none is stored. */
  readKey: () => string | null;
  model: string;
  fetchImpl: FetchLike;
};

export type ExtractOutcome = { exitCode: number; stdout: string; stderr: string };

const refuse = (message: string): ExtractOutcome => ({ exitCode: 2, stdout: '', stderr: `${message}\n` });

export const runExtractCv = async (cv: string, deps: ExtractDeps): Promise<ExtractOutcome> => {
  if (cv.trim().length === 0) return refuse('the CV is empty');
  if (cv.length > MAX_CV_CHARS) return refuse(`the CV is too long (more than ${MAX_CV_CHARS} characters)`);

  const apiKey = deps.readKey();
  if (apiKey === null || apiKey.length === 0) {
    return refuse(
      'no Anthropic key is stored under the openjob-agent service. Add it once with: ' +
        'security add-generic-password -a anthropic -s openjob-agent -w',
    );
  }

  const result: IntakeResult = await extractCandidateFields(cv, {
    apiKey,
    model: deps.model,
    fetchImpl: deps.fetchImpl,
  });
  // The reason is produced by the intake module as a fixed string, so it is safe to print.
  const verdict = { source: result.source, reason: result.reason, fields: result.fields };
  return {
    exitCode: result.source === 'model' ? 0 : 1,
    stdout: `${JSON.stringify(verdict)}\n`,
    stderr: '',
  };
};
