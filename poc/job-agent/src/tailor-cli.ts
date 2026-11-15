/**
 * Reads one request as JSON from stdin, writes the tailored CV, and prints one JSON line.
 *
 *   node src/tailor-cli.ts --pdf /absolute/path/cv.pdf < request.json
 *
 * With --pdf, the CV is also written there as a PDF; the path must be absolute and end in .pdf.
 * Exit 0: the model wrote the CV (and the PDF, when asked). Exit 1: a fallback with a fixed
 * reason. Exit 2: refused (a bad request, a bad --pdf path, or no key stored).
 * The key comes from the keyring under the desktop app's service; never a flag or a file.
 */
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { modelForExtraction } from './extract-model.ts';
import { defaultFetch } from './jev.ts';
import { markdownToPdf } from './cv-pdf.ts';
import { providerChoiceFromEnv } from './provider-choice.ts';
import { parseReportRequest } from './report.ts';
import { tailorCv } from './tailor.ts';
import { readSecret } from './secrets.ts';

const MAX_REQUEST_BYTES = 200_000;

const pdfPathFrom = (argv: readonly string[]): { ok: true; path: string | null } | { ok: false; reason: string } => {
  const flag = argv.indexOf('--pdf');
  if (flag === -1) return { ok: true, path: null };
  const path = argv[flag + 1];
  if (path === undefined) return { ok: false, reason: '--pdf needs a path' };
  if (!isAbsolute(path) || !path.endsWith('.pdf')) return { ok: false, reason: '--pdf must be an absolute path ending in .pdf' };
  return { ok: true, path };
};

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
    process.stderr.write('the request is too large\n');
    process.exitCode = 2;
    return;
  }
  const pdfPath = pdfPathFrom(process.argv);
  if (!pdfPath.ok) {
    process.stderr.write(`${pdfPath.reason}\n`);
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
  const model = process.env['JOBSHELL_LLM_MODEL'] ? choice.llm.model
    : choice.llm.provider === 'anthropic' ? modelForExtraction(process.env)
    : choice.llm.model;
  const apiKey = readSecret(choice.llm.provider);
  if (apiKey === null || apiKey.trim() === '') {
    process.stderr.write(`no ${choice.llm.provider} key is stored under the dev.openjob.desktop service\n`);
    process.exitCode = 2;
    return;
  }
  tailorCv(parsed.input, {
    apiKey: apiKey.trim(),
    provider: choice.llm.provider,
    model,
    fetchImpl: defaultFetch,
  })
    .then((result) => {
      if (result.source === 'fallback') {
        process.stdout.write(`${JSON.stringify(result)}\n`);
        process.exitCode = 1;
        return;
      }
      if (pdfPath.path !== null) writeFileSync(pdfPath.path, markdownToPdf(result.markdown));
      process.stdout.write(`${JSON.stringify({ ...result, pdf: pdfPath.path })}\n`);
      process.exitCode = 0;
    })
    .catch(() => {
      // Fixed message: a keychain or network error may carry details that must not be printed.
      process.stderr.write('the tailored CV could not be written\n');
      process.exitCode = 2;
    });
});
