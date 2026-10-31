import { decodeJpeg } from '../codecs/jpegli';
import { encodeRgba, qualityToDistance, transcodeJpeg, type PixelSource, type RgbaImage } from '../codecs/jxl';
import { jpegOrientation, jpegQuality, type InputFormat } from './formats';
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

// JPEG 'auto' mode, tuned on real JPEGs at the default quality: re-encoding
// beat the lossless transcode by 14-81% for sources of quality ~85 and up, and
// came out 13-35% larger for quality ~75 sources.
/** A lossy re-encode replaces the lossless transcode only if it is at most this fraction of its size. */
const AUTO_MAX_LOSSY_RATIO = 0.8;
/** Re-encoding isn't tried for JPEGs whose estimated quality is this far below the target quality. */
const AUTO_QUALITY_MARGIN = 10;

const percent = (x: number) => `${Math.round(x * 100)}%`;

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
    const distance = qualityToDistance(o.quality);
    const lossless = o.lossless || distance === 0;
    const jxl = (data: Uint8Array, method: string): EncodeResult => ({ data, mime: 'image/jxl', ext: 'jxl', method });
    const encodePixels = async () => {
      const { img, source } = format === 'jpeg' ? await decodeJpegForJxl(bytes, deps) : { img: await deps.decode(), source: {} };
      const alpha = format !== 'jpeg' && hasTransparency(img);
      return encodeRgba(img, alpha, { distance, effort: o.effort, lossless }, source);
    };
    const pixelMethod = lossless ? 'Lossless' : `Lossy, distance ${distance.toFixed(2)}`;

    if (format === 'jpeg' && o.jpegMode !== 'reencode') {
      const transcoded = await transcodeJpeg(bytes, o.effort);
      // A lossless pixel encode is always larger than the transcode.
      if (o.jpegMode === 'lossless' || lossless) return jxl(transcoded, 'Lossless JPEG transcode');
      const quality = jpegQuality(bytes);
      if (quality !== null && quality <= o.quality - AUTO_QUALITY_MARGIN) {
        return jxl(transcoded, `Lossless JPEG transcode (source quality ~${Math.round(quality)})`);
      }
      const reencoded = await encodePixels();
      const ratio = reencoded.byteLength / transcoded.byteLength;
      if (ratio <= AUTO_MAX_LOSSY_RATIO) return jxl(reencoded, `${pixelMethod} (${percent(1 - ratio)} smaller than lossless)`);
      const why = ratio >= 1 ? 're-encoding was larger' : `re-encoding saved only ${percent(1 - ratio)}`;
      return jxl(transcoded, `Lossless JPEG transcode (${why})`);
    }
    return jxl(await encodePixels(), pixelMethod);
  }

  const o = settings.avif;
  const data = await deps.encodeAvif(await deps.decode(), o);
  const method = o.lossless ? 'Lossless' : `Lossy, quality ${o.quality}, ${o.chroma444 ? '4:4:4' : '4:2:0'}`;
  return { data, mime: 'image/avif', ext: 'avif', method };
}
