# Batch Image Compressor

Compress PNG, JPEG, WebP and GIF images to **JPEG XL** or **AVIF**, entirely in the browser. Nothing is uploaded.

- JPEG → JXL uses libjxl's lossless JPEG transcode: typically ~20% smaller, and the original JPEG can be restored bit-exactly (`djxl file.jxl file.jpg`).
- Other inputs are decoded by the browser and encoded at visually-lossless defaults (JXL distance 1.0 / AVIF quality 64). Advanced settings are available but optional.
- Animated GIF/WebP/APNG inputs keep only their first frame (flagged in the UI).
- Pixel-path encodes are sRGB; ICC profiles and EXIF from non-JPEG inputs are not carried over.

## Development

```sh
npm install
npm run dev        # dev server (builds the libjxl wasm first if it's missing)
npm test           # vitest (codec + format detection tests)
npm run check      # svelte-check / TypeScript
npm run build      # static site in dist/, no special server headers needed
```

### libjxl WASM

The single-threaded libjxl build (`wasm/jxl/wrapper.c` defines the exported API) is generated into `src/codecs/jxl/build/` and is not committed. `npm run dev`, `build` and `test` build it automatically when it's missing; to force a rebuild:

```sh
npm run build:jxl  # uses local emcc, or the emscripten/emsdk image via podman/docker
```

The libjxl tag and emsdk image are pinned at the top of `scripts/build-jxl.sh`.

### Test fixtures

`tests/fixtures/` is generated (not committed) by `npm run fixtures`, which needs Python with Pillow. `npm test` generates it automatically when it's missing.
