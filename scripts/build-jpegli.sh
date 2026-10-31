#!/usr/bin/env bash
# Builds jpegli + wasm/jpegli/wrapper.cc into src/codecs/jpegli/build/{jpegli.js,jpegli.wasm}.
# Uses a local emsdk if `emcc` is on PATH, otherwise the emsdk image from
# scripts/build-jxl.sh. `--fetch` only clones the sources (used by the tuning tools).
set -euo pipefail

JPEGLI_COMMIT=031a0077f5799a6041004267fc12b956c1f52a20  # google/jpegli has no tags yet

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/.cache/jpegli"
OUT="$ROOT/src/codecs/jpegli/build"
EMSDK_IMAGE="$(sed -n 's/^EMSDK_IMAGE=//p' "$ROOT/scripts/build-jxl.sh")"

if [[ "${1:-}" != "--inside" ]]; then
  if [[ ! -d "$SRC/.git" ]]; then
    git clone https://github.com/google/jpegli "$SRC"
  fi
  if [[ "$(git -C "$SRC" rev-parse HEAD)" != "$JPEGLI_COMMIT" ]]; then
    git -C "$SRC" fetch -q origin "$JPEGLI_COMMIT"
    git -C "$SRC" checkout -q "$JPEGLI_COMMIT"
  fi
  git -C "$SRC" submodule update --init --depth 1 \
    third_party/highway third_party/skcms third_party/libjpeg-turbo
  [[ "${1:-}" == "--fetch" ]] && exit 0
fi

if [[ "${1:-}" != "--inside" ]] && ! command -v emcc >/dev/null; then
  runtime="$(command -v podman || command -v docker || true)"
  [[ -n "$runtime" ]] || { echo "Need emcc, podman or docker" >&2; exit 1; }
  exec "$runtime" run --rm -v "$ROOT:/src:Z" -w /src "$EMSDK_IMAGE" \
    bash scripts/build-jpegli.sh --inside
fi

BUILD="$ROOT/.cache/jpegli-wasm-build"
mkdir -p "$BUILD" "$OUT"

emcmake cmake -S "$SRC" -B "$BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_C_FLAGS="-msimd128" -DCMAKE_CXX_FLAGS="-msimd128" \
  -DBUILD_SHARED_LIBS=OFF -DBUILD_TESTING=OFF \
  -DJPEGLI_ENABLE_WASM_THREADS=OFF -DJPEGLI_ENABLE_TOOLS=OFF \
  -DJPEGLI_ENABLE_DOXYGEN=OFF -DJPEGLI_ENABLE_MANPAGES=OFF \
  -DJPEGLI_ENABLE_BENCHMARK=OFF -DJPEGLI_ENABLE_JNI=OFF \
  -DJPEGLI_ENABLE_SJPEG=OFF -DJPEGLI_ENABLE_OPENEXR=OFF \
  -DJPEGLI_ENABLE_FUZZERS=OFF -DJPEGLI_ENABLE_SKCMS=ON \
  -DJPEGLI_BUNDLE_LIBPNG=OFF
cmake --build "$BUILD" -j"$(nproc)" --target jpegli-static hwy

exports='_jpegli_decode_rgba,_jpegli_out_ptr,_jpegli_out_len,_jpegli_out_width,_jpegli_out_height,_jpegli_out_icc_ptr,_jpegli_out_icc_len,_jpegli_out_free,_malloc,_free'

em++ -O3 -msimd128 "$ROOT/wasm/jpegli/wrapper.cc" \
  -I"$SRC" -I"$BUILD/lib/include/jpegli" \
  "$BUILD/lib/libjpegli-static.a" "$BUILD/third_party/highway/libhwy.a" \
  -o "$OUT/jpegli.js" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createJpegliModule \
  -sENVIRONMENT=web,worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB -sFILESYSTEM=0 \
  -sEXPORTED_FUNCTIONS="$exports" \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8

ls -l "$OUT"
