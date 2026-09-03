#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${SQ_PADDLEOCR_VENV:-$ROOT/.venv_paddleocr_vl}"
PYTHON_BIN="${PYTHON_BIN:-python3}"

"$PYTHON_BIN" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/python" -m pip install paddlepaddle==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
"$VENV/bin/python" -m pip install -U "paddleocr[doc-parser]"
"$VENV/bin/python" "$ROOT/benchmarks/vietnam-docbench/engines/paddleocr_vl_bridge.py" --probe

echo "PaddleOCR-VL environment ready: $VENV"
echo "First model run will download official model weights if they are not cached."
