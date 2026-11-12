/**
 * Reads a profile payload from stdin and prints a JSON verdict on stdout.
 *
 *   node src/validate-profile-cli.ts < payload.json
 *
 * Exit 0 with {"ok":true}, or exit 1 with {"ok":false,"error":"..."}. The verdict never
 * echoes the payload, so a rejected profile cannot leak its contents into a log.
 */
import { validateProfileText } from './validate.ts';

const chunks: Buffer[] = [];
process.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
process.stdin.on('end', () => {
  const verdict = validateProfileText(Buffer.concat(chunks).toString('utf8'));
  process.stdout.write(`${JSON.stringify(verdict)}\n`);
  process.exitCode = verdict.ok ? 0 : 1;
});
