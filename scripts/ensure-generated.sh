#!/usr/bin/env bash
# Builds the generated, untracked inputs (libjxl wasm, test fixtures) if missing.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if [[ ! -f "$ROOT/src/codecs/jxl/build/jxl.wasm" || ! -f "$ROOT/src/codecs/jxl/build/jxl.js" ]]; then
  echo "libjxl wasm missing, building it (takes a few minutes)…"
  "$ROOT/scripts/build-jxl.sh"
fi

if [[ "${1:-}" == "--fixtures" && ! -d "$ROOT/tests/fixtures" ]]; then
  python3 -I "$ROOT/scripts/make-fixtures.py" "$ROOT/tests/fixtures"
fi
