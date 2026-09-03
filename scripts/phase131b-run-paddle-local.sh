#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PRIVATE_ROOT="${1:-}"
if [[ -z "$PRIVATE_ROOT" ]]; then
  echo "Usage: $0 /absolute/path/to/SmartQuote-VietnamDocBench-v0.1-Phase13.1A-PADDLE-PRIVATE" >&2
  exit 2
fi
PRIVATE_ROOT="$(cd "$PRIVATE_ROOT" && pwd)"
MANIFEST="$PRIVATE_ROOT/manifest-paddle-pdf-subset.json"
[[ -f "$MANIFEST" ]] || { echo "Missing $MANIFEST" >&2; exit 2; }

export SQ_PADDLEOCR_VL_PIPELINE_VERSION="${SQ_PADDLEOCR_VL_PIPELINE_VERSION:-v1.6}"
export SQ_PADDLEOCR_VL_BACKEND="${SQ_PADDLEOCR_VL_BACKEND:-native}"
export SQ_PADDLEOCR_RAW_DIR="${SQ_PADDLEOCR_RAW_DIR:-$PRIVATE_ROOT/raw/paddleocr-vl-1.6}"
export SQ_PADDLEOCR_PYTHON="${SQ_PADDLEOCR_PYTHON:-$ROOT/.venv_paddleocr_vl/bin/python}"

[[ -x "$SQ_PADDLEOCR_PYTHON" ]] || {
  echo "Paddle environment not found: $SQ_PADDLEOCR_PYTHON" >&2
  echo "Run scripts/phase131b-setup-paddle-local.sh first." >&2
  exit 3
}

node "$ROOT/scripts/phase130b-freeze-corpus.mjs" --verify --manifest "$PRIVATE_ROOT/manifest.json" --lock "$PRIVATE_ROOT/freeze-lock.json"
node "$ROOT/benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs" \
  --manifest "$MANIFEST" \
  --adapter "$ROOT/benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs" \
  --out-dir "$PRIVATE_ROOT/reports/phase13.1B-paddleocr-vl-1.6" \
  --fail-if-blocked
