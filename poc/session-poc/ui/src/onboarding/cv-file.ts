/**
 * Accepts only the CV file types the wizard reads, and turns the chosen file into its text.
 * The user uploads the file; nothing is typed or pasted. A PDF is read here, in the page, so its
 * text reaches the agent the same way a text file does.
 */

export type CvFileKind = 'pdf' | 'text';

const isPdf = (name: string, type: string): boolean => type === 'application/pdf' || /\.pdf$/i.test(name);
const isText = (name: string, type: string): boolean =>
  type === 'text/plain' || type === 'text/markdown' || /\.(txt|md)$/i.test(name);

export const cvFileKind = (file: { name: string; type: string }): CvFileKind | null => {
  if (isPdf(file.name, file.type)) return 'pdf';
  if (isText(file.name, file.type)) return 'text';
  return null;
};

const pdfText = async (bytes: ArrayBuffer): Promise<string> => {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
  const pages: string[] = [];
  for (let number = 1; number <= document.numPages; number += 1) {
    const page = await document.getPage(number);
    const content = await page.getTextContent();
    pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
  }
  return pages.join('\n').trim();
};

export const readCvFile = async (file: File): Promise<string> => {
  const kind = cvFileKind(file);
  if (kind === null) throw new Error('unsupported CV file');
  if (kind === 'text') return (await file.text()).trim();
  return pdfText(await file.arrayBuffer());
};
