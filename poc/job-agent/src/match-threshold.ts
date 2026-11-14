/**
 * The match threshold for a run. The desktop app sets JOBSHELL_MATCH_THRESHOLD from the
 * percentage the user chose in Settings; without it, the threshold saved in the profile applies.
 */

const WHOLE_PERCENT = /^\s*\d{1,3}\s*$/;

export const thresholdOverride = (env: Record<string, string | undefined>, profileThreshold: number): number => {
  const raw = env['JOBSHELL_MATCH_THRESHOLD'];
  if (raw === undefined || raw.trim() === '') return profileThreshold;
  const percent = WHOLE_PERCENT.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isInteger(percent) || percent < 1 || percent > 100) {
    throw new Error('the match threshold must be a whole percentage from 1 to 100');
  }
  return percent / 100;
};
