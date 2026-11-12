/**
 * Reads a portfolio link from stdin and prints one JSON line: whether the link answers, its status
 * and the text the page carries.
 *
 *   echo "https://example.com/me" | node src/portfolio-link-cli.ts
 *
 * Exit 0: the link answers. Exit 1: it does not answer. Exit 2: refused before any request
 * (not a public https address, or the input could not be read).
 */
import { checkPortfolioLink, parsePortfolioLink } from './portfolio-link.ts';

const MAX_INPUT_BYTES = 4096;
const chunks: Buffer[] = [];
let received = 0;

process.stdin.on('data', (chunk: Buffer) => {
  received += chunk.length;
  if (received <= MAX_INPUT_BYTES) chunks.push(chunk);
});

process.stdin.on('error', () => {
  process.stderr.write('the input could not be read\n');
  process.exitCode = 2;
});

process.stdin.on('end', () => {
  if (received > MAX_INPUT_BYTES) {
    process.stderr.write('the portfolio link is too long\n');
    process.exitCode = 2;
    return;
  }
  const parsed = parsePortfolioLink(Buffer.concat(chunks).toString('utf8'));
  if (!parsed.ok) {
    process.stderr.write('the portfolio link must be a public https address\n');
    process.exitCode = 2;
    return;
  }
  // Any failure after the input is accepted is a link that does not answer: one JSON line, exit 1.
  checkPortfolioLink(parsed.link, (url, init) => fetch(url, init))
    .catch(() => ({ reachable: false, status: 0, text: '' }))
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
      process.exitCode = result.reachable ? 0 : 1;
    });
});
