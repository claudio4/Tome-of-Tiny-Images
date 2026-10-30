#!/usr/bin/env bash
# Builds libjxl + wasm/jxl/wrapper.c into src/codecs/jxl/build/{jxl.js,jxl.wasm}.
# Uses a local emsdk if `emcc` is on PATH, otherwise the emscripten/emsdk image
# via podman (or docker).
set -euo pipefail

LIBJXL_TAG=v0.12.0
EMSDK_IMAGE=docker.io/emscripten/emsdk:6.0.13

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.cache/libjxl"
OUT="$ROOT/src/codecs/jxl/build"

if [[ ! -d "$SRC" ]]; then
  git clone --depth 1 --branch "$LIBJXL_TAG" https://github.com/libjxl/libjxl "$SRC"
  git -C "$SRC" submodule update --init --depth 1 \
    third_party/highway third_party/brotli third_party/skcms
fi

if [[ "${1:-}" != "--inside" ]] && ! command -v emcc >/dev/null; then
  runtime="$(command -v podman || command -v docker || true)"
  [[ -n "$runtime" ]] || { echo "Need emcc, podman or docker" >&2; exit 1; }
  exec "$runtime" run --rm -v "$ROOT:/src:Z" -w /src "$EMSDK_IMAGE" \
    bash scripts/build-jxl.sh --inside
fi

BUILD="$ROOT/.cache/libjxl-build"
mkdir -p "$BUILD" "$OUT"

emcmake cmake -S "$SRC" -B "$BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="-msimd128" -DCMAKE_CXX_FLAGS="-msimd128" \
  -DBUILD_SHARED_LIBS=OFF -DJPEGXL_STATIC=ON -DBUILD_TESTING=OFF \
  -DJPEGXL_ENABLE_WASM_THREADS=OFF \
  -DJPEGXL_ENABLE_TOOLS=OFF -DJPEGXL_ENABLE_DOXYGEN=OFF \
  -DJPEGXL_ENABLE_MANPAGES=OFF -DJPEGXL_ENABLE_BENCHMARK=OFF \
  -DJPEGXL_ENABLE_EXAMPLES=OFF -DJPEGXL_ENABLE_JNI=OFF \
  -DJPEGXL_ENABLE_SJPEG=OFF -DJPEGXL_ENABLE_OPENEXR=OFF \
  -DJPEGXL_ENABLE_SKCMS=ON -DJPEGXL_BUNDLE_LIBPNG=OFF \
  -DJPEGXL_ENABLE_PLUGINS=OFF -DJPEGXL_ENABLE_TRANSCODE_JPEG=ON
cmake --build "$BUILD" -j"$(nproc)" --target jxl jxl_cms

libs=(
  "$BUILD/lib/libjxl.a"
  "$BUILD/lib/libjxl_cms.a"
  "$BUILD/third_party/highway/libhwy.a"
  "$BUILD"/third_party/brotli/libbrotli{enc,dec,common}.a
)
skcms="$(find "$BUILD" -name 'libskcms*.a' | head -1)"
[[ -n "$skcms" ]] && libs+=("$skcms")

exports='_jxl_transcode_jpeg,_jxl_encode_rgba,_jxl_decode_rgba,_jxl_reconstruct_jpeg,_jxl_out_ptr,_jxl_out_len,_jxl_out_width,_jxl_out_height,_jxl_out_free,_malloc,_free'

emcc -O3 -msimd128 -c "$ROOT/wasm/jxl/wrapper.c" -o "$BUILD/wrapper.o" \
  -I"$SRC/lib/include" -I"$BUILD/lib/include"

em++ -O3 -msimd128 "$BUILD/wrapper.o" "${libs[@]}" \
  -o "$OUT/jxl.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createJxlModule \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS="$exports" \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8

ls -l "$OUT"
