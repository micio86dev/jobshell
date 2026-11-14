import { z } from 'zod';

/** What the desktop app reports after it checks a stored key with its provider. */
const keyCheckReportSchema = z.object({
  account: z.string(),
  outcome: z.enum(['valid', 'rejected', 'unverified', 'missing']),
  status: z.number().int().nullable(),
  detail: z.string(),
});

export type KeyCheckReport = z.infer<typeof keyCheckReportSchema>;
export type KeyCheckOutcome = KeyCheckReport['outcome'];

/** Validate what arrives from the desktop app. Anything that does not match the contract is refused. */
export const parseKeyCheckReport = (value: unknown): KeyCheckReport | null => {
  const parsed = keyCheckReportSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export interface KeyCheckView {
  tone: 'ok' | 'bad' | 'unknown';
  text: string;
}

/** The message the Settings view shows for a key check. It never includes the key. */
export const describeKeyCheck = (report: KeyCheckReport): KeyCheckView => {
  switch (report.outcome) {
    case 'valid':
      return { tone: 'ok', text: 'chiave valida' };
    case 'rejected':
      return {
        tone: 'bad',
        text: `chiave non accettata (HTTP ${report.status ?? '?'}): è sbagliata, scaduta o revocata. Inseriscine una nuova e premi Salva.`,
      };
    case 'unverified':
      return { tone: 'unknown', text: `chiave non verificata: ${report.detail}` };
    case 'missing':
      return { tone: 'unknown', text: 'nessuna chiave salvata' };
  }
};
