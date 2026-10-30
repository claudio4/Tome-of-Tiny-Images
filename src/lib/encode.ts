import { encodeRgba, qualityToDistance, transcodeJpeg, type RgbaImage } from '../codecs/jxl';
import type { InputFormat } from './formats';
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
    const img = await deps.decode();
    const distance = qualityToDistance(o.quality);
    const lossless = o.lossless || distance === 0;
    const data = await encodeRgba(img, hasTransparency(img), { distance, effort: o.effort, lossless });
    const method = lossless ? 'Lossless' : `Lossy, distance ${distance.toFixed(2)}`;
    return { data, mime: 'image/jxl', ext: 'jxl', method };
  }

  const o = settings.avif;
  const data = await deps.encodeAvif(await deps.decode(), o);
  const method = o.lossless ? 'Lossless' : `Lossy, quality ${o.quality}, ${o.chroma444 ? '4:4:4' : '4:2:0'}`;
  return { data, mime: 'image/avif', ext: 'avif', method };
}
