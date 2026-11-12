/**
 * The part of pdf.js this wizard uses. The package's own typings do not parse under TypeScript 5.9,
 * so the module is declared here, with exactly the shapes read.
 */
declare module 'pdfjs-dist/build/pdf.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(source: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(number: number): Promise<{
        getTextContent(): Promise<{ items: Array<{ str?: string } | object> }>;
      }>;
    }>;
  };
}
