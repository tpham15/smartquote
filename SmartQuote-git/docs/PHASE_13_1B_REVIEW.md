# SmartQuote Phase 13.1B — Self-review

## Scope

Phase 13.1B turns the Phase 13.1A PaddleOCR-VL adapter into a reproducible **execution benchmark** while keeping PaddleOCR-VL fully isolated from production import routing.

Frozen benchmark slice remains unchanged:

- dataset: `smartquote-vietnam-docbench-paddleocr-vl-pdf-slice@0.1.0`
- 3 PDF documents
- 92 frozen product rows
- 8 non-product traps
- source dataset manifest SHA-256: `55c89d74aff86dd484f48e2fc355f58d5d9a462f132856e5e1f8ee2487bae110`

## Added

- `benchmarks/vietnam-docbench/paddleocr-vl-benchmark.mjs`
  - runtime preflight
  - execution fingerprint
  - fail-closed states
  - adapter invocation
  - unchanged frozen scorer invocation
  - slice promotion decision
  - no production promotion flag
- `scripts/phase131b-setup-paddle-local.sh`
- `scripts/phase131b-run-paddle-local.sh`
- `scripts/phase131b-paddle-execution-smoke.mjs`
- `docs/PHASE_13_1B_PADDLEOCR_VL_EXECUTION.md`
- package scripts for setup/run/smoke

## Runtime probe hardening

The bridge no longer marks the environment ready merely because a `paddleocr` module name can be imported. It records:

- PaddleOCR version
- PaddleX version
- PaddlePaddle version
- actual `PaddleOCRVL` class import readiness
- backend
- device
- server presence / API key presence as booleans only

Native execution requires the PaddleOCRVL class and PaddlePaddle runtime. Remote execution additionally requires an explicitly configured server.

## Reproducibility

Every execution records an `execution-config.json` and canonical SHA-256 fingerprint covering:

- dataset id/version/policy
- manifest hash
- adapter hash
- engine/version/config
- backend/device
- runtime versions
- frozen source ids/hashes

Secrets are not serialized.

## Benchmark hygiene

The 13.1A label-blind adapter boundary remains in force. The candidate cannot see ground-truth paths, expected row counts, review evidence, label hashes, or release gates during inference.

Smoke tests verify that:

1. a blocked runtime creates status/config only and **never emits predictions**;
2. a ready fake runtime traverses adapter -> frozen scorer -> promotion decision;
3. the candidate context contains no label fields;
4. promotion remains explicitly disabled for production in 13.1B.

## Real execution attempt in this build environment

Result: **BLOCKED_RUNTIME**.

Observed:

- Python 3.13.5 available
- PaddleOCR not installed
- PaddleX not installed
- PaddlePaddle not installed
- no NVIDIA GPU
- benchmark configured as PaddleOCR-VL-1.6 / native / CPU
- `PaddleOCRVL` class import unavailable
- DNS resolution unavailable for PyPI, PaddlePaddle package host, and Paddle model host

A real package download probe was attempted and failed. The benchmark orchestrator therefore emitted **no predictions and no accuracy metrics**.

This is the correct fail-closed outcome. Phase 13.1B does not turn missing inference into zero-row predictions and does not manufacture benchmark numbers.

Execution config fingerprint for the build-container attempt:

`1becec6a31e95b25b346b2f623576c3e87deea5b024bc87c9f2ac025e94b4ff6`

## Automated tests

PASS:

- `smoke:phase13.1B`
- Phase 13.1A Paddle smoke
- Vietnam DocBench unit suite: 29/29
- Phase 13.1 Document Router
- Phase 13.0B freeze smoke
- Phase 13.0.1 fix-pack smoke
- Phase 12.6.1 auth UI
- Phase 12.6 billing
- Dark Mode Step 6
- Phase 12.5.6 UI spacing
- Phase 12.5.5 Excel drawing cleanup
- Phase 12.4.3 same-origin API (Python + JS)
- tenant isolation
- white-label scrub
- Vercel JSX guard

## Production isolation

`src/**` is byte-identical to Phase 13.1A.

No experimental PaddleOCR module is imported by production code. Phase 13.1B cannot promote an engine to production even if an external run later passes all gates; that requires a separate explicit production phase.

## Remaining blocker to accuracy result

Actual 92-row PaddleOCR-VL-1.6 accuracy requires an environment with:

- internet/model cache,
- PaddlePaddle 3.2.1+,
- `paddleocr[doc-parser]`,
- enough memory/time for the full document pipeline.

The packaged local runner is ready to execute on such an environment without modifying the frozen benchmark.
