import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeJpeg, UnsupportedJpegError } from '../src/codecs/jpegli';
import { decodeRgba, encodeRgba, transcodeJpeg, type RgbaImage } from '../src/codecs/jxl';
import { encodeImage } from '../src/lib/encode';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const P3_ICC = new Uint8Array(
  readFileSync(join(__dirname, '../.cache/libjxl/third_party/skcms/profiles/mobile/Display_P3_parametric.icc')),
);

const lossy: Settings = { ...DEFAULT_SETTINGS, jxl: { ...DEFAULT_SETTINGS.jxl, jpegTranscode: false } };
const noBrowser = {
  decode: () => Promise.reject(new Error('browser decode not available')),
  encodeAvif: () => Promise.reject(new Error('unused')),
};

/** Mean absolute difference over the color channels (0–255). */
function meanDiff(a: Uint8ClampedArray, b: Uint8Array | Uint8ClampedArray): number {
  expect(a.length).toBe(b.length);
  let sum = 0;
  for (let i = 0; i < a.length; i++) if (i % 4 !== 3) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length * 0.75);
}

describe('jpegli decode', () => {
  it('returns stored (unrotated) pixels and the ICC profile', async () => {
    const img = await decodeJpeg(fixture('p3-rotated.jpg'));
    expect([img.width, img.height]).toEqual([320, 240]);
    expect(img.icc).toEqual(P3_ICC);
  });

  it('expands grayscale to RGBA', async () => {
    const img = await decodeJpeg(fixture('gray.jpg'));
    expect(img.icc).toBeUndefined();
    for (let i = 0; i < img.data.length; i += 4) {
      expect(img.data[i]).toBe(img.data[i + 1]);
      expect(img.data[i]).toBe(img.data[i + 2]);
    }
  });

  it('rejects CMYK', async () => {
    await expect(decodeJpeg(fixture('cmyk.jpg'))).rejects.toBeInstanceOf(UnsupportedJpegError);
  });
});

describe('JPEG → lossy JXL keeps color profile and orientation', () => {
  // What a color-managed viewer shows for p3-rotated.jpg: upright, converted to sRGB.
  const reference = fixture('p3-rotated.srgb.rgba');

  it('displays like the original', async () => {
    const res = await encodeImage(fixture('p3-rotated.jpg'), 'jpeg', lossy, noBrowser);
    const shown = await decodeRgba(res.data);
    expect([shown.width, shown.height]).toEqual([240, 320]);
    expect(meanDiff(shown.data, reference)).toBeLessThan(2);
  });

  it('would visibly shift colors if the profile were dropped', async () => {
    const img = await decodeJpeg(fixture('p3-rotated.jpg'));
    const jxl = await encodeRgba(img, false, { distance: 1, effort: 7, lossless: false }, { orientation: 6 });
    expect(meanDiff((await decodeRgba(jxl)).data, reference)).toBeGreaterThan(5);
  });

  it('converts large profiles to sRGB instead of embedding them', async () => {
    const jpeg = fixture('big-icc.jpg');
    const { icc, ...img } = await decodeJpeg(jpeg);
    expect(icc!.byteLength).toBeGreaterThan(50_000);
    const res = await encodeImage(jpeg, 'jpeg', lossy, noBrowser);
    const untagged = await encodeRgba(img, false, { distance: 1, effort: 7, lossless: false });
    expect(res.data.byteLength).toBeLessThan(untagged.byteLength + 1024);
  });

  it('falls back to the browser decoder for CMYK', async () => {
    const fake: RgbaImage = { data: new Uint8ClampedArray(16 * 16 * 4).fill(128), width: 16, height: 16 };
    const res = await encodeImage(fixture('cmyk.jpg'), 'jpeg', lossy, { ...noBrowser, decode: async () => fake });
    expect((await decodeRgba(res.data)).width).toBe(16);
  });
});

describe('JXL preview decode', () => {
  it('shows a transcoded P3, rotated JPEG upright and in sRGB', async () => {
    const shown = await decodeRgba(await transcodeJpeg(fixture('p3-rotated.jpg')));
    expect([shown.width, shown.height]).toEqual([240, 320]);
    expect(meanDiff(shown.data, fixture('p3-rotated.srgb.rgba'))).toBeLessThan(1.2);
  });
});
