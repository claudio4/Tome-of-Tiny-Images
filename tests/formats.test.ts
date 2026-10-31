import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectFormat, imageSize, isAnimated, jpegOrientation } from '../src/lib/formats';

const fixture = (name: string) => new Uint8Array(readFileSync(join(__dirname, 'fixtures', name)));

describe('detectFormat', () => {
  it.each([
    ['photo.jpg', 'jpeg'],
    ['photo-progressive.jpg', 'jpeg'],
    ['alpha.png', 'png'],
    ['photo.webp', 'webp'],
    ['static.gif', 'gif'],
    ['animated.gif', 'gif'],
    ['not-an-image.txt', null],
  ])('%s → %s', (name, expected) => {
    expect(detectFormat(fixture(name))).toBe(expected);
  });

  it('ignores the extension', () => {
    expect(detectFormat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
    expect(detectFormat(new Uint8Array())).toBe(null);
  });
});

describe('isAnimated', () => {
  it.each([
    ['static.gif', 'gif', false],
    ['animated.gif', 'gif', true],
    ['photo.webp', 'webp', false],
    ['animated.webp', 'webp', true],
    ['opaque.png', 'png', false],
    ['animated.png', 'png', true],
    ['photo.jpg', 'jpeg', false],
  ] as const)('%s → %s', (name, format, expected) => {
    expect(isAnimated(fixture(name), format)).toBe(expected);
  });
});

describe('imageSize', () => {
  it.each([
    ['photo.jpg', 'jpeg', 320, 240],
    ['photo-progressive.jpg', 'jpeg', 320, 240],
    ['alpha.png', 'png', 320, 240],
    ['photo.webp', 'webp', 320, 240],
    ['animated.webp', 'webp', 64, 48],
    ['static.gif', 'gif', 64, 48],
  ] as const)('%s → %dx%d', (name, format, width, height) => {
    expect(imageSize(fixture(name), format)).toEqual({ width, height });
  });
});

describe('jpegOrientation', () => {
  it.each([
    ['photo.jpg', 1],
    ['p3-rotated.jpg', 6],
  ])('%s → %i', (name, orientation) => {
    expect(jpegOrientation(fixture(name))).toBe(orientation);
  });

  it('returns 1 for truncated input', () => {
    expect(jpegOrientation(fixture('p3-rotated.jpg').subarray(0, 30))).toBe(1);
  });
});
