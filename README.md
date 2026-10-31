# Batch Image Compressor

Compress PNG, JPEG, WebP and GIF images to **JPEG XL** or **AVIF**, entirely in the browser. Nothing is uploaded.

- JPEG → JXL uses libjxl's lossless JPEG transcode: typically ~20% smaller, and the original JPEG can be restored bit-exactly (`djxl file.jxl file.jpg`).
- Other inputs are decoded by the browser and encoded at visually-lossless defaults (JXL distance 1.0 / AVIF quality 80, which score about the same in SSIMULACRA2). Advanced settings are available but optional.
- When JPEGs are re-encoded to JXL instead (transcode turned off), they are decoded with [jpegli](https://github.com/google/jpegli), which is more precise than the browser's decoder (about 1–3% smaller output at slightly higher quality). Their ICC profile is kept (profiles over 8 KB are converted to sRGB instead) and the EXIF orientation goes into the JXL header. CMYK JPEGs, and grayscale ones with a gray profile, fall back to the browser decoder.
- Animated GIF/WebP/APNG inputs keep only their first frame (flagged in the UI).
- Other pixel-path encodes (all non-JPEG inputs, and everything to AVIF) are sRGB and pre-rotated; ICC profiles are not carried over.
- Metadata: the lossless transcode keeps all of the JPEG's metadata (EXIF, XMP, including e.g. GPS location), since it is needed to rebuild the original file. Every other output drops EXIF/XMP; only the orientation and color profile survive as described above.

## Development

```sh
npm install
npm run dev        # dev server (builds the libjxl and jpegli wasm first if missing)
npm test           # vitest (codec + format detection tests)
npm run check      # svelte-check / TypeScript
npm run build      # static site in dist/, no special server headers needed
```

### WASM codecs

The single-threaded libjxl and jpegli builds (`wasm/jxl/wrapper.c` and `wasm/jpegli/wrapper.cc` define the exported APIs) are generated into `src/codecs/{jxl,jpegli}/build/` and are not committed. `npm run dev`, `build` and `test` build them automatically when missing; to force a rebuild:

```sh
npm run build:jxl     # uses local emcc, or the emscripten/emsdk image via podman/docker
npm run build:jpegli
```

The libjxl tag and emsdk image are pinned at the top of `scripts/build-jxl.sh`, the jpegli commit in `scripts/build-jpegli.sh` (the project has no release tags yet).

### Test fixtures

`tests/fixtures/` is generated (not committed) by `npm run fixtures`, which needs Python with Pillow (with LittleCMS) and the libjxl checkout from `scripts/build-jxl.sh` (for its ICC profiles). `npm test` generates it automatically when it's missing.

### Tuning defaults

Defaults were chosen with a sweep over real images in `test-images/<category>/` (gitignored), scored with SSIMULACRA2:

```sh
scripts/tune/build-tools.sh             # once: builds ssimulacra2 + djpegli into .cache/bin
node scripts/tune/sweep.ts              # encodes every image with many settings (cached per image)
node scripts/tune/report.ts > .cache/tune/report.md
```

The sweep uses the same JXL wasm and AVIF encoder as the app, and needs ImageMagick, `djxl` and `avifdec`. Huge images use a lot of memory; `--budget-mp` caps how many megapixels are encoded at once.

`node scripts/tune/jpeg-decode.ts` compares jpegli with libjpeg-turbo decoding for lossy JPEG re-encodes (quality, size, speed), and `node scripts/tune/jpegli-bench.ts` times the jpegli wasm and checks it against native `djpegli`.

Note that `ssimulacra2` misreads ICC-tagged inputs (identical pixels score below 100 with an sRGB profile attached), so compare untagged pixels when color profiles are involved.
