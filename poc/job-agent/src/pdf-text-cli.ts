/**
 * Reads a PDF from stdin and prints its text on stdout.
 *
 *   node src/pdf-text-cli.ts < cv.pdf
 *
 * Exit 0: the text, possibly empty. Exit 2: the input is not a readable PDF.
 */
import { pdfText } from './pdf-text.ts';

const chunks: Buffer[] = [];
process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
process.stdin.on('error', () => {
  process.stderr.write('the input could not be read\n');
  process.exitCode = 2;
});
process.stdin.on('end', () => {
  pdfText(new Uint8Array(Buffer.concat(chunks)))
    .then((text) => {
      process.stdout.write(text);
    })
    .catch((error: unknown) => {
      process.stderr.write(`the PDF could not be read: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 2;
    });
});
