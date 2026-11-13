/**
 * pdfjs 6 hashes and encodes bytes with Uint8Array methods that the webview of some systems does
 * not have yet (hex and base64 conversions). Without them a PDF fails while its text is read, with
 * "is not a function". Each method is added only when the engine lacks it, and behaves as the
 * standard describes, so an engine that has them keeps its own.
 */

declare global {
  interface Uint8Array {
    toHex(): string;
    toBase64(): string;
  }
  interface Uint8ArrayConstructor {
    fromHex(text: string): Uint8Array;
    fromBase64(text: string): Uint8Array;
  }
}

const HEX = '0123456789abcdef';

const bytesToHex = (bytes: Uint8Array): string => {
  let out = '';
  for (const byte of bytes) out += HEX.charAt(byte >> 4) + HEX.charAt(byte & 15);
  return out;
};

const hexToBytes = (text: string): Uint8Array => {
  if (text.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(text)) throw new SyntaxError('invalid hex string');
  const out = new Uint8Array(text.length / 2);
  for (let index = 0; index < out.length; index += 1) out[index] = parseInt(text.slice(index * 2, index * 2 + 2), 16);
  return out;
};

const bytesToBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  // Chunks keep the argument list of String.fromCharCode short for large inputs.
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary);
};

const base64ToBytes = (text: string): Uint8Array => Uint8Array.from(atob(text), (char) => char.charCodeAt(0));

const define = (target: object, name: string, value: unknown): void => {
  if (name in target) return;
  Object.defineProperty(target, name, { value, writable: true, configurable: true });
};

/** Adds the hex and base64 methods to Uint8Array where the engine has none. Safe to call twice. */
export const installBinaryPolyfills = (): void => {
  define(Uint8Array.prototype, 'toHex', function toHex(this: Uint8Array) {
    return bytesToHex(this);
  });
  define(Uint8Array.prototype, 'toBase64', function toBase64(this: Uint8Array) {
    return bytesToBase64(this);
  });
  define(Uint8Array, 'fromHex', (text: string) => hexToBytes(text));
  define(Uint8Array, 'fromBase64', (text: string) => base64ToBytes(text));
};
