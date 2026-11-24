/**
 * The judgment services that answer POST /v1/systemone. Each one is a place the answer
 * can come from; the model name is chosen per service.
 *  - typesafe: hosted by TypeSafe, needs its key (Jev).
 *  - ollama: a model on this machine, no key.
 *  - provider: no separate service. The model the user chose for the AI work (an API provider or a
 *    subscription program) answers the questions too, so there is no further key.
 *  - laya: a model the user runs themselves, no key; the address is theirs to name, since
 *    Laya has no published default port.
 */
import { TYPESAFE_URL } from './jev.ts';
import { checkEndpoint } from './endpoints.ts';

export const JUDGMENT_SERVICES = ['typesafe', 'ollama', 'laya', 'provider'] as const;
export type JudgmentService = (typeof JUDGMENT_SERVICES)[number];

export type JudgmentTarget = {
  service: JudgmentService;
  url: string;
  needsKey: boolean;
  defaultModel: string | null;
};

const OLLAMA_URL = 'http://localhost:11434/v1/systemone';

/** The address and key rules of one service. `address` is required only for Laya. */
export const judgmentService = (service: JudgmentService, address?: string): JudgmentTarget => {
  if (service === 'typesafe') {
    return { service, url: TYPESAFE_URL, needsKey: true, defaultModel: 'jev-1.14.0' };
  }
  if (service === 'provider') {
    // No address: the questions go to the chosen model, not to a service.
    return { service, url: '', needsKey: false, defaultModel: 'provider' };
  }
  if (service === 'ollama') {
    return { service, url: OLLAMA_URL, needsKey: false, defaultModel: null };
  }
  if (address === undefined || address.trim() === '') {
    throw new Error('laya needs an endpoint: name the address where it runs');
  }
  const url = address.trim();
  const check = checkEndpoint(url);
  if (!check.ok) throw new Error(`laya endpoint refused: ${check.reason}`);
  return { service, url, needsKey: false, defaultModel: null };
};
