/**
 * Reads one report request as JSON from stdin and prints the report as one JSON line.
 *
 *   node src/report-cli.ts < request.json
 *
 * Exit 0: the model wrote the report. Exit 1: a fallback with a fixed reason. Exit 2: refused
 * (a malformed request, or no key stored). The key is read from the keyring under the desktop
 * app's service; it is never a flag, an environment variable or a file.
 */
import { modelForExtraction } from './extract-model.ts';
import { defaultFetch } from './jev.ts';
import { providerChoiceFromEnv } from './provider-choice.ts';
import { generateReport, parseReportRequest } from './report.ts';
import { readSecret } from './secrets.ts';

const MAX_REQUEST_BYTES = 200_000;
const chunks: Buffer[] = [];
let received = 0;
process.stdin.on('data', (chunk: Buffer) => {
  received += chunk.length;
  if (received <= MAX_REQUEST_BYTES) chunks.push(chunk);
});
process.stdin.on('error', () => {
  process.stderr.write('the input could not be read\n');
  process.exitCode = 2;
});
process.stdin.on('end', () => {
  if (received > MAX_REQUEST_BYTES) {
    process.stderr.write('the report request is too large\n');
    process.exitCode = 2;
    return;
  }
  const parsed = parseReportRequest(Buffer.concat(chunks).toString('utf8'));
  if (!parsed.ok) {
    process.stderr.write(`${parsed.reason}\n`);
    process.exitCode = 2;
    return;
  }
  let choice: ReturnType<typeof providerChoiceFromEnv>;
  try {
    choice = providerChoiceFromEnv(process.env);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : 'the provider choice is invalid'}\n`);
    process.exitCode = 2;
    return;
  }
  // The Anthropic default keeps its model variable, the same rule the CV extraction follows.
  const model = process.env['JOBSHELL_LLM_MODEL'] ? choice.llm.model
    : choice.llm.provider === 'anthropic' ? modelForExtraction(process.env)
    : choice.llm.model;
  const apiKey = readSecret(choice.llm.provider);
  if (apiKey === null || apiKey.trim() === '') {
    process.stderr.write(`no ${choice.llm.provider} key is stored under the dev.openjob.desktop service\n`);
    process.exitCode = 2;
    return;
  }
  generateReport(parsed.input, {
    apiKey: apiKey.trim(),
    provider: choice.llm.provider,
    model,
    fetchImpl: defaultFetch,
  })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.source === 'model' ? 0 : 1;
    })
    .catch(() => {
      // Fixed message: a keychain or network error may carry details that must not be printed.
      process.stderr.write('the report could not be written\n');
      process.exitCode = 2;
    });
});
