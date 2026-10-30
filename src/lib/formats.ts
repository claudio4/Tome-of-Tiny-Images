export type InputFormat = 'jpeg' | 'png' | 'webp' | 'gif';

export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';

const startsWith = (b: Uint8Array, sig: number[], at = 0) => sig.every((v, i) => b[at + i] === v);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** Identifies the input by its magic bytes; returns null for unsupported files. */
export function detectFormat(b: Uint8Array): InputFormat | null {
  if (startsWith(b, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)) return 'webp';
  if (startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))) return 'gif';
  return null;
}

/** True if the file holds more than one frame (only the first one gets encoded). */
export function isAnimated(b: Uint8Array, format: InputFormat): boolean {
  switch (format) {
    case 'gif':
      return gifFrameCount(b) > 1;
    case 'webp':
      // VP8X header with the animation flag.
      return startsWith(b, ascii('VP8X'), 12) && (b[20] & 0x02) !== 0;
    case 'png':
      return hasPngChunk(b, 'acTL');
    case 'jpeg':
      return false;
  }
}

function gifFrameCount(b: Uint8Array): number {
  let p = 13;
  if (b[10] & 0x80) p += 3 << ((b[10] & 0x07) + 1); // global color table
  let frames = 0;
  const skipSubBlocks = () => {
    while (p < b.length && b[p] !== 0) p += b[p] + 1;
    p++;
  };
  while (p < b.length) {
    const tag = b[p];
    if (tag === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      const flags = b[p + 9];
      p += 10;
      if (flags & 0x80) p += 3 << ((flags & 0x07) + 1); // local color table
      p++; // LZW minimum code size
      skipSubBlocks();
    } else if (tag === 0x21) {
      p += 2;
      skipSubBlocks();
    } else {
      break; // trailer (0x3b) or garbage
    }
  }
  return frames;
}

function hasPngChunk(b: Uint8Array, type: string): boolean {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const want = ascii(type);
  for (let p = 8; p + 8 <= b.length; ) {
    const len = view.getUint32(p);
    if (startsWith(b, want, p + 4)) return true;
    if (startsWith(b, ascii('IDAT'), p + 4)) return false; // acTL must precede IDAT
    p += 12 + len;
  }
  return false;
}
