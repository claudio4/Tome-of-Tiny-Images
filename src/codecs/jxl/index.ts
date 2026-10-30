import createJxlModule, { type JxlWasmModule } from './build/jxl.js';

export interface JxlPixelOptions {
  /** Butteraugli distance; 1.0 is visually lossless. Ignored when lossless. */
  distance: number;
  /** 1 (fastest) to 9 (slowest), libjxl default is 7. */
  effort: number;
  lossless: boolean;
}

export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

let modulePromise: Promise<JxlWasmModule> | undefined;

function getModule(): Promise<JxlWasmModule> {
  modulePromise ??= createJxlModule();
  return modulePromise;
}

/** Copies `input` into wasm memory, runs `fn` on it and returns the copied output. */
function withInput(m: JxlWasmModule, input: Uint8Array, fn: (ptr: number) => number, what: string): Uint8Array {
  const ptr = m._malloc(input.byteLength);
  if (!ptr) throw new Error(`${what}: out of memory`);
  try {
    m.HEAPU8.set(input, ptr);
    if (fn(ptr) !== 0) throw new Error(`${what} failed`);
    // HEAPU8 may have been replaced by memory growth during `fn`.
    const out = m.HEAPU8.slice(m._jxl_out_ptr(), m._jxl_out_ptr() + m._jxl_out_len());
    return out;
  } finally {
    m._free(ptr);
  }
}

/** Losslessly transcodes a JPEG; the original file can be reconstructed bit-exactly. */
export async function transcodeJpeg(jpeg: Uint8Array, effort = 7): Promise<Uint8Array> {
  const m = await getModule();
  try {
    return withInput(m, jpeg, (p) => m._jxl_transcode_jpeg(p, jpeg.byteLength, effort), 'JPEG transcode');
  } finally {
    m._jxl_out_free();
  }
}

/** Encodes 8-bit sRGB RGBA pixels. */
export async function encodeRgba(img: RgbaImage, hasAlpha: boolean, opts: JxlPixelOptions): Promise<Uint8Array> {
  const m = await getModule();
  const bytes = new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength);
  try {
    return withInput(
      m,
      bytes,
      (p) =>
        m._jxl_encode_rgba(p, img.width, img.height, hasAlpha ? 1 : 0, opts.distance, opts.effort, opts.lossless ? 1 : 0),
      'JXL encode',
    );
  } finally {
    m._jxl_out_free();
  }
}

export async function decodeRgba(jxl: Uint8Array): Promise<RgbaImage> {
  const m = await getModule();
  try {
    const data = withInput(m, jxl, (p) => m._jxl_decode_rgba(p, jxl.byteLength), 'JXL decode');
    return { data: new Uint8ClampedArray(data.buffer), width: m._jxl_out_width(), height: m._jxl_out_height() };
  } finally {
    m._jxl_out_free();
  }
}

/** Rebuilds the original JPEG from a file produced by `transcodeJpeg`. */
export async function reconstructJpeg(jxl: Uint8Array): Promise<Uint8Array> {
  const m = await getModule();
  try {
    return withInput(m, jxl, (p) => m._jxl_reconstruct_jpeg(p, jxl.byteLength), 'JPEG reconstruction');
  } finally {
    m._jxl_out_free();
  }
}

/** cjxl's quality → distance mapping (quality 90 ≈ distance 1.0). */
export function qualityToDistance(quality: number): number {
  if (quality >= 100) return 0;
  if (quality >= 30) return 0.1 + (100 - quality) * 0.09;
  return (53 / 3000) * quality * quality - (23 / 20) * quality + 25;
}
