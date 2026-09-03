# Phase 13.1A — PaddleOCR-VL benchmark adapter

## Goal

Make PaddleOCR-VL a real, reproducible Vietnam DocBench candidate without allowing it to affect production imports.

## Decisions

1. Benchmark the **full PaddleOCR-VL 1.6 pipeline**, not only the 0.9B VLM component.
2. Keep XLSX on SmartQuote native parsers. PaddleOCR-VL competes only on PDF/image slices.
3. Use the frozen DocBench scorer unchanged.
4. Convert Paddle table blocks deterministically to SmartQuote benchmark rows; no ground truth is visible to the adapter.
5. Never auto-approve PaddleOCR-VL rows in 13.1A because the VL document output has no trustworthy per-field confidence signal.
6. Keep raw engine output and private corpus outside Git/Vercel.

## New files

- `benchmarks/vietnam-docbench/engines/paddleocr-vl-1.6.mjs`
- `benchmarks/vietnam-docbench/engines/paddleocr-vl-normalize.mjs`
- `benchmarks/vietnam-docbench/engines/paddleocr_vl_bridge.py`
- `benchmarks/vietnam-docbench/engines/PADDLEOCR_VL_SETUP.md`
- `benchmarks/vietnam-docbench/tests/paddleocr-vl.test.mjs`
- `scripts/phase131a-paddleocr-vl-smoke.mjs`
- `scripts/phase131a-make-paddle-subset.mjs`

## Benchmark hygiene hardening

Phase 13.1's generic adapter runner previously handed the complete manifest and document object to every adapter. That included `groundTruth`, `expectedProductRows`, review evidence and hashes. Phase 13.1A closes this leakage: candidate adapters now receive a label-blind document context and only benchmark identity metadata.

## Environment result in the build container

The container has Python 3.13 but no `paddleocr`, `paddlex`, `paddle` installation, no NVIDIA GPU, and no PaddleOCR hosted API token. Therefore real PaddleOCR-VL model inference is **not claimed** in this phase artifact. The bridge/runtime protocol and deterministic normalizer are tested; the actual accuracy run must execute in an environment with the official runtime/model available.
