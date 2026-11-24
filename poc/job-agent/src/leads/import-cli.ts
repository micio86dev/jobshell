#!/usr/bin/env node
/**
 * Queue one pasted post, or one public link, for the next lead run. The request arrives as JSON on
 * stdin ({"text": "...", "url": "..."}), never in the argument list. Nothing is bought here: the
 * judgment happens in the run.
 */
import { readFileSync } from 'node:fs';

import { z } from 'zod';
import { loadConfig } from '../config.ts';
import { defaultFetch } from '../jev.ts';
import { importSignal, saveImport } from './import.ts';

const request = z.object({ text: z.string().max(20000).nullable().optional(), url: z.string().max(2000).nullable().optional() });

const main = async (): Promise<void> => {
  let parsed: z.infer<typeof request>;
  try {
    parsed = request.parse(JSON.parse(readFileSync(0, 'utf8')));
  } catch {
    process.stderr.write('the import request is not valid\n');
    process.exit(2);
  }
  const result = await importSignal(parsed, { fetchImpl: defaultFetch, now: new Date() });
  if (!result.ok) {
    process.stderr.write(`${result.reason}\n`);
    process.exit(2);
  }
  saveImport(loadConfig().evidence_dir, result.signal);
  process.stdout.write(`${JSON.stringify({ id: result.signal.id, title: result.signal.title })}\n`);
};

await main();
