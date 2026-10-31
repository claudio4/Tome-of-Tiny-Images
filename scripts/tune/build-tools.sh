#!/usr/bin/env bash
# Builds the native tuning tools into .cache/bin/ (inside the emsdk image, which
# ships gcc + cmake): libjxl's ssimulacra2 metric and jpegli's djpegli decoder.
# Only needed for tuning.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/.cache/libjxl"
JPEGLI_SRC="$ROOT/.cache/jpegli"
EMSDK_IMAGE="$(sed -n 's/^EMSDK_IMAGE=//p' "$ROOT/scripts/build-jxl.sh")"

[[ -d "$SRC" ]] || { echo "Run scripts/build-jxl.sh first (it fetches libjxl)" >&2; exit 1; }

if [[ "${1:-}" != "--inside" ]]; then
  "$ROOT/scripts/build-jpegli.sh" --fetch
  runtime="$(command -v podman || command -v docker)"
  exec "$runtime" run --rm -v "$ROOT:/src:Z" -w /src "$EMSDK_IMAGE" \
    bash scripts/tune/build-tools.sh --inside
fi

command -v apt-get >/dev/null && ! dpkg -s libpng-dev >/dev/null 2>&1 &&
  apt-get update -qq && apt-get install -y -qq libpng-dev zlib1g-dev >/dev/null
mkdir -p "$ROOT/.cache/bin"

BUILD="$ROOT/.cache/ssimulacra2-build"
CC=gcc CXX=g++ cmake -S "$SRC" -B "$BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF \
  -DBUILD_SHARED_LIBS=OFF -DJPEGXL_STATIC=ON \
  -DJPEGXL_ENABLE_TOOLS=ON -DJPEGXL_ENABLE_DEVTOOLS=ON \
  -DJPEGXL_BUNDLE_LIBPNG=OFF -DJPEGXL_ENABLE_SJPEG=OFF \
  -DJPEGXL_ENABLE_OPENEXR=OFF -DJPEGXL_ENABLE_JNI=OFF \
  -DJPEGXL_ENABLE_DOXYGEN=OFF -DJPEGXL_ENABLE_MANPAGES=OFF \
  -DJPEGXL_ENABLE_BENCHMARK=OFF -DJPEGXL_ENABLE_EXAMPLES=OFF
cmake --build "$BUILD" -j"$(nproc)" --target ssimulacra2
cp "$BUILD/tools/ssimulacra2" "$ROOT/.cache/bin/"

JPEGLI_BUILD="$ROOT/.cache/jpegli-build"
CC=gcc CXX=g++ cmake -S "$JPEGLI_SRC" -B "$JPEGLI_BUILD" -G "Unix Makefiles" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DBUILD_SHARED_LIBS=OFF \
  -DJPEGLI_ENABLE_TOOLS=ON -DJPEGLI_ENABLE_SKCMS=ON \
  -DJPEGLI_BUNDLE_LIBPNG=OFF -DJPEGLI_ENABLE_SJPEG=OFF \
  -DJPEGLI_ENABLE_OPENEXR=OFF -DJPEGLI_ENABLE_JNI=OFF \
  -DJPEGLI_ENABLE_DOXYGEN=OFF -DJPEGLI_ENABLE_MANPAGES=OFF \
  -DJPEGLI_ENABLE_BENCHMARK=OFF -DJPEGLI_ENABLE_FUZZERS=OFF
cmake --build "$JPEGLI_BUILD" -j"$(nproc)" --target djpegli
cp "$JPEGLI_BUILD/tools/djpegli" "$ROOT/.cache/bin/"
