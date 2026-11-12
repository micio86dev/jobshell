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
import { readSecret } from './secrets.ts';

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
  runExtractCv(cv, {
    readKey: () => readSecret('anthropic'),
    model: modelForExtraction(process.env),
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
      process.stderr.write('the extraction could not run: the keychain or the request failed\n');
      process.exitCode = 2;
    });
});
