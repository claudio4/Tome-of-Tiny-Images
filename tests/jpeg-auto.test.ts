import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { reconstructJpeg, transcodeJpeg } from '../src/codecs/jxl';
import { encodeImage } from '../src/lib/encode';
import { DEFAULT_SETTINGS, type Settings } from '../src/lib/settings';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));
const noBrowser = {
  decode: () => Promise.reject(new Error('browser decode not available')),
  encodeAvif: () => Promise.reject(new Error('unused')),
};
const auto = (jxl: Partial<Settings['jxl']> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  jxl: { ...DEFAULT_SETTINGS.jxl, jpegMode: 'auto', ...jxl },
});

describe("JPEG 'auto' mode", () => {
  it('transcodes low-quality JPEGs losslessly without trying a re-encode', async () => {
    const jpeg = fixture('photo-q70.jpg');
    const res = await encodeImage(jpeg, 'jpeg', auto(), noBrowser);
    expect(res.method).toBe('Lossless JPEG transcode (source quality ~70)');
    expect(await reconstructJpeg(res.data)).toEqual(jpeg);
  });

  it('re-encodes high-quality JPEGs when that is much smaller', async () => {
    const jpeg = fixture('photo-q98.jpg');
    const res = await encodeImage(jpeg, 'jpeg', auto(), noBrowser);
    expect(res.method).toMatch(/^Lossy, distance 1\.00 \(\d+% smaller than lossless\)$/);
    expect(res.data.byteLength).toBeLessThanOrEqual(0.8 * (await transcodeJpeg(jpeg)).byteLength);
  });

  it('keeps the transcode when the re-encode is not smaller enough', async () => {
    // Quality 99 (distance ~0.19) keeps far more detail than the q90 source needs.
    const res = await encodeImage(fixture('photo.jpg'), 'jpeg', auto({ quality: 99 }), noBrowser);
    expect(res.method).toMatch(/^Lossless JPEG transcode \(re-encoding (was larger|saved only \d+%)\)$/);
  });

  it('always transcodes when lossless output is requested', async () => {
    const res = await encodeImage(fixture('photo-q98.jpg'), 'jpeg', auto({ lossless: true }), noBrowser);
    expect(res.method).toBe('Lossless JPEG transcode');
  });

  it("'lossless' and 'reencode' modes don't decide", async () => {
    const jpeg = fixture('photo-q70.jpg');
    expect((await encodeImage(jpeg, 'jpeg', auto({ jpegMode: 'lossless' }), noBrowser)).method).toBe('Lossless JPEG transcode');
    expect((await encodeImage(jpeg, 'jpeg', auto({ jpegMode: 'reencode' }), noBrowser)).method).toBe('Lossy, distance 1.00');
  });
});
