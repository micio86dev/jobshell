/** What the desktop app reports after it checks a stored key with its provider. */
export type KeyCheckOutcome = 'valid' | 'rejected' | 'unverified' | 'missing';

export interface KeyCheckReport {
  account: string;
  outcome: KeyCheckOutcome;
  status: number | null;
  detail: string;
}

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
