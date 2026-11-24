/**
 * Reads a CV from stdin and prints the proposed profile fields as one JSON line.
 *
 *   node src/extract-cv-cli.ts < cv.txt
 *
 * Pass `--kind portfolio` for a portfolio; the default is a CV.
 *
 * Exit 0: the model proposed fields. Exit 1: a fallback with a fixed reason. Exit 2: refused
 * (an empty or oversized CV, an unknown --kind, no key stored, or the keyring could not be read).
 * The key is read from the keyring under the desktop app's service; it is never a flag, an
 * environment variable or a file.
 */
import { maxTokensForExtraction, modelForExtraction } from './extract-model.ts';
import { runExtractCv, MAX_CV_CHARS } from './extract-cv.ts';
import type { IntakeKind } from './intake.ts';
import { defaultFetch } from './jev.ts';
import { isCliProvider } from './llm-cli.ts';
import { readSecret } from './secrets.ts';
import { providerChoiceFromEnv } from './provider-choice.ts';

// Bytes bound what is kept: a UTF-8 character is at most 4 bytes and at least one UTF-16 unit, so
// an input past 4 * MAX_CV_CHARS bytes is past MAX_CV_CHARS characters too. It is refused whole,
// never cut short and extracted as if it were complete.
const MAX_CV_BYTES = MAX_CV_CHARS * 4;
const chunks: Buffer[] = [];
let received = 0;
process.stdin.on('data', (chunk: Buffer) => {
  received += chunk.length;
  if (received <= MAX_CV_BYTES) chunks.push(chunk);
});
// A failed read is a refusal with a fixed message, never an unhandled error.
process.stdin.on('error', () => {
  process.stderr.write('the input could not be read\n');
  process.exitCode = 2;
});
process.stdin.on('end', () => {
  if (received > MAX_CV_BYTES) {
    process.stderr.write(`the CV is too long (more than ${MAX_CV_CHARS} characters)\n`);
    process.exitCode = 2;
    return;
  }
  const cv = Buffer.concat(chunks).toString('utf8');
  const kindFlag = process.argv.indexOf('--kind');
  const named = kindFlag === -1 ? 'cv' : process.argv[kindFlag + 1];
  if (named === undefined) {
    // A flag with no value is a mistake, not a request for the default.
    process.stderr.write('--kind needs a value: cv or portfolio\n');
    process.exitCode = 2;
    return;
  }
  if (named !== 'cv' && named !== 'portfolio') {
    process.stderr.write('--kind must be cv or portfolio\n');
    process.exitCode = 2;
    return;
  }
  const kind: IntakeKind = named;
  let choice: ReturnType<typeof providerChoiceFromEnv>;
  try {
    choice = providerChoiceFromEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'the provider choice is invalid'}\n`);
    process.exitCode = 2;
    return;
  }
  const chosen = choice.llm.provider;
  if (isCliProvider(chosen)) {
    // The CV reader needs a provider that answers over an API: a program prints only text for a person.
    process.stderr.write('reading a CV needs a provider with an API key (Anthropic, OpenAI, Gemini or Qwen): choose one in Settings, or fill the fields by hand\n');
    process.exitCode = 2;
    return;
  }
  const llmProvider = chosen;
  // The Anthropic default keeps its model variable, as before the choice existed.
  const model = process.env['JOBSHELL_LLM_MODEL'] ? choice.llm.model
    : choice.llm.provider === 'anthropic' ? modelForExtraction(process.env)
    : choice.llm.model;
  runExtractCv(cv, {
    provider: llmProvider,
    readKey: () => readSecret(llmProvider),
    model,
    maxTokens: maxTokensForExtraction(process.env),
    fetchImpl: defaultFetch,
  }, kind)
    .then((outcome) => {
      process.stdout.write(outcome.stdout);
      process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    })
    .catch(() => {
      // A keychain failure carries no detail that is safe to print; the message is fixed.
      process.stderr.write('the extraction could not complete\n');
      process.exitCode = 2;
    });
});
