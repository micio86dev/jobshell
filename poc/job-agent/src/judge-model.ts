/**
 * The judge answered by the model the user chose, instead of a hosted System One service.
 *
 * For a person who uses a subscription (or any provider) and wants no further key: the same
 * questions are put to that model in one request and it answers in the same shape, so everything
 * downstream (scoring, gates, caches) is unchanged. A model's own probabilities are less calibrated
 * than a purpose-built judge's, which is why this is a choice and not a silent substitution.
 */
import type { JeAnswer, JeQuestion, JeResponse } from './jev.ts';
import { askModel, type AskDeps } from './llm-call.ts';

const PROMPT = (state: unknown, questions: Record<string, JeQuestion>): string =>
  [
    'You are a careful judge. Read the state and answer every question about it. Use only what the state says; when it does not say, stay near 0.5 and do not guess.',
    'Each answer is a probability between 0 and 1, never a certainty unless the state states it outright.',
    '- A "noul" question: {"type":"noul","noul": probability that the statement is true}.',
    '- A "choice" question: {"type":"choice","choice": one of the listed keys,"confidence": 0..1,"probabilities": {key: probability for every key, summing to 1}}.',
    'Answer with one JSON object and nothing else: {"answers": {"<question name>": <answer>, ...}}.',
    '',
    'STATE:',
    JSON.stringify(state),
    '',
    'QUESTIONS:',
    JSON.stringify(questions),
  ].join('\n');

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

const objectIn = (text: string): unknown => {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
};

/** Put the questions to the chosen model. A failure throws a fixed sentence, as the hosted judge does. */
export const askViaModel = async (
  request: { state: unknown; questions: Record<string, JeQuestion> },
  deps: AskDeps,
  parse: (raw: unknown) => Record<string, JeAnswer>,
): Promise<JeResponse> => {
  // A model sometimes answers in prose: it is asked once more before the company is given up on.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const said = await askModel(PROMPT(request.state, request.questions), deps);
    if (!said.ok) throw new Error(`judgment: ${said.reason}`);
    const object = objectIn(said.text);
    const answers = parse(isRecord(object) ? object['answers'] : null);
    if (Object.keys(answers).length > 0) return { model: `${deps.provider}:${deps.model}`, answers, usage: said.usage };
  }
  throw new Error('judgment: the model answer had no usable answers');
};
