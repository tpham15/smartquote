# Phase 13.1A — PaddleOCR-VL benchmark runtime

This integration is **benchmark-only**. It is not imported by SmartQuote production code.

## Frozen engine configuration

- Full pipeline: PaddleOCR-VL (layout analysis + region cropping + reading order + VLM recognition + result assembly)
- Pipeline version: `v1.6`
- Layout detection: enabled
- Document orientation classification: enabled
- Document unwarping: enabled
- Formatted block content: enabled
- Auto approval: disabled in the adapter because PaddleOCR-VL does not expose reliable per-field confidence in its document-VL output
- Supported DocBench inputs: `digital_pdf`, `hybrid_pdf`, `scan_pdf`, `photo`
- XLSX is intentionally excluded; SmartQuote remains native-first for spreadsheets

Do not replace the full pipeline with the standalone 0.9B VLM service and call it the same benchmark. The official PaddleOCR documentation explicitly distinguishes the VLM recognition component from the complete PaddleOCR-VL pipeline.

## Recommended isolated environment

Official PaddleOCR documentation recommends a virtual environment. Its PaddleOCR-VL guide documents Python 3.9–3.13 and PaddlePaddle 3.2.1+ for PaddlePaddle inference.

Example x64 CPU setup:

```bash
python3 -m venv .venv_paddleocr_vl
source .venv_paddleocr_vl/bin/activate
python -m pip install --upgrade pip
python -m pip install paddlepaddle==3.2.1 -i https://www.paddlepaddle.org.cn/packages/stable/cpu/
python -m pip install -U "paddleocr[doc-parser]"
```

GPU users should use the PaddlePaddle build matching their CUDA runtime instead of installing the CPU build.

Verify SmartQuote's bridge:

```bash
SQ_PADDLEOCR_PYTHON="$PWD/.venv_paddleocr_vl/bin/python" \
  python benchmarks/vietnam-docbench/engines/paddleocr_vl_bridge.py --probe
```

## Run the frozen PDF slice

Keep the private benchmark outside Git. From the SmartQuote repo:

```bash
export SQ_PADDLEOCR_PYTHON="$PWD/.venv_paddleocr_vl/bin/python"
export SQ_PADDLEOCR_VL_PIPELINE_VERSION=v1.6
export SQ_PADDLEOCR_VL_BACKEND=native
export SQ_PADDLEOCR_RAW_DIR=/absolute/private/path/raw/paddleocr-vl-1.6

node benchmarks/vietnam-docbench/engines/run-adapter.mjs \
  --manifest /absolute/private/path/manifest-paddle-pdf-subset.json \
  --adapter benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs \
  --out /absolute/private/path/predictions-paddleocr-vl-1.6.json

node benchmarks/vietnam-docbench/run.mjs \
  --manifest /absolute/private/path/manifest-paddle-pdf-subset.json \
  --predictions /absolute/private/path/predictions-paddleocr-vl-1.6.json \
  --out /absolute/private/path/reports/paddleocr-vl-1.6
```

For a separate VLM inference service, set `SQ_PADDLEOCR_VL_BACKEND` to an official supported backend such as `vllm-server`, then set `SQ_PADDLEOCR_VL_SERVER_URL`. Credentials must stay in environment variables and must never be committed.

## Phase 13.1B one-command runner

Phase 13.1B adds two wrappers:

```bash
bash scripts/phase131b-setup-paddle-local.sh
bash scripts/phase131b-run-paddle-local.sh /absolute/path/to/private-corpus
```

The second command verifies the frozen corpus before inference and writes raw output, predictions, score report, execution fingerprint and promotion decision only into the private corpus directory.
