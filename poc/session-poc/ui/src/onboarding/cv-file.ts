/**
 * Accepts only the CV file types the wizard reads, and turns the chosen file into its text.
 * The user uploads the file; nothing is typed or pasted. A PDF is read by the agent, so its text
 * reaches the agent the same way a text file does.
 */

import { invoke } from '@tauri-apps/api/core';
import { z } from 'zod';

const pdfTextSchema = z.string();

export type CvFileKind = 'pdf' | 'text';

const isPdf = (name: string, type: string): boolean => type === 'application/pdf' || /\.pdf$/i.test(name);
const isText = (name: string, type: string): boolean =>
  type === 'text/plain' || type === 'text/markdown' || /\.(txt|md)$/i.test(name);

export const cvFileKind = (file: { name: string; type: string }): CvFileKind | null => {
  if (isPdf(file.name, file.type)) return 'pdf';
  if (isText(file.name, file.type)) return 'text';
  return null;
};

export const readCvFile = async (file: File): Promise<string> => {
  const kind = cvFileKind(file);
  if (kind === null) throw new Error('unsupported CV file');
  if (kind === 'text') return (await file.text()).trim();
  // The PDF is read by the agent's reader in Node: the webview's own reader failed on some files.
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  // The text comes from the Rust side: it is checked at this boundary, not trusted.
  return pdfTextSchema.parse(await invoke<unknown>('cv_read_pdf', { bytes }));
};
