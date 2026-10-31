import { decodeJpeg } from '../codecs/jpegli';
import { encodeRgba, qualityToDistance, transcodeJpeg, type PixelSource, type RgbaImage } from '../codecs/jxl';
import { jpegOrientation, type InputFormat } from './formats';
import type { Settings } from './settings';

export interface EncodeResult {
  data: Uint8Array;
  mime: string;
  ext: string;
  /** Human-readable description of what was done, e.g. "Lossless JPEG transcode". */
  method: string;
}

export interface EncodeDeps {
  decode: () => Promise<RgbaImage>;
  encodeAvif: (img: RgbaImage, opts: Settings['avif']) => Promise<Uint8Array>;
}

export function hasTransparency(img: RgbaImage): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] !== 255) return true;
  return false;
}

/**
 * Decodes a JPEG for JXL pixel encoding: with jpegli when possible, keeping its
 * ICC profile and leaving the pixels unrotated (the orientation goes into the
 * JXL header). Falls back to the browser decoder (oriented, sRGB) for JPEGs
 * jpegli can't handle here.
 */
async function decodeJpegForJxl(bytes: Uint8Array, deps: EncodeDeps): Promise<{ img: RgbaImage; source: PixelSource }> {
  try {
    const { icc, ...img } = await decodeJpeg(bytes);
    return { img, source: { icc, orientation: jpegOrientation(bytes) } };
  } catch {
    return { img: await deps.decode(), source: {} };
  }
}

export async function encodeImage(
  bytes: Uint8Array,
  format: InputFormat,
  settings: Settings,
  deps: EncodeDeps,
): Promise<EncodeResult> {
  if (settings.format === 'jxl') {
    const o = settings.jxl;
    if (format === 'jpeg' && o.jpegTranscode) {
      const data = await transcodeJpeg(bytes, o.effort);
      return { data, mime: 'image/jxl', ext: 'jxl', method: 'Lossless JPEG transcode' };
    }
    const { img, source } = format === 'jpeg' ? await decodeJpegForJxl(bytes, deps) : { img: await deps.decode(), source: {} };
    const distance = qualityToDistance(o.quality);
    const lossless = o.lossless || distance === 0;
    const alpha = format !== 'jpeg' && hasTransparency(img);
    const data = await encodeRgba(img, alpha, { distance, effort: o.effort, lossless }, source);
    const method = lossless ? 'Lossless' : `Lossy, distance ${distance.toFixed(2)}`;
    return { data, mime: 'image/jxl', ext: 'jxl', method };
  }

  const o = settings.avif;
  const data = await deps.encodeAvif(await deps.decode(), o);
  const method = o.lossless ? 'Lossless' : `Lossy, quality ${o.quality}, ${o.chroma444 ? '4:4:4' : '4:2:0'}`;
  return { data, mime: 'image/avif', ext: 'avif', method };
}
