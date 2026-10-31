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

/** Reads the pixel dimensions from the file header without decoding the image. */
export function imageSize(b: Uint8Array, format: InputFormat): { width: number; height: number } | null {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    switch (format) {
      case 'png':
        return { width: view.getUint32(16), height: view.getUint32(20) };
      case 'gif':
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
      case 'webp': {
        const chunk = String.fromCharCode(...b.subarray(12, 16));
        if (chunk === 'VP8X') {
          const u24 = (o: number) => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16);
          return { width: u24(24) + 1, height: u24(27) + 1 };
        }
        if (chunk === 'VP8L') {
          const bits = view.getUint32(21, true);
          return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
        }
        if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
        return null;
      }
      case 'jpeg':
        for (let p = 2; p + 9 < b.length; ) {
          if (b[p] !== 0xff) return null;
          const marker = b[p + 1];
          if (marker === 0xff) {
            p++;
            continue;
          }
          // SOF0–SOF15, excluding DHT (C4), JPG (C8) and DAC (CC).
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            return { width: view.getUint16(p + 7), height: view.getUint16(p + 5) };
          }
          p += 2 + view.getUint16(p + 2);
        }
        return null;
    }
  } catch {
    return null; // truncated header
  }
}

/**
 * EXIF orientation (1-8) of a JPEG, read from its APP1 Exif segment; 1 when
 * absent or unreadable. 1 means the stored pixels are already upright.
 */
export function jpegOrientation(b: Uint8Array): number {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    for (let p = 2; p + 4 < b.length; ) {
      if (b[p] !== 0xff) return 1;
      const marker = b[p + 1];
      if (marker === 0xff) {
        p++;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) return 1; // SOS / EOI: no more metadata
      const len = view.getUint16(p + 2);
      // APP1 "Exif\0\0", followed by a TIFF header.
      if (marker === 0xe1 && view.getUint32(p + 4) === 0x45786966 && view.getUint16(p + 8) === 0) {
        const tiff = p + 10;
        const le = view.getUint16(tiff) === 0x4949; // "II"
        const ifd = tiff + view.getUint32(tiff + 4, le);
        const count = view.getUint16(ifd, le);
        for (let i = 0; i < count; i++) {
          const entry = ifd + 2 + i * 12;
          if (view.getUint16(entry, le) === 0x0112) {
            const value = view.getUint16(entry + 8, le);
            return value >= 1 && value <= 8 ? value : 1;
          }
        }
        return 1;
      }
      p += 2 + len;
    }
  } catch {
    // truncated or malformed segment
  }
  return 1;
}
