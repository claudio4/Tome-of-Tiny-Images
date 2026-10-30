import encode from '@jsquash/avif/encode.js';
import type { Settings } from '../../lib/settings';

const SUBSAMPLE_420 = 1;
const SUBSAMPLE_444 = 3;

export async function encodeAvif(img: ImageData, opts: Settings['avif']): Promise<Uint8Array> {
  const out = await encode(img, {
    quality: opts.quality,
    speed: opts.speed,
    lossless: opts.lossless,
    subsample: opts.chroma444 ? SUBSAMPLE_444 : SUBSAMPLE_420,
    enableSharpYUV: !opts.chroma444,
  });
  return new Uint8Array(out);
}
