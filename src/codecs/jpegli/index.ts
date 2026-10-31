import createJpegliModule, { type JpegliWasmModule } from './build/jpegli.js';
import type { RgbaImage } from '../jxl';

export interface JpegliImage extends RgbaImage {
  /** The JPEG's embedded ICC profile; the pixels are in this color space. */
  icc?: Uint8Array;
}

/** The JPEG is valid but not RGB-compatible here (CMYK, or grayscale with a gray profile). */
export class UnsupportedJpegError extends Error {}

/** Images above this size get a fresh wasm instance afterwards, since wasm memory never shrinks. */
const RESET_AFTER_PIXELS = 16_000_000;

let modulePromise: Promise<JpegliWasmModule> | undefined;

/**
 * Decodes a JPEG with jpegli, which is more precise than the browsers' libjpeg-turbo.
 * Pixels are returned as stored: EXIF orientation is not applied.
 */
export async function decodeJpeg(jpeg: Uint8Array): Promise<JpegliImage> {
  modulePromise ??= createJpegliModule();
  const m = await modulePromise;
  const ptr = m._malloc(jpeg.byteLength);
  if (!ptr) throw new Error('JPEG decode: out of memory');
  try {
    m.HEAPU8.set(jpeg, ptr);
    const rc = m._jpegli_decode_rgba(ptr, jpeg.byteLength);
    if (rc === -2) throw new UnsupportedJpegError('Unsupported JPEG color space');
    if (rc !== 0) throw new Error('JPEG decode failed');
    // HEAPU8 may have been replaced by memory growth during the decode.
    const out = m._jpegli_out_ptr();
    const data = new Uint8ClampedArray(m.HEAPU8.slice(out, out + m._jpegli_out_len()).buffer);
    const iccPtr = m._jpegli_out_icc_ptr();
    const icc = iccPtr ? m.HEAPU8.slice(iccPtr, iccPtr + m._jpegli_out_icc_len()) : undefined;
    const width = m._jpegli_out_width();
    const height = m._jpegli_out_height();
    if (width * height > RESET_AFTER_PIXELS) modulePromise = undefined;
    return { data, width, height, icc };
  } finally {
    m._free(ptr);
    m._jpegli_out_free();
  }
}
