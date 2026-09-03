# Phase 13.1B — PaddleOCR-VL execution benchmark

## Goal

Execute PaddleOCR-VL-1.6 against the frozen Vietnam DocBench PDF slice without weakening benchmark hygiene or changing production import routing.

Frozen slice:

- 3 PDF documents
- 92 product rows
- 8 non-product traps
- 53 rows from an image-only Lumi scan PDF
- 39 rows from two digital PDFs

## What Phase 13.1B adds

1. A reproducible benchmark orchestrator: `benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs`.
2. Runtime/config fingerprinting before inference.
3. Fail-closed execution states: `BLOCKED_RUNTIME`, `FAILED_INFERENCE`, or `EXECUTED`.
4. Raw output retention outside Git.
5. Scoring through the unchanged frozen DocBench scorer.
6. Per-input-kind promotion decisions, while keeping `productionPromotionAllowed=false` in this phase.
7. One-command isolated local setup and execution scripts.
8. Smoke coverage proving a blocked runtime never creates fake predictions and a ready fake runtime traverses adapter -> scorer -> promotion end to end.

## Benchmark hygiene

Candidate inference remains label-blind. `run-adapter.mjs` only gives an engine:

- benchmark id/version/policy id,
- document id/input kind/document type/industry/supplier/tags,
- the source file bytes.

It does not receive ground-truth paths, expected row counts, review evidence, release gates, or label hashes.

The execution status/report never serializes credential values. It records only whether server/API-key configuration exists.

## Reproducibility

Every run stores `execution-config.json` containing:

- dataset id/version,
- benchmark policy,
- manifest SHA-256,
- adapter SHA-256,
- engine/version/config,
- Paddle/PaddleOCR/PaddleX versions,
- backend/device,
- source document ids and frozen source hashes.

The canonicalized execution config is itself SHA-256 fingerprinted in `execution-status.json`.

## Local execution

### 1. Create isolated runtime

```bash
npm run setup:phase13.1B:paddle
```

The setup installs PaddlePaddle 3.2.1 and `paddleocr[doc-parser]` into `.venv_paddleocr_vl`. The first inference may download model weights.

### 2. Extract the PRIVATE benchmark package outside Git

Then run:

```bash
npm run bench:phase13.1B:paddle -- /absolute/path/to/private-corpus
```

This verifies the frozen v0.1 corpus before inference, keeps raw Paddle output in the private directory, scores predictions, and writes the promotion decision there.

Default benchmark runtime is:

```text
pipeline = PaddleOCR-VL-1.6
backend  = native
device   = cpu
```

Override with environment variables only when deliberately comparing a second runtime. A changed backend/device is a distinct execution fingerprint and should not silently replace an earlier result.

## Container execution result

The build container was genuinely probed. It has Python 3.13.5 but no `paddle`, `paddleocr`, or `paddlex`. DNS/outbound package/model access is also unavailable in this container, so the official runtime cannot be installed here.

13.1B therefore records `BLOCKED_RUNTIME` and emits **no predictions and no accuracy numbers** in this environment. This is intentional fail-closed behavior, not a synthetic benchmark result.

## Production scope

No Phase 13.1B experimental Paddle module is imported by the production import pipeline. Promotion is impossible in this phase even if a later external execution passes all benchmark gates. A separate explicit production phase is required.
