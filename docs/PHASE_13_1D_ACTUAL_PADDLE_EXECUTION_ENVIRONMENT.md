# Phase 13.1D — Actual PaddleOCR-VL execution environment

## Goal

Phase 13.1D makes the real PaddleOCR-VL-1.6 Vietnam DocBench run reproducible on an external Linux CPU/GPU machine. It does not change SmartQuote production routing.

The key change from 13.1B/13.1C is that the execution runtime itself is now frozen and fingerprinted instead of relying on whatever Paddle packages happen to be installed on the machine.

## Frozen runtime

- PaddleOCR pipeline: `PaddleOCR-VL-1.6`
- PaddleOCR package: `3.7.0`
- PaddlePaddle: `3.2.1`
- Python: **exact major/minor `3.12`** for the locked image; upstream documents `3.9–3.13`, but 13.1D intentionally narrows this for reproducibility
- Node: `20.19.5`
- platform: Linux `x86_64`
- backend: `native`
- CPU device: `cpu`
- NVIDIA profile: CUDA 12.6 / `gpu:0`
- document orientation classification: enabled
- document unwarping: enabled
- layout detection: enabled
- formatted block content: enabled
- production promotion: disabled

Runtime identity lives in:

`benchmarks/vietnam-docbench/runtime/paddleocr-vl-1.6/runtime-lock.json`

## Recommended execution path

Use a Linux NVIDIA machine for the real 92-row run. CPU exists as a correctness fallback, but GPU is the preferred benchmark execution profile.

### Build the locked image

```bash
npm run setup:phase13.1D:paddle:gpu
```

CPU fallback:

```bash
npm run setup:phase13.1D:paddle:cpu
```

### Run the frozen private benchmark

```bash
npm run bench:phase13.1D:paddle -- \
  /absolute/path/to/SmartQuote-VietnamDocBench-v0.1-Phase13.1D-PADDLE-PRIVATE \
  gpu-cu126 online
```

The first online run populates the host model cache at:

```text
~/.cache/smartquote-paddleocr-vl-1.6
```

PaddleX receives that cache through `PADDLE_PDX_CACHE_HOME=/model-cache` inside the container. The cache is intentionally not committed into SmartQuote or the private DocBench ZIP.

After an online run has populated the cache, the same image can be run without model-host access:

```bash
npm run bench:phase13.1D:paddle -- \
  /absolute/path/to/private-corpus \
  gpu-cu126 offline
```

Offline mode fails closed when the cache is empty.

## Runtime doctor

The doctor verifies before inference:

- exact PaddleOCR and PaddlePaddle versions;
- `PaddleOCRVL` importability;
- exact locked Python 3.12 and Node 20.19.5;
- requested CPU/GPU availability;
- NVIDIA GPU visibility when the GPU profile is selected;
- model-cache presence;
- DNS reachability when an online model download is needed;
- private frozen manifest / subset / lock presence;
- frozen source-file resolvability;
- locked Linux/x86_64 platform plus disk, memory and observed dependency versions.

A failed doctor exits before the benchmark and cannot create `predictions.json`.

## Evidence produced by a successful run

`reports/phase13.1D-paddleocr-vl-1.6/` contains:

- `runtime-doctor.json`
- `runtime-lock.json`
- `execution-config.json`
- `execution-status.json`
- `predictions.json`
- frozen score report
- row-level error analysis
- route decision
- stdout/stderr/exit-code captures
- `phase13.1D-execution-evidence.json`
- `PHASE_13_1D_EXECUTION.md`

The final evidence includes SHA-256 fingerprints of the runtime lock, adapter, Paddle subset manifest and frozen corpus lock.

## Why PaddleOCR 3.7.0 is pinned

PaddleOCR 3.7.0 is the current published release as of this phase. PaddleOCR-VL-1.6 was introduced in the 3.6 line and remains the default/current PaddleOCR-VL pipeline in the official usage documentation. Pinning the package prevents a future `pip install -U paddleocr` from silently changing benchmark behavior.

## Safety boundary

13.1D only makes the benchmark executable and reproducible. It does **not** make PaddleOCR-VL a SmartQuote production engine.

Even if the real run produces `SCAN_REVIEW_CANARY_ELIGIBLE`, the document router remains untouched. A separate explicit canary phase is required.
