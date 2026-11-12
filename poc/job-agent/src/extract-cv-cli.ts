/**
 * Reads a CV from stdin and prints the proposed profile fields as one JSON line.
 *
 *   node src/extract-cv-cli.ts < cv.txt
 *
 * Exit 0: the model proposed fields. Exit 1: a fallback with a fixed reason. Exit 2: refused
 * (no key stored, empty or oversized CV). The key is read from the keyring under the
 * agent's own service name; it is never a flag, an environment variable or a file.
 */
import { DEFAULT_MODEL } from './config.ts';
import { runExtractCv, MAX_CV_CHARS } from './extract-cv.ts';
import { defaultFetch } from './jev.ts';
import { readSecret } from './secrets.ts';

const chunks: Buffer[] = [];
let received = 0;
process.stdin.on('data', (chunk: Buffer) => {
  received += chunk.length;
  // Stop reading well past the character bound, so a huge input cannot exhaust memory.
  if (received <= MAX_CV_CHARS * 4) chunks.push(chunk);
});
process.stdin.on('end', () => {
  const cv = Buffer.concat(chunks).toString('utf8');
  runExtractCv(cv, {
    readKey: () => readSecret('anthropic'),
    model: DEFAULT_MODEL.anthropic,
    fetchImpl: defaultFetch,
  })
    .then((outcome) => {
      process.stdout.write(outcome.stdout);
      process.stderr.write(outcome.stderr);
      process.exitCode = outcome.exitCode;
    })
    .catch(() => {
      // A keychain failure carries no detail that is safe to print; the message is fixed.
      process.stderr.write('the CV could not be read from the keychain\n');
      process.exitCode = 2;
    });
});
