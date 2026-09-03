#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="${SQ_PADDLEOCR_API_VENV:-$ROOT/.venv_paddleocr_api}"
PYTHON="${PYTHON:-python3}"
"$PYTHON" -m venv "$VENV"
"$VENV/bin/python" -m pip install --upgrade pip
"$VENV/bin/pip" install "paddleocr==3.7.0"
echo "✓ PaddleOCR official API client installed: $VENV/bin/paddleocr"
echo "  This client submits files to PaddleOCR hosted services; it does not run local inference."
