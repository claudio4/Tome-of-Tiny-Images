import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeRgba, encodeRgba, qualityToDistance, reconstructJpeg, transcodeJpeg } from '../src/codecs/jxl';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

function hasDjxl(): boolean {
  try {
    execFileSync('djxl', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

describe('JPEG → JXL lossless transcode', () => {
  for (const name of ['photo.jpg', 'photo-progressive.jpg']) {
    it(`reconstructs ${name} bit-exactly and is smaller`, async () => {
      const jpeg = fixture(name);
      const jxl = await transcodeJpeg(jpeg);
      expect(jxl.byteLength).toBeLessThan(jpeg.byteLength);
      expect(await reconstructJpeg(jxl)).toEqual(jpeg);
    });

    it.runIf(hasDjxl())(`${name} round-trips through the reference djxl`, async () => {
      const dir = mkdtempSync(join(tmpdir(), 'jxl-'));
      writeFileSync(join(dir, 'in.jxl'), await transcodeJpeg(fixture(name)));
      execFileSync('djxl', [join(dir, 'in.jxl'), join(dir, 'out.jpg')], { stdio: 'ignore' });
      expect(new Uint8Array(readFileSync(join(dir, 'out.jpg')))).toEqual(fixture(name));
    });
  }
});

describe('pixel encode', () => {
  const img = (w: number, h: number, alpha: boolean) => {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      data[i * 4] = (i * 7) % 256;
      data[i * 4 + 1] = (i * 13) % 256;
      data[i * 4 + 2] = i % 256;
      data[i * 4 + 3] = alpha ? i % 256 : 255;
    }
    return { data, width: w, height: h };
  };

  it('lossless RGBA round-trips exactly', async () => {
    const src = img(37, 23, true);
    const jxl = await encodeRgba({ ...src, data: src.data.slice() }, true, { distance: 0, effort: 7, lossless: true });
    const out = await decodeRgba(jxl);
    expect([out.width, out.height]).toEqual([37, 23]);
    expect(out.data).toEqual(src.data);
  });

  it('lossless opaque RGB round-trips exactly', async () => {
    const src = img(40, 30, false);
    const jxl = await encodeRgba({ ...src, data: src.data.slice() }, false, { distance: 0, effort: 7, lossless: true });
    expect((await decodeRgba(jxl)).data).toEqual(src.data);
  });

  it('lossy encode decodes to the same dimensions', async () => {
    const jxl = await encodeRgba(img(64, 48, false), false, { distance: 1, effort: 7, lossless: false });
    const out = await decodeRgba(jxl);
    expect([out.width, out.height]).toEqual([64, 48]);
  });

  it('reconstructJpeg rejects files without JPEG data', async () => {
    const jxl = await encodeRgba(img(8, 8, false), false, { distance: 1, effort: 3, lossless: false });
    await expect(reconstructJpeg(jxl)).rejects.toThrow();
  });
});

it('qualityToDistance matches cjxl anchors', () => {
  expect(qualityToDistance(100)).toBe(0);
  expect(qualityToDistance(90)).toBeCloseTo(1.0);
  expect(qualityToDistance(30)).toBeCloseTo(6.4);
});
